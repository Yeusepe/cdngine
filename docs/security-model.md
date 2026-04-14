# Security Model

This document defines the default security posture for CDNgine.

The goal is not only to block obvious attacks, but to preserve tenant isolation, provenance, operator accountability, and safe handling of untrusted binaries.

## 1. Security objectives

The platform should guarantee:

1. tenant- and namespace-scoped authorization
2. strong control over who can upload, reprocess, purge, or retrieve private derivatives
3. safe handling of untrusted binary content
4. auditable operator actions
5. origin isolation between public delivery and privileged internal systems

## 2. Threat surface

The main exposed surfaces are:

- upload-session creation and upload completion APIs
- direct upload targets
- metadata and manifest APIs
- signed derivative delivery URLs
- operator replay and quarantine actions
- worker access to raw and derived stores
- webhook or event callbacks

## 3. Identity and authorization model

Authorization should be explicit at every boundary.

Minimum authorization dimensions:

- tenant or namespace identity
- caller role
- asset ownership or delegated access
- operation type
- asset visibility class

Typical privileged operations that require tighter policy:

- reprocess
- quarantine and release
- purge
- retention override
- manual manifest rewrite
- private asset delivery

## 4. Upload security model

Upload flow requirements:

1. clients request an upload session from the API
2. the API validates asset class, declared content constraints, and tenant policy
3. the API issues a short-lived upload target for the canonical raw asset
4. upload completion is confirmed through a signed or authenticated callback
5. the workflow re-validates the uploaded content using signature sniffing and metadata extraction

Do not trust:

- declared MIME type alone
- filename extension alone
- upload completion as proof of valid content

## 5. Raw and derived storage boundaries

The platform intentionally separates:

- **Oxen** for canonical originals and provenance
- **derived storage** for published generated artifacts

Security implications:

- public delivery traffic should not require direct access to Oxen
- workers should have least-privilege access scoped to the binaries they need
- private origin access should be enforced between processors and storage systems
- CDN-origin access should be limited to the derived store, not the canonical raw store

## 6. Signed delivery model

Private delivery should rely on signed URLs or equivalent capability tokens.

Signed delivery controls should include:

- short expiration
- path binding
- transform-policy binding where relevant
- tenant- or visibility-aware claims
- replay-resistant signature validation

The platform should never expose arbitrary free-form transforms for untrusted callers.

## 7. High-risk file classes

These inputs deserve stricter policy and inspection:

- archives and zip-like packages
- Unity packages
- executable-like binaries
- office and presentation documents
- large PDFs from untrusted sources

Expected controls include:

- content-type and file-signature validation
- archive inventory inspection
- decompression-ratio and zip-bomb protections
- malware scanning
- worker sandboxing
- tighter timeout and memory ceilings

## 8. Worker and processor hardening

Workers should run with:

- least-privilege credentials
- narrowly scoped storage access
- no broad egress by default
- bounded CPU, memory, disk, and time
- isolated scratch space
- explicit logging and audit correlation

Do not let processors become privileged shell environments with broad network reach.

## 9. Secrets and key management

Secrets that need disciplined rotation include:

- signing keys
- storage credentials
- webhook secrets
- database and Temporal credentials
- internal service credentials

Requirements:

- central secret management
- rotation support
- no secret material in source control
- redaction in logs and error payloads

## 10. Audit model

The platform should emit auditable records for:

- upload session issuance
- upload completion
- validation rejection
- workflow start and replay
- quarantine and release
- deletion and purge
- visibility-policy changes
- operator authentication and privileged actions

Audit events should be durable, queryable, and correlated with asset and version identifiers.

## 11. Minimum hardening checklist

Every production deployment should show:

1. authenticated upload-session issuance
2. short-lived presigned upload targets
3. MIME sniffing and signature validation
4. worker least privilege
5. signed private delivery
6. operator-role separation
7. malware scanning for risky file classes
8. audit logging for privileged actions

## 12. References

- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html)
