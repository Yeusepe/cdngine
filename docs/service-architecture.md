# Service Architecture

This document defines the backend service shape for CDNgine.

The goal is not only to name technologies, but to make the request boundaries, durability model, and control-plane ownership explicit enough that implementation can start without rediscovering core semantics.

The default direction is:

- **Hono** for the HTTP and API surface
- **Prisma** for database access and migrations
- **Encore or Nest** as supported host environments around the same service core

The service lifecycle should be read in one line:

`stage -> canonicalize -> process -> publish -> deliver`

That means:

- **stage**: tusd and staging storage accept the upload
- **canonicalize**: the service verifies staged bytes and snapshots them into the canonical source repository
- **process**: Temporal and workers read canonical source and generate outputs
- **publish**: workers write deterministic derivatives and manifests
- **deliver**: clients read published artifacts through the delivery plane and CDN

## 1. Service surfaces

CDNgine should expose distinct surfaces with different auth, stability, and SDK expectations:

| Surface | Audience | Stability | Typical concerns |
| --- | --- | --- | --- |
| `public` | product clients and SDK consumers | highest | upload sessions, asset metadata, derivatives, manifests |
| `platform-admin` | internal platform owners | high but not public-SDK stable | service namespace registration, capability validation, recipe governance |
| `operator` | trusted operators and SREs | internal-only | replay, quarantine, purge, diagnostics, recovery |
| `internal` | service-to-service calls inside CDNgine | implementation detail | workflow dispatch, capability resolution, publication coordination |

These may begin in one deployable application, but they must not blur their responsibilities or auth boundaries.

## 2. Default TypeScript service profile

The current leading service-level stack is:

| Concern | Default |
| --- | --- |
| runtime language | TypeScript |
| HTTP and API layer | Hono |
| host environment | portable between Encore and Nest |
| validation and schema authoring | Zod plus JSON Schema alignment |
| API description | OpenAPI 3.1 derived from the published external surface |
| event description | AsyncAPI where helpful |
| database access | Prisma over PostgreSQL |
| authentication and bearer sessions | pluggable bearer-token auth through `@cdngine/auth`, with Better Auth as the default repository adapter |
| resumable ingest endpoint | tus / tusd |
| telemetry | OpenTelemetry |
| logging | structured application logging with request and workflow correlation |
| durable workflows | Temporal TypeScript SDK |

## 3. Public upload contract

The upload contract is intentionally split into two stages:

1. the client asks the `public` API for an upload session
2. the API creates asset, version, and idempotency records in the registry
3. the API returns a short-lived **ingest-managed upload target**
4. the client uploads the raw binary to that ingest target, normally **tusd** backed by object storage
5. the client calls upload completion, or an authenticated completion callback is received
6. the ingest service verifies the uploaded object, validates metadata and checksums, and snapshots the staged object into the **canonical source repository** on the tiered storage substrate
7. the service records canonicalization success and emits a durable workflow-dispatch intent
8. a workflow dispatcher launches the Temporal workflow for that asset version

The important distinction is:

- the **ingest target** owns resumable upload ergonomics
- the **canonical source repository** owns deduplicated canonical source storage after successful finalization

Clients do **not** upload directly to the source repository by default.

The critical boundary is between:

- **staged bytes**
- **canonical source identity**
- **workflow dispatch**

The service must keep those as separate durable steps.

### 3.1 Uploading a new revision of an existing asset

`POST /v1/upload-sessions` must support both:

1. creating the first uploaded version of a logical asset
2. creating a new uploaded version of an existing logical asset

The intended flow for a new revision is:

1. look up the existing `Asset` by scoped identity
2. create a new `AssetVersion`
3. create a new `UploadSession`
4. return a new **tusd** upload target
5. accept completion for that version only
6. snapshot that version into **Kopia**
7. dispatch a **Temporal** workflow keyed by `(service namespace, asset ID, version ID, workflow template)`

This is where the separation of responsibilities matters:

- **CDNgine** owns the logical asset and version model
- **tusd** owns resumable upload behavior
- **RustFS**, **SeaweedFS**, or another S3-compatible substrate hold staged and published objects
- **Kopia** owns canonical source snapshotting and deduplicated source storage
- **Temporal** owns durable processing execution

