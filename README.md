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

At a high level, CDNgine separates **provenance**, **control**, and **delivery**:

- **Xet** stores canonical source assets through content-defined chunking, deduplication, and reconstruction metadata over S3-backed storage
- the **registry** stores asset, version, derivative, manifest, workflow, and audit state
- **Temporal** owns long-running orchestration and replay-safe execution
- workers generate deterministic outputs into a **derived object store**
- the **CDN** serves those published artifacts on the hot path

That means the platform treats:

- **Xet** as the canonical content plane for originals
- the **derived store** as the source of truth for published delivery artifacts
- the **registry** as the system of record for control-plane state

## How ingest actually works

The ingest path is:

1. the client calls CDNgine to create an upload session
2. CDNgine creates the asset and version records in the registry
3. CDNgine returns upload instructions for an **ingest-managed upload target**
4. the client uploads the original binary to that ingest target
5. the client calls upload completion
6. CDNgine validates the upload and canonicalizes the staged object into **Xet**, which stores deduplicated content over S3-backed storage
7. CDNgine starts a durable workflow in **Temporal**
8. workers read the canonical source version from **Xet**
9. workers validate and transform that source into delivery variants
10. workers publish those variants into the **derived store**
11. the registry records the derivative keys and manifest

The important point is: **Xet should own the canonical source identity, deduplicated storage layout, and replay source.**

That does **not** mean Xet must be the first public multipart upload endpoint exposed directly to every client. A simpler ingest target or ingest proxy in front of Xet is the cleaner operational choice for browser and SDK clients.

The current best default for that public upload endpoint is:

- **tus/tusd** for resumable, reusable, protocol-level uploads
- backed by multipart-capable object storage where that improves throughput and recovery

Canonical source assets still live physically in S3-compatible storage, but they are addressed through Xet identities and reconstruction metadata rather than exposed as raw application-level object keys.

Trusted internal flows can use Xet more directly:

- bulk imports can canonicalize directly through Xet-aware services built on `xet-core`
- operator recovery and replay can anchor to Xet file IDs, content digests, and canonical logical paths
- source-side immutable evidence can live in the same Xet-backed canonical scope when it must replay with the asset

## How delivery actually works

The delivery path is different from the ingest path:

1. the client asks CDNgine for asset metadata, derivatives, or a manifest
2. CDNgine returns manifest data and, where needed, a signed delivery URL or path
3. the client fetches the published derivative through the **CDN**
4. the CDN serves from cache or fetches from the **derived store**

The important point is: **clients do not normally download published derivatives from Xet.**

When a client needs the **original source asset itself**, that is a separate flow:

1. the client asks the API to authorize original-source delivery for a version
2. CDNgine resolves the canonical Xet identity for that version
3. CDNgine either proxies reconstruction from Xet, returns a tightly scoped Xet-backed read handle, or materializes a delivery export depending on policy and deployment posture

That means **published delivery** and **original-source delivery** are different concerns:

- published delivery optimizes for CDN-friendly hot reads
- original-source delivery optimizes for exact canonical reconstruction, policy control, and provenance

Xet is for:

- canonical originals
- deduplicated source storage across revisions and related binaries
- replay
- provenance

The derived store plus CDN are for:

- thumbnails
- WebP masters
- posters
- HLS segments
- slide images
- other published delivery outputs

## Why the split exists

This split is intentional:

- **Xet** answers: "what exact canonical source file should replay use, and which stored chunks already exist?"
- the **derived store** answers: "what exact published artifact should the client receive right now?"

If the client needs the canonical original, the service should expose that through an explicit **original-source delivery** contract rather than pretending the public delivery CDN path and the canonical source path are the same thing.

If every published derivative had to be delivered from Xet, the platform would mix provenance storage with hot delivery traffic, which makes replay, cache behavior, and retention policy harder to operate.

Likewise, if every public upload had to speak Xet semantics directly, the platform would couple browser and SDK ingest too tightly to a specialized canonical content system. The cleaner pattern is usually:

- simple upload target for ingress
- canonicalization into Xet after ingest finalization
- replay and derivation from Xet

The stronger Xet posture is not "use Xet less." It is "use Xet for the things Xet is actually good at":

- content-defined chunking and chunk-level deduplication over S3-backed storage
- canonical file identity for replay and provenance
- smart reconstruction of source files into worker scratch space
- storage-efficient repeated revisions of large binaries such as Unity packages, FBX files, texture archives, and video masters

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
| canonical raw source | Xet over S3-backed storage |
| derived delivery origin | S3-compatible object storage |

This is an **opinionated default profile**, not a claim that every adopter must use the exact same infrastructure provider.

## Architectural stance

CDNgine is intentionally opinionated about the things that matter most:

- **Xet is fixed** as the canonical deduplicated source plane
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

**clients upload originals through the ingest service, CDNgine canonicalizes them into Xet over S3-backed storage, workers reconstruct from Xet, and clients download published outputs from the CDN-backed derived store.**

## What is in this repository

This repository currently contains the **design and implementation guidance** for the platform:

- reference architecture
- service architecture
- state-machine, persistence, and dispatch contracts
- canonicalization and Xet source-of-truth rules
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
  - [Canonicalization And Xet Contract](./docs/canonicalization-and-xet-contract.md)
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
