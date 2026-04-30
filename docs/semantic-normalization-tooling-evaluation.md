# Semantic Normalization Tooling Evaluation

This document turns the format-agnostic normalization contract into an implementation-facing evaluation of **generic semantic-normalization functions**, **useful upstream tooling categories**, **fallback posture**, and **benchmark guidance**.

It exists to help capability implementers decide **what an adapter should do** without turning CDNgine core architecture into:

- one mandatory intermediate format
- one mandatory parser stack
- one mandatory scene or media toolchain
- one hard-coded worldview about what a "real" asset looks like

## 1. Governing docs

- [Architecture](./architecture.md)
- [Source Plane Strategy](./source-plane-strategy.md)
- [Format-Agnostic Upstream Review](./format-agnostic-upstream-review.md)
- [Pipeline Capability Model](./pipeline-capability-model.md)
- [Workflow Extensibility](./workflow-extensibility.md)
- [Testing Strategy](./testing-strategy.md)
- [Traceability](./traceability.md)

## 2. Immediate conclusions

1. **Keep semantic normalization capability-owned and optional.**  
   The core platform should define generic adapter roles and evidence contracts, not one required semantic toolchain.
2. **Separate byte-level truth from semantic evidence.**  
   Canonical source identity remains universal; semantic normalization is additive evidence produced after canonicalization.
3. **Support a small set of generic semantic functions, not a long list of file-type-specific features.**  
   Capabilities may combine those functions differently for scenes, archives, images, media, package-like assets, or unfamiliar future formats.
4. **Treat upstream tooling as category seeds, not platform mandates.**  
   `OpenUSD`, `assimp`, `OpenImageIO`, `libarchive`, `OpenAssetIO`, `diffoscope`, `tar-split`, and capability-specific extractors are all useful examples, but none should become a universal requirement for every capability.
5. **Fallback must stay strong enough to keep unknown formats safe.**  
   When no semantic adapter exists, preserve the original, retain strong digests, allow proven container inventory only, and avoid unsupported semantic claims.
6. **Benchmark semantic normalization by invariants and evidence quality, not by one favored file type.**  
   Measure determinism, fidelity, fallback safety, cost, and diagnosability across fixture families rather than making one ecosystem the architectural center.
7. **Keep cross-format semantic reuse out of the first dedupe slice.**  
   Cross-format reuse needs parser, intermediate, and semantic-evidence work that should advance in a separate capability-owned workstream instead of being implied by universal byte-level dedupe.

## 3. Generic semantic-normalization functions CDNgine should support

The core platform should support the following **generic functions behind capability-owned adapters**.

| Generic function | What it means | Required evidence shape | Existing generic role |
| --- | --- | --- | --- |
| container inventory | Inspect a container or package-like asset and record entries, declared member types, and basic structure without over-claiming semantics | inventory manifest, entry counts, detected members, parser confidence, parse warnings | `ContainerNormalizer` |
| external reference resolution | Resolve or record linked resources, sub-assets, or dependent files needed to understand the asset semantically | resolved reference set, unresolved references, lookup policy, provenance of each resolution | new helper under capability-owned normalization |
| canonical intermediate build | Convert many source encodings into one capability-scoped intermediate that later processors can reason about deterministically | intermediate format identifier, toolchain version, conversion warnings, fidelity notes | `CanonicalIntermediateBuilder` |
| structural normalization | Normalize ordering, naming, metadata, or graph layout inside the capability-owned intermediate so repeated runs converge on the same semantic shape | normalization rules applied, before/after digests, dropped or preserved metadata summary | `SemanticExtractor` plus capability rules |
| semantic extraction | Read meaningful structures from the original or intermediate such as nodes, tracks, layers, textures, pages, channels, or declared asset members | extracted semantic document, schema version, parser/tool identity, confidence markers | `SemanticExtractor` |
| semantic fingerprinting | Compute stable fingerprints over normalized semantic content rather than raw bytes alone | fingerprint algorithm, input scope, excluded fields, normalized payload digest | `SemanticFingerprintBuilder` |
| semantic relation recording | Record relationships between sub-assets, logical parts, variants, references, and generated outputs | relation list, relation type taxonomy, source evidence, ambiguity markers | `SemanticRelationRecorder` |
| deterministic repack or export | Emit a stable normalized package, sidecar, or intermediate export when a capability needs one for replay, validation, or downstream use | export recipe, deterministic build inputs, output digest, reproducibility notes | capability-owned export helper |
| semantic diff and conformance evidence | Compare semantic outputs between runs, tool versions, or source revisions to prove intended vs unintended change | diff report, regression verdict, ignored nondeterministic fields, evidence links | test/diagnostics-only helper |

