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
7. Kopia repository server backed by a RustFS bucket
8. OCI registry for ORAS-compatible artifact publication tests

This profile intentionally uses **RustFS** for local simplicity even though the broader reference architecture still prefers **SeaweedFS** as the default substrate in fuller environments.

## Quickstart

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
- derived bucket: `cdngine-derived`
- Kopia bucket: `cdngine-kopia`
- application database URL: `postgresql://cdngine:cdngine@localhost:5432/cdngine`

Copy `.env.example` to `.env` before changing any local values. The local `.env` file is ignored by Git.

## What this stack is for

Use this stack for:

- API development
- workflow and activity development
- local storage-adapter work
- upload and completion-path experimentation
- contract and conformance work that needs real dependencies

This stack is **not** the source of truth for production sizing, hardening, or network layout.

## Governing docs

- `README.md`
- `docs/environment-and-deployment.md`
- `docs/upstream-integration-model.md`
- `docs/conformance.md`
- `docs/spec-governance.md`
