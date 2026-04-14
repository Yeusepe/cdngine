# ADR 0003: Deterministic Derivative Keys

## Status

Accepted

## Context

The platform needs caching, replay, invalidation, and manifest publication to behave predictably across retries and reprocessing.

If derivative keys are ad hoc or runtime-generated without stable inputs, the platform becomes much harder to cache and reason about.

## Decision

Derivatives are addressed by stable keys derived from asset identity, version, recipe, and schema version.

## Alternatives considered

### Random output keys

Rejected because they make replay and invalidation awkward and complicate manifest consistency.

### Mutable location-based naming without schema inputs

Rejected because it weakens cache predictability and obscures which contract version produced the artifact.

## Consequences

- manifests can reference stable derivative paths
- retries can safely overwrite or confirm expected output locations
- cache invalidation can be reasoned about by version and prefix
- tests should prove key stability across repeated processing
