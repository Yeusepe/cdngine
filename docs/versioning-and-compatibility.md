# Versioning And Compatibility

This document defines how CDNgine evolves API, workflow, manifest, and SDK contracts without breaking adopters or running workflows.

## 1. Compatibility domains

CDNgine has multiple versioned surfaces:

| Surface | Compatibility concern |
| --- | --- |
| public OpenAPI | external client and SDK breakage |
| platform-admin and operator OpenAPI | internal tooling and operational breakage |
| AsyncAPI | consumer event breakage |
| Arazzo | SDK workflow-helper drift |
| manifest schemas | published delivery interpretation |
| capability and recipe registrations | processor and workflow expansion behavior |
| workflow and activity code | replay safety and worker rollout safety |
| generated SDKs | checked-in client and helper drift |

## 2. Public API rules

Public API changes should be:

- additive by default
- version-prefixed at the path level
- stable in `operationId`
- accompanied by updated examples and problem types

Breaking public API changes require:

1. a new versioned contract or explicitly documented deprecation plan
2. SDK regeneration
3. updated Arazzo workflows where affected
4. release notes and migration guidance

## 3. Manifest and schema rules

Manifest formats carry explicit schema versions.

Change categories:

- additive fields: allowed when consumers can ignore them safely
- semantic reinterpretation: breaking
- required-field addition: breaking
- enum narrowing: breaking unless gated by a new schema version

Published manifests should preserve prior schema versions long enough for existing readers to upgrade.

## 4. Capability and recipe rules

Capability IDs and recipe IDs are stable identifiers.

Rules:

1. do not silently repurpose an existing ID
2. version the schema or template when semantics change materially
3. document rollout consequences for deterministic keys and manifests

## 5. Workflow-code deployment policy

Workflow-code compatibility follows Temporal safe-deployment guidance.

Default posture:

- prefer Worker Versioning for production workflow-code rollout
- use replay tests before shipping workflow changes
- use patching only as a fallback while versioned worker deployment posture is not yet available

Workflow types should declare whether they are:

- **Pinned**: execution stays on the worker deployment version where it started
- **Auto-Upgrade**: execution may move to a target deployment version and therefore must remain replay-safe

## 6. Activity and task-queue rules

Activity and workflow registrations should change deliberately.

Rules:

1. changing a task queue, workflow template, or activity signature requires rollout notes
2. worker-pool separation by workload is a compatibility boundary, not just a scaling choice
3. operator-facing message names and meanings must remain stable or versioned

## 7. Generated SDK rules

SDK generation requires:

- stable `operationId`s
- checked-in generated artifacts for supported SDKs
- version-aligned examples
- problem-type stability

If a spec change makes generated method names or common-flow helpers worse, it is a compatibility issue even if the wire format still works.

## 8. Release evidence

Any meaningful compatibility change should leave behind:

1. updated spec artifacts
2. updated examples
3. replay evidence for workflow changes
4. updated conformance scenarios where affected
5. migration notes where the change is not purely additive

## 9. Read more

- [API Surface](./api-surface.md)
- [API Style Guide](./api-style-guide.md)
- [SDK Strategy](./sdk-strategy.md)
- [Workflow Extensibility](./workflow-extensibility.md)
- [Spec Governance](./spec-governance.md)
- [Temporal Worker Versioning](https://docs.temporal.io/production-deployment/worker-deployments/worker-versioning)
- [Temporal safe deployments](https://docs.temporal.io/develop/safe-deployments)
- [Semantic Versioning](https://semver.org/)
