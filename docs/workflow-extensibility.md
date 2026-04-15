# Workflow Extensibility

This document defines how new workflows are added and how existing workflows evolve safely.

## 1. Model

Workflows should be:

- durable
- declarative at the recipe-binding layer
- explicit in code registration
- easy to test in isolation
- replay-safe
- versionable
- understandable without reading scheduler internals

## 2. Registration flow

1. define capability
2. bind capability to recipes
3. register processors
4. register workflow template
5. add tests and examples

Illustrative shape:

```ts
export const backwallImageToVideoWorkflow = registerWorkflow({
  workflowId: 'backwall-image-to-video',
  capability: 'image.backwall',
  recipes: ['webp-master', 'image-to-video-loop', 'poster-frame'],
  workflowTemplate: 'media-derivation-v1',
});
```

## 3. Template model

The platform should prefer a small number of reusable workflow templates, for example:

- `asset-validation-v1`
- `image-derivation-v1`
- `media-derivation-v1`
- `presentation-normalization-v1`
- `archive-inspection-v1`

Namespace and capability bindings should choose templates and recipes rather than forcing each product to invent an orchestration stack from scratch.

## 3.1 Step-boundary rules

Durability depends on step boundaries being intentional.

Rules:

- give externally meaningful steps stable names
- keep non-deterministic side effects behind durable workflow or activity boundaries
- keep step inputs and outputs small enough that replay and diagnostics stay understandable
- design steps so retries and resume behavior are expected, not surprising
- do not hide waits, approvals, callbacks, or remote polling loops inside opaque helpers

## 4. Constraint

Do not bake product logic into orchestration internals when it can live in recipe bindings or namespace policy.

## 5. Temporal posture

Temporal is the default orchestration engine because the platform needs:

- durable timers
- retries and compensation
- replayable execution history
- explicit workflow and activity ownership

Workflow registration should remain platform-owned and code-defined even if an adopter later chooses a compatible alternative.

Temporal should own:

- workflow history
- timers and backoff
- replay and recovery behavior
- long-running, crash-resistant execution
- activity retries and terminal failure visibility

## 6. Workflow identity and interaction model

Workflow starts should use stable Workflow IDs derived from business identity, not random fire-and-forget starts.

Operator interactions with running workflows should prefer:

- **Queries** for read-only state inspection
- **Signals** for asynchronous control changes
- **Updates** for tracked, state-changing requests that need a returned result

This keeps operator control inside Temporal's durable model instead of inventing a parallel control channel.

## 7. Safe deployment policy

Workflow-code changes must follow Temporal's safe-deployment posture:

- replay tests run before shipping workflow changes
- Worker Versioning is the preferred production posture
- patching APIs are the fallback when Worker Versioning is not yet in use
- rollout plans must distinguish workflow-code changes from activity-only changes

Long-lived workflows should use Continue-As-New when histories approach scaling limits.

## 8. Async execution rules

1. Inline request paths should only do lightweight validation and session setup.
2. Upload completion triggers durable workflows through a workflow-dispatch intent.
3. Every activity should be idempotent or safely repeatable.
4. Every workflow should define terminal states clearly.
5. Operator replay should start from a known workflow and version boundary.
6. Message handlers should not hide non-deterministic behavior.

## 8.1 Wait, cancellation, and operator interaction

Durable waits are part of the workflow model.

Every workflow template should define:

- when it may enter a `waiting` state
- what external event, timer, or operator action resumes it
- how cancellation is requested and recorded
- what replay means for a cancelled or waiting run

If a workflow needs human-in-the-loop behavior, that should be a named durable state with an operator-visible reason, not a hidden convention.

## 8.2 Run-history projection

Temporal remains the execution system of record, but CDNgine should project workflow history into operator-facing run summaries.

Minimum projection fields:

- business-keyed workflow ID
- current run state
- current step or phase
- wait reason
- retry summary
- last failure summary
- last operator action

This follows the stronger operator-facing posture seen in Inngest, Trigger.dev, DBOS, and Restate.

## 9. Testing expectations

Every new workflow should land with:

- a contract example
- registration coverage
- workflow-level tests
- retry and idempotency evidence
- replay compatibility evidence

Recommended workflow tests:

- registration coverage
- recipe expansion behavior
- activity retry behavior
- replay from prior workflow state
- terminal failure handling
- Continue-As-New behavior where long-lived flows use it

## 10. References

- [Temporal safe deployments](https://docs.temporal.io/develop/safe-deployments)
- [Temporal Workflow IDs](https://docs.temporal.io/workflow-execution/workflowid-runid)
- [Temporal TypeScript message passing](https://docs.temporal.io/develop/typescript/workflows/message-passing)
- [Temporal TypeScript Continue-As-New](https://docs.temporal.io/develop/typescript/workflows/continue-as-new)
- [Inngest docs](https://www.inngest.com/docs)
- [Trigger.dev docs](https://trigger.dev/docs)
- [DBOS docs](https://docs.dbos.dev/)
- [Restate docs](https://docs.restate.dev/)
