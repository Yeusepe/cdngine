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

Cross-format semantic reuse such as Blender-versus-Unity equivalence is not part of the first byte-dedupe project. It belongs in a separate capability-owned semantic-normalization workstream that can prove parser coverage, canonical intermediates, semantic evidence, and sidecar or relation behavior before it changes broader platform expectations.

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

The current registry persistence fields for that byte-level evidence are:

- `repositoryEngine`
- `canonicalSourceId`
- `canonicalSnapshotId`
- `canonicalLogicalPath`
- `canonicalDigestSet`
- `canonicalLogicalByteLength`
- `canonicalStoredByteLength`
- `sourceReconstructionHandles`
- `sourceSubstrateHints`
- `dedupeMetrics`

Those fields intentionally stop at source-plane provenance and storage facts. They do not collapse semantic normalization output into registry truth unless a separate contract explicitly introduces that slice.

The current rollout posture is:

- **Xet is the default canonical source engine for new canonicalizations**
- `repositoryEngine` remains the durable selector for reads, replay, diagnostics, and migration
- **legacy Kopia-backed versions stay readable** until migration, backfill, and explicit operator signoff retire them
- CDNgine may backfill or re-canonicalize legacy versions into Xet, but it must preserve durable auditability of what engine originally produced each version record
- the request path and public API remain engine-neutral; callers still authorize one source read and CDNgine resolves it to the correct internal reconstruction path

The checked-in migration commands make that posture executable:

- `npm run source:migration -- inventory`
- `npm run source:migration -- recanonicalize`
- `npm run source:migration -- recanonicalize --apply`

Those commands deliberately avoid silently rewriting the original `AssetVersion` audit record. They surface what still depends on Kopia, flag rows with missing `repositoryEngine`, and let operators create candidate Xet evidence explicitly while the dual-read window remains open.

The checked-in local and production runtime examples now mirror that rollout posture:

- they omit `CDNGINE_SOURCE_ENGINE` so the default engine switch remains visible instead of hidden behind redundant env values
- they require command-backed Xet bridge wiring for the implemented path today
- they keep the temporary Kopia variables documented where operators still need rollback and legacy-read coverage
- they keep the checked-in examples command-backed while the runtime factory still supports either command-backed or service-backed Xet wiring

The executable proof path remains `npm run benchmark:source-plane-proof`, which runs deterministic near-duplicate binary revisions through the command-backed Xet scaffold and reports stored-byte savings plus restore verification. The broader comparison entrypoint is `npm run benchmark:source-plane-compare`, which runs a repeated **benchmark matrix** instead of one synthetic file. Those proofs now support rollout regression checks and migration confidence, not the old "Xet is only a benchmark-facing challenger" posture.

That rigorous comparison suite covers:

- `single-large-binary`: one large near-duplicate revision to probe within-file reuse
- `multi-file-module-tree`: a medium tree with repeated files and targeted edits to probe cross-file reuse
- `small-file-corpus`: a metadata-heavy small-file corpus to probe engine overhead and small-object behavior

For each directly measurable engine, the suite records:

- base, duplicate, and patch stored-byte deltas
- base, duplicate, patch, and restore durations
- restore verification
- the engine's **metric mode**, so repo-growth measurements are not confused with native chunk-reuse evidence

The repetition count is controlled with `CDNGINE_SOURCE_BENCHMARK_REPETITIONS`, which defaults to 3 for the suite runners.

The current benchmark and migration-validation posture for adjacent upstream systems is:

- **Xet:** default target engine for new canonicalizations and the primary regression target for near-duplicate binary revisions
- **Kopia:** legacy migration baseline that must remain restorable during the temporary dual-read period
- **Borg:** directly measured benchmark candidate for content-defined chunk dedupe
- **Oxen:** directly measured secondary benchmark because it behaves like a dataset VCS and includes commit/Merkle metadata in its storage growth
- **lakeFS:** intentionally excluded from the stored-byte ranking for this workload because its value is Git-like object-version management over object storage, not near-duplicate byte compaction

One important outcome from the richer suite is that a single large-file benchmark can understate snapshot-repository reuse when the only observable metric is repo growth. The benchmark should therefore be read workload-by-workload, not as one patched-file number.

## 5. Read more

- [Architecture](./architecture.md)
- [Canonical Source And Tiering Contract](./canonical-source-and-tiering-contract.md)
- [Environment And Deployment](./environment-and-deployment.md)
- [Format-Agnostic Upstream Review](./format-agnostic-upstream-review.md)
- [Semantic Normalization Tooling Evaluation](./semantic-normalization-tooling-evaluation.md)
- [Semantic Normalization Scope Boundary](./semantic-normalization-scope-boundary.md)
- [Pipeline Capability Model](./pipeline-capability-model.md)
- [Workflow Extensibility](./workflow-extensibility.md)
- [Workload And Recipe Matrix](./workload-and-recipe-matrix.md)
- [Production Deployment Profiles](../deploy/production/README.md)
- [Xet deduplication](https://huggingface.co/docs/xet/en/deduplication)
- [restic design](https://restic.readthedocs.io/en/stable/design.html)
- [libarchive](https://www.libarchive.org/)
- [Reproducible Builds archive guidance](https://reproducible-builds.org/docs/archives/)
- [OpenAssetIO](https://openassetio.github.io/OpenAssetIO/)
