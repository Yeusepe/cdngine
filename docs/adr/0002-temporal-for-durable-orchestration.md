# ADR 0002: Temporal For Durable Orchestration

## Status

Accepted

## Context

CDNgine has long-running, failure-prone work:

- video transcoding
- presentation normalization
- slide rasterization
- archive inspection
- replay of already-processed versions

This work requires durable retries, execution history, operator visibility, and replay-safe semantics. Basic queue chaining is not enough.

## Decision

Use Temporal as the default durable workflow engine.

## Alternatives considered

### Queue-only orchestration

Rejected because it hides execution history and makes retries, compensation, and replay harder to reason about.

### Build custom workflow state in SQL and Redis

Rejected because it recreates durable workflow concerns with more risk and less tooling.

## Consequences

- workflow definitions become a first-class part of the codebase
- operators get durable execution history and replay semantics
- tests must cover workflow behavior, not only route behavior
- Hono and the chosen host shell remain the service platform, but Temporal owns long-running orchestration
