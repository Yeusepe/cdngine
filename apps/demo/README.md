# Public Upload Client

This workspace hosts the CDNgine public product client for authenticated, multi-tenant uploads and public-read inspection.

Its local runtime assembles the production public routes with one shared backing state for:

- `POST /v1/upload-sessions`
- `PATCH /uploads/*`
- `POST /v1/upload-sessions/{uploadSessionId}/complete`
- `GET /v1/assets/{assetId}/versions/{versionId}`
- `POST /v1/assets/{assetId}/versions/{versionId}/source/authorize`
- `GET /uploads/*`

Governing docs:

- `docs/repository-layout.md`
- `docs/api-surface.md`
- `docs/service-architecture.md`
- `docs/testing-strategy.md`

## Start the local client

1. Install dependencies:
   `npm install`
2. Optional: copy `apps/demo/.env.example` to `apps/demo/.env` and override any local storage buckets you want to pin.
3. Start the full local experience:
   `npm run start:demo`
4. Open:
   `http://localhost:5173`

If you only want the Vite app without booting the dependency stack first, use:

1. Install dependencies:
   `npm install`
2. Optional: copy `apps/demo/.env.example` to `apps/demo/.env` and override any local storage buckets you want to pin.
3. Start only the client workspace:
   `npm run demo:start`
4. Open:
   `http://localhost:5173`

The Vite app proxies `/v1` and `/uploads` to the local public runtime on `http://localhost:4000`, so the browser exercises the same upload-session and version-read contract that the public SDK uses.
When `apps/demo/scripts/start-public-runtime.mjs` starts that runtime, it persists upload-session metadata under `.cdngine-public-runtime` by default. Override that location with `CDNGINE_PUBLIC_RUNTIME_STATE_DIR`, or delete the directory when you intentionally want a clean local CDNgine state. This keeps local restart behavior aligned with the production contract that persisted asset/version records must remain resolvable after a process restart.
Artifact bytes do not have to live in that local state directory. Set `CDNGINE_PUBLIC_RUNTIME_STORAGE=object-store` and provide RustFS/S3 envs to put staged source bytes in the ingest bucket while keeping only local runtime metadata on disk. The runtime accepts `RUSTFS_ENDPOINT` or `CDNGINE_S3_ENDPOINT`, `CDNGINE_INGEST_BUCKET` or `CDNGINE_STORAGE_BUCKET` or `STAGING_BUCKET`, optional `CDNGINE_INGEST_PREFIX`, `AWS_REGION`, and either `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` or `RUSTFS_ACCESS_KEY`/`RUSTFS_SECRET_KEY`.
These commands are shell-agnostic and work on Linux, macOS, and Windows.
The generated local principals are issued through the in-memory Better Auth adapter that ships with `@cdngine/auth`, so the page and usage examples reflect the repository's default bearer-token integration rather than custom scope headers.

## Build and preview

1. Build:
   `npm run demo:build`
2. Preview the production build:
   `npm run demo:preview`

## Local environment variables

| Variable | Purpose | Default when unset |
| --- | --- | --- |
| `CDNGINE_DEMO_BUCKET_PREFIX` | Prefix used when the local stack auto-creates its own bucket names | `cdngine-demo` |
| `CDNGINE_DEMO_API_BASE_URL` | Base URL used in the generated API and SDK usage examples | `https://api.cdngine.local` |
| `CDNGINE_DEMO_URL` | URL shown in the client UI for the Vite app itself | `http://localhost:5173` |
| `CDNGINE_DEMO_INGEST_BUCKET` | Bucket/prefix root used for resumable upload staging | `${CDNGINE_DEMO_BUCKET_PREFIX}-ingest` |
| `CDNGINE_DEMO_SOURCE_BUCKET` | Bucket/prefix root used for canonical source storage | `${CDNGINE_DEMO_BUCKET_PREFIX}-source` |
| `CDNGINE_DEMO_DERIVED_BUCKET` | Bucket/prefix root used for derived delivery objects | `${CDNGINE_DEMO_BUCKET_PREFIX}-derived` |
| `CDNGINE_DEMO_EXPORTS_BUCKET` | Bucket/prefix root used for original-source export objects | `${CDNGINE_DEMO_BUCKET_PREFIX}-exports` |
| `CDNGINE_PUBLIC_RUNTIME_STATE_DIR` | File-backed state directory for local public runtime upload-session records | `.cdngine-public-runtime` |
| `CDNGINE_PUBLIC_RUNTIME_STORAGE` | Runtime artifact-byte storage mode. Use `object-store` for RustFS/S3-backed staged bytes, `local-files` for the fallback file store, or `auto` to use object storage when enough env is present | `auto` behavior |
| `RUSTFS_ENDPOINT` / `CDNGINE_S3_ENDPOINT` | S3-compatible endpoint used by object-store runtime mode | unset |
| `CDNGINE_INGEST_BUCKET` / `CDNGINE_STORAGE_BUCKET` / `STAGING_BUCKET` | Ingest bucket used by object-store runtime mode | unset |
| `CDNGINE_INGEST_PREFIX` / `TUSD_OBJECT_PREFIX` | Ingest object prefix used by object-store runtime mode | `uploads` |

If you do not configure any storage buckets, the local stack generates its own bucket names automatically from `CDNGINE_DEMO_BUCKET_PREFIX`. If you provide some but not all bucket envs, the remaining ones still fall back to generated local names.

## What the client now shows

- configurable public upload scope inputs for `serviceNamespaceId`, `assetOwner`, and optional `tenantId`
- the production upload lifecycle: issue session, PATCH upload target, complete session, and read the version
- a version explorer that calls the public SDK methods for version reads, source authorization, manifest reads, derivative listing, and delivery authorization
- raw API examples using generic bearer tokens against the public contract directly
- SDK examples using `createCDNgineClient`, `client.withDefaults(...)`, `scopedClient.upload(...)`, `client.assets.get(...)`, and fluent `asset(...).version(...).delivery(...).authorize(...)` helpers
