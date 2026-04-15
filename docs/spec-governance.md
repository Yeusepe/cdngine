# Spec Governance

This document defines how machine-readable API and workflow contracts are authored, validated, and released.

## 1. Contract families

The repository should publish:

| Family | Purpose | Default location |
| --- | --- | --- |
| OpenAPI | public, platform-admin, and operator HTTP contracts | `contracts/openapi/` |
| AsyncAPI | externally relevant events and subscriptions | `contracts/asyncapi/` |
| Arazzo | multi-step flows such as upload, completion, polling, and manifest retrieval | `contracts/arazzo/` |
| examples | request, response, manifest, and event examples | `contracts/examples/` |

## 2. Governance pipeline

Every contract change should go through:

1. authoring near the owning docs and code
2. bundling of referenced documents
3. linting against structural and governance rules
4. example validation
5. breaking-change review
6. checked-in generated artifacts for supported SDKs

## 3. Tooling posture

Recommended default tooling:

- **Redocly CLI** for OpenAPI and Arazzo linting
- **AsyncAPI CLI** for AsyncAPI validation and bundling

Redocly CLI explicitly supports linting OpenAPI, AsyncAPI, and Arazzo descriptions. AsyncAPI CLI provides `validate`, `bundle`, `diff`, and related commands for AsyncAPI documents.

## 4. Minimum governance rules

### 4.1 OpenAPI

- stable `operationId`
- explicit tags
- examples on public requests and key responses
- all public errors map to stable problem types

### 4.2 AsyncAPI

- event names are stable and versioned deliberately
- message payloads have explicit schema ownership
- producer and consumer ownership is documented

### 4.3 Arazzo

- workflows reference the published OpenAPI descriptions they depend on
- steps represent real supported flows, not aspirational prose only
- workflow examples stay aligned with generated SDK helpers

## 5. Release gates

Before a contract change is considered ready:

1. lint passes for each changed contract family
2. examples match schemas
3. breaking changes are identified explicitly
4. README and docs links still point to the current contract paths
5. supported SDK outputs are regenerated when the public surface changed

## 6. Ownership

| Surface | Default owner |
| --- | --- |
| public OpenAPI | API/service maintainers |
| platform-admin OpenAPI | platform maintainers |
| operator OpenAPI | operator-platform maintainers |
| AsyncAPI | producer team plus platform review |
| Arazzo | API maintainers plus SDK maintainers |

## 7. Read more

- [API Surface](./api-surface.md)
- [API Style Guide](./api-style-guide.md)
- [SDK Strategy](./sdk-strategy.md)
- [Versioning And Compatibility](./versioning-and-compatibility.md)
- [Redocly CLI lint](https://redocly.com/docs/cli/commands/lint/)
- [AsyncAPI CLI usage](https://www.asyncapi.com/docs/tools/cli/usage)
- [Arazzo Specification](https://spec.openapis.org/arazzo/latest.html)