If a caller is only retrying the same mutation, durable idempotency should converge on the original upload session and version. If the caller is intentionally creating a new revision, the result must be a new `AssetVersion` even when the filename is unchanged.

## 4. Recommended service ownership

Recommended service areas:

| Service | Responsibility |
| --- | --- |
| `ingest` | upload sessions, upload completion, ingest-target verification, and source snapshotting |
| `registry` | asset, version, derivative, manifest, idempotency, and audit state |
| `delivery` | signed URLs, manifest retrieval, derivative lookup |
| `capability-admin` | capability registration, recipe validation, namespace policy resolution |
| `operations` | replay, quarantine, purge, diagnostics |
| `workflow-gateway` | durable workflow dispatch and operator-facing Temporal coordination |

The Hono route tree should stay thin. Host-specific composition should wrap these services, not replace their ownership model.

## 4.1 Upstream integration boundary

The service code should not connect to every upstream system ad hoc from random route handlers or activities.

The intended posture is:

- **Temporal** is consumed directly through the TypeScript SDK
- **S3-compatible staging and derived storage** are consumed through standard S3-compatible clients
- **RustFS** is the default fast-start S3-compatible backend for local development and simple single-bucket deployments
- **SeaweedFS** is the richer default substrate when explicit tiering, filer semantics, and hot/warm/cold placement matter
- **SeaweedFS filer** is consumed through internal HTTP only where filer semantics are actually needed
- **Kopia** is consumed through a managed repository server plus controlled CLI adapter
- **ORAS** is consumed through ORAS CLI and OCI registry semantics
- **Nydus** is consumed as a worker/runtime layer, not as a public API dependency
- **Alluxio** is consumed only as an optional cache/control service

See [Upstream Integration Model](./upstream-integration-model.md) for the exact API, SDK, and CLI boundaries.

## 5. Request path posture

The synchronous request path should do only the work that belongs in a direct request boundary:

- authentication and authorization
- schema validation
- idempotency check
- lightweight policy binding
- asset or version record mutation
- ingest-target issuance
- canonicalization command acceptance
- workflow dispatch intent creation

For authenticated surfaces, the request path should validate bearer tokens or sessions through a pluggable `@cdngine/auth` adapter and then derive CDNgine actor scope server-side. It should not trust tenant or namespace authorization claims passed through custom caller headers.

The request path should not:

- do expensive transforms
- hide long retries
- run long remote dependency chains
- quietly become a second workflow engine

The request path may authorize delivery access, but it should not become the streaming session manager or bundle-orchestration layer for private media reads.

## 6. Consistency and state-transition model

The most important control-plane boundary in the system is:

`upload complete` -> `canonical source identity durable` -> `workflow dispatched`

That boundary must be designed explicitly.

### 6.1 Durable idempotency

Every mutating boundary should define:

- idempotency key scope
- storage location for durable idempotency evidence
- retry-safe response behavior
- operator-visible failure mode

Redis can help with short-lived dedupe windows, but durable idempotency evidence belongs in the registry.

### 6.2 Canonicalization transaction

Upload completion should be modeled as a state machine, not a boolean:

- `session_created`
- `uploading`
- `uploaded`
- `canonicalizing`
- `canonical`
- `processing`
- `published`
- `failed_validation`
- `failed_retryable`
- `quarantined`

The registry transaction for completion should:

1. verify the upload session and idempotency record
2. transition the version from `uploaded` to `canonicalizing`
3. record verified ingest metadata
4. persist the canonical source identity when snapshotting succeeds
5. insert a workflow-dispatch outbox record

Only after the outbox record exists should workflow dispatch be attempted.

This is the service-level expression of the core architecture rule:

1. staging is not canonical truth
2. canonical truth begins only after snapshotting succeeds
3. workflow work begins only after canonical truth exists

### 6.3 Workflow dispatch

Workflow start must be business-keyed and repeatable.

The default workflow identity should be derived from stable inputs such as:

- service namespace
- asset ID
- version ID
- workflow template or replay reason

