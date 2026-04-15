# Technology Profile

This document explains the intended package and platform choices for the default CDNgine profile.

It is not a raw trade-study dump. It records the choices the architecture is trying to optimize for and how to use those packages well enough that we do not leave obvious reliability or ergonomics on the table.

The technology profile follows the same platform lifecycle as the architecture doc:

`stage -> canonicalize -> process -> publish -> deliver`

## 1. Selection criteria

Default choices should optimize for:

1. durability
2. runtime performance
3. maintainability
4. ease of extension
5. operational clarity
6. adoption flexibility for bring-your-own SQL and S3-style storage
7. host portability between different service shells

## 2. Default package profile

| Concern | Default | Why not custom code |
| --- | --- | --- |
| HTTP and API layer | Hono | fast, Web-standards-based, multi-runtime routing without coupling the platform to a single host framework |
| host environment | Encore or Nest | lets teams choose their service shell without changing platform semantics |
| validation and schema authoring | Zod and JSON Schema alignment | typed validation and better ergonomics without inventing a schema DSL |
| contract artifacts | OpenAPI 3.1 + JSON Schema + Arazzo | standard contracts and workflow descriptions are better than hand-maintained SDK notes |
| database access and migrations | Prisma | type-safe relational access, schema ownership, generated client, and migrations in one toolchain |
| resumable ingest endpoint | tus / tusd | production-grade resumable upload protocol and server are better than inventing custom chunk upload behavior |
| telemetry | OpenTelemetry | vendor-neutral observability without one-off instrumentation conventions |
| durable workflows | Temporal | durable retries, replay, testing, timers, execution history already exist |
| SQL registry | PostgreSQL + JSONB | rich relational semantics and flexible metadata without a custom registry store |
| cache and coordination | Redis | mature hot-path primitives without inventing ephemeral coordination systems |
| image transform and delivery | imgproxy + libvips | proven, fast image server instead of building our own resizing service |
| video and image-to-video | FFmpeg | broad codec and pipeline support, hardware acceleration, deep ecosystem |
| canonical source repository | Kopia | run the repository directly instead of inventing a custom chunk store |
| storage substrate | SeaweedFS by default, JuiceFS when POSIX semantics matter | tiered storage and object-backed workspaces are better than writing bespoke placement logic |
| lazy hot-read path | Nydus plus optional Alluxio | consume the lazy-read and cache layers directly instead of materializing every large asset eagerly |
| artifact graph | ORAS | immutable bundles and artifact references are better than inventing a custom registry |
| delivery edge behavior | immutable versioned artifacts plus CDN tiering | hot artifacts should stay cheap and fast without dragging reads back to origin or source repository |
| document normalization | Gotenberg | LibreOffice and Chromium behind an API instead of custom conversion orchestration |
| derived artifact storage | S3-compatible store | avoids bespoke binary storage and lets adopters bring their own provider |
| native SDK core | Rust + UniFFI + cbindgen | lets the platform share hard client logic across languages instead of reimplementing it repeatedly |

## 3. Default does not mean vague

The platform should document supported substitution points for:

- SQL database
- S3-compatible storage
- CDN
- worker runtime and compute environment
- chosen service host shell

The goal is not infinite abstraction. The goal is stable platform semantics with deliberate, well-documented swap boundaries.

## 4. Package-specific posture

### 4.1 Hono

Hono is the preferred HTTP layer because it is fast, small, multi-runtime, and based on Web Standard APIs.

To use it well in CDNgine:

- use validator middleware consistently, with `@hono/zod-validator` or `@hono/standard-validator`
- structure exported route trees so Hono type inference remains useful in tests and internal clients
- use RPC typing for internal service clients where sharing route types reduces drift
- use `testClient` for typed route testing
- apply `requestId`, `secureHeaders`, and `timeout` middleware as standard service posture

### 4.2 Encore or Nest as host shells

The platform should be able to run in Encore or Nest without changing its core API semantics. Host-specific conveniences must stay outside the core route and service ownership model.

### 4.3 Prisma

Prisma is the preferred data-access layer because it gives the platform:

- a strong schema-centric relational model
- type-safe client generation
- migration support
- clearer collaboration on evolving the registry schema

Use it with explicit architectural discipline:

- unique constraints enforce idempotent business keys
- optimistic concurrency control uses version fields where records are mutable
- transactions protect registry state transitions
- raw SQL remains acceptable for PostgreSQL-specific query paths Prisma does not model efficiently

### 4.4 Temporal

Temporal should own long-running orchestration, retries, timers, and replay. The platform should not reimplement durable workflow bookkeeping inside Redis tables or queue glue.

To use it well:

- derive Workflow IDs from business identity
- use Worker Versioning for workflow-code deployments
- run replay tests before shipping workflow changes
- use Queries, Signals, and Updates for operator interaction with running workflows
- use Continue-As-New when workflow histories grow too large

### 4.5 tus / tusd

tus is the strongest general-purpose resumable upload protocol in the current ecosystem, and tusd is the clearest reusable server choice when CDNgine needs a public upload endpoint that supports resume, retries, and operational maturity.

