# Temporal Message Contracts

This document defines how CDNgine interacts with running workflows through Temporal message passing.

The goal is to keep operator actions durable, typed, auditable, and replay-safe instead of inventing side channels around the workflow engine.

## 1. Message types

CDNgine uses Temporal message types with these semantics:

| Type | Use when | Key rule |
| --- | --- | --- |
| Query | caller needs read-only workflow state | must not mutate workflow state or perform async work |
| Signal | caller needs fire-and-record control input without immediate result | may mutate state but does not return a value |
| Update | caller needs tracked, state-changing behavior with acceptance and optional result | may mutate state and return a value |

## 2. Default operator action mapping

| Operation | Temporal primitive | Why |
| --- | --- | --- |
| get workflow summary | Query | read-only status inspection |
| request cancellation | Update | caller should know whether the request was accepted |
| request replay or reprocess | Update | state-changing, policy-bound, should return accepted run metadata |
| quarantine during processing | Update | state-changing and should be validated before history acceptance |
| release from quarantine | Update | state-changing and should return the next action |
| non-critical nudges or annotations | Signal | no synchronous result needed |

## 3. Validator rules

Update validators should reject requests before they are written to history when the action is not allowed.

Use validators for:

- invalid state transitions
- missing operator authority or action basis
- duplicate replay requests that should converge on existing work
- release or quarantine actions that conflict with current policy

Validators are non-async and use the same arguments as the Update handler.

Replay and reprocess validators should explicitly reject requests when:

- the version is not yet `canonical`
- canonical source identity is missing
- policy forbids replay from the current lifecycle state

## 4. Handler rules

1. define message types as exported workflow-level identifiers
2. prefer a single input object over positional arguments
3. keep Query handlers synchronous and side-effect free
4. keep Signal and Update handlers explicit about state mutation
5. record operator action identifiers and reasons in workflow state projection

## 5. Continue-As-New and exactly-once posture

Long-lived workflows may use Continue-As-New, but message handling must still preserve exactly-once reasoning.

When a workflow continues as new:

- dedupe keys and current action IDs must survive handoff when needed
- Update IDs should be available for deduplication or audit correlation where the workflow template needs it

## 6. Operator-facing contract

Every operator-exposed message should define:

- stable message name
- required input fields
- validation rules
- whether the action is retriable
- expected run-state changes
- expected audit projection fields

## 7. Read more

- [Workflow Extensibility](./workflow-extensibility.md)
- [Service Architecture](./service-architecture.md)
- [State Machines](./state-machines.md)
- [Temporal TypeScript message passing](https://docs.temporal.io/develop/typescript/message-passing)
- [Temporal Worker Versioning](https://docs.temporal.io/production-deployment/worker-deployments/worker-versioning)
