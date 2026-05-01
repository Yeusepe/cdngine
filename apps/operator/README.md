# Operator App

This app hosts the trusted operator product surface and the audited operator API for replay, quarantine, release, purge, diagnostics, and audit review.

Governing docs:

- `docs/service-architecture.md`
- `docs/security-model.md`
- `docs/runbooks/README.md`
- `docs/threat-models/README.md`

## What the operator surface provides

- a bearer-authenticated operator console for loading a concrete asset version
- diagnostics summaries for lifecycle, workflow, publication, and source replay state
- recent audit history with recorded reasons and evidence references
- recovery forms that require an explicit reason before replay, quarantine, release, or purge can be queued
- the mounted `/v1/operator/*` API for diagnostics and audited recovery automation
