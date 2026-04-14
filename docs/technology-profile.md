# Technology Profile

This document explains the intended package and platform choices for the default CDNgine profile.

It is not a raw trade-study dump. It records the choices the architecture is trying to optimize for and why they are better than writing more platform code ourselves.

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
| database access and migrations | Prisma | type-safe relational access, schema ownership, generated client, and migrations in one toolchain |
| telemetry | OpenTelemetry | vendor-neutral observability without one-off instrumentation conventions |
| durable workflows | Temporal | durable retries, replay, testing, timers, execution history already exist |
| SQL registry | PostgreSQL + JSONB | rich relational semantics and flexible metadata without a custom registry store |
| cache and coordination | Redis | mature hot-path primitives without inventing ephemeral coordination systems |
| image transform and delivery | imgproxy + libvips | proven, fast image server instead of building our own resizing service |
| video and image-to-video | FFmpeg | broad codec and pipeline support, hardware acceleration, deep ecosystem |
| document normalization | Gotenberg | LibreOffice and Chromium behind an API instead of custom conversion orchestration |
| derived artifact storage | S3-compatible store | avoids bespoke binary storage and lets adopters bring their own provider |

## 3. Default does not mean mandatory

The platform should document supported substitution points for:

- SQL database
- S3-compatible storage
- CDN
- worker runtime and compute environment
- chosen service host shell

The goal is not infinite abstraction. The goal is stable platform semantics with deliberate, well-documented swap boundaries.

## 4. Package-specific notes

### 4.1 Hono

Hono is the preferred HTTP layer because it is fast, small, multi-runtime, and based on Web Standard APIs. It gives CDNgine a portable API surface that can be hosted inside different application shells without rewriting the route model.

### 4.2 Encore or Nest as host shells

The platform should be able to run in Encore or Nest without changing its core API semantics. That means host-specific conveniences must stay outside the core route and service ownership model.

### 4.3 Prisma

Prisma is the preferred data-access layer because it gives the platform:

- a strong schema-centric relational model
- type-safe client generation
- migration support
- clearer collaboration on evolving the registry schema

Raw SQL remains acceptable for performance-sensitive or Prisma-unfriendly query paths, but Prisma should own the primary relational contract.

### 4.4 Temporal

Temporal should own long-running orchestration, retries, timers, and replay. The platform should not reimplement durable workflow bookkeeping inside Redis tables or queue glue.

### 4.5 Zod plus JSON Schema alignment

Zod is a strong fit for code-near validation and schema reuse, while published contracts should still center on OpenAPI and JSON Schema.

### 4.6 OpenTelemetry

OpenTelemetry is the default telemetry posture for traces, metrics, and logs because it keeps the service vendor-neutral and observable by design.

### 4.7 PostgreSQL + JSONB

JSONB lets the registry keep a strong relational core while storing:

- capability metadata
- manifest fragments
- processor result blobs
- namespace-specific structured metadata

without inventing a separate metadata subsystem too early.

### 4.8 Redis

Redis should accelerate hot paths and coordination, but never become the hidden control-plane database.

### 4.9 imgproxy + libvips

This pair is the clearest answer for fast image delivery and transformation without writing a custom server. It fits the architecture's bias toward deterministic delivery paths and signed URLs.

### 4.10 Gotenberg

For document conversion, Gotenberg gives an API-first container that already combines Chromium, LibreOffice, and PDF tooling. That is much cheaper to operate and reason about than building a bespoke service mesh of document converters.

### 4.11 FFmpeg

FFmpeg remains the core for:

- transcoding
- poster extraction
- streaming ladders
- image-to-video derivation

with hardware acceleration where available.

### 4.12 Oxen and the storage split

Oxen is the canonical raw/versioned source of truth. It should own:

- immutable uploaded originals
- version lineage
- replay provenance
- auditability of what the platform derived from

The derived store exists for a different reason: serve deterministic generated artifacts cheaply and fast through the CDN. The platform therefore defaults to:

- **Oxen for originals and replay**
- **S3-compatible derived storage for delivery artifacts**

That split is deliberate, not accidental. It avoids forcing hot derivative traffic through the same system that exists to preserve provenance.

## 5. References

- [Hono](https://hono.dev/)
- [Prisma ORM](https://www.prisma.io/docs/orm)
- [OpenTelemetry docs](https://opentelemetry.io/docs/)
- [Temporal documentation](https://docs.temporal.io/)
- [PostgreSQL JSON types](https://www.postgresql.org/docs/current/datatype-json.html)
- [Redis documentation](https://redis.io/docs/latest/)
- [imgproxy documentation](https://docs.imgproxy.net/)
- [Gotenberg documentation](https://gotenberg.dev/)
- [FFmpeg documentation](https://ffmpeg.org/documentation.html)
- [Encore.ts documentation](https://encore.dev/docs/ts)
- [NestJS documentation](https://docs.nestjs.com/)
- [Cloudflare R2 product page](https://www.cloudflare.com/developer-platform/products/r2/)
