# AGENTS.md

This file is the working contract for coding agents operating in this repository.

Its purpose is to make agent behavior **repeatable, architecture-aware, and TDD-first**.

An agent working in CDNgine must not write code as if this were a blank project. Every change must be grounded in:

1. the local architecture and operating docs in `docs/`
2. relevant upstream package or protocol references
3. executable tests written before or alongside implementation

If an agent cannot identify the governing docs and references for a change, it is not ready to code that change.

## 1. Non-negotiable rules

1. **Work TDD-first.**
   - Start with docs and contracts if needed.
   - Write failing tests before implementation whenever the change is executable.
   - Do not treat tests as cleanup.
2. **Map every change to governing docs.**
   - Before coding, identify which local docs govern the change.
   - Update those docs when the change affects architecture, contracts, operations, or behavior.
3. **Attach references to every code change.**
   - Every new source file, major module, workflow, adapter, or route must have documentation and references attached to it.
   - Those references must include both:
     - local repository docs
     - upstream external docs or repositories where behavior depends on them
4. **Do not invent core platform semantics casually.**
   - Reuse the architecture already established in `docs/`.
   - If a change would alter core semantics, update the architecture docs and ADRs first or alongside the change.
5. **Keep the implementation traceable.**
   - Code, tests, docs, and operational expectations must move together.

## 2. Required reading before coding

An agent should read these first for almost every non-trivial task:

1. `README.md`
2. `docs/README.md`
3. `docs/architecture.md`
4. `docs/service-architecture.md`
5. `docs/technology-profile.md`
6. `docs/package-reference.md`
7. `docs/testing-strategy.md`
8. `docs/traceability.md`
9. `docs/implementation-ledger.md`
10. `docs/repository-layout.md`
11. `docs/regular-programming-practices/resilient-coding-debugging-and-performance.md`
12. `docs/contributor-guide.md`

Then read the domain-specific docs for the change.

## 3. Documentation map for coding work

Use this map to decide which docs govern which code.

| If you touch... | Read and follow... |
| --- | --- |
| API routes, request/response models, auth boundaries | `docs/service-architecture.md`, `docs/api-surface.md`, `docs/api-style-guide.md`, `docs/security-model.md` |
| upload flows, ingest, resumable uploads, canonical commit logic | `README.md`, `docs/architecture.md`, `docs/service-architecture.md`, `docs/technology-profile.md`, `docs/security-model.md` |
| Xet integration, storage adapters, derived-store publication | `docs/architecture.md`, `docs/technology-profile.md`, `docs/repository-layout.md`, `docs/resilience-and-scale-validation.md` |
| Prisma schema, migrations, registry data model | `docs/domain-model.md`, `docs/service-registration-model.md`, `docs/repository-layout.md`, `docs/testing-strategy.md` |
| Temporal workflows, activities, replay, compensation | `docs/architecture.md`, `docs/workflow-extensibility.md`, `docs/testing-strategy.md`, `docs/resilience-and-scale-validation.md` |
| manifests, derivative records, deterministic keys | `docs/architecture.md`, `docs/domain-model.md`, `docs/pipeline-capability-model.md`, `docs/traceability.md`, `docs/adr/0003-deterministic-derivative-keys.md` |
| capabilities, new file types, recipe registration | `docs/pipeline-capability-model.md`, `docs/workflow-extensibility.md`, `docs/workload-and-recipe-matrix.md` |
| observability, logs, traces, metrics, audit events | `docs/observability.md`, `docs/security-model.md`, `docs/traceability.md` |
| deployment, runtime topology, worker pools, scaling | `docs/environment-and-deployment.md`, `docs/service-architecture.md`, `docs/resilience-and-scale-validation.md` |
| operator flows, replay, quarantine, diagnostics | `docs/service-architecture.md`, `docs/security-model.md`, `docs/runbooks/README.md`, `docs/threat-models/README.md` |
| repository structure, module placement, package boundaries | `docs/repository-layout.md`, `docs/engineering.md`, `docs/contributor-guide.md` |

## 4. Upstream reference policy

When using an external package, protocol, or service pattern, the agent must read the upstream docs or repo before coding against it.

Examples:

- **Hono** for HTTP and middleware behavior
- **Prisma** for schema, client, and migrations
- **Temporal** for workflow semantics and testing
- **tus / tusd** for resumable ingest
- **Xet** for canonical versioned raw storage
- **imgproxy / libvips** for image transformation and delivery
- **Gotenberg** for document conversion
- **FFmpeg** for video and media operations

If the implementation relies on upstream behavior, the agent must attach the upstream reference to the change.

## 5. What “documentation attached to code” means

For this repository, “documentation attached to code” is mandatory and means:

### 5.1 For every new source file

Attach:

1. a clear file/module purpose
2. the governing local docs
3. the upstream external references
4. the test location or test evidence

Preferred implementation:

- add a short **reference header comment** at the top of the file when the file owns meaningful logic
- or add an adjacent package/module README if that is cleaner for a group of files

Minimum reference header format:

