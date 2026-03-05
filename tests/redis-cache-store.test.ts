import type { CacheEnvelope } from "@plasius/graph-contracts";
import { describe, expect, it } from "vitest";

import { RedisCacheStore } from "../src/redis-cache-store.js";

class FakeRedis {
  private readonly store = new Map<string, string>();
  public readonly setCalls: Array<{ key: string; value: string; args: Array<string | number> }> = [];

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async mget(...keys: string[]): Promise<Array<string | null>> {
    return keys.map((key) => this.store.get(key) ?? null);
  }

  async set(key: string, value: string, ...args: Array<string | number>): Promise<string> {
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

const envelope = <T>(key: string, value: T, version: number): CacheEnvelope<T> => ({
  key,
  value,
  fetchedAtEpochMs: version,
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
});
