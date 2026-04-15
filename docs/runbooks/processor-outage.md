# Processor Outage

## Detection

- crash or timeout rate spikes in one worker pool
- throughput drops while backlog grows
- dependency-specific failures cluster by capability or recipe

## Scope and blast radius

1. identify affected worker class and capabilities
2. determine whether publication is fully blocked or partially degraded
3. separate malformed-input failures from platform outages

## Inspect

- worker-pool health dashboard
- workflow failure summaries
- dependency logs for FFmpeg, Gotenberg, scanners, or image tooling

## Safe actions

- isolate the failing worker pool
- quarantine risky inputs when failures suggest content safety risk
- replay only after dependency health is confirmed

## Never do

- bypass validation to push content through
- widen worker credentials or egress during the incident

## Confirm recovery

- crash and timeout rates normalize
- retryable failures begin to drain
- newly accepted jobs complete successfully