```ts
/**
 * Purpose: Handles upload-session creation and ingest finalization.
 * Governing docs:
 * - docs/architecture.md
 * - docs/service-architecture.md
 * - docs/api-style-guide.md
 * External references:
 * - https://tus.io/
 * - https://github.com/tus/tusd
 * Tests:
 * - tests/api/upload-sessions.test.ts
 */
```

### 5.2 For every changed module or subsystem

Update or create the nearest supporting documentation:

- module README
- design note
- governing doc section in `docs/`
- traceability or implementation-ledger entry if the change is architecturally meaningful

## 6. TDD workflow

Follow this order unless the task is documentation-only:

1. identify governing docs
2. identify upstream references
3. update docs or contracts if needed
4. write failing tests
5. implement
6. run relevant tests
7. update traceability or implementation ledger if the slice meaning changed

The testing expectations are governed by `docs/testing-strategy.md`.

High-risk areas that must have explicit tests include:

- upload completion idempotency
- replay from Xet
- deterministic derivative keys
- manifest publication integrity
- signed delivery behavior
- workflow retry and failure handling

## 7. Resilient coding rules for agents

Agents are expected to produce code that is resilient, diagnosable, and reviewable by default.

Minimum rules:

1. Make invariants explicit in types, validation, and tests.
2. Validate external input at the first boundary.
3. Do not hide failures behind silent fallbacks or broad catches.
4. Attach enough context to errors and logs for production diagnosis.
5. Bound I/O and remote work with explicit timeouts.
6. Retry only safe/idempotent operations, and do so with bounded backoff.
7. Prefer explicit data flow over ambient mutable state.
8. Keep modules single-purpose and named by domain responsibility.
9. Write tests for failure paths, replay behavior, and idempotency where relevant.
10. Measure hot paths before claiming a performance optimization.
11. Keep structured logs, metrics, and traces in mind while coding operator-relevant paths.
12. Treat cache, queue, and workflow state as supporting state, not business truth, unless the governing docs say otherwise.
13. For mutating APIs, write down the idempotency plan: key scope, duplicate behavior, and durable completion evidence.
14. For database-affecting changes, write down the transaction, isolation, lock, or optimistic-concurrency expectations.
15. For workflow changes, cover replay/versioning behavior and retry semantics in tests.
16. For ingest changes, validate file signature and preserve a quarantine/failure path for suspicious inputs.
17. Use typed API errors aligned with RFC 9457 unless the governing docs define a narrower contract.
18. Do not leave floating promises or undocumented fire-and-forget behavior in the codebase.

These rules are governed in more detail by:

- `docs/regular-programming-practices/resilient-coding-debugging-and-performance.md`
- `docs/testing-strategy.md`
- `docs/observability.md`
- `docs/security-model.md`

## 8. Required change bundle

For every meaningful code change, an agent should leave behind a **change bundle**:

- implementation code
- tests
- documentation updates
- local doc references
- external references

If one of those is missing, the work is probably incomplete.

## 9. Definition of done for agents

An agent is not done when code compiles or tests pass once.

The work is done when:

1. the governing docs are identified and updated if necessary
2. the code has attached documentation and references
3. tests exist at the correct layer
4. the implementation matches the architecture
5. operational implications are reflected where relevant
6. traceability is preserved

## 10. Suggested code-to-doc attachment points

Use this structure as the repository grows:

| Code area | Where references should live |
| --- | --- |
| `apps/api/**` | file header + package README + API docs |
| `apps/workers/**` | file header + workflow/capability docs |
| `apps/operator/**` | file header + runbook/threat-model references |
| `packages/contracts/**` | schema comments + API/SDK docs |
| `packages/registry/**` | file header + domain-model and Prisma references |
| `packages/storage/**` | file header + architecture/technology-profile references |
| `packages/workflows/**` | file header + workflow-extensibility and Temporal references |
| `packages/capabilities/**` | file header + pipeline-capability-model references |
| `packages/manifests/**` | file header + domain-model and deterministic-key references |
| `packages/observability/**` | file header + observability references |
| `packages/auth/**` | file header + security-model references |
| `tests/**` | test docstring comments referencing behavior and governing docs where non-obvious |

## 11. When to update traceability and ledger docs

Update:

- `docs/implementation-ledger.md` when a delivery slice changes meaning or scope
- `docs/traceability.md` when a new major claim or evidence obligation is introduced
- ADRs when a durable architecture decision changes

## 12. Anti-patterns for agents

Do not:

- code from memory when upstream docs matter
- add a package without documenting why it is preferred
- add routes without updating API docs
- add workflow logic without workflow tests
- add storage logic without documenting canonical vs derived responsibilities
- hide core behavior in undocumented utility functions
- claim TDD while writing tests only after implementation
- optimize by folklore instead of measurement on relevant hot paths
- make failures hard to diagnose by stripping context from errors and logs

## 13. Working principle

In CDNgine, code is never “just code.”

Every meaningful implementation artifact must be linked to:

- **why it exists**  
- **which docs govern it**  
- **which upstream behavior it relies on**  
- **which tests prove it**
