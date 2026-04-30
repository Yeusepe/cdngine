# Local Platform

This directory contains the **lowest-friction local bring-up** for CDNgine.

The goal is not full production parity. The goal is to let a contributor start the core dependency stack quickly enough to work on APIs, workflows, storage adapters, and contract tooling without manually assembling every service.

## Fast-start stack

The supported fast-start profile currently brings up:

1. PostgreSQL
2. Redis
3. Temporal
4. Temporal UI
5. RustFS as the local S3-compatible store
6. tusd backed by RustFS for resumable uploads
7. Kopia repository server backed by a RustFS bucket and source prefix
8. OCI registry for ORAS-compatible artifact publication tests

This checked-in fast-start stack is the current **migration-era local profile**, not the long-term steady state. The governing docs now make **Xet** the default canonical source engine for new canonicalizations, while this local Kopia service remains available until the runtime rollout and legacy-read migration slices are complete.

This profile intentionally uses **RustFS** for local simplicity even though the broader reference architecture still prefers **SeaweedFS** as the default substrate in fuller environments. When contributors need to exercise tiered placement, filer semantics, or more production-like substrate behavior, the next step is to move from this RustFS profile to a SeaweedFS-backed environment instead of changing the public platform contract.

The current fast-start profile is best described as **single-node + multi-bucket**:

- single-node because the whole stack runs on one local host
- multi-bucket because staging, canonical-source, derived, and export roles use separate buckets by default

If needed, the same local posture can be collapsed into **single-node + single-bucket** by switching to prefixes such as `ingest/`, `source/`, `derived/`, and `exports/`.

## Quickstart

### Cross-platform npm entrypoints

```bash
npm start
```

That command:

1. copies `deploy/local-platform/.env.example` to `deploy/local-platform/.env` if needed
2. starts the local dependency stack with Docker Compose
3. works the same way on Windows, Linux, and macOS

## Local endpoints

| Service | URL |
| --- | --- |
| PostgreSQL | `localhost:5432` |
| Redis | `localhost:6379` |
| Temporal gRPC | `localhost:7233` |
| Temporal UI | `http://localhost:8080` |
| RustFS API | `http://localhost:9000` |
| RustFS console | `http://localhost:9001` |
| tusd | `http://localhost:1080/files/` |
| Kopia server | `http://localhost:51515` |
| OCI registry | `http://localhost:5000` |

## Default local credentials and buckets

The `.env.example` file documents the defaults. The important local values are:

- RustFS access key: `rustfsadmin`
- RustFS secret key: `rustfsadmin`
- staging bucket: `cdngine-staging`
- source bucket: `cdngine-source`
- derived bucket: `cdngine-derived`
- exports bucket: `cdngine-exports`
- legacy Kopia bucket: `cdngine-kopia`
- Kopia repository prefix: `source/`
- application database URL: `postgresql://cdngine:cdngine@localhost:5432/cdngine`

Copy `.env.example` to `.env` before changing any local values. The local `.env` file is ignored by Git.

## App and worker runtime example for the Xet default

The checked-in Compose stack still provisions **Kopia** for the migration lane only. It does **not** spin up a dedicated Xet bridge or sidecar.

Use `deploy/local-platform/runtime.xet-default.env.example` as the checked-in example for application and worker processes that should target the local fast-start stack while treating **Xet** as the default canonical source engine for new canonicalizations.

Important expectations:

- leave `CDNGINE_SOURCE_ENGINE` unset to follow the current default-engine switch to **Xet**
- provide `CDNGINE_XET_COMMAND` plus any optional `CDNGINE_XET_COMMAND_ARGS_JSON`, `CDNGINE_XET_WORKSPACE_PATH`, and `CDNGINE_XET_WORKING_DIRECTORY` values for the command-backed bridge you install locally
- use `CDNGINE_XET_SERVICE_ENDPOINT` only when you intentionally want the service-backed Xet bridge; otherwise keep following the checked-in command-backed local example
- use the checked-in `SOURCE_BUCKET` for Xet-default runtime examples instead of pointing new canonicalizations at the Kopia bucket by habit
- keep the Kopia bucket, prefix, and executable settings available locally only while legacy `repositoryEngine = kopia` rows or rollback rehearsals still matter
- the local readiness default remains `postgres,redis,temporal,tusd,source-repository,oci-registry`; `source-repository` readiness means the Xet bridge command is runnable and the temporary Kopia lane remains reachable when you still depend on it

For migration inventory or backfill rehearsal, use:

```bash
npm run source:migration -- inventory
npm run source:migration -- recanonicalize
```

## One-command variants

Start the stack and the demo together:

```bash
npm run start:demo
```

Start from a clean dependency stack first:

```bash
npm run start:fresh
```

Start the stack and the demo from a clean dependency stack:

```bash
npm run start:demo:fresh
```

Stop the local dependency stack:

```bash
npm run stop
```

## Direct PowerShell and raw Docker Compose

The root npm entrypoints are the default path, but the lower-level commands still exist when needed.

### Windows PowerShell

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy\local-platform\start.ps1
```

To stop it:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy\local-platform\stop.ps1
```

### Raw Docker Compose

```powershell
Copy-Item .\deploy\local-platform\.env.example .\deploy\local-platform\.env
docker compose --env-file .\deploy\local-platform\.env -f .\deploy\local-platform\compose.fast-start.yaml up -d
```

If a contributor or adopter only has one bucket available, the same platform semantics still work by setting `STAGING_BUCKET`, `DERIVED_BUCKET`, `EXPORTS_BUCKET`, and `KOPIA_BUCKET` to the same bucket name and keeping distinct prefixes such as `uploads/`, `source/`, `derived/`, and `exports/`.

## What this stack is for

Use this stack for:

- API development
- workflow and activity development
- local storage-adapter work
- upload and completion-path experimentation
- contract and conformance work that needs real dependencies

This stack is **not** the source of truth for production sizing, hardening, or network layout.

The next step after local fast-start is the checked-in runtime profile surface under `deploy/production/`, which shows how the same logical storage roles and readiness expectations map into one-bucket and multi-bucket deployment inputs without changing the public contract.

## Governing docs

- `README.md`
- `docs/environment-and-deployment.md`
- `docs/upstream-integration-model.md`
- `docs/conformance.md`
- `docs/spec-governance.md`
- `deploy/production/README.md`
