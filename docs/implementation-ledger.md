# Implementation Ledger

This document tracks the intended delivery slices for CDNgine.

It exists to stop the architecture from floating free of execution. The ledger should show what a slice is supposed to prove, not just that someone thought about building it.

## 1. Slice ledger

| Slice | Status | What it should prove |
| --- | --- | --- |
| docs-foundation | done | architecture, service model, surface separation, ingest contract, lifecycle state, persistence, compatibility, and platform semantics are documented coherently and now align with the implemented image and presentation slices |
| program-guardrails | done | coded slices stay coupled to governing docs, the programming-practices suite, and explicit upstream references through executable repository checks |
| workspace-foundation | done | the repository can bootstrap as a real TypeScript workspace with build, typecheck, test, and docs-coupling gates instead of only documentation scaffolding |
| registry-foundation | done | the Prisma schema, initial migration, and registry tests lock the durable lifecycle records, uniqueness rules, handoff constraints, and engine-neutral canonical-source evidence fields described by the architecture |
| persistent-registry-runtime | done | Prisma-backed upload-session issuance/completion, durable workflow-dispatch claiming, and public version/source read repositories now run against PostgreSQL with integration tests that prove idempotency, canonicalization evidence, dispatch persistence, and public-read authorization audit behavior |
| storage-adapter-foundation | done | typed staging, canonical-source, derived, exports, and optional ORAS adapter boundaries exist with concrete S3/Kopia/CLI-backed implementations and tests |
| api-core-shell | done | the Hono app factory, auth and scope enforcement, timeout and request-correlation middleware, validation, and RFC 9457 problem responses are implemented and tested together |
| control-plane-contracts | done | lifecycle transitions, persistence writes, idempotency, dispatch, canonicalization, and workflow operator interaction are specified precisely enough to implement safely and are backed by route, registry, workflow, and conformance tests |
| contracts-and-schemas | done | public API, manifests, capability schemas, event shapes, SDK workflow artifacts, and contract-governance scaffolding have a concrete repository home plus executable lint, bundle, and example-validation gates |
| ingest-foundation | done | upload sessions, canonical source snapshotting over a bucket-or-prefix-backed source repository, and idempotent completion behave correctly across single-node or multi-node plus one-bucket or multi-bucket topologies |
| format-agnostic-normalization-contract | done | capability registrations declare safe preserve-original fallback semantics for unknown formats, generic workflow resolution now converges on the fallback capability, and canonical-source contracts capture repository-engine plus reconstruction evidence without hard-coding any one asset family |
| image-mvp | done | the platform can validate, derive, publish, and deliver deterministic image outputs through one client-facing authorization flow even when internal resolution paths differ across the supported topology matrix |
| deployment-profile-foundation | done | one-bucket and multi-bucket runtime profiles plus readiness requirements are expressed as typed config and checked-in deployment examples instead of only prose |
| xet-deployment-surface | done | local and production runtime examples, readiness expectations, secret inputs, and rollback guidance now make the Xet-default deployment surface explicit while keeping the temporary Kopia compatibility lane operator-visible |
| sdk-foundation | done | the bundled public contract generates checked-in TypeScript client artifacts, freshness checks, and consumer-facing quickstart docs |
| video-mvp | planned | the platform can orchestrate long-running video work and publish poster plus stream outputs |
| presentation-mvp | done | the platform can resolve presentation workflow templates from source content type, normalize canonical presentations to PDF plus slide images, publish presentation manifests, and prove the flow through conformance tests |
| operator-foundation | done | replay, quarantine, diagnostics, audit surfaces, runbooks, and threat-model expectations are explicit and usable |
| product-surfaces | done | the public client now exposes configurable production upload scope plus version, manifest, source, and delivery inspection, while the operator app now ships a real audited console over diagnostics and recovery actions instead of placeholder workspace shells |
| prod-hardening | done | runtime auth config, dependency-backed readiness, trace propagation, structured request telemetry, Prometheus metrics, production verification runbooks, and checked-in conformance execution now align with a company-facing deployment posture |
| architecture-conformance-audit | done | every major implemented code area is mapped back to architecture responsibilities, governing docs, and executable evidence with no remaining undocumented workload-specific drift in the public manifest or workflow-selection surfaces |
| output-workflow-foundation | done | the platform can trigger a registered output workflow at authorization time, replace the resolved URL with the workflow-produced URL, and surface the run record additively in the authorization response; tests confirm backward compat when no store is configured, correct URL replacement on complete, and 404 on unknown workflow ID |
| source-plane-strategy | done | format-agnostic fallback rules are explicit, the storage plus registry contracts record engine-neutral byte-reuse evidence without collapsing `AssetVersion` identity, and the repo includes executable Xet and Kopia proof workloads that support rollout regression checks, migration validation, and long-term source-plane diagnostics |
| xet-rollout-contract | done | governing docs, ADRs, deployment posture, traceability, and checked-in migration tooling now make Xet the default canonical source engine for new canonicalizations, keep legacy Kopia-backed versions readable during the temporary dual-read migration, and give operators an explicit inventory plus re-canonicalization path without silently rewriting legacy audit evidence |
| semantic-normalization-tooling-evaluation | done | semantic-normalization functions, upstream tooling categories, fallback semantics, and benchmark guidance are now documented in a format-agnostic way so capability-owned adapters can evolve without hard-coding one file type into core architecture |
| semantic-normalization-scope-boundary | done | the first dedupe project is now explicitly limited to universal byte-level reuse plus fallback-safe capability boundaries, while cross-format semantic reuse is deferred to a separate parser, intermediate, semantic-evidence, and sidecar-oriented workstream |

## 2. Rules for updating the ledger

Update the ledger when:

- a slice meaning changes
- a slice splits into smaller milestones
- an architectural decision invalidates an old execution plan
- evidence exists that materially changes confidence in the slice

## 3. What each slice entry should eventually link to

Each mature slice should eventually point to:

1. governing docs
2. contracts or schemas
3. test evidence
4. operational evidence
5. known risks or deferred work

## 4. Relationship to traceability

The ledger answers **what we intend to deliver**.

The traceability document answers **what evidence is expected to support the claims behind that delivery**.

## 5. Read more

- [Traceability](./traceability.md)
- [Testing Strategy](./testing-strategy.md)
- [Resilience And Scale Validation](./resilience-and-scale-validation.md)
