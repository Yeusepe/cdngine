# Observability Package

This package is for tracing, logging, metrics, and correlation helpers shared across API, workflow, and worker paths.

Current checked-in helpers include:

- W3C `traceparent` parsing and propagation
- dependency-backed readiness monitors
- structured request-log recording without credential leakage
- Prometheus text rendering for request and readiness metrics

Governing docs:

- `docs/observability.md`
- `docs/slo-and-capacity.md`
- `docs/traceability.md`
