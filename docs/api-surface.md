# API Surface

This document defines the intended external API groups for CDNgine.

It focuses on the product-facing contract, not the full set of private internal service calls that may exist behind the chosen host shell.

## 1. Public API groups

The initial public API should expose these groups:

| Group | Purpose |
| --- | --- |
| assets | logical asset identity and lookup |
| versions | canonical uploaded versions |
| derivatives | processed delivery artifacts |
| manifests | manifest-first retrieval for complex assets |
| namespaces | service and domain registration |
| capabilities | file-type and processor registration validation |
| operations | replay, quarantine, and operator workflows |

## 2. Core endpoints

- `POST /v1/assets/upload-sessions`
- `POST /v1/assets/{assetId}/complete`
- `GET /v1/assets/{assetId}`
- `GET /v1/assets/{assetId}/versions/{versionId}`
- `GET /v1/assets/{assetId}/derivatives`
- `GET /v1/assets/{assetId}/manifests/{manifestType}`
- `POST /v1/assets/{assetId}/reprocess`
- `POST /v1/service-namespaces/register`
- `POST /v1/capabilities/validate`

## 3. Public versus private service posture

The platform should distinguish clearly between:

- **public APIs** exposed to external SDKs and product teams
- **private APIs** used only for internal service coordination inside the CDNgine application

Private APIs should own:

- workflow trigger helpers
- internal capability resolution
- publication coordination
- operator-only commands that do not belong on the broad public surface

The public contract should stay small, stable, and adoption-friendly whether the service is hosted in Encore or Nest.

## 4. API qualities

The public API should guarantee:

- idempotency on mutating endpoints
- explicit async status model
- stable pagination and filtering
- typed errors
- portable examples and language bindings
- predictable auth requirements per operation

## 5. Output shapes the docs should include

Public API artifacts should include:

- request and response examples for every mutating endpoint
- manifest examples for image, video, and presentation outputs
- problem-detail examples for validation and processing failures
- namespace registration examples for multi-service adoption
- visibility examples for public versus private asset delivery

## 6. External contract artifacts

The repository should eventually publish:

1. OpenAPI for the public HTTP surface
2. AsyncAPI where event subscriptions are part of the external contract
3. machine-readable examples for major manifest types
4. generated SDK documentation aligned with the published surface

## 7. References

- [OpenAPI Specification](https://spec.openapis.org/oas/latest.html)
- [RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html)

## 8. Read more

- [API Style Guide](./api-style-guide.md)
- [SDK Strategy](./sdk-strategy.md)
- [Service Architecture](./service-architecture.md)
