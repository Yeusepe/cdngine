# CDNgine

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

- **Oxen** stores immutable raw versions and acts as the replay source
- the **registry** stores asset, version, derivative, manifest, workflow, and audit state
- **Temporal** owns long-running orchestration and replay-safe execution
- workers generate deterministic outputs into a **derived object store**
- the **CDN** serves those published artifacts on the hot path

That means the platform treats:

- **Oxen** as the source of truth for originals
- the **derived store** as the source of truth for published delivery artifacts
- the **registry** as the system of record for control-plane state

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
| image delivery and transform | imgproxy + libvips |
| video processing | FFmpeg |
| document normalization | Gotenberg |
| canonical raw source | Oxen |
| derived delivery origin | S3-compatible object storage |

This is an **opinionated default profile**, not a claim that every adopter must use the exact same infrastructure provider.

## Architectural stance

CDNgine is intentionally opinionated about the things that matter most:

- **Oxen is fixed** as the raw/versioned source of truth
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

## What is in this repository

This repository currently contains the **design and implementation guidance** for the platform:

- reference architecture
- service architecture
- technology profile and upstream package guidance
- API and SDK guidance
- pipeline, workflow, and service registration models
- observability, security, deployment, and resilience expectations
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
  - [Technology Profile](./docs/technology-profile.md)
  - [Package And Repository Reference](./docs/package-reference.md)
- **Reference**
  - [API Surface](./docs/api-surface.md)
  - [API Style Guide](./docs/api-style-guide.md)
  - [SDK Strategy](./docs/sdk-strategy.md)
  - [Pipeline Capability Model](./docs/pipeline-capability-model.md)
  - [Workflow Extensibility](./docs/workflow-extensibility.md)
- **Operations**
  - [Environment And Deployment](./docs/environment-and-deployment.md)
  - [Observability](./docs/observability.md)
  - [Security Model](./docs/security-model.md)
  - [Resilience And Scale Validation](./docs/resilience-and-scale-validation.md)

## Current state

The repository is currently architecture- and documentation-heavy. It is establishing the platform contract before implementation fills in the executable services and workflows.

That is intentional: this system has enough moving parts that unclear architecture would create bad implementation faster than useful implementation.
