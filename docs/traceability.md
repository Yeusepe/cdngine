# Traceability

This document ties platform claims to evidence expectations.

It should be possible to point from a major architectural promise to the docs, tests, and operational evidence that support it.

## 1. Core traceability matrix

| Claim | Evidence target |
| --- | --- |
| raw assets are immutable and deduplicated canonically | canonical source integration behavior, storage contract docs, and replay tests |
| unknown file types still survive canonicalization without format-specific code | capability fallback docs, capability registration tests, and upload-completion contract tests |
| semantic normalization remains capability-owned, benchmarked, and format-agnostic | semantic-normalization scope-boundary and tooling-evaluation docs, capability registration docs, conformance fixtures for fallback and semantic evidence, and adapter-specific benchmark notes |
| workflows are durable and replayable | Temporal workflow tests, operator runbooks, and retry/replay telemetry |
| derivatives are deterministic | key-generation tests, manifest assertions, and repeat-processing evidence |
| new file types are easy to add | capability registration docs, schema examples, and registration tests |
| API is easy to consume | OpenAPI artifacts, generated SDK docs, examples, and error-shape examples |
| one client-facing authorization flow can resolve hot delivery, cached export, or canonical reconstruction without changing the public contract | API-surface docs, architecture diagrams, source-delivery docs, and end-to-end authorization tests |
| delivery does not depend on the canonical source repository on the hot path | architecture diagrams, delivery tests, and CDN/origin telemetry |
| operator actions are auditable | audit-event schema, operator APIs, and observability coverage |
| upload completion is exactly-once at the control-plane boundary | idempotency tests, workflow-dispatch evidence, and registry transaction design docs |
| service namespace, tenant scope, and asset owner remain distinct | domain-model docs, auth tests, and policy examples |
| scoping is enforced programmatically rather than by naming convention | service-architecture docs, scoped repository tests, and security-model rules |
| the canonical source repository is used as the deduplicated source plane rather than raw object keys | source topology docs, file-identity persistence, replay tests, and operator diagnostics |
| Xet is the default canonical source engine for new canonicalizations while legacy Kopia-backed versions remain readable until migration/backfill/signoff retire them, and that rollout does not change `AssetVersion` identity semantics | source-plane strategy doc, ADR 0012, deployment and migration notes, implementation-ledger entry `xet-rollout-contract`, `npm run source:migration`, `scripts/source-migration.test.mjs`, storage contract tests, benchmark proof tests, and operator migration signoff evidence |
| single-bucket deployments preserve the same platform semantics through prefixes and policy | deployment docs, storage-contract docs, and integration tests against one-bucket fixtures |
| SDKs feel code-first rather than like thin REST wrappers | OpenAPI and Arazzo artifacts, generated SDK outputs, and end-to-end upload examples |
| lifecycle transitions are explicit and operator-visible | state-machine docs, API lifecycle fields, and workflow or repository tests |
| persistence boundaries are atomic and diagnosable | persistence docs, idempotency-dispatch docs, transaction tests, and audit evidence |
| running workflows are controlled through durable message contracts | Temporal message-contract docs, operator API docs, and workflow interaction tests |
| contract evolution is rollout-safe | compatibility docs, replay evidence, generated SDK updates, and migration notes |
| public failures share a stable vocabulary | problem-type docs, OpenAPI examples, and SDK error handling examples |
| contract artifacts are governed instead of ad hoc | spec-governance docs, lint outputs, example validation, and breaking-change review evidence |
| operational targets are explicit | SLO docs, dashboards, alerts, and runbooks |
| production control-plane hardening is real rather than demo-shaped | deployment docs, auth runtime config, `/healthz` + `/readyz` + `/metrics` tests, conformance execution in `npm run test`, and the production cutover runbook |

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

## 4. Code-to-architecture audit matrix

This matrix is the current architecture-conformance audit for the implemented codebase. It maps each major code area to its architecture responsibility, governing docs, and the executable evidence that currently backs the implementation.