That lets duplicate completion requests converge on one durable workflow intent instead of starting parallel work.

### 6.3.2 Workflow run projection

Temporal is the execution engine, but CDNgine should also project workflow state into operator-facing registry records.

Minimum projected states:

- `queued`
- `running`
- `waiting`
- `cancelled`
- `failed`
- `completed`

This projection should capture:

- business-keyed workflow ID
- current step or phase
- retry summary
- wait reason where applicable
- cancellation cause where applicable
- last operator intervention

That keeps workflow UX closer to the stronger operator models seen in systems such as Trigger.dev, Inngest, DBOS, and Restate instead of forcing operators to reconstruct state from raw execution history alone.

### 6.3.1 Canonical source identity

The canonical source pointer should not be an opaque blob reference alone.

Persist at minimum:

- canonical repository identity
- snapshot, manifest, or equivalent reconstruction identity
- canonical logical path
- strong content digest such as SHA-256
- source size and detected media metadata when relevant

That gives replay, operator diagnostics, and provenance review a stable source identity that matches the repository's chunked reconstruction model.

### 6.4 Optimistic concurrency

Mutable control-plane rows should carry a version or equivalent concurrency token.

Use optimistic concurrency control for records such as:

- asset publication pointers
- manifest publication state
- operator mutations
- workflow-dispatch rows

Avoid hidden lock-heavy behavior in request handlers when a versioned update is sufficient.

## 6.5 Programmatic scoping rules

Scoping must be enforced as code and data, not just naming.

Minimum rule set:

1. route handlers receive explicit scope context
2. service-layer methods accept scope parameters, not naked asset IDs
3. registry queries use scoped filters such as `serviceNamespaceId`, `tenantScopeId`, and `assetId`
4. cache keys and storage prefixes include scope context
5. authorization is evaluated before and during data access, not only at the edge route

Illustrative scoped lookup posture:

```ts
await assetRepository.getVersion({
  serviceNamespaceId,
  tenantScopeId,
  assetId,
  versionId,
})
```

Unscoped repository methods such as `getAssetById(assetId)` should be treated as an anti-pattern for tenant-aware resources.

## 6.6 Delivery authorization and read posture

Delivery must distinguish between single-object reads and bundle-oriented reads.

Preferred service behavior:

- the API may mint signed URLs for single derivatives
- the API may mint signed-cookie or equivalent bundle credentials for manifests plus segment sets
- public delivery should normally return `404` for unauthorized private reads so it does not disclose asset existence
- authenticated control-plane reads may still return `403` when the denial itself is useful
- manifests should return delivery-scope and authorization-mode metadata clearly enough that SDKs do not guess

### 6.6.1 Original-source delivery

Original-source delivery is separate from published derivative delivery.

Preferred behavior:

- the API exposes an explicit source-download authorization operation for canonical asset versions
- the service resolves the request from the version's canonical source identity
- the service may satisfy the read through proxied reconstruction, a tightly scoped lazy-read handle for trusted internal clients, or, only when repeated delivery behavior justifies it, a materialized export
- source-download authorization may be stricter than derivative authorization
- quarantined or policy-blocked versions must not silently fall back to a raw storage read

Those modes map to the architecture like this:

- **proxy reconstruction**: reconstruct from canonical source on demand
- **lazy-read handle**: trusted internal hot-read path near compute
- **materialized export**: temporary delivery-plane copy of the original source

### 6.6.2 Unified authorization response

Client-facing APIs should still look unified even when the backend resolution path changes.

Preferred posture:

- `POST /v1/assets/{assetId}/versions/{versionId}/deliveries/{deliveryScopeId}/authorize` resolves published derivative reads
- `POST /v1/assets/{assetId}/versions/{versionId}/source/authorize` resolves canonical original reads
- both endpoints return the same shape of authorization envelope
- clients do not choose between derived-store, export, lazy-read, or proxy paths themselves

Illustrative response shape:

```json
{
  "authorizationMode": "signed-url",
  "deliveryMode": "derived",
  "resolvedOrigin": "cdn-derived",
  "expiresAt": "2026-04-15T16:00:00Z",
  "url": "https://cdn.example.com/..."
}
```

