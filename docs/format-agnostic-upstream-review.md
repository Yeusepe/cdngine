# Format-Agnostic Upstream Review

This review groups upstream systems by **generic function** instead of by one hard-coded file type.

It exists to help implementers choose proven upstream building blocks without collapsing CDNgine into:

- one canonical-source engine
- one archive or delta format
- one image stack
- one media-production ecosystem

## 1. Governing docs

- [Architecture](./architecture.md)
- [Source Plane Strategy](./source-plane-strategy.md)
- [Upstream Integration Model](./upstream-integration-model.md)
- [Technology Profile](./technology-profile.md)
- [Workflow Extensibility](./workflow-extensibility.md)
- [Pipeline Capability Model](./pipeline-capability-model.md)

## 2. How to read this review

The `Posture` column uses four values:

| Posture | Meaning |
| --- | --- |
| direct candidate | reasonable to integrate behind a CDNgine-owned adapter, sidecar, or worker boundary |
| benchmark candidate | worth measuring directly against the current default before any replacement decision |
| design/reference | read for architecture, data-model, or operator-pattern guidance, but do not adopt as a default dependency yet |
| validation only | useful for tests, diffing, or operator evidence rather than for request-path or workflow runtime integration |

The `Layer mapping` column uses CDNgine's own layers:

- **canonical source plane**
- **capability worker boundary**
- **publish/export boundary**
- **registry and operator plane**
- **test and diagnostics evidence**

## 3. Immediate conclusions

1. **Use Xet as the default source repository for new canonicalizations, while keeping Kopia readable during the temporary migration window.**  
   `xet-core` is the current implementation target for near-duplicate large binaries, and benchmark proof remains useful as rollout regression evidence rather than as a reason to delay the migration contract.
2. **Treat chunking/CAS, semantic normalization, and delta distribution as separate categories.**  
   They solve different problems and should not be merged into one "asset-format support" decision.
3. **Use archive and delta tooling at worker or export boundaries, not as control-plane truth.**  
   The registry should store evidence, policies, and identities, not embed a patch-format worldview.
4. **Keep capability-specific canonical intermediates out of the core platform contract.**  
   OpenUSD, Assimp, OpenImageIO, and similar tools belong behind capability-owned normalizers and intermediate builders.
5. **Use reproducibility and deep-diff tools as evidence generators.**  
   `diffoscope` and Reproducible Builds guidance are high-value for tests and operator diagnostics, not for hot-path serving.

## 4. Review matrix by generic function

### 4.1 Chunked source repositories, CAS, and reconstruction

