# Package And Repository Reference

This document maps platform concerns to concrete packages, repositories, and upstream documentation.

The purpose is simple: **consume fast, proven systems wherever possible** and reserve custom code for platform semantics, registration, manifests, and orchestration composition.

The package choices map onto this lifecycle:

`stage -> canonicalize -> process -> publish -> deliver`

That is the easiest way to read the stack list below.

## 1. Core default set

| Concern | Package / project | Why it helps |
| --- | --- | --- |
| HTTP and API layer | Hono | fast, lightweight, Web-standards-based routing that can run across multiple runtimes |
| host environment | Encore or Nest | lets teams use a preferred application shell without changing core platform semantics |
| validation and schema authoring | Zod | strongly typed runtime validation with JSON Schema conversion support |
| public contract artifacts | OpenAPI 3.1 + JSON Schema + Arazzo | durable wire contracts plus executable workflow descriptions |
| database access and migrations | Prisma | type-safe ORM client, schema ownership, migrations, and generated data tooling |
| resumable ingest endpoint | tus + tusd | reusable resumable upload protocol and mature server instead of inventing custom chunk upload behavior |
| telemetry | OpenTelemetry | vendor-neutral traces, metrics, and logs |
| canonical source repository | Kopia | chunk-deduplicated canonical asset history and replay provenance without custom repository code |
| tiered storage substrate | SeaweedFS by default, JuiceFS when POSIX semantics matter | explicit byte placement and shared-workspace options |
| local or simple S3-compatible backend | RustFS | active S3-compatible object store for fast-start and one-bucket profiles |
| metadata registry | PostgreSQL + JSONB | durable relational state plus flexible structured metadata |
| metadata/query indexing | PostgreSQL GIN over JSONB | indexable structured metadata without inventing a custom metadata engine |
| cache and coordination | Redis | mature cache, lock, and ephemeral coordination primitives |
| durable workflows | Temporal | retries, replay, timers, testing, and execution history |
| lazy internal hot reads | Nydus plus optional Alluxio | on-demand chunk reads and hot caches for package-like assets |
| artifact graph and immutable bundles | ORAS | OCI-native artifact references and bundle publication |
| image processing and delivery | imgproxy + libvips | high-performance image processing without building a transform server |
| video and image-to-video | FFmpeg | broad codec support, hardware acceleration, deep ecosystem |
| document conversion | Gotenberg | Chromium + LibreOffice + PDF tooling behind an API |
| derived storage | S3-compatible object store | portable binary delivery origin |
| delivery control patterns | CDN delivery guidance and HTTP standards | per-organization hostnames, bundle auth, immutable caching, and hot-object behavior are already well understood |
| native SDK core | Rust + UniFFI + cbindgen | shared cross-language SDK logic without repeated reimplementation |

## 2. Repositories to study

| Project | Repository | Relevance |
| --- | --- | --- |
| Hono | `honojs/hono` | portable HTTP layer, multi-runtime deployment, small API surface |
| Prisma | `prisma/prisma` | data modeling, client generation, migrations, and schema discipline |
| tusd | `tus/tusd` | resumable upload server and protocol reference implementation |
| Encore | `encoredev/encore` | one supported host shell with strong local infrastructure ergonomics |
| NestJS | `nestjs/nest` | one supported host shell with module-oriented application composition |
| Temporal TypeScript SDK | `temporalio/sdk-typescript` | workflow programming model |
| Temporal samples | `temporalio/samples-typescript` | retry, replay, and activity examples |
| imgproxy | `imgproxy/imgproxy` | image server and delivery model |
| libvips | `libvips/libvips` | fast, low-memory image processing engine |
| Gotenberg | `gotenberg/gotenberg` | document conversion service architecture |
| Kopia | `kopia/kopia` | snapshot repository layout, deduplication, and source-history management |
| RustFS | `rustfs/rustfs` | S3-compatible local or simple deployment backend for staging, source, and derived prefixes |
| SeaweedFS | `seaweedfs/seaweedfs` | tiered storage, S3-compatible substrate, and placement controls |
| JuiceFS | `juicedata/juicefs` | object-backed POSIX workspace semantics |
| Nydus | `dragonflyoss/nydus` | lazy chunk-addressed reads and on-demand materialization |
| Alluxio | `Alluxio/alluxio` | distributed hot cache in front of persistent stores |
| ORAS | `oras-project/oras` | OCI artifact publication and immutable bundle references |
| DedupBench | `UWASL/dedup-bench` | benchmarking chunking algorithms on the real corpus |
| Inngest | `inngest/inngest` | durable step-oriented workflow posture |
| Trigger.dev | `triggerdotdev/trigger.dev` | run UX, queues, and long-running developer ergonomics |
| DBOS | `dbos-inc/dbos-transact-ts` | PostgreSQL-centered durable execution ideas |
| Restate | `restatedev/restate` | durable service orchestration and stateful execution |
| OpenMetadata | `open-metadata/OpenMetadata` | metadata-plane entity and lineage modeling |
| DataHub | `datahub-project/datahub` | metadata graph and lineage thinking |
| lakeFS | `treeverse/lakeFS` | optional branch/publish/revert semantics and GC posture when that workflow is needed |
| Unkey | `unkeyed/unkey` | API control-plane auth and permissions patterns |
| Better Auth | `better-auth/better-auth` | composable organization-aware auth |
| Medusa | `medusajs/medusa` | modular workflows and provider composition |
| Cal.com | `calcom/cal.com` | large TypeScript monorepo and multi-tenant package organization |
| UniFFI | `mozilla/uniffi-rs` | multi-language bindings for a Rust SDK core |
| cbindgen | `mozilla/cbindgen` | generated C headers for native bindings |