`resolvedOrigin` should be modeled explicitly enough that SDKs can log or branch safely when needed, while still treating the response as one public contract.

## 6.7 Delivery scope resolution

Delivery URL shape should be a modeled service concern.

The service layer should resolve a request against a registered `DeliveryScope` that decides:

- shared-path versus subdomain versus custom-hostname delivery
- cache profile
- public versus private delivery mode
- signed-URL versus signed-cookie posture
- stream-bundle behavior where applicable
- one-bucket versus multi-bucket prefix resolution for the actual origin path
- derived hot path versus export or proxy fallback

Hostnames alone are not authorization truth. They are one input into delivery-scope resolution.

## 7. Package-specific service posture

### 7.1 Hono

Use Hono for a narrow, strongly typed service core:

- use `@hono/zod-validator` or `@hono/standard-validator` for request validation
- use Hono RPC typing for internal clients that share route types across packages
- use `testClient` for typed route tests
- apply `requestId`, `secureHeaders`, and `timeout` middleware consistently
- keep route handlers chained or exported in a way that preserves Hono's type inference

### 7.2 Prisma and PostgreSQL

Use Prisma for the main relational contract and PostgreSQL for the registry:

- relational truth and uniqueness constraints live in PostgreSQL
- JSONB stores governed structured metadata, manifest fragments, and processor outputs
- GIN indexes are used deliberately for JSONB query paths
- optimistic concurrency is expressed through explicit version fields
- raw SQL is acceptable for query shapes Prisma does not express cleanly
- deployments that require stronger tenant isolation may layer PostgreSQL RLS on top of scoped application queries

### 7.3 Temporal

Temporal owns durable orchestration. The service architecture should use it fully:

- Workflow IDs are derived from business identity, not random starts
- Worker Versioning is the preferred deployment posture for workflow-code changes
- replay testing is required before shipping workflow changes
- Queries, Signals, and Updates are the preferred operator interaction model for running workflows
- Continue-As-New should be used when long-lived workflow histories approach scaling limits
- waits, pauses, and human-in-the-loop steps should be modeled durably rather than hidden in ad hoc queue polling
- workflow code should project enough run state that operators can see why a run is waiting, retrying, or cancelled

### 7.4 tus / tusd

tus and tusd should be treated as a first-class ingest subsystem, not a generic file bucket:

- required extensions should include `creation`, `creation-defer-length`, `checksum`, `expiration`, and `termination`
- `concatenation` is optional and only enabled when the SDK strategy needs parallel upload composition
- hook-driven validation should control upload metadata, storage-path derivation, and completion behavior
- the `/metrics` endpoint should be scraped in every non-local environment
- production should use a cloud/object-storage backend, not local disk or NFS-style shared folders
- when targeting Cloudflare R2, `-s3-min-part-size` and `-s3-part-size` should be set to the same value

### 7.5 Canonical source stack

The canonical source stack should be used as the deduplicated content plane, not merely as a raw-file sink.

Use it well by:

- making repository or namespace topology explicit, typically per service namespace or other high-isolation boundary
- persisting snapshot identities, canonical logical paths, and content digests in the registry
- using a repository-aware service for snapshotting and reconstruction
- taking advantage of deduplicated chunk history for repeated revisions of Unity packages, Substance files, FBX assets, textures, and video masters
- using lazy-read or hot-cache layers on worker hosts where repeated reads justify them
- keeping replay-critical source-side evidence in the same canonical source boundary when that evidence must travel with the source
- keeping raw object keys behind the source layer rather than treating them as public or control-plane identities

Keep these responsibilities out of the source stack:

- hot-path derivative delivery
- mutable workflow state
- authorization truth
- public resumable browser upload ergonomics

### 7.6 Delivery and CDN posture

The delivery subsystem should use the CDN deliberately:

- immutable versioned derivatives should be cache-friendly by default
- manifests may use shorter cache lifetimes than immutable segments or files
- hot-read profiles should use tiered-cache or shield behavior where available
- private stream bundles should prefer signed cookies over per-segment URL signing
- range-request support is required for video-oriented delivery profiles