It should sit in front of ingest finalization and source snapshotting rather than being replaced with custom upload-session chunk semantics.

To use it well:

- treat tusd as a dedicated ingest subsystem
- require the protocol extensions that matter for production ingest: `creation`, `creation-defer-length`, `checksum`, `expiration`, and `termination`
- use hooks to validate upload metadata and control storage-path derivation
- scrape tusd's `/metrics`
- avoid production deployment patterns that depend on local-disk locks or shared NFS semantics
- configure equal multipart part sizes when targeting Cloudflare R2

### 4.6 Zod plus JSON Schema alignment

Zod is a strong fit for code-near validation and schema reuse, while published contracts should still center on OpenAPI, JSON Schema, and Arazzo for multi-step flows.

The intended posture is:

- Zod or Standard Schema-compatible definitions near route and contract code
- generated JSON Schema and OpenAPI artifacts as release outputs
- generated Arazzo workflow artifacts for upload and other multi-step public flows
- examples, descriptions, and deprecation metadata authored once and carried through to generated docs

### 4.7 OpenTelemetry

OpenTelemetry is the default telemetry posture for traces, metrics, and logs because it keeps the service vendor-neutral and observable by design.

Use it with:

- W3C Trace Context propagation
- shared correlation fields across API, workflow, and storage spans
- collector-side policy for sampling and export
- separate audit-event recording instead of burying privileged events in normal logs

### 4.8 PostgreSQL + JSONB

JSONB lets the registry keep a strong relational core while storing:

- capability metadata
- manifest fragments
- processor result blobs
- namespace-specific structured metadata

without inventing a separate metadata subsystem too early.

To use PostgreSQL well:

- keep relational truth relational
- add GIN indexes only to real JSONB query paths
- use row-level security where a deployment requires stronger tenant isolation

### 4.9 Redis

Redis should accelerate hot paths and coordination, but never become the hidden control-plane database.

It is appropriate for:

- short-lived dedupe windows
- cache entries
- ephemeral coordination helpers
- rate and lease helpers

It is not the durable home for:

- idempotency truth
- workflow truth
- publication truth

### 4.10 imgproxy + libvips

This pair is the clearest answer for fast image delivery and transformation without writing a custom server. It fits the architecture's bias toward deterministic delivery paths and signed URLs.

Use it for:

- signed on-demand transforms for approved transform policies
- deterministic resize and format conversion
- CDN-friendly image delivery

Do not expose arbitrary free-form transform inputs to untrusted callers.

### 4.11 Gotenberg

For document conversion, Gotenberg gives an API-first container that already combines Chromium, LibreOffice, and PDF tooling. That is much cheaper to operate and reason about than building a bespoke service mesh of document converters.

Use it as a normalization boundary, not as a public synchronous endpoint.

### 4.12 FFmpeg

FFmpeg remains the core for:

- transcoding
- poster extraction
- streaming ladders
- image-to-video derivation

with hardware acceleration where available.

Use it behind narrow processor contracts rather than as a shell-script substrate hidden inside route handlers.

### 4.12.1 Video publication posture

For streaming-oriented outputs, FFmpeg should publish:

- adaptive bitrate ladders
- HLS-style manifests
- immutable media segments
- poster frames and preview clips

The API and CDN layers then decide how those bundles are authorized and exposed.

### 4.13 Canonical source, tiering, and hot-read split

The source stack should separate three jobs that are often wrongly collapsed into one bucket:

- **canonical source history**
- **byte placement across hot, warm, and cold tiers**
- **hot internal reads**

The default posture is:

- use **SeaweedFS** as the default S3-compatible substrate so the platform can control tiered storage rather than leaving every byte in one undifferentiated class
- run **Kopia** on top of that substrate for immutable uploaded originals, chunk deduplication, snapshot history, and replay provenance
- use **RustFS** for fast-start and simple one-bucket profiles because it preserves the same S3-compatible adapter shape while keeping local bring-up easy
- use **JuiceFS** when tools or workers need a shared POSIX workspace
- use **Nydus** and optional **Alluxio** only where repeated package-like reads justify them

This lets the platform stay mathematically efficient for large iterative binaries without forcing browser delivery or public ingest to speak chunk semantics directly.

The important implementation rule is: **consume these upstream systems directly**. CDNgine should not reimplement chunking, snapshot packing, lazy chunk fetch, distributed cache coordination, or OCI artifact graph semantics in application code.

### 4.14 ORAS and the artifact split

ORAS is the preferred artifact-graph layer for immutable bundles, manifests, and related metadata.

Use it for:

- derived bundle publication
- manifest-adjacent artifact graphs
- integrity-linked metadata packages
- internal or cross-service distribution of deterministic outputs

Keep browser-facing delivery in the derived store plus CDN. ORAS is the artifact graph, not the public edge cache.

### 4.15 Lessons from external platforms

The architecture should also consume operating patterns from adjacent systems:

