# Workflow Backlog

## Detection

- queue backlog above the threshold in `docs/slo-and-capacity.md`
- schedule-to-start latency above target
- rising waiting-run count or dead-letter volume

## Scope and blast radius

1. identify which worker pool or task queue is affected
2. separate image, document, and video impact
3. confirm whether dispatch is blocked or workers are simply saturated

## Inspect

- workflow health dashboard
- worker-pool saturation dashboard
- Temporal visibility for affected workflow IDs

## Safe actions

- scale the affected worker pool
- slow or pause non-critical replay traffic
- drain retryable dispatch backlog after dependency recovery

## Never do

- restart all worker pools blindly
- replay all failed runs without separating validation failures from infrastructure failures

## Confirm recovery

- backlog returns below threshold
- schedule-to-start latency returns to target
- no unexpected duplicate workflow starts appear
