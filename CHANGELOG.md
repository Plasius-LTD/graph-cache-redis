# Changelog

All notable changes to this project will be documented in this file.

The format is based on **[Keep a Changelog](https://keepachangelog.com/en/1.1.0/)**, and this project adheres to **[Semantic Versioning](https://semver.org/spec/v2.0.0.html)**.

---

## [Unreleased]

- **Added**
  - Stampede lease primitives: `acquireStampedeLease` and `releaseStampedeLease`.
  - Command retry controls (`maxCommandRetries`, `retryDelayMs`, `retryJitterRatio`).
  - Stale fallback read behavior with hard TTL enforcement.
  - Optional telemetry sink support for retry/error/fallback/lease analytics.
  - Integration-style tests for failover, reconnect, and stale fallback expiry.
  - Telemetry behavior test coverage for cache adapter runtime signals.
  - ADR-0003 documenting resilient read and stampede strategy.

- **Changed**
  - README now includes resilience and stampede usage guidance.

- **Fixed**
  - N/A

- **Security**
  - N/A

## [0.1.1] - 2026-03-05

### Added

- Initial package scaffolding.
- Initial source implementation and baseline tests.
- CI/CD workflow baseline for GitHub Actions and npm publish path.


[0.1.1]: https://github.com/Plasius-LTD/graph-cache-redis/releases/tag/v0.1.1