### 3.1 Function rules

1. **No capability is required to implement every function.**  
   A simple parser may only support container inventory plus semantic extraction; a richer scene capability may also implement canonical intermediate build, fingerprints, and relation recording.
2. **The core contract should stay role-based, not format-named.**  
   Keep names like `CanonicalIntermediateBuilder` and `SemanticRelationRecorder`; avoid core roles like `UsdNormalizer` or `UnitySceneCanonicalizer`.
3. **Adapters should produce evidence before claims.**  
   If a parser can partially inventory a package but cannot safely reconstruct semantics, record partial evidence and warnings instead of pretending full normalization succeeded.
4. **Semantic outputs are derived evidence, not replacement source truth.**  
   They should remain tied to `AssetVersion` and canonical-source evidence rather than replacing it.

## 4. Upstream tooling categories that help with those functions

The upstream-review lane already grouped tools by generic function. This section turns that into an implementer-facing selection guide for semantic adapters.

| Tooling category | Generic functions it helps with | Example upstream seeds | CDNgine posture |
| --- | --- | --- | --- |
| container and archive analyzers | container inventory, deterministic repack, basic extraction, parser confidence reporting | [libarchive](https://www.libarchive.org/), [tar-split](https://github.com/vbatts/tar-split), [Reproducible Builds archive guidance](https://reproducible-builds.org/docs/archives/) | Best first stop for package-like assets. Keep behind capability workers; never let archive semantics leak into core contracts. |
| scene and graph canonical intermediates | external reference resolution, canonical intermediate build, structural normalization, semantic relation recording | [OpenUSD](https://github.com/PixarAnimationStudios/OpenUSD), [assimp](https://github.com/assimp/assimp) | Strong when a capability truly owns scene-like composition. Optional and capability-scoped only. |
| image and raster normalization libraries | canonical intermediate build, structural normalization, semantic extraction, semantic fingerprinting | [OpenImageIO](https://openimageio.readthedocs.io/en/latest/) | Good for capabilities that need broad raster ingestion or metadata cleanup before downstream publication. Distinct from hot-path delivery tools such as `imgproxy + libvips`. |
| media and document normalizers | canonical intermediate build, structural normalization, deterministic export, semantic extraction over time-based or office-like content | [FFmpeg](https://ffmpeg.org/ffmpeg.html), [Gotenberg](https://gotenberg.dev/) | Good for capabilities that need a capability-scoped normalized media or document form. Keep them as worker-side adapters, not universal semantic contracts. |
| identity, publish, and reference-resolution APIs | external reference resolution, semantic relation recording, provenance recording, publish/resolve coordination | [OpenAssetIO](https://openassetio.github.io/OpenAssetIO/) | Use as a design/reference seed for asset identity and relation contracts. Do not force CDNgine core to depend on a VFX-specific control protocol. |
| capability-specific import/export adapters | canonical intermediate build, semantic extraction, deterministic export, fidelity checks for one ecosystem | [glTF-Blender-IO](https://github.com/KhronosGroup/glTF-Blender-IO), [gltf-pipeline](https://github.com/CesiumGS/gltf-pipeline), [AssetRipper](https://github.com/AssetRipper/AssetRipper), [UnityPy](https://github.com/K0lb3/UnityPy) | Useful as examples of how one capability may bridge a specific ecosystem. Keep them examples, not mandatory platform dependencies. |
| reproducibility and deep-diff tooling | deterministic repack validation, semantic diff and conformance evidence, regression diagnosis | [diffoscope](https://diffoscope.org/), [Reproducible Builds](https://reproducible-builds.org/docs/archives/) | Validation-only by default. High-value for tests, benchmarks, and operator diagnostics; not for request-path hot loops. |

### 4.1 Category-specific takeaways

#### Container and archive analyzers

- Start here when the asset might be a zip, tar, bundle, package, or unknown container.
- Prefer inventory-first behavior: list members, detect nested formats, and record parsing warnings before trying semantic claims.
- Use deterministic archive guidance when a capability emits normalized container exports.

#### Scene and graph intermediates

- Use these only when a capability genuinely benefits from a canonical graph or scene representation.
- A canonical intermediate should remain **capability-owned**, versioned, and replaceable.
- Do not make the registry or workflow core speak the intermediate natively.

#### Image and raster normalization libraries

- Use these when the capability needs broad image decoding, metadata cleanup, color handling, or canonical image-side semantics.
- Keep image-normalization concerns separate from the platform's delivery stack so ingest-time evidence and delivery-time transforms do not blur together.

#### Media and document normalizers

- Use these when a capability needs a normalized time-based or document-oriented form before downstream recipes run.
- Keep the normalized form capability-scoped. The core platform should know that an adapter produced a canonical intermediate, not that every workload must become "an FFmpeg asset" or "a PDF-first asset."

#### Identity and orchestration APIs

- These tools are most useful for modeling **what is related to what**, how references are resolved, and how publish/resolve semantics remain explicit across tools.
- They are especially useful when a capability spans many files or has external dependency graphs.

#### Capability-specific import/export adapters

- Treat these as **adapter examples**, not architectural defaults.
- They are valuable when a capability must preserve ecosystem-specific semantics that generic archive or graph tooling cannot express.
- They should publish evidence in CDNgine's generic semantic contract rather than forcing the core platform to know the tool's native types.

## 5. What fallback looks like when a capability has no semantic adapter

The fallback remains the same platform-wide safety net described by the normalization contract and source-plane strategy:

1. preserve the original
2. retain strong digests
3. route through the generic asset workflow template
4. allow generic container inventory only when container detection is proven
5. make no semantic claims beyond that evidence

### 5.1 Fallback output contract

When no semantic adapter exists, CDNgine should still be able to persist or emit:

- canonical-source evidence already required by the source-plane contract
- `normalizationMode: fallback`
- `semanticClaims: none`
- `containerInventory` only if the parser can prove a container boundary safely
- parser/tool identity for any generic inventory step that did run
- warnings describing why richer semantic extraction did not run

### 5.2 Fallback rules

1. **Fallback is success, not failure, when the architecture has no capability adapter yet.**
2. **Fallback may still publish byte-level or generic delivery artifacts.**  
   For example: original-source export, raw metadata, or generic inventory reports.
3. **Fallback must not over-claim structure.**  
   "Unknown container with 14 members" is acceptable. "Normalized scene graph" is not unless a capability adapter proved it.
4. **Fallback must keep future upgrades possible.**  
   Later capability adapters should be able to add semantic evidence without rewriting the meaning of the original `AssetVersion`.

## 6. Benchmarking and validation without hard-coding one file type

Semantic-normalization evaluation should be **fixture-family based**, not **file-type hard-coded**.

### 6.1 Benchmark dimensions

Every candidate adapter or toolchain should be scored against the same generic questions:

| Dimension | Question |
| --- | --- |
| determinism | Do repeated runs with the same inputs converge on the same semantic evidence and, when applicable, the same normalized export? |
| fidelity | Does normalization preserve the semantics the capability claims to preserve? |
| fallback safety | When parsing is partial or impossible, does the adapter degrade to evidence without data loss or semantic over-claim? |
| diagnosability | Are warnings, unresolved references, dropped metadata, and parse failures explicit enough for operators and tests? |
| cost | What are runtime, memory, CPU, storage, and external dependency costs for the claimed normalization depth? |
| portability | Can the adapter run in CDNgine worker boundaries without turning one host application into a platform-wide requirement? |
| reproducibility | Can the normalized export or evidence be compared reproducibly across runs and tool versions? |

### 6.2 Fixture families

Build benchmark corpora around **asset shapes**, not just formats:

1. self-contained single-file assets
2. referenced multi-file assets
3. package or archive containers
4. graph or scene-like assets
5. media assets with sidecars or embedded metadata
6. malformed, truncated, or adversarial samples
7. repeated revisions with small semantic changes but large byte similarity

Each capability can map its own formats into one or more of those families.

### 6.3 Validation procedure

For each candidate adapter or toolchain:

1. run normalization at least twice on the same fixture
2. compare semantic evidence for stability
3. if the adapter emits a normalized export, compare export digests and run deep diff tooling when digests differ
4. verify fallback behavior by intentionally removing adapter support or feeding unsupported variants
5. record unresolved references, warnings, and dropped fields as first-class evidence
6. measure resource cost under representative worker profiles
7. keep a per-capability benchmark note that states which semantic claims are in scope and which are intentionally out of scope

### 6.4 What "good" looks like

A semantic adapter is strong enough for CDNgine when it can prove:

- stable semantic evidence for repeated runs
- explicit degraded behavior for unsupported or partially supported inputs
- bounded operational cost in worker environments
- clear provenance from source bytes to normalized evidence
- enough diagnostic output to support conformance tests and operator triage

## 7. Recommended implementation posture for CDNgine

1. **Keep the core contract generic.**  
   Maintain platform-owned roles and evidence fields; let capabilities choose how to fulfill them.
2. **Prefer upstream adapters over bespoke parsers.**  
   Reuse mature libraries, CLIs, or sidecars where possible.
3. **Require explicit capability scope for semantic claims.**  
   A capability should declare which generic functions it implements and which semantic guarantees it actually makes.
4. **Treat validation tools as evidence generators.**  
   `diffoscope` and reproducibility guidance belong in tests, benchmarks, and diagnostics first.
5. **Adopt capability-specific ecosystems only behind replaceable boundaries.**  
   `OpenUSD`, `assimp`, `OpenImageIO`, `glTF-Blender-IO`, `gltf-pipeline`, `AssetRipper`, and `UnityPy` are examples of useful adapters, not permanent platform law.

## 8. Suggested next slices

The next low-risk follow-ups should stay documentation-, contract-, and benchmark-oriented:

1. define a small semantic-evidence schema for capability-owned normalization outputs
2. add conformance fixtures that exercise fallback, partial parse, and deterministic semantic evidence
3. prototype one capability-owned adapter using the generic functions above and benchmark it against the fallback path
4. evaluate cross-format reuse only after a capability-scoped parser plus semantic-evidence slice proves stable enough to justify relation or sidecar promotion

## 9. External references

- [OpenUSD](https://github.com/PixarAnimationStudios/OpenUSD)
- [assimp](https://github.com/assimp/assimp)
- [OpenImageIO](https://openimageio.readthedocs.io/en/latest/)
- [FFmpeg](https://ffmpeg.org/ffmpeg.html)
- [Gotenberg](https://gotenberg.dev/)
- [OpenAssetIO](https://openassetio.github.io/OpenAssetIO/)
- [libarchive](https://www.libarchive.org/)
- [tar-split](https://github.com/vbatts/tar-split)
- [diffoscope](https://diffoscope.org/)
- [Reproducible Builds archive guidance](https://reproducible-builds.org/docs/archives/)
- [glTF-Blender-IO](https://github.com/KhronosGroup/glTF-Blender-IO)
- [gltf-pipeline](https://github.com/CesiumGS/gltf-pipeline)
- [AssetRipper](https://github.com/AssetRipper/AssetRipper)
- [UnityPy](https://github.com/K0lb3/UnityPy)
- [Semantic Normalization Scope Boundary](./semantic-normalization-scope-boundary.md)
