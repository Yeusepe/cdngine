# ADR 0008: Xet As Canonical Content Plane

## Status

Superseded by [ADR 0010](./0010-canonical-source-repository-and-tiered-storage.md) and later rollout guidance in [ADR 0012](./0012-xet-default-rollout-and-kopia-dual-read-migration.md)

> Historical record only. Do **not** implement from this ADR. It captures an earlier Xet-based direction that was replaced first by the canonical-source-repository and tiered-storage model in ADR 0010 and later by the migration-aware Xet rollout contract in ADR 0012.

## Historical context

At the time of this decision, CDNgine was looking for a stronger answer to storage efficiency across repeated binary revisions than the earlier Oxen-oriented direction.

Xet was evaluated because it offered:

- content-defined chunking
- chunk-level deduplication
- repository-style reconstruction metadata
- S3-backed storage deployment options

That made it a plausible candidate for large iterative binaries such as Unity packages, Substance Painter files, texture sets, video masters, and archive-like assets.

## Historical decision

This ADR originally selected **Xet backed by S3-compatible storage** as the canonical source plane.

That decision is no longer current.

## Why it was superseded

Later architecture work concluded that the platform needed a broader and clearer model than a single Xet-specific source-plane decision:

- a canonical source repository with explicit snapshot semantics
- a separate tiered storage substrate
- optional lazy-read and hot-cache layers
- an explicit artifact-graph publication layer

Those requirements are now captured by [ADR 0010](./0010-canonical-source-repository-and-tiered-storage.md), which establishes the current direction:

- **Kopia** as the canonical source repository
- **SeaweedFS** by default, with **JuiceFS** when POSIX workspace semantics matter
- **Nydus** with optional **Alluxio** for selected hot-read paths
- **ORAS** for immutable artifact graphs and bundle publication

## Preserved historical references

These links remain only to preserve the research trail behind the superseded decision:

- [Xet Protocol Specification](https://huggingface.co/docs/xet)
- [Xet Upload Protocol](https://huggingface.co/docs/xet/upload-protocol)
- [Xet Chunk-Level Deduplication Specification](https://huggingface.co/docs/xet/en/deduplication)
- [Content-Defined Chunking Algorithm](https://huggingface.co/docs/xet/chunking)
- [Xet Shard File Format Specification](https://huggingface.co/docs/xet/en/shard)
- [Using Xet Storage](https://huggingface.co/docs/hub/en/xet/using-xet-storage)
- [Hugging Face Storage Buckets](https://huggingface.co/storage)
- [huggingface/xet-core](https://github.com/huggingface/xet-core)
