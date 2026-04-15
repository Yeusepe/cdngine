# ADR 0001: Separate Raw And Derived Stores

## Status

Accepted

## Context

The platform needs one clear answer for canonical source provenance and a different answer for hot delivery traffic.

If the same store is forced to serve both roles, the platform mixes:

- immutable source-of-truth concerns
- replay provenance
- high-churn derivative publication
- CDN-origin behavior
- derivative-specific retention and purge policy

That makes both provenance and delivery harder to operate cleanly.

## Decision

Keep Xet as the canonical deduplicated source plane and keep derived delivery artifacts in a separate S3-compatible store.

## Alternatives considered

### Use one binary store for everything

Rejected because it couples canonical provenance to hot delivery and makes replay, retention, and CDN behavior harder to reason about.

### Store every derivative back into Xet

Rejected as the default because derivatives are regenerable delivery outputs, not the canonical upload history the system should replay from.

## Consequences

- replay starts from Xet
- CDN delivery reads come from the derived store, not Xet
- registry records must link source versions to deterministic derivative keys
- retention policy can differ between raw and derived storage
