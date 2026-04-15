# Canonical Source Availability

## Detection

- canonicalization latency spikes
- source-repository write or reconstruction failures
- replay failures that cannot read canonical source identity

## Scope and blast radius

1. separate canonicalization failures from worker reconstruction failures
2. identify whether the outage affects one scope or the whole canonical plane
3. determine whether ingest acceptance must be throttled or paused

## Inspect

- ingest health dashboard
- source-repository read/write and reconstruction metrics
- worker logs for reconstruction failures

## Safe actions

- pause or slow new canonicalization when canonical writes are failing
- keep completed canonical versions immutable and avoid ad hoc source substitution
- retry canonicalization only after dependency health is restored

## Never do

- treat staging objects as permanent canonical truth
- rewrite version records to raw storage keys

## Confirm recovery

- canonicalization succeeds again
- workers reconstruct from the source repository successfully
- replay starts from canonical source identity without manual substitution
