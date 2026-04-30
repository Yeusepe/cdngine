# Semantic Normalization Scope Boundary

This decision note defines what the current dedupe project is allowed to claim about semantic normalization and what must remain a separate follow-on workstream.

## 1. Governing docs

- [Architecture](./architecture.md)
- [Service Architecture](./service-architecture.md)
- [Source Plane Strategy](./source-plane-strategy.md)
- [Format-Agnostic Upstream Review](./format-agnostic-upstream-review.md)
- [Semantic Normalization Tooling Evaluation](./semantic-normalization-tooling-evaluation.md)
- [Pipeline Capability Model](./pipeline-capability-model.md)
- [ADR 0011: Source Plane Benchmark Gate And Engine-Neutral Evidence](./adr/0011-source-plane-benchmark-gate-and-engine-neutral-evidence.md)
- [Traceability](./traceability.md)

## 2. Decision

**Cross-format semantic reuse does not belong in the current dedupe project.**

The current project stops at:

1. universal byte-level dedupe in the canonical source plane
2. engine-neutral source evidence and fallback-safe canonicalization
3. capability-owned and optional semantic normalization contracts

Cross-format reuse such as Blender-versus-Unity equivalence belongs in a **separate semantic-normalization workstream** that can prove parser behavior, intermediate stability, semantic evidence quality, and operator value before it changes any broader platform expectations.

## 3. Why this is the right boundary

### 3.1 Universal byte-level dedupe is the current architectural floor

The architecture already says every successfully canonicalized upload should receive universal byte-level dedupe and engine-neutral source evidence, even when CDNgine has no semantic understanding of the format.

That is the current project:

- preserve the original
- keep strong digests and canonical-source provenance
- allow storage-engine benchmarking without changing `AssetVersion` semantics
- keep unknown formats safe

### 3.2 Semantic normalization is additive and capability-owned

The current architecture also already says semantic normalization is:

- optional
- post-canonicalization
- capability-scoped
- evidence-producing rather than truth-replacing

That means the platform may let a capability emit semantic fingerprints, relations, or canonical intermediates, but the core storage and control-plane contracts do not assume those outputs exist for every file type.

### 3.3 Cross-format reuse is a different problem than first-project dedupe

Claiming reuse across ecosystems such as Blender and Unity is not just "better dedupe." It needs at least:

1. format-specific parsers or import adapters
2. reference-resolution rules for linked or embedded assets
3. a capability-owned canonical intermediate or comparable semantic model
4. explicit semantic evidence and confidence markers
5. conformance fixtures proving determinism, fidelity, and degraded behavior
6. likely semantic sidecars or relation records that stay additive to the core model

Those requirements are materially different from chunk-level or snapshot-level byte reuse. Without them, CDNgine would be promising platform-wide semantic equivalence without evidence.

### 3.4 Core contracts should stay format-agnostic until evidence justifies more

The current source-plane and registry contracts intentionally stop at byte-level provenance and canonical reconstruction facts. They should not absorb:

- Unity-specific or Blender-specific semantic identifiers
- platform-wide "same asset meaning" claims across formats
- mandatory canonical intermediates
- parser-dependent control-plane truth

If cross-format reuse later proves valuable, it should enter as additive capability-owned evidence first, not as a hidden rewrite of canonical-source, registry, or `AssetVersion` meaning.

## 4. In scope now

The current dedupe project may do the following now:

1. keep universal byte-level dedupe as the default for every canonicalized upload
2. preserve engine-neutral source evidence in storage and registry contracts
3. keep unknown-format fallback behavior explicit: preserve original, retain digests, allow only proven container inventory
4. let capabilities declare optional normalization roles without requiring them
5. benchmark canonical-source backends independently of semantic-normalization claims
6. document that semantic outputs, when they exist, are derived evidence rather than replacement source truth

## 5. Deferred from the current project

The current dedupe project should **not** do the following:

1. promise Blender-to-Unity or any other cross-format semantic reuse
2. make semantic fingerprints or parser output part of canonical-source identity
3. change `AssetVersion` identity or dedupe rules based on semantic similarity
4. require a platform-wide canonical intermediate
5. add control-plane or storage contracts that assume semantic sidecars always exist
6. treat partial parser output as proof of semantic equivalence
7. hard-code one DCC, scene, archive, or media ecosystem into core contracts

## 6. Minimum follow-on slices if cross-format reuse is pursued later

If CDNgine wants cross-format semantic reuse later, the minimum follow-on slices should be:

### 6.1 Capability-bounded parser and reference-resolution slice

Choose one bounded asset family and prove:

- parser coverage and failure posture
- reference resolution rules
- partial-parse behavior
- fallback safety when the semantic adapter cannot finish

This should stay inside one capability boundary, not the core platform.

### 6.2 Canonical intermediate and semantic-evidence slice

Define a capability-owned intermediate or semantic document plus evidence contract for:

- tool identity and version
- normalization rules applied
- warnings and ambiguity markers
- semantic fingerprints
- relation evidence

This slice should prefer additive semantic sidecars or derived evidence records over new core source-plane truth.

### 6.3 Determinism, fidelity, and fallback conformance slice

Add fixture families and benchmarks that prove:

- repeated runs converge
- semantic claims preserve the intended meaning
- unsupported variants degrade to evidence without over-claiming
- operational cost is bounded enough for worker execution

### 6.4 Cross-format relation promotion slice

Only after the first three slices are credible should CDNgine evaluate whether to promote any cross-format relation model into broader contracts.

That promotion must stay additive and should answer:

- what semantic relation is being claimed
- what evidence threshold is required
- what remains capability-owned
- what operator diagnostics and remediation are needed when relations are wrong or incomplete

## 7. Implementation rule going forward

Until a later workstream proves otherwise, the implementation rule is:

> **First-project dedupe is universal byte-level reuse plus fallback-safe capability boundaries. Cross-format semantic reuse is deferred and must arrive later as evidence-backed, capability-owned normalization slices.**

## 8. External references

- [OpenUSD](https://openusd.org/release/index.html)
- [Assimp](https://the-asset-importer-lib-documentation.readthedocs.io/en/latest/)
- [OpenAssetIO](https://openassetio.github.io/OpenAssetIO/)
- [glTF-Blender-IO](https://github.com/KhronosGroup/glTF-Blender-IO)
- [AssetRipper](https://github.com/AssetRipper/AssetRipper)
- [UnityPy](https://github.com/K0lb3/UnityPy)