| Code area | Architecture responsibility | Governing docs | Executable evidence | Audit result |
| --- | --- | --- | --- | --- |
| `apps/api/src/public/upload-session-routes.ts` and `apps/api/src/upload-session-service.ts` | issue immutable revisions, enforce staged-to-canonical handoff, and create durable workflow-dispatch intent | `docs/service-architecture.md`, `docs/idempotency-and-dispatch.md`, `docs/persistence-model.md`, `docs/state-machines.md` | `apps/api/test/upload-session-routes.test.mjs`, `tests/conformance/image-lifecycle.test.mjs`, `tests/conformance/presentation-lifecycle.test.mjs` | aligned; completion now resolves workflow templates from capability registrations, persists shared engine-neutral canonical-source evidence, and the current workflow-facing replay seam rehydrates that persisted evidence because there is not yet a separate production restore worker path |
| `apps/api/src/public/delivery-routes.ts` and `apps/api/src/public/delivery-service.ts` | expose immutable version reads, manifest-first publication, and storage-topology-independent delivery or source authorization | `docs/api-surface.md`, `docs/original-source-delivery.md`, `docs/storage-tiering-and-materialization.md` | `apps/api/test/delivery-routes.test.mjs`, `tests/conformance/image-lifecycle.test.mjs`, `tests/conformance/presentation-lifecycle.test.mjs` | aligned; manifest links are workload-aware instead of image-only |
| `packages/capabilities/src/*` | register supported workloads, processors, and workflow-template routing | `docs/pipeline-capability-model.md`, `docs/workload-and-recipe-matrix.md`, `docs/workflow-extensibility.md` | `packages/capabilities/test/image-capability.test.mjs`, `packages/capabilities/test/presentation-capability.test.mjs` | aligned; image and presentation workloads share one capability-driven routing surface |
| `packages/manifests/src/*` | preserve deterministic derivative keys and manifest payload stability across replay | `docs/domain-model.md`, `docs/versioning-and-compatibility.md`, `docs/adr/0003-deterministic-derivative-keys.md` | `packages/manifests/test/image-manifest.test.mjs`, `packages/manifests/test/presentation-manifest.test.mjs` | aligned; image and presentation manifests both use deterministic publication keys and stable ordering |
| `packages/registry/src/*publication-store.ts` | project canonical versions into processing and published control-plane state with deterministic upsert semantics | `docs/domain-model.md`, `docs/persistence-model.md`, `docs/state-machines.md` | `packages/registry/test/image-publication-store.test.mjs`, `packages/registry/test/presentation-publication-store.test.mjs` | aligned; publication records remain durable registry truth, not storage truth |
| `packages/workflows/src/*publication-workflow.ts` and dispatch runtime files | orchestrate replay-safe publication from canonical source truth into derived delivery truth | `docs/workflow-extensibility.md`, `docs/temporal-message-contracts.md`, `docs/architecture.md` | `packages/workflows/test/image-publication-workflow.test.mjs`, `packages/workflows/test/presentation-publication-workflow.test.mjs`, `packages/workflows/test/dispatch-runtime.test.mjs` | aligned; workflow-specific processing stays behind stable dispatch and publication boundaries |
| `packages/storage/src/*`, `packages/observability/src/*`, and `packages/auth/src/index.ts` runtime config helpers | keep storage-role normalization, auth deployment posture, trace propagation, metrics, and readiness requirements outside route handlers | `docs/environment-and-deployment.md`, `docs/security-model.md`, `docs/observability.md` | `packages/storage/test/*.mjs`, `packages/observability/test/readiness-profile.test.mjs`, `packages/observability/test/runtime-observability.test.mjs`, `packages/auth/test/runtime-auth-config.test.mjs` | aligned; production deployment wiring now has checked-in auth, trace, log, metrics, and readiness evidence instead of placeholder readiness alone |
| `packages/sdk/src/*` and `contracts/openapi/public.openapi.yaml` | keep the public contract synchronized with implemented upload, version, manifest, and authorization behavior | `docs/spec-governance.md`, `docs/sdk-strategy.md`, `docs/api-style-guide.md`, `docs/problem-types.md` | `npm run contracts:check`, `npm run sdk:generate`, `npm run sdk:check`, `packages/sdk/test/public-client.test.mjs` | aligned after widening manifest responses to image or presentation payloads |
| `tests/conformance/*.test.mjs` | prove the documented lifecycle across API, canonicalization, dispatch, publication, operator action, public delivery, and production control-plane hardening boundaries | `docs/conformance.md`, `docs/testing-strategy.md`, `docs/architecture.md`, `docs/observability.md` | `tests/conformance/image-lifecycle.test.mjs`, `tests/conformance/presentation-lifecycle.test.mjs`, `tests/conformance/demo-api-flow.test.mjs`, `tests/conformance/production-hardening.test.mjs` | aligned; conformance now covers both workload lifecycles and production-facing observability surfaces |

## 5. Read more

- [Implementation Ledger](./implementation-ledger.md)
- [Testing Strategy](./testing-strategy.md)
- [Observability](./observability.md)
- [Security Model](./security-model.md)