## 8. Public, admin, and operator auth posture

The surface split is also an auth split:

- `public` routes use tenant- and asset-scoped auth
- `platform-admin` routes use internal service or platform-owner auth
- `operator` routes use elevated, auditable operator roles
- `internal` routes are not broad public endpoints and should prefer service-to-service auth or in-process calls

Namespace registration, recipe governance, replay, quarantine, and purge do not belong on the broad public SDK surface.

The preferred authorization style is ABAC-like policy evaluation over:

- subject attributes
- resource attributes
- action
- environment context

That is a better fit than RBAC alone for shared-platform, multi-domain asset systems.

## 9. TDD and maintainability posture

The service should be built in this order:

1. docs and contract
2. failing specification or route test
3. narrower unit or integration tests
4. implementation
5. workflow and replay evidence where needed

The service design should prefer:

- explicit service ownership
- small service modules behind Hono routes
- typed boundaries
- clear Prisma schema ownership and migration discipline
- explicit state machines for control-plane records
- reusable workflow templates
- host portability between Encore and Nest where feasible

## 10. References

- [Hono validation guide](https://hono.dev/docs/guides/validation)
- [Hono RPC guide](https://hono.dev/docs/guides/rpc)
- [Hono testing helper](https://hono.dev/docs/helpers/testing)
- [Hono Request ID middleware](https://hono.dev/docs/middleware/builtin/request-id)
- [Hono Secure Headers middleware](https://hono.dev/docs/middleware/builtin/secure-headers)
- [Hono Timeout middleware](https://hono.dev/docs/middleware/builtin/timeout)
- [Prisma transactions, idempotent APIs, and OCC](https://www.prisma.io/docs/orm/prisma-client/queries/transactions)
- [Prisma index configuration](https://docs.prisma.io/docs/orm/prisma-schema/data-model/indexes)
- [Temporal safe deployments](https://docs.temporal.io/develop/safe-deployments)
- [Temporal Workflow IDs](https://docs.temporal.io/workflow-execution/workflowid-runid)
- [Temporal TypeScript message passing](https://docs.temporal.io/develop/typescript/workflows/message-passing)
- [Temporal TypeScript Continue-As-New](https://docs.temporal.io/develop/typescript/workflows/continue-as-new)
- [tus protocol](https://tus.io/protocols/resumable-upload)
- [tusd monitoring](https://tus.github.io/tusd/advanced-topics/monitoring/)
- [tusd S3 storage backend](https://tus.github.io/tusd/storage-backends/aws-s3/)
- [Kopia features](https://kopia.io/docs/features/)
- [SeaweedFS tiered storage](https://github.com/seaweedfs/seaweedfs/wiki/Tiered-Storage)
- [JuiceFS architecture](https://juicefs.com/docs/community/architecture)
- [Nydus](https://nydus.dev/)
- [ORAS documentation](https://oras.land/docs/)
- [Alluxio documentation](https://documentation.alluxio.io/os-en)
- [NIST SP 800-162: Guide to Attribute Based Access Control (ABAC)](https://csrc.nist.gov/pubs/sp/800/162/upd2/final)
- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- [PostgreSQL row security policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Inngest docs](https://www.inngest.com/docs)
- [Trigger.dev docs](https://trigger.dev/docs)
- [DBOS docs](https://docs.dbos.dev/)
- [Restate docs](https://docs.restate.dev/)
- [Cloudflare Tiered Cache](https://developers.cloudflare.com/cache/how-to/tiered-cache/)
- [Cloudflare Cache Reserve API model](https://developers.cloudflare.com/api/node/resources/cache/subresources/cache_reserve/models/cache_reserve/)
- [Amazon CloudFront signed cookies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-signed-cookies.html)
- [Amazon CloudFront range GETs](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/RangeGETs.html)
- [RFC 8246: HTTP Immutable Responses](https://www.rfc-editor.org/rfc/rfc8246.html)
- [RFC 8216: HTTP Live Streaming](https://www.rfc-editor.org/rfc/rfc8216.html)
- [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html)
