# Workflow Extensibility

This document defines how new workflows are added.

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

## 6. Async execution rules

1. Inline request paths should only do lightweight validation and session setup.
2. Upload completion triggers durable workflows.
3. Every activity should be idempotent or safely repeatable.
4. Every workflow should define terminal states clearly.
5. Operator replay should start from a known workflow and version boundary.

## 7. Testing expectations

Every new workflow should land with:

- a contract example
- registration coverage
- workflow-level tests
- retry and idempotency evidence

Recommended workflow tests:

- registration coverage
- recipe expansion behavior
- activity retry behavior
- replay from prior workflow state
- terminal failure handling

## 8. References

- [Temporal documentation](https://docs.temporal.io/)
- [Temporal TypeScript samples](https://github.com/temporalio/samples-typescript)

