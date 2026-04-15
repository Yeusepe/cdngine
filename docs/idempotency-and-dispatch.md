# Idempotency And Dispatch

This document defines how mutating requests stay retry-safe and how request-path work hands off to Temporal.

## 1. General idempotency rules

Every mutating boundary defines:

1. idempotency key scope
2. normalized request identity
3. durable completion evidence
4. duplicate-request behavior
5. operator-visible failure mode

Durable idempotency evidence belongs in PostgreSQL. Redis may help with short dedupe windows, but it is not authoritative.

## 2. Boundaries that require idempotency

| Boundary | Scope |
| --- | --- |
| `POST /v1/upload-sessions` | caller scope + namespace + asset identity intent |
| `POST /v1/upload-sessions/{id}/complete` | upload session + caller scope |
| operator replay | asset version + replay reason |
| operator quarantine | asset version + quarantine reason |
| operator release | quarantine case + asset version |
| operator purge | asset version + purge scope |

## 3. `IdempotencyRecord` minimum fields

Each record should include:

- API surface
- caller scope
- normalized operation key
- idempotency key
- normalized request hash where relevant
- final response reference or materialized response payload
- terminality marker
- created and completed timestamps

## 4. Duplicate behavior

### 4.1 Same request, same durable result

Return the original response shape and correlation identifiers.

### 4.2 Same idempotency key, different semantic request

Return a typed conflict response. This should map to a problem type such as `idempotency-key-conflict`.

### 4.3 Duplicate completion after workflow already exists

Converge on the existing `WorkflowDispatch` or business-keyed Temporal workflow instead of starting parallel work.

## 5. Dispatch contract

The request path never starts workflow work as a best-effort side effect after commit.

Required posture:

1. canonicalization succeeds and canonical source identity becomes durable
2. request path or completion flow creates `WorkflowDispatch` in the registry
3. the version is already in `canonical` when dispatch is created
4. dispatcher polls or subscribes to pending rows
5. dispatcher attempts the Temporal start with a business-keyed workflow ID
6. dispatcher records `started`, `duplicate`, `failed_retryable`, or `failed_terminal`

`WorkflowDispatch` is therefore a **post-canonicalization** record, not a placeholder created while the version is still only staged.

## 6. Business-keyed workflow identity

Workflow IDs are derived from stable platform inputs, typically:

- `serviceNamespaceId`
- `assetId`
- `versionId`
- workflow template or replay reason

This keeps duplicate completion or replay requests from fanning out into parallel workflow executions.

## 7. Dispatch retry policy

Retry-safe dispatch failures include:

- transient Temporal unavailability
- network failure after accepted SQL commit but before confirmed start response
- worker-deployment routing mismatch that is expected to resolve during rollout

Retry-unsafe or operator-visible failures include:

- invalid workflow template binding
- missing workflow input contract
- non-retryable authorization or scope mismatch

## 8. Operator visibility

Operators must be able to answer:

- did the request commit?
- was canonicalization completed?
- does a `WorkflowDispatch` row exist?
- was a workflow actually started?
- if not, why not?

## 9. Read more

- [Service Architecture](./service-architecture.md)
- [State Machines](./state-machines.md)
- [Persistence Model](./persistence-model.md)
- [Workflow Extensibility](./workflow-extensibility.md)
- [Prisma transactions, idempotent APIs, and OCC](https://www.prisma.io/docs/orm/prisma-client/queries/transactions)
