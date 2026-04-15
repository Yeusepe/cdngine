# ADR Index

This directory records architectural decisions that should not be left implicit in chat or scattered prose.

ADRs should capture the decision, the alternatives that mattered, and the consequences the implementation must respect.

## Current ADRs

- [0001 Separate Raw And Derived Stores](./0001-separate-raw-and-derived-stores.md)
- [0002 Temporal For Durable Orchestration](./0002-temporal-for-durable-orchestration.md)
- [0003 Deterministic Derivative Keys](./0003-deterministic-derivative-keys.md)
- [0004 Ingest Boundary And API Surfaces](./0004-ingest-boundary-and-api-surfaces.md)
- [0005 Programmatic Scope And Authorization Model](./0005-programmatic-scope-and-authorization-model.md)
- [0007 CDN As Code SDK And FFI Model](./0007-cdn-as-code-sdk-and-ffi-model.md)
- [0008 Xet As Canonical Content Plane](./0008-xet-as-canonical-content-plane.md)
- [0009 Delivery Scopes, Private Access, And Streaming](./0009-delivery-scopes-private-access-and-streaming.md)

## ADR writing expectations

Each ADR should explain:

1. context and problem statement
2. decision
3. alternatives considered
4. consequences and follow-on constraints

ADRs are not for temporary brainstorm notes. They are for durable decisions the rest of the docs and code should honor.
