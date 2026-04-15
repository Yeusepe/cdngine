# External Systems Study

This document records the external systems and standards that meaningfully shape CDNgine's architecture.

The goal is not to copy their products. The goal is to extract the operating patterns that reduce architectural stress for CDNgine's actual problem:

- binary-heavy canonical assets in Xet over S3-compatible storage
- a registry and control plane
- durable processing and replay
- derived-object publication
- CDN delivery for hot assets, private assets, and streaming video

## 1. Durable business logic systems

### 1.1 Inngest

Study focus:

- durable step-oriented business logic
- retries and replay
- event-driven orchestration
- keeping long-running work out of request handlers

What matters for CDNgine:

- workflow code should be expressed as named steps with stable boundaries
- request handlers should only validate, authorize, mutate the registry, and emit durable workflow intents
- replay should reuse recorded progress instead of re-running every side effect blindly
- waits and long-running orchestration should be first-class workflow features, not ad hoc queue loops

Adopted rule:

- CDNgine workflows must project named step and run state into operator-visible records instead of behaving like invisible background jobs

### 1.2 Trigger.dev

Study focus:

- developer-facing run UX
- idempotency
- queues and concurrency
- waiting and long-running tasks
- human-in-the-loop operation

What matters for CDNgine:

- a workflow run is a product feature, not just infrastructure plumbing
- waiting states should release scarce execution slots
- run history, queue placement, retries, and manual intervention should be easy to inspect
- bundle-oriented delivery authorizations and replay requests should be auditable operator actions with durable run history

Adopted rule:

- the platform must expose operator-visible run states such as `queued`, `running`, `waiting`, `cancelled`, `failed`, and `completed`

### 1.3 DBOS Transact

Study focus:

- durable execution close to PostgreSQL
- durable queues
- checkpointing and recovery
- idempotence by construction

What matters for CDNgine:

- the registry is not a passive metadata table set; it is part of the durable handoff model
- the request-path to workflow-path boundary should be an explicit outbox-style record, not a best-effort side effect
- exactly-once semantics are still operational goals, but the practical mechanism is durable state transitions plus business-keyed workflow identity

Adopted rule:

- upload completion, replay requests, and publication intents must always create durable registry evidence before asynchronous execution proceeds

### 1.4 Restate

Study focus:

- durable execution attached to service endpoints
- durable timers and promises
- reliable communication
- stateful service logic

What matters for CDNgine:

- workflow state should stay attached to asset/version business identity
- waiting for external events, approvals, or callbacks should be modeled durably
- replay and cancellation need explicit state transitions and service semantics

Adopted rule:

- long-running asset logic must be treated as durable service logic over asset versions, not as anonymous worker jobs

### 1.5 Convex

Study focus:

- generated developer APIs
- small, typed backend functions
- strong generated client ergonomics

What matters for CDNgine:

- the SDK should feel like code, not raw HTTP assembly
- generated client shapes should be obvious for upload, waiting, manifest retrieval, and delivery authorization
- the control plane should stay small enough that code generation still produces pleasant APIs

Adopted rule:

- every public API group must map cleanly to one obvious generated SDK entry point

## 2. Control-plane and metadata systems

### 2.1 OpenMetadata

Study focus:

- metadata modeling
- entity relationships
- lineage and governance
- central metadata repository design

What matters for CDNgine:

- the registry should be treated as an explicit metadata and lineage plane
- lineage should connect asset versions, workflow runs, derivatives, manifests, and operator actions
- entity modeling has to stay coherent enough that operators can answer provenance questions without joining ad hoc tables mentally

Adopted rule:

- registry records must answer lineage questions directly, including which source identity, workflow run, and policy scope produced a published derivative

### 2.2 DataHub

Study focus:

- metadata graph thinking
- entity APIs
- change propagation
- lineage across systems

What matters for CDNgine:

- delivery, provenance, and control-plane state form a graph, not isolated CRUD records
- scope, asset, version, derivative, manifest, workflow run, and audit event relationships must remain queryable and explicit

Adopted rule:

- the domain model should privilege relationship clarity over compact but ambiguous records

### 2.3 lakeFS

Study focus:

- branch and commit business semantics
- zero-copy branching
- metadata and catalog APIs
- garbage collection lifecycle operations

What matters for CDNgine:

- canonical content and published delivery should each have explicit lifecycle semantics
- GC, purge, and retention are platform features and need API and operator design, not just storage scripts
- storage efficiency should be paired with lifecycle controls

Adopted rule:

- retention, purge, and replay remain first-class operator flows with durable control-plane records

### 2.4 Unkey

Study focus:

- API product control-plane design
- roles, permissions, and auditable policy
- workspace-like key management

What matters for CDNgine:

- delivery authorization should be treated like a product surface with explicit policy artifacts
- coarse operator roles are still useful, even though CDNgine's main posture is ABAC-like evaluation
- delivery signing, bundle access, and organization-specific exposure need auditable policy boundaries

Adopted rule:

- public delivery authorization stays resource-scoped and ephemeral, while platform-admin and operator privileges remain explicit and auditable

## 3. Modular TypeScript product systems

### 3.1 Better Auth

Study focus:

- organization-aware auth
- teams, invitations, active organization state
- plugin-based auth packaging
- dynamic roles and permissions

What matters for CDNgine:

- organization and team context should be first-class, not inferred from route prefixes
- dynamic organization-level policy and active-organization context should feed delivery-scope resolution
- auth behavior should remain modular and composable, not hard-coded into route middleware sprawl

Adopted rule:

- organization-aware delivery and access rules belong in code-defined scope and delivery bindings, not one-off route conditions

