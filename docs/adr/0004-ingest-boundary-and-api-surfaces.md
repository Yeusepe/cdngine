# ADR 0004: Ingest Boundary And API Surfaces

## Status

Accepted

## Context

The architecture requires a clean answer to four related questions:

1. where clients upload binaries
2. when an uploaded object becomes the canonical raw version
3. which API surface is the public SDK contract
4. how service namespace, tenant scope, and operator privileges stay distinct

Without an explicit answer, the platform will accumulate inconsistent auth, idempotency, and workflow-start behavior before implementation is even mature.

## Decision

Adopt the following platform contract:

1. clients upload to an ingest-managed target, normally **tusd** backed by object storage
2. the ingest service verifies the uploaded object and snapshots it into the **canonical source repository**
3. public, platform-admin, and operator HTTP surfaces are documented separately
4. service namespace, tenant scope, and asset owner remain distinct control-plane concepts
5. upload completion writes a durable workflow-dispatch intent before Temporal start

## Alternatives considered

### Upload directly to the source repository from clients

Rejected as the default because it couples client ingest ergonomics to the canonical version store and weakens resumable-upload flexibility.

### Put namespace registration and replay on the broad public API

Rejected because it mixes product-consumer APIs with privileged control-plane operations and weakens auth boundaries.

### Treat namespace and tenant as the same field

Rejected because it couples internal service ownership, external customer isolation, and caller-facing access control too tightly.

## Consequences

- the public ingest story is `API -> tusd/object storage -> completion -> canonical source repository`
- the source repository remains the canonical source plane, not the first direct client upload surface
- replay, quarantine, purge, and namespace governance live on privileged internal surfaces
- the registry must hold durable idempotency and workflow-dispatch records
- future implementation must model asset lifecycle and auth around separate namespace, tenant, and ownership concepts
