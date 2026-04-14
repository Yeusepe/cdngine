# Package And Repository Reference

This document maps platform concerns to concrete packages, repositories, and upstream documentation.

The purpose is simple: **consume fast, proven systems wherever possible** and reserve custom code for platform semantics, registration, manifests, and orchestration composition.

## 1. Core default set

| Concern | Package / project | Why it helps |
| --- | --- | --- |
| HTTP and API layer | Hono | fast, lightweight, Web-standards-based routing that can run across multiple runtimes |
| host environment | Encore or Nest | lets teams use a preferred application shell without changing core platform semantics |
| validation and schema authoring | Zod | strongly typed runtime validation with JSON Schema conversion support |
| database access and migrations | Prisma | type-safe ORM client, schema ownership, migrations, and generated data tooling |
| telemetry | OpenTelemetry | vendor-neutral traces, metrics, and logs |
| raw versioned source | Oxen | immutable raw asset lineage and version semantics |
| metadata registry | PostgreSQL + JSONB | durable relational state plus flexible structured metadata |
| metadata/query indexing | PostgreSQL GIN over JSONB | indexable structured metadata without inventing a custom metadata engine |
| cache and coordination | Redis | mature cache, lock, and ephemeral coordination primitives |
| durable workflows | Temporal | retries, replay, timers, testing, and execution history |
| image processing and delivery | imgproxy + libvips | high-performance image processing without building a transform server |
| video and image-to-video | FFmpeg | broad codec support, hardware acceleration, deep ecosystem |
| document conversion | Gotenberg | Chromium + LibreOffice + PDF tooling behind an API |
| PDF / slide rasterization watchlist | PDFium, MuPDF | strong rendering options for deeper PDF-specific workloads |
| derived storage | S3-compatible object store | portable binary delivery origin |

## 2. Repositories to study

| Project | Repository | Relevance |
| --- | --- | --- |
| Hono | `honojs/hono` | portable HTTP layer, multi-runtime deployment, small API surface |
| Prisma | `prisma/prisma` | data modeling, client generation, migrations, and schema discipline |
| Encore | `encoredev/encore` | one supported host shell with strong local infrastructure ergonomics |
| NestJS | `nestjs/nest` | one supported host shell with module-oriented application composition |
| Temporal TypeScript SDK | `temporalio/sdk-typescript` | workflow programming model |
| Temporal samples | `temporalio/samples-typescript` | retry, replay, and activity examples |
| imgproxy | `imgproxy/imgproxy` | image server and delivery model |
| libvips | `libvips/libvips` | fast, low-memory image processing engine |
| Gotenberg | `gotenberg/gotenberg` | document conversion service architecture |
| Gotenberg lok | `gotenberg/lok` | newer document-to-PDF conversion surface via LibreOfficeKit |

## 3. Service-foundation stack

### 3.1 Hono

Use for:

- public and private API definition
- middleware composition
- runtime-portable HTTP handling
- keeping the API layer small and explicit

Why it fits:

- strong multi-runtime support
- very small surface area
- excellent TypeScript ergonomics
- easier to embed in different hosting models than a monolithic framework

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

### 3.4 Prisma

Use for:

- primary relational modeling
- client generation
- migrations
- a clearer shared schema contract for the registry

Constraint:

- allow raw SQL escapes for query paths Prisma does not model efficiently

### 3.5 OpenTelemetry

Use for:

- traces
- metrics
- logs and correlation
- vendor-neutral observability posture

## 4. Image stack

### 4.1 imgproxy

Use for:

- on-demand image delivery
- resize, crop, and format conversion
- signed URLs
- removing image-processing logic from application code

Why it fits:

- production-proven
- explicitly optimized for speed and simplicity
- built around libvips
- good fit for CDN-backed delivery

### 4.2 libvips

Use for:

- high-performance backend image operations
- texture slicing and splicing helpers
- precompute jobs when on-demand paths are not enough

Why it fits:

- horizontally threaded
- low memory profile
- wide format support
- already used under imgproxy and other serious image systems

## 5. Video stack

### 5.1 FFmpeg

Use for:

- transcoding
- poster extraction
- HLS ladder generation
- image-to-video conversion
- clip and preview generation

