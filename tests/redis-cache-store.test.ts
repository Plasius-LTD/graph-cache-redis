import type { CacheEnvelope } from "@plasius/graph-contracts";
import { describe, expect, it } from "vitest";

import { RedisCacheStore } from "../src/redis-cache-store.js";

class FakeRedis {
  private readonly store = new Map<string, string>();
  public readonly setCalls: Array<{ key: string; value: string; args: Array<string | number> }> = [];
  public failReads = false;
  public transientReadFailures = 0;
  public observedReadFailures = 0;

  async get(key: string): Promise<string | null> {
    if (this.failReads || this.transientReadFailures > 0) {
      this.observedReadFailures += 1;
      if (this.transientReadFailures > 0) {
        this.transientReadFailures -= 1;
      }
      throw new Error("redis unavailable");
    }
    return this.store.get(key) ?? null;
  }

  async mget(...keys: string[]): Promise<Array<string | null>> {
    if (this.failReads || this.transientReadFailures > 0) {
      this.observedReadFailures += 1;
      if (this.transientReadFailures > 0) {
        this.transientReadFailures -= 1;
      }
      throw new Error("redis unavailable");
    }
    return keys.map((key) => this.store.get(key) ?? null);
  }

  async set(key: string, value: string, ...args: Array<string | number>): Promise<string | null> {
    const hasNx = args.includes("NX");
    if (hasNx && this.store.has(key)) {
      this.setCalls.push({ key, value, args });
      return null;
    }

    this.store.set(key, value);
    this.setCalls.push({ key, value, args });
    return "OK";
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.store.delete(key)) {
        removed += 1;
      }
    }

    return removed;
  }
}

const envelope = <T>(key: string, value: T, version: number, fetchedAtEpochMs = version): CacheEnvelope<T> => ({
  key,
  value,
  fetchedAtEpochMs,
  policy: { softTtlSeconds: 1, hardTtlSeconds: 5 },
  version,
  schemaVersion: "1",
  source: "resolver",
  tags: ["user"],
});

