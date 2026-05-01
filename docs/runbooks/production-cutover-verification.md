# Production Cutover Verification

Use this runbook before a first production launch, a major runtime change, or an emergency rollback recovery.

## 1. Detect when to use this runbook

Use it when:

- a new production deployment profile is being promoted
- auth, readiness, tracing, or metrics wiring changed
- operators need to prove the stack is company-facing ready rather than merely booting

## 2. Confirm scope and blast radius

1. identify the deployment profile and region under test
2. confirm which auth adapter is active
3. confirm whether legacy Kopia reads are still in scope
4. confirm which worker pools and delivery scopes are enabled

## 3. Required checks

1. `GET /healthz` returns `200` and includes `requestId`, `traceId`, `service`, and `version`
2. `GET /readyz` reflects real dependency state for `auth`, `postgres`, `redis`, `temporal`, `tusd`, `source-repository`, and the required storage origins for the selected profile
3. `GET /metrics` exposes request counters plus readiness gauges in Prometheus text format
4. an authenticated synthetic public request succeeds with propagated `traceparent`
5. an unauthenticated public request fails as `401` without leaking auth material into logs
6. one end-to-end conformance path succeeds for upload, publication, and delivery

## 4. Dashboards and traces to inspect

- ingest health
- workflow health
- delivery health
- auth failure and scope-denial dashboards
- request traces filtered by the synthetic `traceId` used during cutover verification

## 5. Safe operator actions

- pause rollout if `/readyz` reports `not-ready`
- keep traffic on the previous deployment while replay and synthetic checks run
- use `CDNGINE_SOURCE_ENGINE=kopia` only for an explicit emergency write-path rollback
- re-run the checked-in conformance suite before resuming rollout

## 6. Never do this

- never mark production ready from `/healthz` alone
- never ignore a missing readiness probe for a required dependency
- never log raw bearer tokens or session cookies during verification
- never rewrite canonical-source evidence just to make rollback look simpler

## 7. Confirm recovery or cutover success

Success requires:

- `/readyz` is `ready` or an explicitly accepted `degraded` state with owner signoff
- metrics scrape successfully
- structured request logs show request ID and trace ID without credential leakage
- synthetic authenticated and denied requests both match the documented contracts
- at least one conformance scenario passes against the promoted build

