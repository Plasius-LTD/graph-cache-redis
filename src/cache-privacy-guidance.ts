export interface CacheEntryPrivacyGuidance {
  /**
   * Stable identifier for this cache-entry class.
   */
  readonly id: string;
  /**
   * Whether payloads in this class are acceptable for Redis caching at all.
   */
  readonly cacheable: boolean;
  /**
   * Brief description of the payload class.
   */
  readonly summary: string;
  /**
   * Suggested soft TTL in seconds for stale-read policy decisions.
   */
  readonly softTtlSeconds: number;
  /**
   * Suggested hard TTL in seconds for absolute retention bounds.
   */
  readonly hardTtlSeconds: number;
  /**
   * Operational retention guidance for this class.
   */
  readonly retentionExpectation: string;
  /**
   * Redaction or avoidance rule that callers must apply before caching.
   */
  readonly redactionRule: string;
  /**
   * Representative payload examples for the class.
   */
  readonly examples: readonly string[];
}

/**
 * Package-level guidance for classifying graph cache payloads before they are
 * written to Redis. The adapter stores caller-provided envelopes verbatim, so
 * hosts remain responsible for minimizing payloads and selecting bounded TTLs.
 */
export const REDIS_CACHE_ENTRY_PRIVACY_GUIDANCE: readonly CacheEntryPrivacyGuidance[] = [
  {
    id: "public-reference",
    cacheable: true,
    summary: "Public or low-sensitivity reference data that is already safe to disclose to every authorized reader.",
    softTtlSeconds: 60,
    hardTtlSeconds: 900,
    retentionExpectation: "May use the longest TTL in this package, but still requires an explicit hard TTL and source-driven invalidation.",
    redactionRule: "Exclude diagnostic metadata that is not required for the consumer response.",
    examples: [
      "feature-flag manifests without actor context",
      "public taxonomy lookups",
      "renderer-safe configuration snapshots",
    ],
  },
  {
    id: "tenant-scoped-derived",
    cacheable: true,
    summary: "Tenant- or account-scoped derived projections that are safe only after field minimization.",
    softTtlSeconds: 30,
    hardTtlSeconds: 300,
    retentionExpectation: "Keep TTLs short and align the hard TTL with the source system's privacy and rollback window.",
    redactionRule: "Strip raw identifiers, free-text notes, and any fields that are not required by the read model before caching.",
    examples: [
      "account dashboard counters",
      "graph-backed menu summaries",
      "moderation queue aggregates without evidence bodies",
    ],
  },
  {
    id: "sensitive-derived",
    cacheable: true,
    summary: "Sensitive but cacheable derived payloads that must be aggressively minimized and retained only briefly.",
    softTtlSeconds: 15,
    hardTtlSeconds: 60,
    retentionExpectation: "Use only when the caller can justify short-lived caching and prove the hard TTL stays below the source retention boundary.",
    redactionRule: "Pseudonymize user references, omit direct identifiers where possible, and never store raw auth/session material alongside the payload.",
    examples: [
      "short-lived authorization decision projections",
      "privacy-safe entitlement snapshots",
      "derived admin safety indicators without source evidence",
    ],
  },
  {
    id: "secret-or-regulated",
    cacheable: false,
    summary: "Secrets, raw credentials, regulated data, or unredacted personal data that must never be written to Redis through this adapter.",
    softTtlSeconds: 0,
    hardTtlSeconds: 0,
    retentionExpectation: "Do not cache. Resolve from the authoritative secret or protected data store on demand.",
    redactionRule: "Avoid caching entirely; tokens, passwords, recovery codes, raw identity claims, and unredacted PII must never enter the envelope value.",
    examples: [
      "OAuth access or refresh tokens",
      "password hashes or recovery codes",
      "raw moderation evidence or unredacted identity records",
    ],
  },
] as const;
