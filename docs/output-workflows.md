# Output Workflows

This document defines output workflows: programmatic transformations that run at **download authorization time** and modify the file before delivery.

Output workflows are distinct from ingest-time derivation workflows. Ingest-time workflows (`image-derivation-v1`, `media-derivation-v1`, etc.) run once after upload and produce durable, static derivatives stored in the derived store. Output workflows run **per authorization request**, when a client calls `source/authorize` or `deliveries/{deliveryScopeId}/authorize` and supplies an `outputWorkflow` field in the request body.

Representative use cases:

- inject a per-recipient license key into a software archive
- embed a watermark or recipient identifier into an image download
- add a recipient-specific metadata manifest to a document

## 1. Trigger model

An output workflow is triggered when the authorization request body includes:

```json
{
  "outputWorkflow": {
    "outputWorkflowId": "license-key-injection-v1",
    "outputParameters": {
      "licenseKey": "ORG-12345-XXXX",
      "licensee": "Acme Corp"
    }
  }
}
```

Both `source/authorize` and `deliveries/{deliveryScopeId}/authorize` accept this field.

`outputParameters` is an arbitrary key-value object passed directly to the output workflow. The API layer treats it as opaque data; the output workflow implementation is responsible for validating and applying it.

The platform constructs an `OutputWorkflowTriggerContext` from the authorization request and passes it to the configured `OutputWorkflowStore`. The context includes:

| Field | Description |
| --- | --- |
| `assetId` | the asset being downloaded |
| `versionId` | the version being downloaded |
| `authorizationKind` | `'source'` or `'delivery'` |
| `deliveryScopeId` | present when `authorizationKind === 'delivery'` |
| `idempotencyKey` | from the `Idempotency-Key` request header |
| `now` | the request timestamp |
| `outputWorkflowId` | the requested output workflow |
| `outputParameters` | the caller-supplied transformation parameters |
| `resolvedUrl` | the URL that the base authorization step resolved, before transformation |

## 2. Run record

The `OutputWorkflowStore.triggerOutputWorkflow()` method returns an `OutputWorkflowRunRecord`:

| Field | Description |
| --- | --- |
| `runId` | stable identifier for this run (idempotent per `idempotencyKey`) |
| `outputWorkflowId` | the workflow that was triggered |
| `state` | `'pending'`, `'running'`, `'complete'`, or `'failed'` |
| `url` | the workflow-produced download URL (present when `state === 'complete'`) |
| `expiresAt` | expiration of the produced artifact (present when `state === 'complete'`) |

### State meanings

| State | Meaning | Client action |
| --- | --- | --- |
| `pending` | workflow is queued but not yet executing | retry with the same `idempotencyKey` after a short delay |
| `running` | workflow is executing | retry with the same `idempotencyKey` |
| `complete` | transformation is done; `url` is ready | use `url` to download the modified file |
| `failed` | transformation failed terminally | treat as a delivery failure; do not retry with the same parameters |

## 3. Response shape

Output workflows are **additive** to the authorization response. Existing clients that do not send `outputWorkflow` in the request body receive exactly the same response as before.

When an output workflow is triggered, the authorization response gains an `outputWorkflowRun` field:

```json
{
  "assetId": "ast_001",
  "authorizationMode": "signed-url",
  "expiresAt": "2026-01-15T19:00:00.000Z",
  "resolvedOrigin": "source-export",
  "url": "https://transforms.cdngine.local/output/run_001",
  "versionId": "ver_001",
  "outputWorkflowRun": {
    "runId": "run_001",
    "outputWorkflowId": "license-key-injection-v1",
    "state": "complete",
    "url": "https://transforms.cdngine.local/output/run_001",
    "expiresAt": "2026-01-15T19:00:00.000Z"
  }
}
```

When `state === 'complete'` and the run produced a `url`, the top-level `url` is replaced with the workflow-produced URL. This means clients that do not inspect `outputWorkflowRun` still receive a working download URL automatically.

When `state` is `'pending'` or `'running'`, the top-level `url` is unchanged (it points to the original resolved URL), and clients should poll by retrying the authorization request with the same `Idempotency-Key` until `state === 'complete'`.

## 4. Store contract

`OutputWorkflowStore` is the interface that production and test implementations satisfy:

```ts
interface OutputWorkflowStore {
  triggerOutputWorkflow(context: OutputWorkflowTriggerContext): Promise<OutputWorkflowRunRecord>;
}
```

Every implementation must:

1. **Be idempotent within the scope of `idempotencyKey`.** Repeated calls with the same `idempotencyKey` must return the same `runId` and, once `state === 'complete'`, the same `url`.
2. **Reject same-key semantic drift.** Reusing the same `idempotencyKey` with a different asset, version, authorization kind, delivery scope, output workflow ID, or output parameters must return `https://docs.cdngine.dev/problems/idempotency-key-conflict`.
3. **Respect scope.** Output workflows receive the same authorization context as the base authorization step and must not serve content outside the authorized scope.
4. **Declare async behavior explicitly.** If the implementation cannot complete synchronously within the authorization timeout, it must return `state: 'pending'` or `state: 'running'` — not block indefinitely.
5. **Throw `UnknownOutputWorkflowError`** when `outputWorkflowId` is not registered. This maps to a 404 problem response.

## 5. Using `InMemoryOutputWorkflowStore` in tests

The `InMemoryOutputWorkflowStore` is a test-friendly fake that resolves immediately. Use it by registering named handlers:

```ts
import {
  InMemoryOutputWorkflowStore,
  createImmediateOutputWorkflowHandler
} from '@cdngine/api/public/output-workflow-service';

const outputWorkflowStore = new InMemoryOutputWorkflowStore({
  handlers: new Map([
    [
      'license-key-injection-v1',
      createImmediateOutputWorkflowHandler(
        (ctx) => `https://transforms.cdngine.local/output/${ctx.runId}`
      )
    ]
  ]),
  runIdFactory: () => 'owrun_001'  // deterministic for assertions
});
```

Pass it to `registerDeliveryRoutes` or `registerDownloadLinkRoutes` via `DeliveryRouteDependencies.outputWorkflowStore`.

An unregistered `outputWorkflowId` throws `UnknownOutputWorkflowError` → 404 in tests.

## 6. Registered templates

The `output-delivery-v1` Temporal workflow template handles download-time transformations. It is registered on the `output-processing` task queue.

```ts
import { outputWorkflowTemplates } from '@cdngine/workflows';
// outputWorkflowTemplates[0].workflowTemplateId === 'output-delivery-v1'
// outputWorkflowTemplates[0].taskQueue === 'output-processing'
```

Namespace and capability bindings that need output transformation should reference `output-delivery-v1` rather than inventing a new template.

## 7. Security posture

Output workflows run in the delivery path after authorization is already established. They must not:

- bypass the scope checks enforced by `requireRequestedScope`
- accept `outputWorkflowId` values that have not been registered in the platform
- use `outputParameters` to access assets outside the authorized version

The `outputWorkflowId` is validated against the registered store. An unrecognized ID returns 404, not 400, because it is a missing resource reference, not a schema error.

## 8. Read more

- [Architecture](./architecture.md) — lifecycle and delivery plane
- [Workflow Extensibility](./workflow-extensibility.md) — template model and registration
- [API Surface](./api-surface.md) — authorization endpoint contracts
- [Original Source Delivery](./original-source-delivery.md) — source authorization read path
- [Security Model](./security-model.md) — scope and authorization posture
