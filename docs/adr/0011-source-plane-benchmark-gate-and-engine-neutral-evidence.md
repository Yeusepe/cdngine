# ADR 0011: Source Plane Benchmark Gate And Engine-Neutral Evidence

## Status

Accepted

## Context

CDNgine already uses a canonical source repository instead of raw object keys, and ADR 0010 selected Kopia as the default implementation. The new dedupe work needs a more actionable answer to a narrower question:

- how do we improve observability and future swap readiness for the canonical source plane
- without replacing the current backend speculatively
- while keeping every file type on a safe, format-agnostic fallback path

Upstream review shows:

- **xet-core** is the strongest direct challenger for near-duplicate binary revisions
- **restic** and **borg** are strong repository references and benchmark baselines
- **casync** is a valuable chunk-store and export/distribution reference
- delta tools and reproducibility tools matter, but not as the universal canonical source backend

## Decision

1. keep **Kopia** as the default implemented canonical source engine until benchmark evidence justifies a change
2. make the `SourceRepository` contract **engine neutral** by requiring repository engine identity and allowing richer byte-reuse evidence:
   - strong digests
   - logical and stored sizes when available
   - dedupe metrics
   - reconstruction handles
3. pass verified size and digest evidence from upload completion into canonicalization so the source adapter can return useful evidence immediately
4. treat **xet-core** as the primary benchmark challenger, not as the current default
5. keep semantic normalization capability-driven and optional, separate from universal byte-level dedupe

## Alternatives considered

### Replace Kopia immediately with xet-core

Rejected for now because the repo does not yet have benchmark evidence, migration posture, or operational runbooks strong enough to justify a backend flip.

### Keep Kopia and leave the contract opaque

Rejected because the missing engine-neutral evidence makes the benchmark and migration question hard to answer later.

### Collapse semantic normalization into the first byte-dedupe slice

Rejected because unknown formats still need a preserve-original fallback, and cross-format reuse is a different problem than chunk-level storage reuse.

## Consequences

- the implemented stack stays stable while the canonical-source contract becomes more useful
- future backend comparisons can use the same control-plane semantics
- registry persistence should grow next to store richer source-evidence fields
- `AssetVersion` identity remains separate from underlying byte reuse

## References

- [Source Plane Strategy](../source-plane-strategy.md)
- [ADR 0010: Canonical Source Repository And Tiered Storage](./0010-canonical-source-repository-and-tiered-storage.md)
- [Xet chunk-level deduplication](https://huggingface.co/docs/xet/en/deduplication)
- [huggingface/xet-core](https://github.com/huggingface/xet-core)
- [restic repository design](https://restic.readthedocs.io/en/stable/design.html)
- [borgbackup internals](https://borgbackup.readthedocs.io/en/stable/internals/data-structures.html)
- [systemd/casync](https://github.com/systemd/casync)
