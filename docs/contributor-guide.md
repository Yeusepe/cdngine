# Contributor Guide

This is the practical starting point for contributors working on docs, contracts, and implementation.

The repository is architecture-heavy right now, so contribution quality depends on keeping docs, contracts, tests, and operational expectations aligned.

## 1. Done means

A slice is not done until:

1. governing docs are updated
2. tests match the intended behavior
3. examples remain portable and scrubbed of machine-local details
4. traceability stays aligned
5. operational consequences are reflected in observability, security, or runbook docs where relevant

## 2. Review expectations

Reviewers should expect contributors to:

- keep ownership and boundaries explicit
- explain new dependencies and why upstream capability was insufficient
- update references when a design decision relies on upstream behavior
- preserve the canonical source, tiering, and deterministic delivery model
- keep the Hono-based portable service picture consistent with the rest of the docs

## 3. Documentation expectations

For non-trivial changes:

1. update the governing design doc
2. update the relevant contract or API reference
3. update implementation ledger and traceability when the slice meaning changes
4. keep examples and generated docs aligned
5. update runbook or threat-model indexes when a new operational surface is introduced

## 4. Dependency expectations

Default order of preference:

1. existing platform capability
2. Hono and the selected host-shell primitives already in the stack
3. declarative registration
4. upstream package or managed service
5. narrow custom code

Any change that skips ahead in that order should explain why.

## 5. Review checklist

Before a change is considered ready, contributors should ask:

- does this change alter public versus private API exposure?
- does this change affect replay or deterministic keys?
- does this change require new audit or telemetry fields?
- does this change require a new threat model or runbook?
- does this change introduce new operational dependencies?

## 6. Read more

- [Engineering Guide](./engineering.md)
- [Testing Strategy](./testing-strategy.md)
- [Regular Programming Practices](./regular-programming-practices/README.md)
- [Implementation Ledger](./implementation-ledger.md)
- [Traceability](./traceability.md)
