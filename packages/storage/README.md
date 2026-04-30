# Storage Package

This package is for canonical source-repository adapters, tiered-store and lazy-read adapters, ORAS publication helpers, derived-store adapters, and signing helpers.

The intended adapter boundaries are:

- S3-compatible clients for SeaweedFS staging and derived storage
- internal HTTP clients for SeaweedFS filer operations when needed
- controlled Xet adapters that canonicalize through a controlled command or service boundary, persist engine-neutral reconstruction evidence, and materialize from canonical identity plus registry evidence for replay
- controlled Kopia CLI and repository-server wrappers kept only for legacy-read migration and backfill support
- controlled ORAS CLI wrappers for artifact publication
- runtime or sidecar control for Nydus and optional Alluxio paths

Runtime source-repository selection:

- `createSourceRepositoryFromEnvironment(...)` resolves `CDNGINE_SOURCE_ENGINE` with **Xet** as the default engine when absent
- Xet runtime inputs stay behind typed config for command or service rollout knobs: `CDNGINE_XET_COMMAND`, `CDNGINE_XET_COMMAND_ARGS_JSON`, `CDNGINE_XET_SERVICE_ENDPOINT`, `CDNGINE_XET_AUTH_TOKEN`, `CDNGINE_XET_WORKSPACE_PATH`, `CDNGINE_XET_WORKING_DIRECTORY`, `CDNGINE_XET_TIMEOUT_MS`
- Xet command-backed and service-backed runtime selection now share the same adapter contract, explicit timeout handling, and typed bridge errors
- Kopia remains available for the migration lane through `CDNGINE_SOURCE_ENGINE=kopia` plus `CDNGINE_KOPIA_EXECUTABLE`, `CDNGINE_KOPIA_WORKING_DIRECTORY`, and `CDNGINE_KOPIA_TIMEOUT_MS`

Benchmark proof commands:

- `npm run benchmark:source-plane-proof` runs a deterministic near-duplicate binary workload through the default-target Xet command boundary and prints stored-byte savings plus restore verification
- `npm run benchmark:source-plane-proof:kopia` runs the same workload through a real local Kopia filesystem repository and reports repo-growth-based stored-byte savings plus restore verification
- `npm run benchmark:source-plane-compare` runs both proof paths and prints the measured differences for rollout regression and migration validation
- `scripts/xet-benchmark.js` and `scripts/xet-restore.js` provide the real command targets used by the experimental Xet adapter and the proof workload

Governing docs:

- `docs/canonical-source-and-tiering-contract.md`
- `docs/upstream-integration-model.md`
- `docs/architecture.md`
- `docs/technology-profile.md`
