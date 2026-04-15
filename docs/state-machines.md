# State Machines

This document is the source of truth for durable lifecycle transitions in CDNgine.

The platform already treats lifecycle as explicit state, but implementation needs one place that answers:

1. which states exist
2. who is allowed to move them
3. which transition evidence must be persisted
4. which transitions are terminal, retryable, or operator-controlled

## 1. General rules

All durable lifecycle objects follow these rules:

1. state transitions are persisted in the registry, not inferred from logs
2. transitions are monotonic unless an operator action explicitly defines a controlled reversal
3. every transition records actor, reason, timestamp, and correlation identifiers
4. every transition is idempotent by business key and target state
5. asynchronous execution does not bypass the state machine

## 2. Upload session

### 2.1 States

| State | Meaning |
| --- | --- |
| `session_created` | upload session exists but no bytes are durable yet |
| `uploading` | ingest target has accepted bytes or resumable progress exists |
| `uploaded` | ingest target reports upload completion and staged bytes are present |
| `expired` | upload window elapsed before successful completion |
| `terminated` | upload was explicitly terminated before canonicalization |
| `failed_validation` | ingest-side completion validation failed |

### 2.2 Allowed transitions

| From | To | Actor | Required evidence |
| --- | --- | --- | --- |
| `session_created` | `uploading` | client or ingest subsystem | staged upload handle, first activity timestamp |
| `uploading` | `uploaded` | client completion call or authenticated callback | staged object reference, observed size, completion timestamp |
| `session_created` | `expired` | expiry job | expiry reason |
| `uploading` | `expired` | expiry job | expiry reason, last progress timestamp |
| `session_created` | `terminated` | client or operator | actor, reason |
| `uploading` | `terminated` | client or operator | actor, reason |
| `uploaded` | `failed_validation` | ingest completion handler | validation problem type, diagnostics |

An upload session never transitions back from `uploaded` to `uploading`.

## 3. Asset version

`AssetVersion` is the main cross-boundary lifecycle object.

The most important transition in the whole platform is:

`uploaded -> canonicalizing -> canonical`

That is the boundary where staged bytes stop being "an uploaded file" and become immutable canonical source truth.

### 3.1 States

| State | Meaning |
| --- | --- |
| `session_created` | version exists because upload session was issued |
| `uploading` | bytes are still being transferred |
| `uploaded` | staged bytes exist and completion was accepted |
| `canonicalizing` | the staged object is being verified and committed into the canonical source repository |
| `canonical` | canonical source identity is durable and immutable |
| `processing` | workflow fan-out or derivation work is in progress |
| `published` | required manifest and derivative publication is complete |
| `failed_validation` | content or policy rejected the version |
| `failed_retryable` | infrastructure or transient dependency failure blocked progress |
| `quarantined` | risky or suspicious content is held from further processing |
| `purged` | retention or operator action removed delivery-facing state |

### 3.2 Allowed transitions

| From | To | Actor | Required evidence |
| --- | --- | --- | --- |
| `session_created` | `uploading` | ingest subsystem | upload-session linkage |
| `uploading` | `uploaded` | completion handler | staged object reference, checksum evidence |
| `uploaded` | `canonicalizing` | completion handler | idempotency record, accepted completion request |
| `canonicalizing` | `canonical` | canonicalization worker | source identity fields, digest set, canonical path |
| `canonical` | `processing` | workflow dispatch flow | workflow-dispatch row and workflow ID |
| `processing` | `published` | registry publication flow | manifest publication pointer, derivative set |
| `uploaded` | `failed_validation` | completion handler | problem type, diagnostics |
| `canonicalizing` | `failed_retryable` | canonicalization worker | failure class, retry summary |
| `processing` | `failed_retryable` | workflow or activity | failure class, retry summary |
| `uploaded` | `quarantined` | completion handler or operator | quarantine reason, evidence reference |
| `canonicalizing` | `quarantined` | canonicalization or scanning flow | quarantine reason, evidence reference |
| `processing` | `quarantined` | workflow or operator | quarantine reason, actor |
| `quarantined` | `processing` | operator release | release reason, approving actor, new workflow dispatch |
| `published` | `processing` | operator replay | replay reason, new workflow dispatch |
| `published` | `purged` | operator or retention flow | purge scope, actor, retention basis |
| `failed_retryable` | `processing` | replay or retry flow | replay reason, workflow linkage |

Once a version reaches `canonical`, the canonical source identity never changes.

## 4. Workflow dispatch

`WorkflowDispatch` models the synchronous-to-async handoff.

| State | Meaning |
| --- | --- |
| `pending` | dispatch intent exists but has not been attempted |
| `starting` | dispatcher is attempting Temporal start |
| `started` | Temporal accepted the workflow start |
| `duplicate` | business-keyed workflow already existed and dispatch converged on it |
| `failed_retryable` | start attempt failed transiently |
| `failed_terminal` | start attempt failed and manual intervention is required |

Allowed transitions are:

- `pending` -> `starting`
- `starting` -> `started`
- `starting` -> `duplicate`
- `starting` -> `failed_retryable`
- `starting` -> `failed_terminal`
- `failed_retryable` -> `starting`

## 5. Workflow run projection

The registry projection of workflow execution uses:

- `queued`
- `running`
- `waiting`
- `cancelled`
- `failed`
- `completed`

Each projected update records current phase, wait reason, retry summary, and last operator action.

## 6. Quarantine case

Quarantine is not just a version flag. It is an operator-visible case.

| State | Meaning |
| --- | --- |
| `open` | version is quarantined and action is required |
| `released` | operator approved re-entry to processing |
| `purged` | quarantined content was removed |
| `closed-no-action` | no further operator action was required |

Quarantine release never mutates the canonical source identity. It only authorizes future processing or delivery behavior.

## 7. Publication

Derivative and manifest publication uses:

- `pending`
- `writing`
- `published`
- `failed_retryable`
- `failed_terminal`

Publication must not advance a version to `published` until the manifest pointer and required derivative set are durable.

## 8. Read more

- [Service Architecture](./service-architecture.md)
- [Domain Model](./domain-model.md)
- [Persistence Model](./persistence-model.md)
- [Idempotency And Dispatch](./idempotency-and-dispatch.md)
- [Temporal Message Contracts](./temporal-message-contracts.md)