### 3.2 Medusa

Study focus:

- module boundaries
- provider-based extension
- workflow composition

What matters for CDNgine:

- capabilities, recipes, workflow templates, and delivery providers should compose through registration
- storage, delivery, and policy differences should be provider or registration choices where possible

Adopted rule:

- CDNgine keeps workflow composition and provider selection declarative instead of burying them in route or worker branching

### 3.3 Cal.com

Study focus:

- large TypeScript monorepo organization
- package boundaries
- multi-tenant SaaS concerns
- Prisma-heavy business logic

What matters for CDNgine:

- multi-tenant scoping rules must stay visible in the domain and API model
- large-platform ergonomics depend on package boundaries, docs, and repeatable conventions more than on one clever abstraction

Adopted rule:

- scope and organization semantics must stay explicit in shared contracts and package boundaries

## 4. Delivery and access standards

### 4.1 Hot-file delivery and cache posture

Applicable sources:

- RFC 8246 for `Cache-Control: immutable`
- Cloudflare Tiered Cache documentation
- Cloudflare Cache Reserve model

What matters for CDNgine:

- versioned derivatives and segments should use immutable URLs and immutable cache headers
- manifests should usually have shorter TTLs than immutable versioned segments or files
- the CDN layer should explicitly optimize hot files with tiered-cache or shield behavior to reduce origin fan-out
- persistent cache layers are useful when hot binaries are repeatedly requested and rewarming origin is expensive

Adopted rule:

- hot-path delivery must prefer immutable versioned URLs plus CDN tiering and reserve-style persistence over origin-direct fetch patterns

### 4.2 Unauthorized reads and non-disclosure

Applicable sources:

- RFC 9110 for 403 and 404 semantics
- OWASP Authorization Cheat Sheet

What matters for CDNgine:

- the public delivery path should avoid becoming an existence oracle for private assets
- for unauthenticated or invalidly signed public delivery attempts, returning `404` is often the safer posture
- authenticated control-plane APIs may return `403` when the caller is known and the denial itself is useful

Adopted rule:

- public delivery is non-disclosing by default for private assets, while control-plane APIs may use explicit authorization failures

### 4.3 Organization-specific URLs

Applicable sources:

- Cloudflare for SaaS and custom-hostname patterns
- SaaS tenant-isolation architecture guidance

What matters for CDNgine:

- organizations may need separate hostnames, not only path prefixes
- delivery identity must be explicit and registry-backed, not reconstructed from the `Host` header alone
- custom domains change certificate, caching, and authorization concerns and therefore belong in the modeled delivery scope

Adopted rule:

- organization-specific URL strategy is modeled as a `DeliveryScope`, not improvised per route

### 4.4 Video streaming

Applicable sources:

- RFC 8216 for HLS
- CloudFront range-request guidance

What matters for CDNgine:

- streaming video should publish HLS/CMAF-style manifests and immutable segment paths
- manifest and segment authorization have different ergonomics than single-file downloads
- signed cookies are usually a better fit than per-segment signed URLs when authorizing an entire stream bundle
- range requests, adaptive bitrate ladders, captions, and poster frames belong in the derived-output contract

Adopted rule:

- private streaming should authorize bundles, not force callers to individually sign every segment URL

## 5. Adopted cross-system rules for CDNgine

These are the rules CDNgine takes forward from the systems above:

1. durable business logic lives in workflows and service modules, not request handlers
2. workflow runs are first-class operator-facing records with explicit states and history
3. the registry is a durable control-plane and lineage system, not a bag of side tables
4. scope, organization, and delivery identity remain explicit records
5. hot delivery uses immutable versioned artifacts, tiered caching, and reserve-style persistence where available
6. private asset delivery is non-disclosing by default on the public path
7. organization-specific hostnames are modeled, not improvised
8. streaming video is a manifest-and-segment product surface with bundle authorization

## 6. References

- [Inngest docs](https://www.inngest.com/docs)
- [Trigger.dev docs](https://trigger.dev/docs)
- [DBOS docs](https://docs.dbos.dev/)
- [Restate docs](https://docs.restate.dev/)
- [Convex generated API](https://docs.convex.dev/generated-api/)
- [Convex actions](https://docs.convex.dev/functions/actions)
- [OpenMetadata docs](https://docs.open-metadata.org/)
- [DataHub GraphQL docs](https://docs.datahub.com/docs/api/graphql/overview)
- [lakeFS documentation](https://docs.lakefs.io/)
- [Unkey roles and permissions](https://www.unkey.com/docs/apis/features/authorization/roles-and-permissions)
- [Better Auth organization plugin](https://better-auth.com/docs/plugins/organization)
- [Medusa workflows and modules](https://docs.medusajs.com/)
- [Cal.com repository](https://github.com/calcom/cal.com)
- [Cloudflare Tiered Cache](https://developers.cloudflare.com/cache/how-to/tiered-cache/)
- [Cloudflare Cache Reserve API model](https://developers.cloudflare.com/api/node/resources/cache/subresources/cache_reserve/models/cache_reserve/)
- [Cloudflare custom hostnames](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/)
- [Cloudflare create custom hostnames](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/create-custom-hostnames/)
- [Cloudflare custom metadata](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/custom-metadata/)
- [Amazon CloudFront signed cookies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-signed-cookies.html)
- [Amazon CloudFront range GETs](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/RangeGETs.html)
- [RFC 8246: HTTP Immutable Responses](https://www.rfc-editor.org/rfc/rfc8246.html)
- [RFC 8216: HTTP Live Streaming](https://www.rfc-editor.org/rfc/rfc8216.html)
- [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html)
- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
