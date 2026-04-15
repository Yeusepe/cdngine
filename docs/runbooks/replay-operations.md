# Replay Operations

## Preconditions

Replay is allowed only when:

1. the canonical source identity is durable
2. the replay reason is recorded
3. the requested action is authorized for the operator

## Inspect before replay

- current asset version state
- prior workflow summary and failure classification
- manifest and derivative publication state
- quarantine status

## Safe actions

- use business-keyed replay requests
- record operator action reason and correlation IDs
- replay from canonical source identity only

## Never do

- replay from a transient staging object
- bypass quarantine or policy checks
- mutate old audit records to hide prior failures

## Confirm recovery

- new workflow dispatch is durable
- workflow summary reflects replay reason
- resulting publication state is coherent