## 3. Service-foundation stack

### 3.1 Hono

Use for:

- public, platform-admin, and operator route definition
- middleware composition
- runtime-portable HTTP handling
- keeping the API layer small and explicit

Use it fully:

- validator middleware for headers, params, and JSON bodies
- RPC typing for internal clients
- `testClient` for typed route tests
- request IDs, secure headers, and timeout middleware as defaults

### 3.2 Encore or Nest

Use for:

- application composition
- service hosting
- environment-specific operational conveniences

Why it fits:

- Encore brings strong local-infrastructure ergonomics and service discovery tooling
- Nest brings a familiar module-oriented application shell for teams already standardized on Nest
- both can host the same Hono-centered service core if boundaries stay explicit

### 3.3 Zod

Use for:

- code-near schema authoring
- runtime validation beyond basic endpoint typing
- inferred types
- portable schema derivation inputs

### 3.3.1 OpenAPI, JSON Schema, and Arazzo

Use for:

- public HTTP contract publication
- schema portability across SDK generators
- workflow descriptions for multi-step operations such as upload and polling
- keeping generated SDKs aligned to the real lifecycle of the API

### 3.4 Prisma

Use for:

- primary relational modeling
- client generation
- migrations
- a clearer shared schema contract for the registry

Use it deliberately:

- enforce idempotency with unique constraints
- use optimistic concurrency control on mutable control-plane rows
- use transactions around canonicalization and dispatch state
- prefer scoped repository methods and composite filters over bare resource-ID lookups

### 3.5 OpenTelemetry

Use for:

- traces
- metrics
- logs and correlation
- vendor-neutral observability posture

Preferred posture:

- W3C Trace Context propagation end to end
- collector-managed export and sampling policy
- shared correlation fields across API, Temporal, and storage spans

### 3.6 tus / tusd

Use for:

- resumable browser and SDK uploads
- pause and resume semantics
- interrupted-upload recovery
- reusable provider-agnostic upload behavior

Use it fully:

- enable the required protocol extensions for real ingest
- use hooks for metadata validation and completion control
- scrape tusd metrics
- use object storage backends in production
- configure equal R2 multipart part sizes when Cloudflare R2 is the backing store

### 3.7 Canonical source repository and substrate

Use for:

- canonical asset storage after ingest finalization
- rolling-hash chunking and deduplicated snapshot history
- canonical file reconstruction for replay and processing
- storage-efficient repeated revisions of binary-heavy source assets

Use it deliberately:

- keep public clients on the simpler ingest target and snapshot into the source repository after verification
- persist snapshot identities, logical paths, and content digests in the registry
- back the repository with an explicit bucket or prefix whether the deployment uses RustFS locally or SeaweedFS in fuller environments
- treat SeaweedFS or JuiceFS as the physical substrate while the source repository remains the canonical addressing layer
- use lazy-read or hot-cache layers only where repeated source reconstruction justifies them

Do not reimplement:

- content-defined or rolling-hash chunking
- snapshot pack and index formats
- repository maintenance and prune logic
- lazy chunk-addressed fetch semantics
- distributed cache coherence for shared hot reads

### 3.7.1 ORAS

Use for:

- immutable artifact bundles
- cross-service artifact references
- manifest-adjacent metadata packages
- OCI-native publication semantics

