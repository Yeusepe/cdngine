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

- service namespace identity
- tenant scope where applicable
- caller role
- asset ownership or delegated access
- operation type
- asset visibility class

The preferred model is attribute-based access control:

- **subject** attributes such as role, team, namespace affiliation, and operator status
- **resource** attributes such as service namespace, tenant scope, asset class, visibility, and owner
- **action** such as upload, complete, read, replay, quarantine, or purge
- **environment** such as request surface, network zone, and time-bound delivery claims

This is the preferred posture because standard guidance for modern authorization favors evaluating permissions against resource and request context, not only coarse static roles.

RBAC may still be used for coarse operator roles, but RBAC alone is not expressive enough for the shared-platform scoping model.

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
3. the API issues a short-lived upload target for the ingest-managed upload object
4. upload completion is confirmed through a signed or authenticated callback
5. the ingest service verifies the uploaded object before snapshotting it into the canonical source repository
6. the workflow re-validates the uploaded content using signature sniffing and metadata extraction

Do not trust:

- declared MIME type alone
- filename extension alone
- upload completion as proof of valid content

Upload-session issuance should bind the allowed scope explicitly so a completion request cannot silently shift an upload from one namespace or tenant scope into another.

## 5. Raw and derived storage boundaries

The platform intentionally separates:

- the **canonical source repository** for canonical originals, deduplicated storage, and provenance
- **derived storage** for published generated artifacts

Security implications:

- public delivery traffic should not require direct access to the source repository
- workers should have least-privilege access scoped to the binaries they need
- private origin access should be enforced between processors and storage systems
- CDN-origin access should be limited to the derived store, not the canonical raw store
- raw object keys used beneath the source repository should not be treated as public application-level identifiers

## 6. Signed delivery model

Private delivery should rely on signed URLs or equivalent capability tokens.

Signed delivery controls should include:

- short expiration
- path binding
- transform-policy binding where relevant
- tenant- or visibility-aware claims
- replay-resistant signature validation

The platform should never expose arbitrary free-form transforms for untrusted callers.

Bundle-oriented delivery has different ergonomics than single-file delivery.

Preferred posture:

- use signed URLs for one-off derivative reads when that keeps the client model simple
- use signed cookies or equivalent bundle credentials for HLS manifests plus segments and other bundle-style reads
- bind delivery authorization to delivery scope, visibility, and asset identity

## 6.1 Unauthorized-read posture

Public delivery should be non-disclosing for private assets.

Preferred rule set:

- delivery requests that lack valid authorization for a private asset should normally return `404`
- authenticated control-plane APIs may return `403` when the caller is known and the denial itself is useful
- logging and audit trails must still record the true denial reason internally

This prevents the public delivery path from becoming an easy existence oracle for private assets.

## 6.2 Surface separation

Authorization policy must distinguish:

- public client access
- platform-admin access
- operator access
- internal service-to-service access

Replay, quarantine, purge, namespace registration, and capability governance require elevated internal roles and should not be exposed as broad public-SDK operations.

## 6.3 Delivery scope and organization URL security

Per-organization delivery URLs must be modeled as registered delivery scopes.

Security rules:

- hostnames and path prefixes resolve to a delivery scope but are not authorization truth by themselves
- custom hostnames require explicit certificate and ownership handling in the CDN layer
- cache and signing behavior may differ by delivery scope, but the underlying asset and policy checks stay explicit
- origin access remains private even when organizations use custom domains

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

## 8.1 Registry isolation posture

Application-layer auth is mandatory. Deployments that need stronger database-level isolation may additionally use PostgreSQL row-level security for tenant-scoped records, but RLS is not a substitute for application authorization.

Data access anti-patterns to avoid:

- looking up tenant-aware assets by bare `assetId` alone
- using unscoped cache keys
- allowing namespace policy to be inferred from route names instead of explicit resource attributes

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
- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [NIST SP 800-162: Guide to Attribute Based Access Control (ABAC)](https://csrc.nist.gov/pubs/sp/800/162/upd2/final)
- [PostgreSQL row security policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html)
- [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html)
- [Cloudflare custom hostnames](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/)
- [Amazon CloudFront signed cookies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-signed-cookies.html)
- [Cloudflare Tiered Cache](https://developers.cloudflare.com/cache/how-to/tiered-cache/)
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
