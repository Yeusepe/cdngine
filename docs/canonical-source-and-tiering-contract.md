# Canonical Source And Tiering Contract

This document defines the handoff from staged ingest bytes to canonical source history, tiered byte placement, and hot-read materialization.

CDNgine already distinguishes ingest staging from canonical storage. This document makes that contract implementation-grade for the new reference stack.

## 1. Handoff boundary

The canonicalization boundary is:

`ingest-managed staged object` -> `verified source evidence` -> `canonical repository snapshot` -> `tiered placement metadata`

The staged object is not canonical truth.

## 2. Required verification before snapshotting

Before a version can move from `uploaded` to `canonical`, the platform should verify:

1. authorized scope still matches the upload session
2. staged bytes exist and reported size is stable
3. required checksum evidence is present when the client or ingest profile requires it
4. file signature or sniffed content is consistent with declared class
5. filename and metadata satisfy policy
6. quarantine policy does not require immediate hold

## 3. Persisted canonical identity

When canonicalization succeeds, the registry must persist:

- canonical repository identity
- snapshot or manifest identity for the source version
- canonical logical source path
- strong content digest such as SHA-256
- source size
- detected content type and media metadata where relevant
- deduplication or compression summary when the source repository exposes it
- substrate placement metadata such as storage namespace, tier, or repository path
- canonicalization timestamp

Raw object-storage keys beneath the source repository are not public or control-plane identities.

### 3.1 Backing bucket or prefix

The canonical source repository still needs underlying object storage.

Typical deployments use either:

- a dedicated source bucket such as `cdngine-source`
- or a shared bucket with a `source/` prefix alongside `ingest/`, `derived/`, and `exports/`

In both cases, the registry persists the **Kopia identity** plus deployment metadata such as the backing bucket or prefix. It does not promote raw object keys into the public or control-plane contract.

## 4. Tiering posture

The canonical source plane and the delivery plane have different goals:

- the **canonical source plane** optimizes for storage efficiency, provenance, replay, and retention of iterative binary revisions
- the **delivery plane** optimizes for CDN-friendly access to published artifacts

The default tiering posture is:

- **hot**: recently or frequently accessed chunks, indexes, and worker-local cache state
- **warm**: nearby object or disk tiers for assets that are still active but do not justify premium storage everywhere
- **cold**: cost-efficient cloud or archive-friendly tiers for canonical history that must remain reconstructable

The control plane should decide which bytes stay hot, not leave that behavior implicit in the storage provider alone.

## 5. Replay source rules

Replay always starts from the canonical repository identity stored on the version record.

Replay does not start from:

- a transient staging object
- a published derivative
- a raw underlying storage key

## 6. Source-side evidence retention

Selected immutable evidence may be retained alongside the canonical source when replay depends on it, for example:

- ingest verification summaries
- source-side inventory or scan evidence
- immutable normalization evidence needed to explain later derivations

This evidence remains separate from delivery artifacts and must not turn the source repository into the hot delivery origin.

## 7. Lazy-read and materialization posture

Workers do not need to rehydrate every canonical source version into one fully materialized file before useful work begins.

Preferred behavior:

- use worker-local caches for repeatedly accessed chunks
- allow a lazy-read path for package-like or rebuildable assets when the runtime benefits from chunk-addressed access
- materialize whole files only when the processor or export contract truly needs them
- keep browser-facing delivery on whole published artifacts, not on chunk protocols

This is the layer where **Nydus** on-demand reads and optional **Alluxio** cache behavior are most useful.

## 8. Failure outcomes

Canonicalization may result in:

- `canonical`
- `failed_validation`
- `failed_retryable`
- `quarantined`

Failures record problem type, diagnostics, and whether replay or release is possible later.

## 9. Worker read contract

Workers read from the canonical source plane into isolated scratch or lazy-read mounts.

Workers must not assume:

- stable raw object keys
- public readability of canonical source data
- mutable source identity after `canonical`
- that every source read will be a fully materialized file instead of a lazy chunk stream

## 10. Client source-delivery contract

When a client needs the original source asset, the service should authorize that read explicitly and resolve it from the version's canonical source identity.

The service may:

- proxy reconstruction from the canonical repository
- return a tightly scoped lazy-read capability for trusted internal clients
- materialize a delivery export

The client should not treat staging objects or raw underlying storage keys as the canonical download contract.

## 11. Read more

- [README](../README.md)
- [Architecture](./architecture.md)
- [Service Architecture](./service-architecture.md)
- [State Machines](./state-machines.md)
- [Storage Tiering And Materialization](./storage-tiering-and-materialization.md)
- [Kopia features](https://kopia.io/docs/features/)
- [SeaweedFS tiered storage](https://github.com/seaweedfs/seaweedfs/wiki/Tiered-Storage)
- [JuiceFS architecture](https://juicefs.com/docs/community/architecture)
- [Nydus documentation](https://nydus.dev/)
- [ORAS documentation](https://oras.land/docs/)
- [tusd hooks and configuration](https://tus.github.io/tusd/getting-started/configuration/)
