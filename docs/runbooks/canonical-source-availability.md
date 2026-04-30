# Canonical Source Availability

## Detection

- canonicalization latency spikes
- source-repository write or reconstruction failures
- Xet bridge command failures, timeout spikes, or missing executable errors
- replay failures that cannot read canonical source identity

## Scope and blast radius

1. separate canonicalization failures from worker reconstruction failures
2. identify whether the outage affects one scope or the whole canonical plane
3. determine whether ingest acceptance must be throttled or paused

## Inspect

- ingest health dashboard
- source-repository read/write and reconstruction metrics
- Xet bridge command logs, timeout metrics, and configured working-directory or workspace-path inputs
- worker logs for reconstruction failures
- temporary Kopia lane health when legacy rows or rollback still depend on it

## Safe actions

- pause or slow new canonicalization when canonical writes are failing
- keep completed canonical versions immutable and avoid ad hoc source substitution
- retry canonicalization only after dependency health is restored
- if the Xet bridge is unhealthy and the migration lane is still provisioned, switch only the operator rollout control for **new** canonicalizations with `CDNGINE_SOURCE_ENGINE=kopia`
- keep legacy Kopia credentials and repository access available until migration/backfill/signoff confirm that no remaining rows depend on them
- run `npm run source:migration -- inventory` before declaring the incident closed if the failure could have stranded new Xet writes or left operators unsure which legacy rows still depend on Kopia

## Never do

- treat staging objects as permanent canonical truth
- rewrite version records to raw storage keys
- silently hide a broken Xet bridge behind undocumented fallback behavior

## Confirm recovery

- canonicalization succeeds again
- workers reconstruct from the source repository successfully
- replay starts from canonical source identity without manual substitution
- readiness returns green for the configured `source-repository` dependency set
- operator inventory from `npm run source:migration -- inventory` still matches the expected legacy migration window
