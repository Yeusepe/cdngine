![CDNgine](https://github.com/user-attachments/assets/8feb6790-796e-4de7-ab57-40bd2942df7f)

CDNgine is a **generic asset processing and delivery platform** for teams that need one durable system for ingest, versioning, derivation, and global delivery of binary assets.

It is designed for products and internal domains that work with:

- images and textures
- video
- presentations and PDFs
- archives and packages
- future custom asset types registered through explicit capability and workflow contracts

The repository currently focuses on the **architecture, platform model, and implementation guidance** for the system.

## What CDNgine is trying to solve

Most asset systems become inconsistent over time:

- originals and generated outputs get mixed together
- delivery paths are fast but hard to replay
- workflows are added through scattered conditionals
- every new file type forces redesign
- platform behavior depends too much on one deployment environment

CDNgine is meant to fix that by standardizing a few core rules:

1. **raw uploads stay canonical**
2. **derivatives are deterministic and regenerable**
3. **expensive work happens in durable workflows**
4. **delivery stays CDN-friendly**
5. **new asset types are added through registration, not service sprawl**

## Core model

At a high level, CDNgine separates **canonical source**, **control**, **materialization**, and **delivery**:

- **Kopia** is the default canonical source repository and stores immutable source versions through rolling-hash chunking, deduplication, compression, and snapshot history
- a **SeaweedFS** or **JuiceFS** substrate gives the source and derived planes operational storage tiers, S3-compatible access, and fast local or regional placement
- the **registry** stores asset, version, derivative, manifest, workflow, and audit state
- **Temporal** owns long-running orchestration and replay-safe execution
- **ORAS** packages deterministic derived bundles, manifests, and integrity-linked artifact graphs
- **Nydus** is the default lazy-read layer, with optional **Alluxio** hot caching, to accelerate repeated internal reads without forcing every output to stay permanently materialized
- the **CDN** serves browser-friendly published artifacts on the hot path

That means the platform treats:

- the **canonical source repository** as the source of truth for immutable originals and iterative revisions
- the **tiered storage substrate** as the byte-placement layer for hot, warm, and cold data
- **ORAS** as the artifact-graph layer for deterministic published bundles
- the **derived store plus CDN** as the source of truth for browser-facing delivery artifacts
- the **registry** as the system of record for control-plane state

## How ingest actually works

The ingest path is:

1. the client calls CDNgine to create an upload session
2. CDNgine creates the asset and version records in the registry
3. CDNgine returns upload instructions for an **ingest-managed upload target**
4. the client uploads the original binary to that ingest target
5. the client calls upload completion
6. CDNgine validates the upload and snapshots the staged object into the **canonical source repository**, which stores deduplicated content over the tiered storage substrate
7. CDNgine starts a durable workflow in **Temporal**
8. workers materialize the canonical source version through the source repository and hot cache layers
9. workers validate and transform that source into delivery variants
10. workers package deterministic delivery bundles and manifests through **ORAS** where bundle semantics matter
11. workers publish browser-facing outputs into the **derived store**
12. the registry records the derivative keys, artifact references, and manifest

The important point is: the **canonical source repository** should own immutable source identity, deduplicated source history, and replay provenance.

That does **not** mean the source repository must be the first public multipart upload endpoint exposed directly to every client. A simpler ingest target or ingest proxy in front of the source repository is the cleaner operational choice for browser and SDK clients.

The current best default for that public upload endpoint is:

- **tus/tusd** for resumable, reusable, protocol-level uploads
- backed by multipart-capable object storage where that improves throughput and recovery

So the intended default public ingest path is:

- `client -> API session creation -> tusd/staging upload -> snapshot into canonical source repository -> workflow dispatch`

Canonical source assets still live physically on a tiered S3-compatible substrate, but they are addressed through repository snapshots, chunk identities, and canonical logical paths rather than raw application-level object keys.

Trusted internal flows can use the source plane more directly:

- bulk imports can snapshot directly into the canonical repository when the caller already has trusted access to the substrate
- operator recovery and replay anchor to repository snapshot IDs, content digests, and canonical logical paths
- package-like or rebuildable assets may also be exposed through **Nydus** for high-frequency internal reads

## How delivery actually works

The delivery path is different from the ingest path:

1. the client asks CDNgine for asset metadata, derivatives, or a manifest
2. CDNgine returns manifest data and, where needed, a signed delivery URL or path
3. the client fetches the published derivative through the **CDN**
4. the CDN serves from cache or fetches from the **derived store**

The important point is: **clients do not normally download published derivatives from the canonical source repository.**

When a client needs the **original source asset itself**, that is a separate flow:

1. the client asks the API to authorize original-source delivery for a version
2. CDNgine resolves the canonical source snapshot for that version
3. CDNgine either proxies reconstruction from the source repository, returns a tightly scoped lazy-read handle for trusted internal clients, or, only when justified, materializes a delivery export depending on policy and deployment posture

That means **published delivery** and **original-source delivery** are different concerns:

- published delivery optimizes for CDN-friendly hot reads
- original-source delivery optimizes for exact canonical reconstruction, policy control, and provenance
- the original is stored once in the canonical repository by default; a second delivery copy is optional rather than automatic

There is also an important transfer distinction:

- a **generic browser download** of the original is usually just a normal byte stream from a proxy or export path
- a **trusted internal client** can use a lazy chunk-backed read path and hot cache to avoid rehydrating the full asset on every read
- published derivatives still rely on CDN caching, immutable artifact keys, and selective materialization rather than source-plane transfer semantics

The canonical source plane is for:

- canonical originals
- deduplicated source storage across revisions and related binaries
- replay
- provenance
- storage-efficient retention of very large iterative assets such as Unity packages, `.spp` files, PSD/EXR sources, video masters, and archives

The derived store plus CDN are for:

- thumbnails
- WebP masters
- posters
- HLS segments
- slide images
- other published delivery outputs

## Why the split exists

This split is intentional:

- the **canonical source repository** answers: "what exact immutable source version should replay use, and which chunks are already stored?"
- the **derived store** answers: "what exact browser-facing artifact should the client receive right now?"

If the client needs the canonical original, the service should expose that through an explicit **original-source delivery** contract rather than pretending the public delivery CDN path and the canonical source path are the same thing.

If every published derivative had to be delivered from the source repository, the platform would mix provenance storage with hot delivery traffic, which makes replay, cache behavior, and retention policy harder to operate.

Likewise, if every public upload had to speak source-repository semantics directly, the platform would couple browser and SDK ingest too tightly to a specialized canonical content system. The cleaner pattern is usually:

- simple upload target for ingress
- snapshotting into the canonical repository after ingest finalization
- replay and derivation from the canonical repository
- selective lazy materialization for hot internal reads

The stronger source-plane posture is not "store everything in the CDN." It is "use the right layer for the right job":

- **Kopia** for deduplicated snapshot history and rolling-hash chunking
- **SeaweedFS** for tiered blob placement, cloud tier movement, and S3-compatible storage access
- **JuiceFS** where POSIX mounts or shared workspace semantics matter for tools and artists
- **Nydus** for package-like or rebuildable hot paths
- **ORAS** for immutable artifact graphs, manifests, and bundle publication

## Service stack direction

The current service-level direction is:

| Concern | Default direction |
| --- | --- |
| runtime language | TypeScript |
| HTTP and API layer | Hono |
| host environment | portable between Encore and Nest |
| database access and migrations | Prisma |
| primary SQL engine | PostgreSQL + JSONB |
| cache and short-lived coordination | Redis |
| durable workflows | Temporal |
| resumable upload endpoint | tus / tusd |
| image delivery and transform | imgproxy + libvips |
| video processing | FFmpeg |
| document normalization | Gotenberg |
| canonical raw source | Kopia repository over a SeaweedFS-backed S3 namespace |
| hot read acceleration | Nydus plus optional Alluxio cache |
| artifact graph and bundle registry | ORAS over OCI registry |
| branch/publish semantics when needed | lakeFS |
| derived delivery origin | S3-compatible object storage |

This is an **opinionated default profile**, not a claim that every adopter must use the exact same infrastructure provider.

You should use these packages and services where possible, but you are free to use your own infrastructure providers if you preserve the platform semantics.

- run **Kopia** for canonical source history instead of rebuilding chunking or snapshot semantics
- run **SeaweedFS** as the default tiered substrate instead of inventing custom hot/warm/cold placement logic
- use **JuiceFS** only when a real POSIX workspace is needed
- use **Nydus** for lazy chunk-addressed reads instead of writing a bespoke lazy materializer
- use **ORAS** for artifact graphs instead of inventing a custom bundle registry
- use **Alluxio** only when a shared hot cache is justified by the workload

## Architectural stance

CDNgine is intentionally opinionated about the things that matter most:

- **deduplicated canonical source history** is required
- **lazy or selective materialization** is required for hot internal reads
- **deterministic derivative keys** are required
- **Temporal-style durable orchestration semantics** are required
- **public API behavior** should remain stable even if host/runtime choices differ

At the same time, the platform is meant to stay portable where that does not break platform semantics:

- SQL deployment
- object storage provider
- CDN
- worker runtime
- application host shell around the Hono-based API layer

## Supported workload families

The architecture is generic on purpose. It is meant to support workloads such as:

- image upload, validation, thumbnails, and format conversion
- texture slicing, tiling, and other frontend-oriented image derivation
- video transcoding, poster extraction, and streaming publication
- PowerPoint or PDF normalization into slide-oriented delivery outputs
- archive and package preservation, inspection, and future domain-specific transforms

## One-sentence mental model

If you only remember one thing, remember this:

**clients upload originals through the ingest service, CDNgine snapshots them into a deduplicated canonical source repository on a tiered substrate, workers materialize only the bytes they need, and clients download published outputs from the CDN-backed derived store.**

## What is in this repository

This repository currently contains the **design and implementation guidance** for the platform:

- reference architecture
- service architecture
- state-machine, persistence, and dispatch contracts
- canonical source, tiering, and materialization rules
- public, platform-admin, and operator API surface guidance
- problem-type and compatibility guidance
- technology profile and upstream package guidance
- API and SDK guidance
- contract-governance and conformance guidance
- pipeline, workflow, and service registration models
- observability, security, deployment, and resilience expectations
- SLOs, runbooks, and threat-model guidance
- SDK, code-generation, and polyglot FFI strategy
- ADRs, contributor guidance, and implementation traceability docs

## Where to start

If you are new to the project, read in this order:

1. [docs/architecture.md](./docs/architecture.md)
2. [docs/service-architecture.md](./docs/service-architecture.md)
3. [docs/technology-profile.md](./docs/technology-profile.md)
4. [docs/package-reference.md](./docs/package-reference.md)
5. [docs/README.md](./docs/README.md)

## Documentation map

The full docs index lives at [docs/README.md](./docs/README.md).

Key entry points:

- **Platform**
  - [Architecture](./docs/architecture.md)
  - [Service Architecture](./docs/service-architecture.md)
  - [State Machines](./docs/state-machines.md)
  - [Persistence Model](./docs/persistence-model.md)
  - [Canonical Source And Tiering Contract](./docs/canonical-source-and-tiering-contract.md)
  - [Technology Profile](./docs/technology-profile.md)
  - [Package And Repository Reference](./docs/package-reference.md)
- **Reference**
  - [API Surface](./docs/api-surface.md)
  - [API Style Guide](./docs/api-style-guide.md)
  - [Problem Types](./docs/problem-types.md)
  - [SDK Strategy](./docs/sdk-strategy.md)
  - [Spec Governance](./docs/spec-governance.md)
  - [Pipeline Capability Model](./docs/pipeline-capability-model.md)
  - [Workflow Extensibility](./docs/workflow-extensibility.md)
- **Operations**
  - [Environment And Deployment](./docs/environment-and-deployment.md)
  - [Observability](./docs/observability.md)
  - [SLO And Capacity](./docs/slo-and-capacity.md)
  - [Security Model](./docs/security-model.md)
  - [Resilience And Scale Validation](./docs/resilience-and-scale-validation.md)

## Current state

The repository is currently architecture- and documentation-heavy. It is establishing the platform contract before implementation fills in the executable services and workflows.

That is intentional: this system has enough moving parts that unclear architecture would create bad implementation faster than useful implementation.
