# Threat Model Index

This directory is for focused threat models covering the platform's highest-risk boundaries.

Threat models should be concrete enough that they influence API design, worker isolation, storage policy, and operator controls.

## 1. Required threat-model families

Threat models should exist for:

- upload authorization and direct-upload abuse
- private delivery and signed URL misuse
- workflow replay and operator controls
- package and archive ingestion
- document conversion and untrusted office-file execution
- credential and signing-key exposure

## 2. What every threat model should contain

Every threat model should identify:

1. protected assets and trust boundaries
2. likely attacker actions
3. abuse paths and preconditions
4. preventative controls
5. detective controls
6. operator response expectations

## 3. Expected future threat-model files

Recommended files:

- `upload-authorization.md`
- `private-delivery.md`
- `operator-replay-and-quarantine.md`
- `archive-and-package-ingestion.md`
- `document-conversion.md`

## 4. Relationship to other docs

- security controls should align with `docs/security-model.md`
- observability requirements should align with `docs/observability.md`
- operator response expectations should align with the runbooks

## 5. Read more

- [Security Model](../security-model.md)
- [Observability](../observability.md)
