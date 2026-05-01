# Testing Strategy

This repository should be built and evolved in a TDD-first way.

For this platform, tests are not only about correctness. They are the executable proof that idempotency, replay, deterministic keys, and publication behavior are real.

## 1. Order of work

The preferred order is:

1. architecture or contract update
2. failing specification, route, or workflow test
3. narrower unit and integration tests
4. implementation
5. observability and runbook alignment where the change affects operations

## 2. Test layers

| Layer | Primary purpose |
| --- | --- |
| docs checks | architecture, links, and contract alignment |
| schema and contract tests | OpenAPI, manifest, capability, and recipe compatibility |
| unit tests | deterministic key generation, validation rules, mappers, helpers |
| repository and storage integration tests | registry behavior, object publication, signing, idempotency storage |
| workflow tests | retries, replay, timers, compensation, and failure branching |
| API integration tests | auth, validation, route contracts, idempotent mutation behavior |
| end-to-end tests | visible user outcomes across upload, processing, and delivery |
| load and soak tests | throughput, saturation, and degradation behavior |

## 3. High-risk behaviors that must be tested

The platform should explicitly test:

- upload completion idempotency
- replay from the canonical source identity
- source snapshotting and deduplication behavior for repeated binary revisions
- benchmark-matrix behavior across large-file, multi-file, and small-file source workloads when a change claims better dedupe or reconstruction efficiency
- canonical-source evidence persistence for repository engine, digests, and logical-versus-stored size reporting
- unknown-format fallback behavior that preserves originals, digests, and optional container inventory without semantic overclaim
- deterministic derivative key generation
- manifest publication integrity
- signed delivery URL behavior
- workflow registration and recipe expansion
- validation rejection versus retryable infrastructure failure
- partial publication cleanup or recovery
- workflow dispatch idempotency between registry and Temporal
- replay compatibility for workflow-code deployments
- cross-scope denial behavior between service namespaces and tenant scopes

## 4. Workflow testing posture

Temporal workflows should not be treated like opaque background magic.

Expected workflow-test coverage:

- success path
- transient failure with retry
- non-retryable validation failure
- timeout handling
- compensation or cleanup where required
- replay compatibility across workflow evolution
- safe-deployment replay tests against captured workflow histories

## 5. Integration testing posture

The platform needs real integration tests for:

- PostgreSQL registry behavior
- Redis-backed idempotency and ephemeral coordination
- canonical source snapshotting and reconstruction behavior for canonical assets
- derived-store publication semantics
- signature and URL generation
- ingest-target verification and completion semantics
- scoped repository lookups and authorization enforcement

Mock-heavy tests are not enough for storage and workflow boundaries.

### 5.1 Topology coverage

Integration and end-to-end coverage should prove that packaging changes do not change semantics.

At minimum, keep explicit coverage for:

- single-node + multi-bucket
- single-node + single-bucket with prefixes
- adapter behavior that remains stable when later multi-node deployment profiles are introduced

## 5.2 Contract-build expectations

Because the repository is contract-first, the test plan should also validate:

- generated OpenAPI artifacts for each documented API surface
- example payload compatibility with published schemas
- docs consistency around state models and surface ownership

## 6. End-to-end scenario families

At minimum, keep scenario coverage for:

1. image upload to published derivatives
2. video upload to poster and stream publication
3. presentation upload to normalized PDF and slide images
4. archive upload to inspection and policy decision
5. replay of an already-processed asset version

The checked-in root `npm run test` path should execute `tests/conformance/*.test.mjs` after workspace builds so production-facing lifecycle and control-plane assertions cannot silently drift out of CI.

## 7. Failure-injection expectations

The platform should eventually exercise:

- temporary storage unavailability
- worker crash or restart
- malformed file input
- dependency timeout
- duplicate completion requests
- partial derived publication

## 8. Test evidence expected per major change

A mature change should usually leave behind:

- updated docs or contracts
- focused unit coverage
- integration or workflow coverage for changed boundaries
- regression coverage for the bug or failure mode that motivated the change

## 9. References

- [Temporal testing docs](https://docs.temporal.io/develop/typescript/testing-suite)
- [Google Engineering Practices: Testing](https://google.github.io/eng-practices/)
- [Kopia features](https://kopia.io/docs/features/)