describe("RedisCacheStore", () => {
  it("stores and fetches cache envelopes", async () => {
    const redis = new FakeRedis();
    const store = new RedisCacheStore({ redis, namespace: "test" });

    await store.set("user:1", envelope("user:1", { name: "alice" }, 1));

    const value = await store.get<{ name: string }>("user:1");
    const missing = await store.get("user:missing");

    expect(value?.value).toEqual({ name: "alice" });
    expect(missing).toBeNull();
    expect(redis.setCalls[0]?.args).toEqual([]);
  });

  it("supports mget and mset operations", async () => {
    const store = new RedisCacheStore({ redis: new FakeRedis(), namespace: "test" });

    expect(await store.mget([])).toEqual([]);

    await store.mset([
      { key: "user:1", envelope: envelope("user:1", { id: 1 }, 1) },
      { key: "user:2", envelope: envelope("user:2", { id: 2 }, 1) },
    ]);

    const values = await store.mget<{ id: number }>(["user:1", "user:2", "user:missing"]);
    expect(values[0]?.value).toEqual({ id: 1 });
    expect(values[1]?.value).toEqual({ id: 2 });
    expect(values[2]).toBeNull();
  });

  it("invalidates keys and handles empty invalidation list", async () => {
    const store = new RedisCacheStore({ redis: new FakeRedis(), namespace: "test" });

    await store.mset([
      { key: "user:1", envelope: envelope("user:1", { id: 1 }, 1) },
      { key: "user:2", envelope: envelope("user:2", { id: 2 }, 1) },
    ]);

    const removed = await store.invalidate(["user:1", "user:2"]);
    const none = await store.invalidate([]);

    expect(removed).toBe(2);
    expect(none).toBe(0);
  });

  it("compareAndSet requires matching version when expectedVersion is provided", async () => {
    const redis = new FakeRedis();
    const store = new RedisCacheStore({ redis, namespace: "test" });

    await store.set("user:1", envelope("user:1", { version: 1 }, 1));

    const rejected = await store.compareAndSet(
      "user:1",
      envelope("user:1", { version: 2 }, 2),
      999,
    );

    const accepted = await store.compareAndSet(
      "user:1",
      envelope("user:1", { version: 2 }, 2),
      1,
    );

    const forced = await store.compareAndSet("user:1", envelope("user:1", { version: 3 }, 3));

    expect(rejected).toBe(false);
    expect(accepted).toBe(true);
    expect(forced).toBe(true);
    expect(redis.setCalls.at(-1)?.args).toEqual([]);
  });

  it("writes ttl options using EX", async () => {
    const redis = new FakeRedis();
    const store = new RedisCacheStore({ redis, namespace: "test" });

    await store.set("user:1", envelope("user:1", { id: 1 }, 1), { ttlSeconds: 30 });
    await store.mset(
      [{ key: "user:2", envelope: envelope("user:2", { id: 2 }, 1) }],
      { ttlSeconds: 15 },
    );

    expect(redis.setCalls[0]?.args).toEqual(["EX", 30]);
    expect(redis.setCalls[1]?.args).toEqual(["EX", 15]);
  });

  it("provides stampede lease primitives", async () => {
    const redis = new FakeRedis();
    const store = new RedisCacheStore({ redis, namespace: "test" });

    const ownerA = await store.acquireStampedeLease("user:1", { ownerId: "owner-a", ttlSeconds: 5 });
    const ownerB = await store.acquireStampedeLease("user:1", { ownerId: "owner-b", ttlSeconds: 5 });

    expect(ownerA).toBe("owner-a");
    expect(ownerB).toBeNull();
    expect(await store.releaseStampedeLease("user:1", "owner-b")).toBe(false);
    expect(await store.releaseStampedeLease("user:1", "owner-a")).toBe(true);
  });

  it("serves stale fallback data during redis read failover", async () => {
    let now = 1_000;
    const redis = new FakeRedis();
    const store = new RedisCacheStore({
      redis,
      namespace: "test",
      now: () => now,
      maxCommandRetries: 0,
      enableStaleFallback: true,
    });

    await store.set("user:1", envelope("user:1", { id: 1 }, 1, now));
    redis.failReads = true;

    const duringFailover = await store.get<{ id: number }>("user:1");
    expect(duringFailover?.value).toEqual({ id: 1 });

    redis.failReads = false;
    now += 100;
    await store.set("user:1", envelope("user:1", { id: 2 }, 2, now));

    const afterRecovery = await store.get<{ id: number }>("user:1");
    expect(afterRecovery?.value).toEqual({ id: 2 });
  });

  it("drops stale fallback once hard ttl is exceeded", async () => {
    let now = 0;
    const redis = new FakeRedis();
    const store = new RedisCacheStore({
      redis,
      namespace: "test",
      now: () => now,
      maxCommandRetries: 0,
      enableStaleFallback: true,
    });

    await store.set("user:1", {
      ...envelope("user:1", { id: 1 }, 1, 0),
      policy: { softTtlSeconds: 1, hardTtlSeconds: 1 },
    });

    now = 2_500;
    redis.failReads = true;
    const expiredFallback = await store.get("user:1");
    expect(expiredFallback).toBeNull();
  });

  it("retries transient read failures and succeeds after reconnect", async () => {
    const redis = new FakeRedis();
    const store = new RedisCacheStore({
      redis,
      namespace: "test",
      maxCommandRetries: 2,
      retryDelayMs: 0,
    });

    await store.set("user:1", envelope("user:1", { id: 1 }, 1));
    redis.transientReadFailures = 1;

    const recovered = await store.get<{ id: number }>("user:1");
    expect(recovered?.value).toEqual({ id: 1 });
    expect(redis.observedReadFailures).toBe(1);
  });
});