## 4. Image stack

### 4.1 imgproxy

Use for:

- on-demand image delivery
- resize, crop, and format conversion
- signed URLs
- removing image-processing logic from application code

### 4.2 libvips

Use for:

- high-performance backend image operations
- texture slicing and splicing helpers
- precompute jobs when on-demand paths are not enough

## 5. Video stack

### 5.1 FFmpeg

Use for:

- transcoding
- poster extraction
- HLS ladder generation
- image-to-video conversion
- clip and preview generation

Video publication rules:

- publish immutable segments and manifests as first-class derivatives
- prefer bundle-level authorization for private streams
- support range-friendly delivery behavior at the CDN layer

## 6. Document stack

### 6.1 Gotenberg

Use for:

- PowerPoint to PDF normalization
- HTML or Chromium-backed rendering paths
- document API orchestration

Treat it as a worker dependency, not as a public request-path dependency.

## 7. Registry and state stack

### 7.1 PostgreSQL + JSONB

Use for:

- assets
- versions
- derivatives
- manifests
- namespace registrations
- workflow and job state
- structured metadata extensions
- idempotency records
- workflow-dispatch outbox rows
- scope policy bindings

### 7.2 Redis

Use for:

- upload-session cache helpers
- short-lived locks
- replay windows
- hot metadata caching
- workflow coordination helpers that are explicitly non-durable

Constraint:

- never use Redis as durable truth

## 8. Workflow and durability stack

### 8.1 Temporal

Use for:

- durable orchestration
- retries and backoff
- timers
- compensation flows
- replay and operator-visible history
- workflow message handling through Queries, Signals, and Updates
- safe evolution through Worker Versioning and replay testing

## 9. SDK and FFI stack

### 9.1 Rust SDK core

Use for:

- shared upload orchestration logic
- manifest decoding helpers
- retry and polling state machines
- hard cross-language logic that should not be rewritten repeatedly

### 9.2 UniFFI

Use for:

- Swift bindings
- Kotlin bindings
- Python bindings

when the shared native core is preferable to language-local reimplementation.

### 9.3 cbindgen

Use for:

- generated C headers
- stable C and C++ integration points
- keeping the lowest-level native ABI explicit and reviewable

## 10. Storage and CDN stack

### 10.1 S3-compatible object storage

Use for:

- ingest-target backing storage
- derived artifacts
- manifest-addressable delivery files
- adoption flexibility

### 10.2 Cloudflare-friendly deployment profile

Use for:

- low-latency CDN edge delivery
- R2-backed default profile when that provider fits
- strong edge routing and cache behavior
- per-organization hostname support where the delivery scope needs it
- tiered-cache or reserve-style behavior for hot artifacts

## 11. References

- [Hono validation guide](https://hono.dev/docs/guides/validation)
- [Hono RPC guide](https://hono.dev/docs/guides/rpc)
- [Hono testing helper](https://hono.dev/docs/helpers/testing)
- [Hono Request ID middleware](https://hono.dev/docs/middleware/builtin/request-id)
- [Hono Secure Headers middleware](https://hono.dev/docs/middleware/builtin/secure-headers)
- [Hono Timeout middleware](https://hono.dev/docs/middleware/builtin/timeout)
- [OpenAPI Specification](https://spec.openapis.org/oas/latest.html)
- [JSON Schema](https://json-schema.org/)
- [Arazzo Specification](https://spec.openapis.org/arazzo/latest.html)
- [Prisma transactions, idempotent APIs, and OCC](https://www.prisma.io/docs/orm/prisma-client/queries/transactions)
- [Prisma index configuration](https://docs.prisma.io/docs/orm/prisma-schema/data-model/indexes)
- [tus protocol](https://tus.io/protocols/resumable-upload)
- [tusd monitoring](https://tus.github.io/tusd/advanced-topics/monitoring/)
- [tusd S3 storage backend](https://tus.github.io/tusd/storage-backends/aws-s3/)
- [Temporal safe deployments](https://docs.temporal.io/develop/safe-deployments)
- [Temporal Workflow IDs](https://docs.temporal.io/workflow-execution/workflowid-runid)
- [Temporal TypeScript message passing](https://docs.temporal.io/develop/typescript/workflows/message-passing)
- [Temporal TypeScript Continue-As-New](https://docs.temporal.io/develop/typescript/workflows/continue-as-new)
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
- [PostgreSQL row security policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Cloudflare R2 product page](https://www.cloudflare.com/developer-platform/products/r2/)
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
