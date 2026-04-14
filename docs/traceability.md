# Traceability

This document ties platform claims to evidence expectations.

It should be possible to point from a major architectural promise to the docs, tests, and operational evidence that support it.

## 1. Core traceability matrix

| Claim | Evidence target |
| --- | --- |
| raw assets are immutable | Oxen integration behavior, storage contract docs, and replay tests |
| workflows are durable and replayable | Temporal workflow tests, operator runbooks, and retry/replay telemetry |
| derivatives are deterministic | key-generation tests, manifest assertions, and repeat-processing evidence |
| new file types are easy to add | capability registration docs, schema examples, and registration tests |
| API is easy to consume | OpenAPI artifacts, generated SDK docs, examples, and error-shape examples |
| delivery does not depend on Oxen on the hot path | architecture diagrams, delivery tests, and CDN/origin telemetry |
| operator actions are auditable | audit-event schema, operator APIs, and observability coverage |

## 2. Evidence categories

The main evidence categories are:

- governing architecture and service docs
- machine-readable contracts
- executable tests
- operational dashboards and alerts
- runbooks and threat models
- implementation ledger entries

## 3. How to use this document

When a new major claim appears in docs, ask:

1. where is the authoritative doc for the claim?
2. what executable evidence should eventually back it up?
3. what operator-facing evidence should exist?
4. what slice in the implementation ledger is responsible for it?

If none of those answers exist, the claim is underspecified.

## 4. Read more

- [Implementation Ledger](./implementation-ledger.md)
- [Testing Strategy](./testing-strategy.md)
- [Observability](./observability.md)
- [Security Model](./security-model.md)