Why it fits:

- unmatched breadth
- hardware acceleration support
- stable ecosystem
- lets the platform consume a mature media engine instead of building one

## 6. Document and presentation stack

### 6.1 Gotenberg

Use for:

- PowerPoint to PDF normalization
- HTML or Chromium-backed rendering paths
- document API orchestration

Why it fits:

- API-first container
- combines Chromium, LibreOffice, and PDF tools
- can work with presigned object-store URLs

### 6.2 PDFium and MuPDF

These are strong rendering candidates when the platform needs finer-grained PDF and slide rasterization control than a broad conversion service can provide.

- **PDFium**: strong Chromium-aligned renderer with heavier build/tooling
- **MuPDF**: strong rendering library with command-line tools and broad document support

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

Why it fits:

- relational joins for core control-plane entities
- JSONB for flexible metadata
- GIN indexing for structured lookups

### 7.2 Redis

Use for:

- upload sessions
- short-lived locks
- replay windows
- hot metadata caching
- workflow coordination helpers

Why it fits:

- fast
- operationally familiar
- mature ecosystem

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

Why it fits:

- strong durability model
- code-native workflow programming
- excellent match for TDD and workflow tests

## 9. Storage and CDN stack

### 9.1 S3-compatible object storage

Use for:

- derived artifacts
- manifest-addressable delivery files
- adoption flexibility

### 9.2 Cloudflare-friendly deployment profile

Use for:

- low-latency CDN edge delivery
- S3-compatible default profile with R2 or equivalent
- strong edge routing and cache behavior

This is the leading default profile, but not the only supported deployment shape.

## 10. Session-local cloned references

The following upstream repositories were cloned into the session artifacts folder for direct study:

- `C:\\Users\\svalp\\.copilot\\session-state\\c9249919-f070-4df4-8888-59c750713f66\\files\\references\\samples-typescript`
- `C:\\Users\\svalp\\.copilot\\session-state\\c9249919-f070-4df4-8888-59c750713f66\\files\\references\\imgproxy`
- `C:\\Users\\svalp\\.copilot\\session-state\\c9249919-f070-4df4-8888-59c750713f66\\files\\references\\gotenberg`
- `C:\\Users\\svalp\\.copilot\\session-state\\c9249919-f070-4df4-8888-59c750713f66\\files\\references\\libvips`
- `C:\\Users\\svalp\\.copilot\\session-state\\c9249919-f070-4df4-8888-59c750713f66\\files\\references\\lok`

## 11. References

- [Hono](https://hono.dev/)
- [Prisma ORM](https://www.prisma.io/docs/orm)
- [Prisma repository](https://github.com/prisma/prisma)
- [Encore.ts documentation](https://encore.dev/docs/ts)
- [Encore repository](https://github.com/encoredev/encore)
- [NestJS documentation](https://docs.nestjs.com/)
- [NestJS repository](https://github.com/nestjs/nest)
- [Zod](https://zod.dev/)
- [OpenTelemetry docs](https://opentelemetry.io/docs/)
- [Temporal documentation](https://docs.temporal.io/)
- [Temporal TypeScript SDK](https://github.com/temporalio/sdk-typescript)
- [Temporal TypeScript samples](https://github.com/temporalio/samples-typescript)
- [imgproxy documentation](https://docs.imgproxy.net/)
- [imgproxy repository](https://github.com/imgproxy/imgproxy)
- [libvips project site](https://www.libvips.org/)
- [libvips repository](https://github.com/libvips/libvips)
- [Gotenberg documentation](https://gotenberg.dev/)
- [Gotenberg repository](https://github.com/gotenberg/gotenberg)
- [Gotenberg lok repository](https://github.com/gotenberg/lok)
- [FFmpeg documentation](https://ffmpeg.org/documentation.html)
- [PostgreSQL JSON types](https://www.postgresql.org/docs/current/datatype-json.html)
- [PostgreSQL GIN indexes](https://www.postgresql.org/docs/current/gin.html)
- [Redis documentation](https://redis.io/docs/latest/)
- [Cloudflare R2 product page](https://www.cloudflare.com/developer-platform/products/r2/)
- [MuPDF docs](https://mupdf.readthedocs.io/en/latest/)
