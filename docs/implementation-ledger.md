# Implementation Ledger

This document tracks the intended delivery slices for CDNgine.

It exists to stop the architecture from floating free of execution. The ledger should show what a slice is supposed to prove, not just that someone thought about building it.

## 1. Slice ledger

| Slice | Status | What it should prove |
| --- | --- | --- |
| docs-foundation | doing | architecture, service model, surface separation, ingest contract, and platform semantics are documented coherently |
| contracts-and-schemas | planned | public API, manifests, capability schemas, event shapes, and SDK workflow artifacts become machine-readable |
| ingest-foundation | planned | upload sessions, scoped Oxen repository commits, and idempotent completion behave correctly |
| image-mvp | planned | the platform can validate, derive, publish, and deliver deterministic image outputs |
| video-mvp | planned | the platform can orchestrate long-running video work and publish poster plus stream outputs |
| presentation-mvp | planned | the platform can normalize presentations and publish slide-oriented manifests and derivatives |
| operator-foundation | planned | replay, quarantine, diagnostics, and audit surfaces are usable |

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
