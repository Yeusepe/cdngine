# Repository Layout

This document describes the intended repository structure for an implementation-grade CDNgine codebase.

The goal is to keep ownership obvious, contracts explicit, and cross-cutting concerns shared deliberately rather than hidden in vague utility folders.

## 1. Proposed top-level shape

```text
contracts/
  openapi/
  asyncapi/
  arazzo/
  examples/
apps/
  api/
  workers/
  operator/
packages/
  contracts/
  registry/
  storage/
  workflows/
  capabilities/
  manifests/
  observability/
  auth/
  testing/
docs/
deploy/
tests/
  conformance/
  fixtures/
    assets/
```

## 2. Why this shape

The repository should separate:

- published contract artifacts
- deployable applications
- reusable domain packages
- test harnesses and scenario fixtures
- deployment artifacts
- architecture and operating documentation

This avoids the common failure mode where all business logic, workflow code, storage adapters, and test helpers collapse into one unowned application folder.

## 3. Application boundaries

### `apps/api`

Should own:

- HTTP routes
- auth and idempotency boundaries
- upload-session and metadata APIs
- signed delivery URL generation

### `apps/workers`

Should own:

- processor entrypoints
- workload-pool configuration
- activity implementations

### `apps/operator`

Should own:

- replay
- quarantine
- diagnostics
- administrative workflows

## 4. Package boundaries

Recommended package ownership:

| Package | Responsibility |
| --- | --- |
| `contracts` | code-near schema helpers, generators, and contract-build support |
| `registry` | SQL models, queries, migrations, idempotency state |
| `storage` | canonical source adapters, tiered-store adapters, lazy-read adapters, ORAS helpers, derived-store adapters, signing helpers |
| `workflows` | Temporal workflow definitions and activity contracts |
| `capabilities` | file-type and recipe registration |
| `manifests` | manifest builders, parsers, deterministic publication helpers |
| `observability` | tracing, logging, metric helpers, correlation utilities |
| `auth` | authn/authz helpers, claims handling, policy checks |
| `testing` | fixtures, workflow harnesses, integration helpers |

The top-level `contracts/` directory is where published OpenAPI, AsyncAPI, Arazzo, and example artifacts should live.

## 5. Rules

1. keep SQL out of HTTP route files
2. keep workflow definitions out of generic utility folders
3. keep storage adapters explicit and testable
4. keep contracts versioned and visible
5. keep test fixtures and harnesses reusable
6. keep published contract artifacts separate from code-only helpers

## 6. Anti-patterns to avoid

Avoid:

- one giant `services` folder with no ownership
- catch-all `utils` for business logic
- route handlers directly calling shell tools or storage SDKs
- undocumented cross-package imports
- hiding released contract artifacts inside implementation packages only

## 7. Relationship to docs

The repository layout should map cleanly to the docs set:

- architecture explains the system model
- service architecture explains runtime and module boundaries
- pipeline and workflow docs explain extensibility
- testing and observability docs explain quality and operations expectations
