# ADR-0004: Cache Adapter Telemetry Baseline

## Status

- Accepted
- Date: 2026-03-06
- Version: 1.0

## Context

Redis failover behavior (retries, stale fallback, lease contention) directly impacts read SLOs and must be observable for early incident detection.

## Decision

- Add optional telemetry sink to `RedisCacheStoreOptions`.
- Emit metrics for command retries/errors, fallback reads, and lease acquire/release outcomes.
- Emit structured command-failure errors through `TelemetrySink`.

## Consequences

- Cache failure mode behavior is measurable and alertable.
- Adapter remains infra-agnostic and testable through injected telemetry.
