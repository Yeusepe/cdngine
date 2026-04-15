# Traceability

This document ties platform claims to evidence expectations.

It should be possible to point from a major architectural promise to the docs, tests, and operational evidence that support it.

## 1. Core traceability matrix

| Claim | Evidence target |
| --- | --- |
| raw assets are immutable and deduplicated canonically | Xet integration behavior, storage contract docs, and replay tests |
| workflows are durable and replayable | Temporal workflow tests, operator runbooks, and retry/replay telemetry |
| derivatives are deterministic | key-generation tests, manifest assertions, and repeat-processing evidence |
| new file types are easy to add | capability registration docs, schema examples, and registration tests |
| API is easy to consume | OpenAPI artifacts, generated SDK docs, examples, and error-shape examples |
| delivery does not depend on Xet on the hot path | architecture diagrams, delivery tests, and CDN/origin telemetry |
| operator actions are auditable | audit-event schema, operator APIs, and observability coverage |
| upload completion is exactly-once at the control-plane boundary | idempotency tests, workflow-dispatch evidence, and registry transaction design docs |
| service namespace, tenant scope, and asset owner remain distinct | domain-model docs, auth tests, and policy examples |
| scoping is enforced programmatically rather than by naming convention | service-architecture docs, scoped repository tests, and security-model rules |
| Xet is used as the canonical deduplicated content plane rather than as raw S3 keys | Xet topology docs, file-identity persistence, replay tests, and operator diagnostics |
| SDKs feel code-first rather than like thin REST wrappers | OpenAPI and Arazzo artifacts, generated SDK outputs, and end-to-end upload examples |
| lifecycle transitions are explicit and operator-visible | state-machine docs, API lifecycle fields, and workflow or repository tests |
| persistence boundaries are atomic and diagnosable | persistence docs, idempotency-dispatch docs, transaction tests, and audit evidence |
| running workflows are controlled through durable message contracts | Temporal message-contract docs, operator API docs, and workflow interaction tests |
| contract evolution is rollout-safe | compatibility docs, replay evidence, generated SDK updates, and migration notes |
| public failures share a stable vocabulary | problem-type docs, OpenAPI examples, and SDK error handling examples |
| contract artifacts are governed instead of ad hoc | spec-governance docs, lint outputs, example validation, and breaking-change review evidence |
| operational targets are explicit | SLO docs, dashboards, alerts, and runbooks |

## 2. Evidence categories

The main evidence categories are:

- governing architecture and service docs
- machine-readable contracts
- executable tests
- operational dashboards and alerts
- runbooks and threat models
- conformance fixtures and scenarios
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
