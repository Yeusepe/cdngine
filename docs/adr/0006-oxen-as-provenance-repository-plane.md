# ADR 0006: Oxen As Provenance Repository Plane

## Status

Accepted

## Context

The earlier architecture used Oxen primarily as the canonical raw store after ingest finalization.

That was directionally correct, but too narrow. Official Oxen capabilities include:

- repository and branch semantics on `oxen-server`
- remote repository access without full local download
- server-side workspaces for staging and committing changes
- file and schema metadata attached to versioned content
- diff and query capabilities over versioned datasets

If CDNgine treats Oxen only as an immutable blob sink, it leaves version-control, workspace, and provenance features underused.

## Decision

Treat Oxen as the **provenance repository plane**, not just as a blob store.

That means:

1. every canonical source version is committed into an Oxen repository with a durable commit reference
2. repository topology should align with programmatic scope, typically one repository per service namespace, with stronger tenant isolation allowed through dedicated repositories where policy requires it
3. trusted server-side imports, bulk ingest, replay preparation, and operator review flows may use Oxen workspaces directly
4. CDNgine should persist Oxen commit IDs, repository identity, and canonical file paths in the registry
5. source-side immutable evidence such as ingest manifests, inspection outputs, or selected normalization metadata may be committed to Oxen alongside the canonical asset when that evidence should replay with the source history
6. PostgreSQL remains the control-plane system of record for authorization, workflow state, publication state, and operator actions
7. the derived store remains the hot delivery origin for published artifacts

## Alternatives considered

### Oxen as raw blob storage only

Rejected because it underuses workspace, commit, metadata, and remote-repository capabilities that are directly relevant to provenance and replay.

### Oxen as the default public browser upload endpoint

Rejected as the default because browser and SDK ingest still benefit from resumable tus semantics and object-storage-backed upload ergonomics.

### Put all control-plane state into Oxen

Rejected because workflow state, authorization checks, delivery lookup state, and idempotency evidence still fit PostgreSQL and Temporal better.

## Consequences

- Oxen repository topology becomes an explicit part of the architecture
- namespace and tenant isolation rules must define how they map into Oxen repositories and paths
- replay should prefer Oxen commit identity, not only an abstract source pointer
- selected immutable evidence can live with the source history in Oxen instead of being stored only in SQL
- trusted internal flows can use direct Oxen workspace APIs while public ingest still defaults to `API -> tusd/object storage -> completion -> Oxen commit`

## References

- [Oxen Repository API](https://docs.oxen.ai/http-api)
- [Oxen Workspaces](https://docs.oxen.ai/concepts/workspaces)
- [Oxen Remote Repositories](https://docs.oxen.ai/concepts/remote-repos)
- [Oxen File Metadata](https://docs.oxen.ai/concepts/file_metadata)
- [Oxen Server](https://docs.oxen.ai/getting-started/oxen-server)
