# ADR-0003: Resilient Read and Stampede Primitives

## Status

- Accepted
- Date: 2026-03-06
- Version: 1.0

## Context

The cache adapter must support high read availability during Redis failover windows and provide primitives to avoid thundering-herd revalidation.

## Decision

- Add command retry controls (`maxCommandRetries`, `retryDelayMs`) for transient Redis failures.
- Add stale fallback reads with hard TTL enforcement to preserve read continuity when Redis is unavailable.
- Add stampede lease primitives:
  - `acquireStampedeLease`
  - `releaseStampedeLease`

## Consequences

- Read path remains available with bounded stale data when Redis is briefly unavailable.
- Hosts can coordinate revalidation ownership without introducing package-level queue coupling.
- Additional in-memory fallback state requires careful TTL enforcement and observability at host level.
