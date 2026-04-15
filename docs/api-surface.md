# API Surface

This document defines the intended HTTP surface for CDNgine.

The goal is to keep the public SDK contract small and durable while still documenting the platform-admin and operator surfaces that the platform needs internally.

## 1. API surfaces

CDNgine should publish separate API descriptions for separate audiences:

| Surface | Audience | SDK posture |
| --- | --- | --- |
| `public` | product clients and external SDK consumers | versioned and broadly supported |
| `platform-admin` | internal platform owners and service integrators | documented but not broad public-SDK stable |
| `operator` | operators, SREs, and recovery tooling | documented, audited, internal-only |

The `public` surface is the compatibility contract. The other surfaces are still deliberate APIs, but they are not the broad adoption contract.

The public surface should be shaped for direct SDK generation, not only for human documentation.

Only the **public** endpoints in [5.1](#51-public) are part of the broad product-SDK compatibility promise by default.

The `platform-admin` and `operator` surfaces may evolve with platform releases and should be treated as internal platform APIs unless a narrower compatibility policy is published for them explicitly.

## 2. Public API groups

The initial public API should expose these groups:

| Group | Purpose |
| --- | --- |
| upload-sessions | ingest-target issuance and completion |
| assets | logical asset identity and lookup |
| versions | canonical uploaded versions and processing state |
| source-downloads | authorization for reading the canonical original source version |
| derivatives | processed delivery artifacts for a specific version |
| manifests | manifest-first retrieval for complex assets |
| deliveries | delivery authorization and scope-aware URL resolution |

The public surface should **not** expose namespace registration, capability governance, replay, purge, or quarantine as ordinary SDK operations.

## 3. Platform-admin API groups

The platform-admin surface should expose:

| Group | Purpose |
| --- | --- |
| service-namespaces | namespace registration and policy inspection |
| capabilities | capability validation and registration governance |
| recipes | recipe and workflow binding governance |

## 4. Operator API groups

The operator surface should expose:

| Group | Purpose |
| --- | --- |
| operations | replay, quarantine, purge, manual recovery |
| diagnostics | workflow and publication diagnostics |
| audit | operator-visible event and intervention history |

## 5. Core endpoints

### 5.1 Public

- `POST /v1/upload-sessions`
- `POST /v1/upload-sessions/{uploadSessionId}/complete`
- `GET /v1/assets/{assetId}`
- `GET /v1/assets/{assetId}/versions/{versionId}`
- `POST /v1/assets/{assetId}/versions/{versionId}/source/authorize`
- `GET /v1/assets/{assetId}/versions/{versionId}/derivatives`
- `GET /v1/assets/{assetId}/versions/{versionId}/manifests/{manifestType}`
- `POST /v1/assets/{assetId}/versions/{versionId}/deliveries/{deliveryScopeId}/authorize`

### 5.2 Platform-admin

- `POST /v1/platform/service-namespaces`
- `GET /v1/platform/service-namespaces/{namespaceId}`
- `POST /v1/platform/capabilities/validate`
- `POST /v1/platform/recipes/validate`

### 5.3 Operator

- `POST /v1/operator/assets/{assetId}/versions/{versionId}/reprocess`
- `POST /v1/operator/assets/{assetId}/versions/{versionId}/quarantine`
- `POST /v1/operator/assets/{assetId}/versions/{versionId}/release`
- `POST /v1/operator/assets/{assetId}/versions/{versionId}/purge`
- `GET /v1/operator/assets/{assetId}/versions/{versionId}/diagnostics`

## 6. Public contract guarantees

The public API should guarantee:

- idempotency on mutating endpoints
- explicit async status modeling
- typed errors
- predictable auth requirements
- stable ownership fields
- explicit original-source delivery posture
- explicit delivery-scope and authorization-mode modeling
- version-aware derivative and manifest lookup
- stable operation names and tags for generated SDK method grouping

The public API should expose enough fields that clients do not need to reverse-engineer ownership or processing state from opaque identifiers.

## 7. Ownership fields

Public resources should distinguish:

- `serviceNamespaceId`: the internal namespace registered with CDNgine
- `tenantId`: the external customer or isolation boundary within a namespace, when applicable
- `assetOwner`: the caller-facing owner or subject used for policy checks

These are not interchangeable concepts and should not collapse into one generic `namespace` field.

For `POST /v1/upload-sessions`, the request contract should include explicit scope information:

- `serviceNamespaceId` is required
- `tenantId` is required when the namespace uses tenant scoping, and should normally be derived from the authenticated principal rather than trusted from arbitrary client input
- callers must not be allowed to create an upload session for a namespace or tenant scope they are not authorized to use

The API should treat that scope tuple as a contract input, but authoritative allowed values come from service registration and authenticated caller policy rather than from arbitrary client choice.

## 8. Async behavior posture

Mutating endpoints should make deferred work obvious.

Preferred behavior:

- completion returns accepted work and a status handle when processing is deferred
- asset and version resources expose lifecycle state explicitly
- source-download authorization exposes whether the caller receives a proxy URL, a tightly scoped lazy-read handle for trusted internal clients, or a materialized export
- derivatives and manifests appear only after publication
- delivery authorization responses expose whether the caller receives a signed URL, signed cookie bundle, or public path
- operator actions expose workflow or operation identifiers that can be audited later

## 9. Contract artifacts

The repository should eventually publish:

1. OpenAPI for the public HTTP surface
2. separate OpenAPI artifacts for platform-admin and operator surfaces
3. Arazzo workflows for public multi-step flows such as upload, completion, polling, manifest retrieval, and source-download authorization
4. AsyncAPI where external event subscriptions are part of the contract
5. machine-readable examples for major manifest types
6. generated SDK documentation aligned only with the public surface unless a narrower admin SDK is explicitly supported

## 10. SDK-facing posture

The public API should be easy to wrap into a high-level SDK shape such as:

- `assets.upload`
- `assets.get`
- `assets.waitForVersion`
- `versions.authorizeSourceDownload`
- `derivatives.list`
- `manifests.get`
- `deliveries.authorize`

That means the HTTP surface should stay boring and resource-oriented while the published contract artifacts describe the workflow clearly enough that generated and handwritten SDK layers do not have to guess.

## 10.1 What the public API does not expose

The public API and public SDKs should not expose the upstream stack directly.

That means product-facing consumers should not need to know about:

- SeaweedFS S3 or filer endpoints
- Kopia repository commands or snapshot IDs beyond CDNgine-owned source identity fields
- ORAS CLI or OCI registry internals
- Nydus runtime details
- Alluxio cache-control APIs
- Temporal APIs

Those remain internal implementation dependencies behind CDNgine-owned routes and adapters.

## 11. References

- [OpenAPI Specification](https://spec.openapis.org/oas/latest.html)
- [Arazzo Specification](https://spec.openapis.org/arazzo/latest.html)
- [RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html)

## 12. Read more

- [API Style Guide](./api-style-guide.md)
- [SDK Strategy](./sdk-strategy.md)
- [Service Architecture](./service-architecture.md)
- [Upstream Integration Model](./upstream-integration-model.md)
