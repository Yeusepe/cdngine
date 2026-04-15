# ADR 0010: Canonical Source Repository And Tiered Storage

## Status

Accepted

## Context

CDNgine needs a source stack that is optimized for:

- huge iterative binary assets such as Unity packages, `.spp` files, PSD or EXR sources, archives, and video masters
- storage efficiency across many revisions
- replay-safe provenance
- fast internal reads without forcing every asset to stay fully materialized
- browser-friendly delivery that still uses ordinary CDN behavior

The earlier Xet-specific decision was directionally useful, but it overcommitted the architecture to one product and left hot-read acceleration, tiering, and artifact publication under-specified.

Recent upstream study points to a stronger composed model:

- **Kopia-style repositories** for deduplicated snapshot history and canonical source identity
- **SeaweedFS** for tiered storage placement and S3-compatible substrate behavior
- **JuiceFS** where POSIX workspaces are operationally important
- **Nydus-style lazy reads** and optional **Alluxio** when repeated package-like reads dominate
- **ORAS** for immutable artifact graphs and bundle publication

## Decision

Adopt the following default source and storage architecture:

1. public clients still upload to an ingest-managed target, normally `tusd` backed by staging object storage
2. upload completion snapshots the staged object into a **canonical source repository** instead of treating staging as canonical truth
3. the default reference repository behaves like a **Kopia-style snapshot repository** and is backed by a **SeaweedFS** S3-compatible namespace
4. **JuiceFS** is an optional workspace profile when processors or tools require POSIX semantics
5. the registry stores canonical source identity using repository-oriented fields such as repository ID, snapshot identity, canonical path, digest, and size
6. workers reconstruct from the canonical source repository and may use a **Nydus-style lazy-read path** or **Alluxio** hot cache when the workload benefits from it
7. immutable bundles and artifact graphs are published through **ORAS**
8. browser-facing derivatives still live in a separate derived object store in front of the CDN

## Alternatives considered

### Keep Xet as the fixed canonical content plane

Rejected because the user-facing architecture needs a broader answer: source deduplication, hot-read acceleration, tiered placement, and bundle publication all need to be first-class rather than implied.

### Use raw object storage as the canonical source of truth

Rejected because flat object keys do not provide repository semantics, cross-version deduplication, or replay-friendly source identity.

### Materialize every canonical source version permanently for hot reads

Rejected because it wastes storage and defeats the purpose of a deduplicated source plane for iterative binary assets.

## Consequences

- the storage architecture becomes `ingest staging -> canonical source repository -> optional lazy-read or hot-cache path -> publication to derived store and ORAS`
- observability must track source deduplication, repository health, tiering behavior, hot-cache effectiveness, and artifact publication
- persistence and domain docs must use repository-oriented source identity rather than product-specific Xet identifiers
- operators need runbooks for canonical source availability, tier migration, and hot-read degradation

## References

- [Kopia features](https://kopia.io/docs/features/)
- [restic repository design](https://restic.readthedocs.io/en/stable/100_references.html)
- [SeaweedFS tiered storage](https://github.com/seaweedfs/seaweedfs/wiki/Tiered-Storage)
- [JuiceFS architecture](https://juicefs.com/docs/community/architecture)
- [Nydus](https://nydus.dev/)
- [ORAS documentation](https://oras.land/docs/)
- [Alluxio documentation](https://documentation.alluxio.io/os-en)
