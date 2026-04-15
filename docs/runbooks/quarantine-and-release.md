# Quarantine And Release

## Detection

- validation or scanning raises a quarantine-worthy signal
- operator requests quarantine during incident response

## Scope and blast radius

1. identify affected asset versions
2. determine whether canonical source, derived artifacts, or both are impacted
3. identify current delivery exposure

## Safe actions

- open a `QuarantineCase`
- halt further processing or delivery publication as required by policy
- record evidence references, actor, and reason
- use controlled release with explicit approving actor and next action

## Never do

- silently clear quarantine state
- allow release without audit evidence and policy review
- treat quarantine as only a log annotation

## Confirm recovery

- quarantine case is closed with `released`, `purged`, or `closed-no-action`
- downstream processing or delivery state matches the release decision
