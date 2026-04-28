# Source Plane Strategy

This document defines how CDNgine evolves the canonical source plane without collapsing the architecture into one storage engine or one file format family.

The strategy has two tracks that must stay separate:

1. **byte-level source dedupe**
2. **format-aware normalization**

## 1. Byte-level source dedupe is universal

Every uploaded file should benefit from the canonical source plane even when CDNgine has no semantic understanding of the format.

That means the source-plane contract must always preserve:

- canonical repository identity
- snapshot or reconstruction identity
- strong digests
- logical source size
- optional stored-size and dedupe metrics when the repository exposes them

This is the baseline that keeps strange future formats safe.

## 2. Semantic normalization is capability-owned

Semantic normalization is optional and additive.

The core platform should talk about generic capability-owned roles such as:

- `ContainerNormalizer`
- `SemanticExtractor`
- `CanonicalIntermediateBuilder`
- `SemanticFingerprintBuilder`
- `SemanticRelationRecorder`

Format-specific tooling may implement those roles, but the architecture must not hard-code Unity, Blender, or any other single ecosystem into the core contracts.

## 3. Required fallback for unknown formats

When no capability-specific normalizer exists, the platform still accepts the file through the generic fallback contract:

- preserve the original
- retain strong digests
- route through the generic asset workflow template
- add generic container inventory only when container detection is proven
- make no semantic claims beyond that evidence

## 4. Registry posture

`AssetVersion` remains the business identity even when the source plane reuses bytes underneath.

The registry should therefore persist enough source evidence to explain:

- which repository engine produced the canonical record
- how the version can be reconstructed
- what byte-level savings were observed
- whether any normalization evidence was generic fallback evidence or capability-scoped semantic evidence

## 5. Read more

- [Architecture](./architecture.md)
- [Canonical Source And Tiering Contract](./canonical-source-and-tiering-contract.md)
- [Pipeline Capability Model](./pipeline-capability-model.md)
- [Workflow Extensibility](./workflow-extensibility.md)
- [Workload And Recipe Matrix](./workload-and-recipe-matrix.md)
- [Xet deduplication](https://huggingface.co/docs/xet/en/deduplication)
- [restic design](https://restic.readthedocs.io/en/stable/design.html)
- [libarchive](https://www.libarchive.org/)
- [Reproducible Builds archive guidance](https://reproducible-builds.org/docs/archives/)
- [OpenAssetIO](https://openassetio.github.io/OpenAssetIO/)
