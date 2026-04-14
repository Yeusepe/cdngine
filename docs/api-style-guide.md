# API Style Guide

This document defines the intended API quality bar.

## 1. Standards

The platform should adopt:

- OpenAPI 3.1 and JSON Schema as the primary HTTP schema source
- AsyncAPI for event contracts where helpful
- RFC 9457 problem details for typed API errors

## 2. Rules

1. Prefer boring, resource-oriented paths.
2. Keep request and response shapes versionable.
3. Use idempotency keys for mutating operations.
4. Provide examples, descriptions, deprecation metadata, and field-level docs in schemas.
5. Keep public API naming stable even when infrastructure changes.
6. Return typed, documented errors instead of vague message blobs.
7. Make async behavior explicit in both the resource model and examples.
8. Keep namespace and asset ownership visible in request and response shapes.
9. Treat manifests as first-class outputs, not undocumented side channels.

## 2.1 Naming guidance

Prefer:

- noun-based resources
- stable version prefixes
- explicit nested resources where ownership matters

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

## 3. Discoverability

The platform should expose:

- machine-readable OpenAPI artifacts
- human-readable docs
- tested examples
- generated SDK entry points

## 3.1 Async API posture

The API should make asynchronous work obvious instead of pretending long-running transforms are immediate.

Preferred behavior:

- mutating endpoints return accepted work and status handles where processing is deferred
- asset and version resources expose state transitions explicitly
- derivatives and manifests appear only when published, not as magical side effects

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

- namespace or tenant identity
- source version identity
- recipe and manifest identity
- processing state

The API should not force consumers to reverse-engineer ownership from opaque IDs.

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
- [RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html)
- [Redocly docs](https://redocly.com/docs/)
- [Stoplight Elements](https://docs.stoplight.io/docs/elements/b074dc47b2826-elements-quick-start)

