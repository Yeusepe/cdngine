# Contract Examples

Place machine-readable examples here for:

- public request and response bodies
- problem-detail payloads
- manifest payloads
- event payloads

Examples should stay aligned with the published schemas and lint/validation pipeline described in `docs/spec-governance.md`.

Convention:

- `*.schema.json` defines the portable JSON Schema
- `*.example.json` is validated against the sibling schema by `npm run contracts:examples`
