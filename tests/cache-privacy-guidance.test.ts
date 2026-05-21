import { describe, expect, it } from "vitest";

import { REDIS_CACHE_ENTRY_PRIVACY_GUIDANCE } from "../src/index.js";

describe("REDIS_CACHE_ENTRY_PRIVACY_GUIDANCE", () => {
  it("defines unique class ids", () => {
    const ids = REDIS_CACHE_ENTRY_PRIVACY_GUIDANCE.map((entry) => entry.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps ttl expectations internally consistent", () => {
    for (const entry of REDIS_CACHE_ENTRY_PRIVACY_GUIDANCE) {
      if (!entry.cacheable) {
        expect(entry.softTtlSeconds).toBe(0);
        expect(entry.hardTtlSeconds).toBe(0);
        continue;
      }

      expect(entry.softTtlSeconds).toBeGreaterThan(0);
      expect(entry.hardTtlSeconds).toBeGreaterThanOrEqual(entry.softTtlSeconds);
    }
  });

  it("includes a never-cache class for secrets and regulated data", () => {
    expect(REDIS_CACHE_ENTRY_PRIVACY_GUIDANCE).toContainEqual(
      expect.objectContaining({
        id: "secret-or-regulated",
        cacheable: false,
      }),
    );
  });
});
