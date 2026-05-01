# Runbook Index

This directory is for operator-facing recovery and diagnosis runbooks.

Runbooks should exist for the real failure modes of the platform, not just as placeholders. They are part of the product's operability.

## 1. Required runbook families

Runbooks should exist for:

- processor outage
- storage degradation
- workflow backlog
- replay operations
- security quarantine flows
- CDN or delivery-origin degradation
- canonical source availability, snapshotting, or replay-source failure
- production cutover and hardening verification

## 2. What every runbook should contain

Every runbook should answer:

1. how to detect the issue
2. how to confirm scope and blast radius
3. which dashboards or traces to inspect
4. what safe operator actions are available
5. what should never be done during the incident
6. how to confirm recovery

## 3. Current runbook files

Current files:

- `workflow-backlog.md`
- `processor-outage.md`
- `derived-store-degradation.md`
- `canonical-source-availability.md`
- `source-engine-migration.md`
- `replay-operations.md`
- `quarantine-and-release.md`
- `production-cutover-verification.md`

## 4. Relationship to other docs

- security-sensitive response procedures should align with the threat models
- replay procedures should align with the resilience and scale validation expectations
- operator actions should match the public or private service surfaces defined in the architecture docs

## 5. Read more

- [Observability](../observability.md)
- [Security Model](../security-model.md)
- [Resilience And Scale Validation](../resilience-and-scale-validation.md)
