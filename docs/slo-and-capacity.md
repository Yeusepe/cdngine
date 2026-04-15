# SLO And Capacity

This document defines initial operating targets for the reference profile.

These are the default targets the platform should design dashboards, alerts, and worker-pool sizing around. They can be tightened by adopters, but they should not remain implicit.

## 1. Initial service objectives

| Objective | Target |
| --- | --- |
| upload-session creation latency | p95 <= 500 ms |
| upload completion acceptance latency | p95 <= 2 s |
| image workflow schedule-to-start latency | p95 <= 30 s |
| document workflow schedule-to-start latency | p95 <= 60 s |
| video workflow schedule-to-start latency | p95 <= 120 s |
| image publication latency | p95 <= 5 min |
| document publication latency | p95 <= 10 min |
| first video poster publication latency | p95 <= 15 min |
| initial stream publication latency | p95 <= 30 min |

## 2. Availability posture

Initial service-level posture:

- public control-plane API: 99.9%
- workflow dispatch path: 99.9%
- delivery authorization path: 99.9%

Published derivatives behind the CDN should exceed control-plane availability during steady-state delivery because hot reads should not depend on Xet or the synchronous API path.

## 3. Backlog and saturation thresholds

| Signal | Initial threshold |
| --- | --- |
| image queue backlog | alert when sustained above 5 minutes of work |
| document queue backlog | alert when sustained above 10 minutes of work |
| video queue backlog | alert when sustained above 20 minutes of work |
| schedule-to-start latency | alert when above 2x target for 15 minutes |
| worker CPU saturation | investigate when sustained above 80% |
| worker memory saturation | investigate when sustained above 80% |
| derived-store write failures | page when publication is blocked |
| Xet canonicalization failure rate | page when canonical ingest is blocked |

## 4. Recovery expectations

Operators should be able to:

1. detect backlog growth before customer-visible publication failure
2. shed or slow non-critical replay traffic during acute incidents
3. quarantine risky content without blocking the entire worker class
4. restore workflow dispatch without duplicate publication

## 5. Capacity rules

1. keep worker pools separated by workload class
2. size worker pools by schedule-to-start and not only CPU averages
3. keep long waits and operator approval states out of scarce execution slots where the orchestration engine supports that posture
4. monitor Xet caches separately from canonicalization throughput

## 6. Read more

- [Environment And Deployment](./environment-and-deployment.md)
- [Observability](./observability.md)
- [Resilience And Scale Validation](./resilience-and-scale-validation.md)
- [Runbook Index](./runbooks/README.md)
