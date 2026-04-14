# Delivery And Review

## 1. Standing rules

1. Start from the expected outcome.
2. Keep one coherent slice per change.
3. Update docs, contracts, tests, and implementation together.
4. Do not hide architectural decisions in chat.
5. Prefer deletion and reuse over custom subsystems.

## 2. Review expectations

- reviewers should be able to find ownership quickly
- non-trivial behavior should have examples or links
- new dependencies and custom primitives need rationale
- durability, replay, and rollback should not be deferred for critical paths

## 3. Slice discipline

Prefer one coherent concern per slice:

- a contract change
- a workflow change
- a storage boundary change
- a new file-type registration path

Split cleanup from feature work when it would hide the main change.

