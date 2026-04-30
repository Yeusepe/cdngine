# Source Engine Migration

Use this runbook when the deployment has switched the write path to **Xet** but operators still need an explicit migration plan for legacy **Kopia-backed** versions.

## Detection

- `repositoryEngine = kopia` rows are still present in the registry
- canonical rows exist without `repositoryEngine`, which means old implicit-default assumptions are still in the data
- operators need a concrete inventory before changing source-plane infrastructure

## Preconditions

1. new canonicalizations already default to **Xet**
2. the temporary Kopia lane is still reachable for legacy restores
3. `DATABASE_URL` is set for registry access unless you are using `--from-file`
4. Xet command wiring is configured before using `recanonicalize --apply`

## Inventory the legacy lane

Run:

```bash
npm run source:migration -- inventory --output scripts\output\source-migration\inventory.json
```

What to look for:

- `legacyKopiaRows`: versions that still depend on Kopia for restore and replay
- `missingEngineRows`: canonical rows that must be reviewed manually because the registry is missing `repositoryEngine`
- `eligibleLegacyRows`: legacy Kopia rows with enough canonical evidence for an explicit Xet re-canonicalization rehearsal

Do **not** treat `missingEngineRows` as Kopia automatically. The point of this command is to avoid silently reintroducing the old default assumption.

## Plan re-canonicalization

Dry-run the migration plan first:

```bash
npm run source:migration -- recanonicalize --output scripts\output\source-migration\recanonicalize-plan.json
```

This produces:

- `eligible` rows that can be restored from Kopia and snapshotted into Xet explicitly
- `manual-review` rows that are missing `repositoryEngine` or other canonical evidence

## Apply explicit re-canonicalization

When you want to rehearse the migration path or capture Xet-side evidence for a legacy row, run:

```bash
npm run source:migration -- recanonicalize --apply --output scripts\output\source-migration\recanonicalize-report.json
```

Important behavior:

- the command restores legacy rows by the persisted `repositoryEngine`
- the command snapshots the restored bytes into **Xet**
- the command writes a report with `candidateCanonicalSource`
- the command does **not** rewrite the original `AssetVersion` fields

That last rule is intentional. The current schema still uses one durable canonical-source evidence set per version, so this tooling preserves the original Kopia-backed audit record while making the Xet rehearsal explicit and reviewable.

## Safe actions

- keep Kopia reachable while inventory still reports legacy rows
- treat `recanonicalize --apply` as an explicit operator action, not an automatic background migration
- archive the generated inventory and re-canonicalization reports with rollout evidence
- review `manual-review` rows before changing any source-plane infrastructure

## Never do

- guess that a missing `repositoryEngine` row is really Kopia
- rewrite registry rows to raw storage coordinates
- retire Kopia because the write path switched to Xet; retire it only after migration criteria and signoff are met
- hide re-canonicalization side effects behind automatic request-path fallback

## Confirm migration readiness

- `inventory` shows only the legacy dependency window you expect
- every `eligible` row in the re-canonicalization plan has either a reviewed dry-run or an apply report
- the generated reports are attached to rollout or signoff evidence
- legacy reads still restore correctly during the dual-read window
