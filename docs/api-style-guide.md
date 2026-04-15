# API Style Guide

This document defines the intended API quality bar.

## 1. Standards

The platform should adopt:

- OpenAPI 3.1 and JSON Schema as the primary HTTP schema source
- AsyncAPI for event contracts where helpful
- Arazzo for multi-step workflow descriptions where the API flow spans several calls
- RFC 9457 problem details for typed API errors

The published contract posture should be:

- separate public, platform-admin, and operator API descriptions
- Zod or Standard Schema-compatible definitions near code
- generated OpenAPI and JSON Schema artifacts as release outputs
- generated Arazzo workflow artifacts for common multi-step flows

## 2. Rules

1. Prefer boring, resource-oriented paths.
2. Keep request and response shapes versionable.
3. Use idempotency keys for mutating operations.
4. Keep public, platform-admin, and operator surfaces distinct.
5. Provide examples, descriptions, deprecation metadata, and field-level docs in schemas.
6. Keep public API naming stable even when infrastructure changes.
7. Return typed, documented errors instead of vague message blobs.
8. Make async behavior explicit in both the resource model and examples.
9. Keep service namespace, tenant scope, and asset ownership visible in request and response shapes.
10. Treat manifests as first-class outputs, not undocumented side channels.
11. Design method names and schemas so generated SDKs have one obvious shape for common workflows.
12. Make delivery-scope and authorization mode explicit for private and organization-specific delivery.

## 2.1 Naming guidance

Prefer:

- noun-based resources
- stable version prefixes
- explicit nested resources where ownership matters
- stable `operationId` values that generate predictable method names
- resource-oriented operations that fit standard client generation well

Avoid:

- RPC-style verb sprawl for normal resource reads
- transport-specific naming leaking into public semantics
- provider-specific naming in core resources

## 2.2 Error model

Use RFC 9457 problem details as the baseline error envelope.

Every public error shape should document:

- stable error type
- HTTP status
- retryability
- idempotency behavior
- operator or caller remediation when relevant

Public delivery should follow a non-disclosing posture for private assets. Control-plane reads may disclose authorization failure more explicitly when the caller is already authenticated.

## 3. Discoverability

The platform should expose:

- machine-readable OpenAPI artifacts
- human-readable docs
- tested examples
- generated SDK entry points

Only the public surface should be treated as the broad external SDK contract unless a narrower admin SDK is deliberately supported.

## 3.1 Async API posture

The API should make asynchronous work obvious instead of pretending long-running transforms are immediate.

Preferred behavior:

- mutating endpoints return accepted work and status handles where processing is deferred
- asset and version resources expose state transitions explicitly
- derivatives and manifests appear only when published, not as magical side effects
- common multi-step sequences such as upload and completion should be documented as executable workflows, not only scattered examples

Illustrative response posture:

```json
{
  "assetId": "ast_123",
  "versionId": "ver_456",
  "status": "processing",
  "workflowRunId": "wf_789",
  "links": {
    "self": "/v1/assets/ast_123",
    "version": "/v1/assets/ast_123/versions/ver_456",
    "derivatives": "/v1/assets/ast_123/derivatives"
  }
}
```

## 4. Schema metadata rules

Schemas should carry enough metadata to make editors pleasant:

- descriptions on all public fields
- examples on requests and important responses
- deprecation markers
- enum descriptions where the generator supports them
- links to related resources or manifests where helpful

## 4.1 Namespace and ownership rules

Public resources should make ownership and policy visible when it matters:

- service namespace identity
- tenant identity where applicable
- asset owner or policy subject where applicable
- source version identity
- recipe and manifest identity
- processing state

The API should not force consumers to reverse-engineer ownership from opaque IDs.

## 4.3 Delivery rules

Public delivery contracts should expose:

- `deliveryScopeId`
- delivery hostname or path base where relevant
- `authorizationMode` such as `public`, `signed-url`, or `signed-cookie`
- manifest versus bundle semantics for streaming media

Streaming manifests should not make SDKs guess whether the client needs a signed URL for one file or bundle credentials for many files.

## 4.2 Example problem detail

Illustrative validation error:

```json
{
  "type": "https://docs.cdngine.dev/problems/invalid-asset-dimensions",
  "title": "Invalid asset dimensions",
  "status": 422,
  "detail": "Banner image does not match the required dimensions for namespace creative-services.",
  "instance": "/v1/assets/ast_123/versions/ver_456",
  "assetId": "ast_123",
  "versionId": "ver_456",
  "retryable": false
}
```

## 5. References

- [OpenAPI Specification](https://spec.openapis.org/oas/latest.html)
- [JSON Schema](https://json-schema.org/)
- [AsyncAPI](https://www.asyncapi.com/docs)
- [Arazzo Specification](https://spec.openapis.org/arazzo/latest.html)
- [RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html)
- [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html)
- [Google AIP-121: Resource-oriented design](https://google.aip.dev/121)
- [Google AIP-130: Standard methods](https://google.aip.dev/130)
- [Redocly docs](https://redocly.com/docs/)
- [Stoplight Elements](https://docs.stoplight.io/docs/elements/b074dc47b2826-elements-quick-start)

