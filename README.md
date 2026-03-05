# @plasius/graph-cache-redis

[![npm version](https://img.shields.io/npm/v/@plasius/graph-cache-redis.svg)](https://www.npmjs.com/package/@plasius/graph-cache-redis)
[![Build Status](https://img.shields.io/github/actions/workflow/status/Plasius-LTD/graph-cache-redis/ci.yml?branch=main&label=build&style=flat)](https://github.com/Plasius-LTD/graph-cache-redis/actions/workflows/ci.yml)
[![coverage](https://img.shields.io/codecov/c/github/Plasius-LTD/graph-cache-redis)](https://codecov.io/gh/Plasius-LTD/graph-cache-redis)
[![License](https://img.shields.io/github/license/Plasius-LTD/graph-cache-redis)](./LICENSE)
[![Code of Conduct](https://img.shields.io/badge/code%20of%20conduct-yes-blue.svg)](./CODE_OF_CONDUCT.md)
[![Security Policy](https://img.shields.io/badge/security%20policy-yes-orange.svg)](./SECURITY.md)
[![Changelog](https://img.shields.io/badge/changelog-md-blue.svg)](./CHANGELOG.md)

[![CI](https://github.com/Plasius-LTD/graph-cache-redis/actions/workflows/ci.yml/badge.svg)](https://github.com/Plasius-LTD/graph-cache-redis/actions/workflows/ci.yml)
[![CD](https://github.com/Plasius-LTD/graph-cache-redis/actions/workflows/cd.yml/badge.svg)](https://github.com/Plasius-LTD/graph-cache-redis/actions/workflows/cd.yml)

Redis-backed cache adapter implementing the graph cache store port.

Apache-2.0. ESM + CJS builds. TypeScript types included.

---

## Requirements

- Node.js 24+ (matches `.nvmrc` and CI/CD)
- Redis-compatible server
- `ioredis`

---

## Installation

```bash
npm install @plasius/graph-cache-redis ioredis
```

---

## Exports

```ts
import {
  RedisCacheStore,
  type RedisLike,
  type RedisCacheStoreOptions,
} from "@plasius/graph-cache-redis";
```

---

## Quick Start

```ts
import Redis from "ioredis";
import { RedisCacheStore } from "@plasius/graph-cache-redis";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const cacheStore = new RedisCacheStore({ redis, namespace: "graph" });

await cacheStore.set("user:1", {
  key: "user:1",
  value: { id: 1 },
  fetchedAtEpochMs: Date.now(),
  policy: { softTtlSeconds: 30, hardTtlSeconds: 300 },
  version: 1,
  schemaVersion: "1",
  source: "user.profile",
  tags: ["user"],
}, { ttlSeconds: 300 });
```

---

## Development

```bash
npm run clean
npm install
npm run lint
npm run typecheck
npm run test:coverage
npm run build
```

---

## Architecture

- Package ADRs: [`docs/adrs`](./docs/adrs)
- Cross-package ADRs: `plasius-ltd-site/docs/adrs/adr-0020` to `adr-0024`

---

## License

Licensed under the [Apache-2.0 License](./LICENSE).
