# Problem Types

This document is the catalog of stable RFC 9457 problem types for CDNgine.

Every public problem response should include:

- `type`
- `title`
- `status`
- `detail`
- `instance` where relevant
- platform identifiers such as `assetId`, `versionId`, or `workflowId` when safe
- `retryable`

## 1. Core problem catalog

| Type | Status | Retryable | Meaning |
| --- | --- | --- | --- |
| `https://docs.cdngine.dev/problems/invalid-request` | `400` | no | request shape or basic validation failed |
| `https://docs.cdngine.dev/problems/unauthorized` | `401` | no | caller is not authenticated |
| `https://docs.cdngine.dev/problems/forbidden` | `403` | no | caller is authenticated but not allowed on the control plane |
| `https://docs.cdngine.dev/problems/scope-not-allowed` | `403` | no | caller cannot act in the requested namespace or tenant scope |
| `https://docs.cdngine.dev/problems/not-found` | `404` | no | addressed resource does not exist or should not be disclosed |
| `https://docs.cdngine.dev/problems/idempotency-key-conflict` | `409` | no | same idempotency key was reused for a different semantic request |
| `https://docs.cdngine.dev/problems/invalid-state-transition` | `409` | no | request is not allowed from the current lifecycle state |
| `https://docs.cdngine.dev/problems/upload-session-expired` | `410` | no | upload session expired before valid completion |
| `https://docs.cdngine.dev/problems/upload-not-finished` | `409` | yes | completion was requested before staged bytes were durably present |
| `https://docs.cdngine.dev/problems/checksum-mismatch` | `422` | no | staged bytes did not match expected integrity evidence |
| `https://docs.cdngine.dev/problems/unsupported-media-type` | `415` | no | uploaded content class is not supported by policy or capability |
| `https://docs.cdngine.dev/problems/validation-failed` | `422` | no | content or metadata violated validation rules |
| `https://docs.cdngine.dev/problems/quarantined` | `423` | no | asset or version is quarantined pending operator action |
| `https://docs.cdngine.dev/problems/version-not-ready` | `409` | yes | requested derivative, manifest, or authorization target is not yet published |
| `https://docs.cdngine.dev/problems/delivery-scope-not-found` | `404` | no | delivery scope does not exist or should not be disclosed |
| `https://docs.cdngine.dev/problems/delivery-not-authorized` | `404` | no | delivery request lacked valid authorization for a private asset |
| `https://docs.cdngine.dev/problems/upstream-dependency-failed` | `503` | yes | a required dependency such as Xet, derived storage, or Temporal failed |
| `https://docs.cdngine.dev/problems/workflow-dispatch-failed` | `503` | yes | the request committed but durable workflow start could not be completed yet |
| `https://docs.cdngine.dev/problems/operator-action-rejected` | `409` | no | requested replay, quarantine, release, or purge action was rejected by policy or state |

## 2. Public versus control-plane posture

- public delivery should generally use non-disclosing `404` responses for unauthorized private reads
- authenticated control-plane APIs may return `403` or `409` when the distinction is useful to the caller
- internal services may carry richer diagnostics, but public problem types stay stable

## 3. Idempotency expectations

Problem responses must document whether callers may safely retry:

- validation and policy failures are not retryable without changing input
- transient upstream failures are retryable
- idempotency conflicts are not retryable with the same key and altered input

## 4. Read more

- [API Style Guide](./api-style-guide.md)
- [API Surface](./api-surface.md)
- [Security Model](./security-model.md)
- [RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html)
