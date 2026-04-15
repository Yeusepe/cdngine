# ADR 0008: Xet As Canonical Content Plane

## Status

Superseded by [ADR 0010](./0010-canonical-source-repository-and-tiered-storage.md)

## Context

CDNgine needs a canonical source plane for large binary assets such as:

- Unity packages
- Substance Painter files
- FBX files
- textures and texture sets
- video masters
- archive-like asset bundles

The previous Oxen-based design preserved provenance correctly, but it was not optimized for storage efficiency across repeated binary revisions.

Official Xet documentation describes a content-addressed storage system with:

- content-defined chunking
- chunk-level deduplication
- xorb block aggregation
- shard-based file reconstruction metadata
- local, cached, and global deduplication layers
- storage-bucket deployments with no Git overhead

That is a better fit for a binary-heavy asset platform where many revisions share large regions of unchanged content.

## Decision

Adopt **Xet backed by S3-compatible storage** as the canonical content plane.

That means:

1. public clients still upload to an ingest-managed target, normally `tusd` backed by S3-compatible staging storage
2. upload completion canonicalizes the staged object into Xet rather than treating the staging object as canonical
3. the canonical source identity stored in the registry is Xet-oriented, including:
   - Xet scope or bucket identity
   - Xet file ID or equivalent reconstruction identity
   - content digest
   - logical canonical path
4. S3 remains the underlying physical storage substrate, but canonical assets are addressed through Xet semantics rather than raw object keys
5. workers reconstruct canonical source files from Xet into isolated scratch space before processing
6. derived artifacts remain in a separate S3-compatible derived object store in front of the CDN
7. selected source-side evidence may also be stored with Xet when it should remain replay-coupled to the canonical source

## Alternatives considered

### Continue with Oxen

Rejected because the workload is dominated by large binary assets where chunk-level deduplication over S3-backed storage is a stronger fit.

### Upload directly from public clients into Xet as the default

Rejected as the default because public ingest still benefits from resumable tus semantics, simpler browser clients, and a clear staging-to-canonicalization boundary.

### Use raw S3 as the canonical source of truth

Rejected because raw S3 object keys alone do not provide the deduplication, reconstruction, or canonical identity semantics needed by the platform.

## Consequences

- the storage architecture becomes `ingest staging in S3 -> canonicalization into Xet over S3 -> processing from Xet -> publication to derived store`
- the registry and workflow model must store Xet file identities instead of the earlier Oxen-style source identities
- observability must track deduplication savings, Xet reconstruction health, and canonicalization throughput
- worker design should take advantage of local Xet caches where beneficial
- delivery still does not read canonical source data on the hot path

## References

- [Xet Protocol Specification](https://huggingface.co/docs/xet)
- [Xet Upload Protocol](https://huggingface.co/docs/xet/upload-protocol)
- [Xet Chunk-Level Deduplication Specification](https://huggingface.co/docs/xet/en/deduplication)
- [Content-Defined Chunking Algorithm](https://huggingface.co/docs/xet/chunking)
- [Xet Shard File Format Specification](https://huggingface.co/docs/xet/en/shard)
- [Using Xet Storage](https://huggingface.co/docs/hub/en/xet/using-xet-storage)
- [Hugging Face Storage Buckets](https://huggingface.co/storage)
- [huggingface/xet-core](https://github.com/huggingface/xet-core)
