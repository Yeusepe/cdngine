# Demo App

This workspace renders a generated CDNgine flow for authenticated, multi-tenant uploads and downloads.

The current demo also includes:

- a normal storage-tiering profile and an accelerated cold-restore profile for architecture walkthroughs
- per-request architectural traces that show which components are hit during publish, hot delivery, cold delivery, and source export
- comparative performance metrics for hot versus cold behavior

Governing docs:

- `docs/repository-layout.md`
- `docs/api-surface.md`
- `docs/service-architecture.md`
- `docs/testing-strategy.md`

## Start the demo

1. Install dependencies:
   `npm install`
2. Optional: copy `apps/demo/.env.example` to `apps/demo/.env` and override any demo storage buckets you want to pin.
3. Start the full local experience:
   `npm run start:demo`
4. Open:
   `http://localhost:5173`

If you only want the Vite app without booting the dependency stack first, use:

1. Install dependencies:
   `npm install`
2. Optional: copy `apps/demo/.env.example` to `apps/demo/.env` and override any demo storage buckets you want to pin.
3. Start only the demo workspace:
   `npm run demo:start`
4. Open:
   `http://localhost:5173`

The dev and build flows regenerate the scenario JSON before Vite starts, so the page always reflects the current generated demo state.
These commands are shell-agnostic and work on Linux, macOS, and Windows.
The generated demo principals are issued through the in-memory Better Auth adapter that ships with `@cdngine/auth`, so the page and usage examples reflect the repository's default bearer-token integration rather than custom scope headers.

## Build and preview

1. Build:
   `npm run demo:build`
2. Preview the production build:
   `npm run demo:preview`

## Demo environment variables

| Variable | Purpose | Default when unset |
| --- | --- | --- |
| `CDNGINE_DEMO_BUCKET_PREFIX` | Prefix used when the demo auto-creates its own bucket names | `cdngine-demo` |
| `CDNGINE_DEMO_API_BASE_URL` | Base URL used in the generated API and SDK usage examples | `https://api.cdngine.local` |
| `CDNGINE_DEMO_URL` | URL shown in the demo UI for the Vite app itself | `http://localhost:5173` |
| `CDNGINE_DEMO_INGEST_BUCKET` | Bucket/prefix root used for resumable upload staging | `${CDNGINE_DEMO_BUCKET_PREFIX}-ingest` |
| `CDNGINE_DEMO_SOURCE_BUCKET` | Bucket/prefix root used for canonical source storage | `${CDNGINE_DEMO_BUCKET_PREFIX}-source` |
| `CDNGINE_DEMO_DERIVED_BUCKET` | Bucket/prefix root used for derived delivery objects | `${CDNGINE_DEMO_BUCKET_PREFIX}-derived` |
| `CDNGINE_DEMO_EXPORTS_BUCKET` | Bucket/prefix root used for original-source export objects | `${CDNGINE_DEMO_BUCKET_PREFIX}-exports` |

If you do not configure any storage buckets, the demo generates its own demo bucket names automatically from `CDNGINE_DEMO_BUCKET_PREFIX`. If you provide some but not all bucket envs, the remaining ones still fall back to generated demo names.

## What the demo now shows

- architecture walkthroughs for hot delivery, cold delivery, source export, and publication
- raw API examples using generic bearer tokens against the public contract directly
- SDK examples using `createCDNgineClient`, `client.withDefaults(...)`, `scopedClient.upload(...)`, `client.assets.get(...)`, and fluent `asset(...).version(...).delivery(...).authorize(...)` helpers
