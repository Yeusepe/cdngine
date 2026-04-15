# Conformance

This document defines the executable evidence expected from the repository-level conformance suite.

Architecture prose is necessary, but it is not enough. Conformance is where the repo proves that the documented contracts still behave as promised.

## 1. Purpose

The conformance suite should prove:

1. lifecycle transitions are real and stable
2. idempotency behaves as documented
3. canonical replay starts from source-repository identity
4. deterministic publication stays deterministic
5. operator actions are auditable and policy-bound

## 2. Repository locations

The default layout is:

```text
tests/
  conformance/
  fixtures/
    assets/
```

## 3. Minimum scenario families

| Scenario | What it proves |
| --- | --- |
| upload-session creation and completion | idempotency, scope checks, lifecycle progression |
| canonicalization into the source repository | staged-to-canonical handoff and replay identity |
| workflow dispatch | outbox-to-Temporal behavior and duplicate convergence |
| derivative publication | deterministic keys and manifest integrity |
| private delivery | scope-aware authorization and non-disclosing behavior |
| replay | source-of-truth reconstruction and coherent registry updates |
| quarantine and release | operator controls and policy-aware lifecycle changes |

## 4. Fixture expectations

`tests/fixtures/assets/` should eventually contain:

- valid image fixtures
- valid video fixtures
- valid presentation or PDF fixtures
- malformed or suspicious archive fixtures
- checksum and metadata edge cases

Fixtures should be stable, scrubbed, and tied to scenario IDs rather than ad hoc filenames only.

## 5. Golden evidence

Golden outputs are useful for:

- manifests
- derivative key shapes
- problem-detail payloads
- operator workflow summaries

Golden evidence should be versioned deliberately and regenerated only when the contract meaning truly changed.

## 6. Local vertical slice

The conformance suite should have a matching local platform bring-up in `deploy/local-platform/` so contributors can exercise:

1. upload-session creation
2. resumable ingest
3. canonicalization
4. workflow dispatch
5. one deterministic publication path

## 7. Read more

- [Testing Strategy](./testing-strategy.md)
- [Resilience And Scale Validation](./resilience-and-scale-validation.md)
- [Spec Governance](./spec-governance.md)
- [Repository Layout](./repository-layout.md)
