# ADR 0012: Xet Default Rollout And Kopia Dual-Read Migration

## Status

Accepted

## Context

CDNgine already established three important constraints:

- the canonical source plane is a repository-oriented contract, not a raw object-key contract
- `AssetVersion` identity must stay stable even when byte reuse changes underneath
- engine-neutral source evidence is required so reads, replay, and diagnostics do not hard-code one repository product into the control plane

ADR 0010 set the broader source-plane architecture, and ADR 0011 added engine-neutral evidence plus benchmark discipline. The remaining architecture question is no longer "should Xet ever be considered?" The rollout question is now:

- what engine should be the default for **new canonicalizations**
- how should legacy **Kopia-backed** versions remain readable during migration
- what conditions must be met before Kopia is retired

## Decision

1. **Xet becomes the default canonical source engine for new canonicalizations.**
2. The control plane remains **engine neutral** through `repositoryEngine`, canonical identity, digest, size, and reconstruction-handle fields.
3. **Legacy Kopia-backed versions remain readable and replayable** during the migration period. Read resolution must branch by persisted `repositoryEngine`, not by guesswork.
4. Backfill or re-canonicalization into Xet is allowed where operators need it, but the migration must preserve durable auditability of what engine originally canonicalized a version.
5. **Kopia is retired only after** migration, any required backfill, and explicit operator signoff confirm that no legacy canonical reads still depend on it.
6. Public APIs and SDKs remain storage-engine neutral. Callers authorize source reads through CDNgine; they do not choose Xet versus Kopia directly.

## Alternatives considered

### Keep Kopia as the indefinite default

Rejected because the intended rollout has already chosen Xet as the target default for new canonicalizations, and the governing docs must state that posture directly rather than leaving the platform in a benchmark-only limbo.

### Flip all reads and writes to Xet immediately with no dual-read window

Rejected because legacy `AssetVersion` rows already carry durable Kopia-backed source identities. A safe migration must preserve readability and replay for those versions until backfill and signoff are complete.

### Reintroduce the older Xet-only ADR 0008 posture

Rejected because the current architecture still depends on the broader repository, tiering, lazy-read, and artifact-graph model established after ADR 0008. The rollout decision changes the default engine, not the surrounding platform shape.

## Consequences

- architecture, deployment, and package-reference docs must describe **Xet as the default write path** for new canonicalizations
- migration docs must describe **Kopia as a temporary dual-read lane**, not as a co-equal steady-state default
- traceability must require evidence for migration safety, legacy readability, and final Kopia retirement signoff
- implementation work that follows this ADR should avoid exposing engine choice in the public API contract

## References

- [Source Plane Strategy](../source-plane-strategy.md)
- [Canonical Source And Tiering Contract](../canonical-source-and-tiering-contract.md)
- [Environment And Deployment](../environment-and-deployment.md)
- [ADR 0010: Canonical Source Repository And Tiered Storage](./0010-canonical-source-repository-and-tiered-storage.md)
- [ADR 0011: Source Plane Benchmark Gate And Engine-Neutral Evidence](./0011-source-plane-benchmark-gate-and-engine-neutral-evidence.md)
- [Xet deduplication](https://huggingface.co/docs/xet/en/deduplication)
- [huggingface/xet-core](https://github.com/huggingface/xet-core)
- [Kopia features](https://kopia.io/docs/features/)
