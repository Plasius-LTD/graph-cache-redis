import type { CacheEnvelope, CacheSetOptions, CacheStore, TelemetrySink, Version } from "@plasius/graph-contracts";

export interface RedisLike {
  get(key: string): Promise<string | null>;
  mget(...keys: string[]): Promise<Array<string | null>>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
}

export interface RedisCacheStoreOptions {
  redis: RedisLike;
  namespace?: string;
  maxCommandRetries?: number;
  retryDelayMs?: number;
  enableStaleFallback?: boolean;
  now?: () => number;
  telemetry?: TelemetrySink;
}

export interface StampedeLeaseOptions {
  ttlSeconds?: number;
  ownerId?: string;
}

export class RedisCacheStore implements CacheStore {
  private readonly redis: RedisLike;
  private readonly namespace: string;
  private readonly maxCommandRetries: number;
  private readonly retryDelayMs: number;
  private readonly enableStaleFallback: boolean;
  private readonly now: () => number;
  private readonly telemetry?: TelemetrySink;
  private readonly staleFallbackStore = new Map<string, CacheEnvelope<unknown>>();

  public constructor(options: RedisCacheStoreOptions) {
    this.redis = options.redis;
    this.namespace = options.namespace ?? "graph";
    this.maxCommandRetries = Math.max(0, options.maxCommandRetries ?? 1);
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? 10);
    this.enableStaleFallback = options.enableStaleFallback ?? true;
    this.now = options.now ?? (() => Date.now());
    this.telemetry = options.telemetry;
  }

  public async get<T>(key: string): Promise<CacheEnvelope<T> | null> {
    const redisKey = this.ns(key);
    try {
      const value = await this.exec(() => this.redis.get(redisKey));
      const envelope = this.deserialize<T>(value);
      if (envelope) {
        this.staleFallbackStore.set(redisKey, envelope as CacheEnvelope<unknown>);
      }
      this.telemetry?.metric({
        name: "graph.redis.read.success",
        value: 1,
        unit: "count",
        tags: { op: "get" },
      });
      return envelope;
    } catch {
      this.telemetry?.metric({
        name: "graph.redis.read.fallback",
        value: 1,
        unit: "count",
        tags: { op: "get" },
      });
      return this.readStaleFallback<T>(redisKey);
    }
  }

  public async mget<T>(keys: string[]): Promise<Array<CacheEnvelope<T> | null>> {
    if (keys.length === 0) {
      return [];
    }

    const redisKeys = keys.map((key) => this.ns(key));
    try {
      const values = await this.exec(() => this.redis.mget(...redisKeys));
      return values.map((value, index) => {
        const envelope = this.deserialize<T>(value);
        if (envelope) {
          this.staleFallbackStore.set(redisKeys[index]!, envelope as CacheEnvelope<unknown>);
        }
        return envelope;
      });
    } catch {
      this.telemetry?.metric({
        name: "graph.redis.read.fallback",
        value: 1,
        unit: "count",
        tags: { op: "mget" },
      });
      return redisKeys.map((redisKey) => this.readStaleFallback<T>(redisKey));
    }
  }

  public async set<T>(key: string, envelope: CacheEnvelope<T>, options?: CacheSetOptions): Promise<void> {
    const redisKey = this.ns(key);
    await this.writeEnvelope(redisKey, envelope, options?.ttlSeconds);
    this.staleFallbackStore.set(redisKey, envelope as CacheEnvelope<unknown>);
  }

  public async mset<T>(entries: Array<{ key: string; envelope: CacheEnvelope<T> }>, options?: CacheSetOptions): Promise<void> {
    for (const entry of entries) {
      const redisKey = this.ns(entry.key);
      await this.writeEnvelope(redisKey, entry.envelope, options?.ttlSeconds);
      this.staleFallbackStore.set(redisKey, entry.envelope as CacheEnvelope<unknown>);
    }
  }

  public async invalidate(keys: string[]): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }

    const redisKeys = keys.map((key) => this.ns(key));
    const removed = await this.exec(() => this.redis.del(...redisKeys));
    for (const redisKey of redisKeys) {
      this.staleFallbackStore.delete(redisKey);
    }
    return removed;
  }

  public async compareAndSet<T>(
    key: string,
    nextEnvelope: CacheEnvelope<T>,
    expectedVersion?: Version,
    options?: CacheSetOptions,
  ): Promise<boolean> {
    const redisKey = this.ns(key);
    let currentRaw: string | null;
    try {
      currentRaw = await this.exec(() => this.redis.get(redisKey));
    } catch {
      const stale = this.readStaleFallback<unknown>(redisKey);
      currentRaw = stale ? JSON.stringify(stale) : null;
    }

    if (expectedVersion !== undefined) {
      const current = this.deserialize<unknown>(currentRaw);
      if (!current || current.version !== expectedVersion) {
        return false;
      }
    }

    await this.writeEnvelope(redisKey, nextEnvelope, options?.ttlSeconds);
    this.staleFallbackStore.set(redisKey, nextEnvelope as CacheEnvelope<unknown>);
    return true;
  }

  public async acquireStampedeLease(key: string, options: StampedeLeaseOptions = {}): Promise<string | null> {
    const ttlSeconds = Math.max(1, Math.floor(options.ttlSeconds ?? 5));
    const ownerId = options.ownerId ?? `${this.now()}_${Math.random().toString(36).slice(2)}`;
    const leaseKey = this.leaseKey(key);
    const result = await this.exec(() => this.redis.set(leaseKey, ownerId, "EX", ttlSeconds, "NX"));
    this.telemetry?.metric({
      name: "graph.redis.lease.acquire",
      value: 1,
      unit: "count",
      tags: {
        acquired: result === "OK" ? "true" : "false",
      },
    });
    return result === "OK" ? ownerId : null;
  }

  public async releaseStampedeLease(key: string, ownerId: string): Promise<boolean> {
    const leaseKey = this.leaseKey(key);
    const current = await this.exec(() => this.redis.get(leaseKey));
    if (current !== ownerId) {
      this.telemetry?.metric({
        name: "graph.redis.lease.release",
        value: 1,
        unit: "count",
        tags: { released: "false" },
      });
      return false;
    }

    await this.exec(() => this.redis.del(leaseKey));
    this.telemetry?.metric({
      name: "graph.redis.lease.release",
      value: 1,
      unit: "count",
      tags: { released: "true" },
    });
    return true;
  }

  private ns(key: string): string {
    return `${this.namespace}:${key}`;
  }

  private leaseKey(key: string): string {
    return `${this.ns(key)}:lease`;
  }

  private deserialize<T>(value: string | null): CacheEnvelope<T> | null {
    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value) as CacheEnvelope<T>;
    } catch {
      return null;
    }
  }

  private async writeEnvelope<T>(redisKey: string, envelope: CacheEnvelope<T>, ttlSeconds?: number): Promise<void> {
    const payload = JSON.stringify(envelope);
    if (!ttlSeconds || ttlSeconds <= 0) {
      await this.exec(() => this.redis.set(redisKey, payload));
      return;
    }

    await this.exec(() => this.redis.set(redisKey, payload, "EX", ttlSeconds));
  }

  private async exec<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxCommandRetries; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt < this.maxCommandRetries) {
          this.telemetry?.metric({
            name: "graph.redis.command.retry",
            value: 1,
            unit: "count",
          });
          await this.wait(this.retryDelayMs);
        }
      }
    }

    const message = lastError instanceof Error ? lastError.message : "redis command failed";
    this.telemetry?.metric({
      name: "graph.redis.command.error",
      value: 1,
      unit: "count",
    });
    this.telemetry?.error({
      message,
      source: "graph-cache-redis",
      code: "REDIS_COMMAND_FAILED",
    });
    throw lastError;
  }

  private async wait(delayMs: number): Promise<void> {
    if (delayMs <= 0) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  private readStaleFallback<T>(redisKey: string): CacheEnvelope<T> | null {
    if (!this.enableStaleFallback) {
      return null;
    }

    const fallback = this.staleFallbackStore.get(redisKey) as CacheEnvelope<T> | undefined;
    if (!fallback) {
      return null;
    }

    const hardTtlMs = Math.max(1, fallback.policy.hardTtlSeconds) * 1000;
    if (this.now() - fallback.fetchedAtEpochMs > hardTtlMs) {
      this.staleFallbackStore.delete(redisKey);
      return null;
    }

    return fallback;
  }
}
