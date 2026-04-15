# Contracts

This directory is the home for machine-readable contract artifacts.

Expected families:

- `openapi/` for public, platform-admin, and operator HTTP contracts
- `asyncapi/` for externally relevant events
- `arazzo/` for multi-step workflows
- `examples/` for request, response, manifest, and event examples

Validation and bundling are part of the repository contract now:

1. `npm run contracts:lint`
2. `npm run contracts:bundle`
3. `npm run contracts:examples`
4. `npm run contracts:check`

Generated bundled artifacts are written to `contracts/dist/`.

The governing docs are:

- `docs/api-surface.md`
- `docs/api-style-guide.md`
- `docs/sdk-strategy.md`
- `docs/spec-governance.md`