- Inngest, Trigger.dev, DBOS, and Restate reinforce that durable business logic belongs in workflows with explicit waits, retries, cancellation, and run history
- Convex reinforces that the public surface should generate pleasant developer APIs, not just technically valid clients
- OpenMetadata and DataHub reinforce that the registry is a lineage and metadata plane, not a loose bag of tables
- lakeFS reinforces that branch, publish, revert, GC, and retention are platform features, not storage afterthoughts when a deployment explicitly needs Git-like branch or publish semantics
- Kopia, restic, and Borg reinforce immutable snapshot identity, pack-file design, and repository maintenance discipline
- SeaweedFS and JuiceFS reinforce that byte placement and workspace semantics belong in a real substrate, not in ad hoc application code
- Nydus reinforces that lazy reads and chunk-aware loading can materially reduce hot-read cost for package-like assets
- ORAS reinforces that immutable artifact graphs should reuse OCI semantics instead of inventing a bespoke bundle registry
- DedupBench reinforces that chunking algorithms should be benchmarked on the real corpus instead of chosen by folklore
- Unkey and Better Auth reinforce that authorization and organization context should be modeled explicitly and auditable
- Medusa and Cal.com reinforce that modular boundaries and explicit package ownership matter when the platform grows

## 5. References

- [Hono validation guide](https://hono.dev/docs/guides/validation)
- [Hono RPC guide](https://hono.dev/docs/guides/rpc)
- [Hono testing helper](https://hono.dev/docs/helpers/testing)
- [Hono Request ID middleware](https://hono.dev/docs/middleware/builtin/request-id)
- [Hono Secure Headers middleware](https://hono.dev/docs/middleware/builtin/secure-headers)
- [Hono Timeout middleware](https://hono.dev/docs/middleware/builtin/timeout)
- [Prisma transactions, idempotent APIs, and OCC](https://www.prisma.io/docs/orm/prisma-client/queries/transactions)
- [Prisma index configuration](https://docs.prisma.io/docs/orm/prisma-schema/data-model/indexes)
- [tus protocol](https://tus.io/protocols/resumable-upload)
- [tusd monitoring](https://tus.github.io/tusd/advanced-topics/monitoring/)
- [tusd S3 storage backend](https://tus.github.io/tusd/storage-backends/aws-s3/)
- [OpenTelemetry sampling](https://opentelemetry.io/docs/concepts/sampling/)
- [Temporal safe deployments](https://docs.temporal.io/develop/safe-deployments)
- [Temporal TypeScript message passing](https://docs.temporal.io/develop/typescript/workflows/message-passing)
- [Temporal TypeScript Continue-As-New](https://docs.temporal.io/develop/typescript/workflows/continue-as-new)
- [PostgreSQL row security policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Cloudflare R2 product page](https://www.cloudflare.com/developer-platform/products/r2/)
- [OpenAPI Specification](https://spec.openapis.org/oas/latest.html)
- [JSON Schema](https://json-schema.org/)
- [Arazzo Specification](https://spec.openapis.org/arazzo/latest.html)
- [Inngest docs](https://www.inngest.com/docs)
- [Trigger.dev docs](https://trigger.dev/docs)
- [DBOS docs](https://docs.dbos.dev/)
- [Restate docs](https://docs.restate.dev/)
- [Convex generated API](https://docs.convex.dev/generated-api/)
- [OpenMetadata docs](https://docs.open-metadata.org/)
- [DataHub GraphQL docs](https://docs.datahub.com/docs/api/graphql/overview)
- [lakeFS documentation](https://docs.lakefs.io/)
- [Unkey roles and permissions](https://www.unkey.com/docs/apis/features/authorization/roles-and-permissions)
- [Better Auth organization plugin](https://better-auth.com/docs/plugins/organization)
- [Medusa documentation](https://docs.medusajs.com/)
- [Cal.com repository](https://github.com/calcom/cal.com)
- [Cloudflare Tiered Cache](https://developers.cloudflare.com/cache/how-to/tiered-cache/)
- [Cloudflare Cache Reserve API model](https://developers.cloudflare.com/api/node/resources/cache/subresources/cache_reserve/models/cache_reserve/)
- [Amazon CloudFront signed cookies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-signed-cookies.html)
- [Amazon CloudFront range GETs](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/RangeGETs.html)
- [RFC 8246: HTTP Immutable Responses](https://www.rfc-editor.org/rfc/rfc8246.html)
- [RFC 8216: HTTP Live Streaming](https://www.rfc-editor.org/rfc/rfc8216.html)
- [Kopia features](https://kopia.io/docs/features/)
- [restic repository design](https://restic.readthedocs.io/en/stable/100_references.html)
- [SeaweedFS tiered storage](https://github.com/seaweedfs/seaweedfs/wiki/Tiered-Storage)
- [JuiceFS architecture](https://juicefs.com/docs/community/architecture)
- [Nydus](https://nydus.dev/)
- [ORAS documentation](https://oras.land/docs/)
- [Alluxio documentation](https://documentation.alluxio.io/os-en)
- [DedupBench](https://github.com/UWASL/dedup-bench)
- [UniFFI user guide](https://mozilla.github.io/uniffi-rs/latest/)
- [cbindgen](https://github.com/mozilla/cbindgen)
