# ADR-0005: Cache Privacy Classification Baseline

## Status

- Accepted
- Date: 2026-05-21
- Version: 1.0

## Context

`@plasius/graph-cache-redis` stores caller-provided cache envelopes verbatim in Redis.
That keeps the adapter generic, but it also means privacy safety depends on hosts
choosing the right TTLs and refusing to cache sensitive payloads in the first place.

The cross-repo cached-graph rollout requires package-level guidance that explains:

- which cache-entry classes are acceptable,
- how aggressively each class should expire,
- and which payloads must be redacted or avoided entirely.

## Decision

- Publish a package-level `REDIS_CACHE_ENTRY_PRIVACY_GUIDANCE` export.
- Classify payloads into four baseline classes:
  - `public-reference`
  - `tenant-scoped-derived`
  - `sensitive-derived`
  - `secret-or-regulated`
- Treat `secret-or-regulated` payloads as never-cacheable.
- Document the guidance in the README so consuming services can align TTL selection
  and payload minimization with the cached-graph rollout's privacy expectations.

## Consequences

- Hosts get a stable, testable contract for cache TTL and redaction expectations.
- The adapter remains storage-focused and does not attempt unsafe payload inspection.
- Callers still own data minimization, but the package now makes the privacy boundary
  explicit enough for NFR review and operational audit.
