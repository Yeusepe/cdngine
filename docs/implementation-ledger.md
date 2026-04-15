# Implementation Ledger

This document tracks the intended delivery slices for CDNgine.

It exists to stop the architecture from floating free of execution. The ledger should show what a slice is supposed to prove, not just that someone thought about building it.

## 1. Slice ledger

| Slice | Status | What it should prove |
| --- | --- | --- |
| docs-foundation | doing | architecture, service model, surface separation, ingest contract, lifecycle state, persistence, compatibility, and platform semantics are documented coherently |
| program-guardrails | done | coded slices stay coupled to governing docs, the programming-practices suite, and explicit upstream references through executable repository checks |
| workspace-foundation | done | the repository can bootstrap as a real TypeScript workspace with build, typecheck, test, and docs-coupling gates instead of only documentation scaffolding |
| registry-foundation | done | the Prisma schema, initial migration, and registry tests lock the durable lifecycle records, uniqueness rules, and handoff constraints described by the architecture |
| storage-adapter-foundation | done | typed staging, canonical-source, derived, exports, and optional ORAS adapter boundaries exist with concrete S3/Kopia/CLI-backed implementations and tests |
| api-core-shell | done | the Hono app factory, auth and scope enforcement, timeout and request-correlation middleware, validation, and RFC 9457 problem responses are implemented and tested together |
| control-plane-contracts | doing | lifecycle transitions, persistence writes, idempotency, dispatch, canonicalization, and workflow operator interaction are specified precisely enough to implement safely |
| contracts-and-schemas | done | public API, manifests, capability schemas, event shapes, SDK workflow artifacts, and contract-governance scaffolding have a concrete repository home plus executable lint, bundle, and example-validation gates |
| ingest-foundation | doing | upload sessions, canonical source snapshotting over a bucket-or-prefix-backed source repository, and idempotent completion behave correctly across single-node or multi-node plus one-bucket or multi-bucket topologies |
| image-mvp | done | the platform can validate, derive, publish, and deliver deterministic image outputs through one client-facing authorization flow even when internal resolution paths differ across the supported topology matrix |
| deployment-profile-foundation | done | one-bucket and multi-bucket runtime profiles plus readiness requirements are expressed as typed config and checked-in deployment examples instead of only prose |
| sdk-foundation | done | the bundled public contract generates checked-in TypeScript client artifacts, freshness checks, and consumer-facing quickstart docs |
| video-mvp | planned | the platform can orchestrate long-running video work and publish poster plus stream outputs |
| presentation-mvp | planned | the platform can normalize presentations and publish slide-oriented manifests and derivatives |
| operator-foundation | done | replay, quarantine, diagnostics, audit surfaces, runbooks, and threat-model expectations are explicit and usable |

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
