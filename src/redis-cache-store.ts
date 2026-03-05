import type { CacheEnvelope, CacheSetOptions, CacheStore, Version } from "@plasius/graph-contracts";

export interface RedisLike {
  get(key: string): Promise<string | null>;
  mget(...keys: string[]): Promise<Array<string | null>>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
}

export interface RedisCacheStoreOptions {
  redis: RedisLike;
  namespace?: string;
}

export class RedisCacheStore implements CacheStore {
  private readonly redis: RedisLike;
  private readonly namespace: string;

  public constructor(options: RedisCacheStoreOptions) {
    this.redis = options.redis;
    this.namespace = options.namespace ?? "graph";
  }

  public async get<T>(key: string): Promise<CacheEnvelope<T> | null> {
    const value = await this.redis.get(this.ns(key));
    return this.deserialize<T>(value);
  }

  public async mget<T>(keys: string[]): Promise<Array<CacheEnvelope<T> | null>> {
    if (keys.length === 0) {
      return [];
    }

    const values = await this.redis.mget(...keys.map((key) => this.ns(key)));
    return values.map((value) => this.deserialize<T>(value));
  }

  public async set<T>(key: string, envelope: CacheEnvelope<T>, options?: CacheSetOptions): Promise<void> {
    await this.writeEnvelope(this.ns(key), envelope, options?.ttlSeconds);
  }

  public async mset<T>(entries: Array<{ key: string; envelope: CacheEnvelope<T> }>, options?: CacheSetOptions): Promise<void> {
    for (const entry of entries) {
      await this.writeEnvelope(this.ns(entry.key), entry.envelope, options?.ttlSeconds);
    }
  }

  public async invalidate(keys: string[]): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }

    return this.redis.del(...keys.map((key) => this.ns(key)));
  }

  public async compareAndSet<T>(
    key: string,
    nextEnvelope: CacheEnvelope<T>,
    expectedVersion?: Version,
    options?: CacheSetOptions,
  ): Promise<boolean> {
    const redisKey = this.ns(key);
    const currentRaw = await this.redis.get(redisKey);

    if (expectedVersion !== undefined) {
      const current = this.deserialize<unknown>(currentRaw);
      if (!current || current.version !== expectedVersion) {
        return false;
      }
    }

    await this.writeEnvelope(redisKey, nextEnvelope, options?.ttlSeconds);
    return true;
  }

  private ns(key: string): string {
    return `${this.namespace}:${key}`;
  }

  private deserialize<T>(value: string | null): CacheEnvelope<T> | null {
    if (!value) {
      return null;
    }

    return JSON.parse(value) as CacheEnvelope<T>;
  }

  private async writeEnvelope<T>(redisKey: string, envelope: CacheEnvelope<T>, ttlSeconds?: number): Promise<void> {
    const payload = JSON.stringify(envelope);
    if (!ttlSeconds || ttlSeconds <= 0) {
      await this.redis.set(redisKey, payload);
      return;
    }

    await this.redis.set(redisKey, payload, "EX", ttlSeconds);
  }
}