| Upstream | Problem solved | Posture | Layer mapping | CDNgine-specific take |
| --- | --- | --- | --- | --- |
| [xet-core](https://github.com/huggingface/xet-core) + [Xet dedupe docs](https://huggingface.co/docs/xet/en/deduplication) | Content-defined chunking and reuse across near-duplicate large binaries, with explicit reconstruction-oriented metadata | direct candidate | canonical source plane | Current default target for new canonicalizations when successive revisions share large internal regions. Keep it behind a CDNgine-owned adapter or sidecar boundary, not as a public client dependency. |
| [restic](https://github.com/restic/restic) + [repository design](https://restic.readthedocs.io/en/stable/design.html) | Immutable snapshot repository, pack/index design, append-only writes, prune discipline | design/reference | canonical source plane | Strong reference for repository invariants, durability, and maintenance posture. Useful for benchmark fixtures and source-evidence field design, not as the current planned replacement for Kopia. |
| [borgbackup/borg](https://github.com/borgbackup/borg) + [internals](https://borgbackup.readthedocs.io/en/stable/internals/data-structures.html) | Deduplicated repository with transactional segments, compaction, and strong object identity | benchmark candidate | canonical source plane | Useful for repository transactionality, append-only logs, and compaction thinking. Good direct benchmark input for content-defined chunk dedupe, but not a preferred direct integration path for CDNgine's current stack. |
| [Oxen-AI/Oxen](https://github.com/Oxen-AI/Oxen) + [Oxen versioning docs](https://docs.oxen.ai/getting-started/versioning) | Dataset-oriented version control with Merkle metadata, content-addressed version files, and dedupe claims for large binary artifacts | benchmark candidate | canonical source plane | Directly runnable for local measurements, but compare it carefully: it behaves like a dataset VCS, so stored-byte growth includes commit and Merkle metadata rather than only source-plane chunk storage. |
| [treeverse/lakeFS](https://github.com/treeverse/lakeFS) + [data-structure docs](https://github.com/treeverse/lakeFS/blob/master/docs/src/understand/data-structure.md) | Git-like object versioning and zero-copy branching over underlying object storage | validation only | registry and operator plane | Strong reference for versioned object-store semantics, branch/commit UX, and zero-copy metadata workflows. Do not rank it in the near-duplicate stored-byte benchmark because it is not a byte-level dedupe engine for this workload. |
| [systemd/casync](https://github.com/systemd/casync) | Chunk-addressed file/tree serialization and efficient reassembly/distribution | direct candidate | publish/export boundary | Most useful when CDNgine wants chunk-aware exports, partial reconstruction, or distribution-friendly materializations. It should complement the source plane, not replace canonical source truth. |
| [ostreedev/ostree](https://github.com/ostreedev/ostree) + [OSTree introduction](https://ostreedev.github.io/ostree/introduction/) | Atomic replication of content-addressed filesystem trees with refs/commits | design/reference | publish/export boundary; registry and operator plane | Good reference for branch/ref semantics, atomic tree publication, and rollback-friendly exports. More relevant to publish/export workflows than to generic upload canonicalization. |
| [perkeep/perkeep](https://github.com/perkeep/perkeep) + [Perkeep overview](https://perkeep.org/) | Long-lived content-addressed storage, sync, search, and permanence-oriented modeling | design/reference | registry and operator plane | Helpful for thinking about durable blob identity, searchability, and future-proof storage claims. Not a close operational fit for the current CDNgine runtime path. |
| [git-annex](https://git-annex.branchable.com/git-annex-git/) + [git-annex docs](https://git-annex.branchable.com/) | Large-file location tracking across many remotes and offline copies | design/reference | registry and operator plane | Valuable for operator-facing copy tracking, offline location awareness, and archival posture. Better as an operational reference than as a direct CDNgine dependency. |
| [IPFS](https://github.com/ipfs) + [how IPFS works](https://docs.ipfs.tech/concepts/how-ipfs-works/) | Content-addressing, DAG-based object graphs, portable archive/bundle packaging, network retrieval | design/reference | publish/export boundary; registry and operator plane | Good reference for content-addressed bundles, portable graph identities, and export formats such as CAR. Avoid turning the public CDNgine API into an IPFS-native contract. |

### 4.2 Archive and container inventory, normalization, and deterministic repacking

| Upstream | Problem solved | Posture | Layer mapping | CDNgine-specific take |
| --- | --- | --- | --- | --- |
| [libarchive/libarchive](https://github.com/libarchive/libarchive) + [libarchive docs](https://www.libarchive.org/) | Format-agnostic archive detection, listing, extraction, conversion, and streaming access | direct candidate | capability worker boundary | Best general upstream for archive/container inventory and safe extraction behind capability-owned normalizers. Use it to avoid inventing archive sniffing, extraction, and conversion code in app logic. |
| [vbatts/tar-split](https://github.com/vbatts/tar-split) | Disassemble and reassemble tar archives while preserving validating original tar bytes | direct candidate | capability worker boundary; publish/export boundary | Especially useful when CDNgine needs deterministic tar normalization or layer-preserving tar export behavior. Keep it behind container/archive capabilities rather than generalizing tar semantics into the whole platform. |
| [Reproducible Builds archive guidance](https://reproducible-builds.org/docs/archives/) | Rules for deterministic archive creation: timestamp clamping, sort order, owner/group normalization, pax handling | design/reference | capability worker boundary; test and diagnostics evidence | High-value implementation guidance whenever a capability emits zip, tar, or similar canonical intermediates. The guidance should influence CDNgine normalization rules and conformance tests. |
| [diffoscope](https://github.com/diffoscope/diffoscope) + [diffoscope docs](https://diffoscope.org/) | Deep recursive comparison of archives, binaries, and transformed artifacts | validation only | test and diagnostics evidence | Excellent for proving two normalization outputs differ only where expected. Prefer it for regression triage, conformance fixtures, and operator diagnostics rather than runtime processing. |

### 4.3 Delta and patch distribution

| Upstream | Problem solved | Posture | Layer mapping | CDNgine-specific take |
| --- | --- | --- | --- | --- |
| [RFC 3284 / VCDIFF](https://datatracker.ietf.org/doc/html/rfc3284) + [google/open-vcdiff](https://github.com/google/open-vcdiff) | Standard delta format and encoder/decoder model for dictionary-based differencing | direct candidate | publish/export boundary | Best standards-based answer when CDNgine needs portable delta artifacts. Use for export/distribution paths, not as canonical-source truth. |
| [jmacd/xdelta](https://github.com/jmacd/xdelta) | Mature delta compression tooling that emits VCDIFF/RFC 3284 streams | direct candidate | publish/export boundary | Practical candidate for patch generation and application behind workers. Useful when a capability can define stable dictionary/base relationships between revisions. |
| [rsync technical report](https://rsync.samba.org/tech_report/) | Rolling-checksum differencing over slow links without colocating both full files | design/reference | publish/export boundary | Important conceptual reference for range-based update economics and rolling-hash patching. Best used to guide export/update design rather than as a direct protocol surface. |
| [AppImageCommunity/zsync2](https://github.com/AppImageCommunity/zsync2) | HTTP range-friendly incremental download/update flow using zsync metadata | direct candidate | publish/export boundary | Strong option for large immutable-file updates when CDNgine wants client-friendly patch distribution over HTTP. Keep it optional and artifact-specific. |

### 4.4 Capability-owned canonical intermediates and semantic composition

| Upstream | Problem solved | Posture | Layer mapping | CDNgine-specific take |
| --- | --- | --- | --- | --- |
| [PixarAnimationStudios/OpenUSD](https://github.com/PixarAnimationStudios/OpenUSD) + [OpenUSD docs](https://openusd.org/release/index.html) | Canonical scene composition, layered edits, schema-based interchange, and large-scene assembly | direct candidate | capability worker boundary | Strong candidate when a capability needs a canonical intermediate for composed scene-like assets. It should remain capability-owned and optional, not a required platform-wide intermediate. |
| [assimp/assimp](https://github.com/assimp/assimp) + [Assimp docs](https://the-asset-importer-lib-documentation.readthedocs.io/en/latest/) | Import many 3D formats into one shared in-memory intermediate plus post-processing helpers | direct candidate | capability worker boundary | Useful for broad import normalization into a stable worker-side intermediate. Best for ingestion/normalization stages, not as a registry or delivery contract. |
| [OpenAssetIO/OpenAssetIO](https://github.com/OpenAssetIO/OpenAssetIO) + [OpenAssetIO docs](https://openassetio.github.io/OpenAssetIO/) | Common API for asset reference resolution, publishing, and related-asset discovery across tools and asset systems | design/reference | registry and operator plane | Valuable for asset identity, publish/resolve semantics, and interoperability patterns. Good reference for CDNgine registry contracts and tool-facing adapters, but not a current default dependency. |

### 4.5 Image and raster normalization

| Upstream | Problem solved | Posture | Layer mapping | CDNgine-specific take |
| --- | --- | --- | --- | --- |
| [AcademySoftwareFoundation/OpenImageIO](https://github.com/AcademySoftwareFoundation/OpenImageIO) + [OpenImageIO docs](https://openimageio.readthedocs.io/en/latest/) | Format-agnostic image read/write/transform APIs for many production image formats | direct candidate | capability worker boundary | Strong worker-side normalization library when a capability must read, validate, and canonicalize many raster/image formats. It complements, not replaces, the hot-path `imgproxy + libvips` delivery posture already chosen in the technology profile. |

## 5. Implementation guidance by CDNgine layer

### 5.1 If you are touching the canonical source plane

Start with:

1. `xet-core`
2. `restic`
3. `borg`
4. `casync`

Use them to answer:

- is this about immutable source truth or only about export/distribution?
- do we need repository-native reconstruction handles and dedupe evidence?
- are we preserving the Xet-default contract while keeping legacy Kopia reads explicit and temporary?

### 5.2 If you are touching generic archive or container normalization

Start with:

1. `libarchive`
2. `tar-split`
3. Reproducible Builds archive guidance
4. `diffoscope`

Use them to answer:

- can the capability inventory the container without assuming a file-type-specific semantic model?
- which metadata must be normalized for deterministic repacks?
- how will tests prove the normalized output is stable?

### 5.3 If you are touching delta exports or incremental delivery

Start with:

1. RFC 3284 / `open-vcdiff`
2. `xdelta`
3. `zsync2`
4. the `rsync` report

Use them to answer:

- is the delta format portable and dictionary-aware?
- who owns the base artifact identity?
- does this belong in an export lane rather than the canonical source plane?

### 5.4 If you are touching canonical intermediates or semantic graphs

Start with:

1. `OpenUSD`
2. `assimp`
3. `OpenImageIO`
4. `OpenAssetIO`

Use them to answer:

- is the intermediate capability-owned and optional?
- can the core platform still preserve the original and retain generic fallback behavior?
- does the registry need semantic relationship recording or only byte-level evidence?

## 6. Rules this review is meant to enforce

1. **Do not hard-code one ecosystem into core contracts.**
2. **Do not confuse byte reuse with semantic normalization.**
3. **Do not make delta formats the source of truth.**
4. **Do not make validation tools part of the hot path.**
5. **Prefer upstream adapters, CLIs, or sidecars over reinvention.**
6. **When in doubt, preserve the original and add evidence rather than over-claiming semantics.**

## 7. Read more

- [Source Plane Strategy](./source-plane-strategy.md)
- [Semantic Normalization Tooling Evaluation](./semantic-normalization-tooling-evaluation.md)
- [Upstream Integration Model](./upstream-integration-model.md)
- [Architecture](./architecture.md)
- [ADR 0012: Xet Default Rollout And Kopia Dual-Read Migration](./adr/0012-xet-default-rollout-and-kopia-dual-read-migration.md)
