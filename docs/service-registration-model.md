# Service Registration Model

This document defines how internal domains register with CDNgine.

The point of registration is not only discoverability. It is how the platform keeps multiple adopting services on one coherent asset model without collapsing ownership, tenant isolation, or workflow policy.

## 1. Why registration exists

Different services should not invent different asset schemas or delivery behavior when they all need the same platform.

Registration standardizes:

- service namespace ownership
- tenant-isolation posture
- asset classes
- capability and recipe allowlists
- retention and visibility policy
- workflow bindings
- metadata schema ownership
- authorization scope rules
- scoped storage and cache conventions
- delivery-scope defaults and hostname policy

## 2. Identity rules

The registration model must preserve these distinctions:

- a **service namespace** is an internal adopting domain
- a **tenant scope** is an external customer or isolation boundary inside that namespace
- an **asset owner** is the caller-facing subject used for policy checks

Namespace registration defines how those concepts relate for a domain. It must not collapse them into one ambiguous field.

## 3. Registration contract

Each service namespace should declare:

- namespace ID
- owner
- enabled asset classes
- allowed MIME types
- allowed capabilities
- default recipes
- access policy
- retention profile
- audit and notification contacts
- tenant-isolation mode

Optional but recommended fields:

- delivery visibility default
- delivery-scope mode
- default delivery auth mode
- allowed metadata schema fragments
- workflow override bindings
- namespace-level validation profiles
- default lifecycle policy
- row-level security posture where a deployment uses PostgreSQL RLS
- scoped key-template rules
- quota or rate-limit profile

## 4. Standardized metadata model

The registration model should let multiple services store data in a standardized platform shape even when they have different business concerns.

For example:

- creative services may attach placement, display-mode, or layout metadata
- operations may attach provenance, audit, or retention overrides

The platform should support this by keeping:

- shared required registry fields relational and stable
- namespace-specific structured metadata in governed JSONB fields
- metadata schema versions explicit and code-registered
- hot JSONB query paths backed by deliberate GIN indexes
- policy attributes available for authorization evaluation

This gives multiple services one standardized persistence model without forcing every field into one giant rigid table.

## 5. Code-defined registration

Registrations should live in code and be reviewable. The platform should favor explicit module registration over ad hoc database-only configuration.

Qualities to preserve:

- discoverable code registration
- schema near implementation
- clear ownership
- easy refactoring
- reviewable policy changes

Illustrative shape:

```ts
export const creativeServicesNamespace = registerServiceNamespace({
  namespaceId: 'creative-services',
  owner: 'creative-platform',
  tenantIsolationMode: 'shared-tenant',
  assetClasses: ['image', 'video', 'presentation', 'archive'],
  capabilities: ['image.backwall', 'video.hls', 'presentation.slides'],
  defaultRecipes: ['webp-master', 'thumbnail-medium'],
  keyScopeMode: 'namespace-and-tenant',
  deliveryScopeMode: 'tenant-hostname-allowed',
  defaultDeliveryAuthMode: 'signed-url',
  authorizationModel: 'abac-v1',
  metadataSchemaVersion: 'v1',
});
```

Illustrative namespace metadata contract:

```ts
export const creativeServicesMetadata = defineNamespaceMetadataSchema({
  schemaId: 'creative-services.asset-metadata',
  version: 'v1',
  fields: {
    placementId: 'string',
    campaignId: 'string?',
    displayMode: ['static', 'looping-video', 'presentation'],
  },
});
```

An operations-oriented namespace can use the same platform contracts with different scope policy:

```ts
export const operationsNamespace = registerServiceNamespace({
  namespaceId: 'operations',
  owner: 'operations-platform',
  tenantIsolationMode: 'namespace-only',
  assetClasses: ['document', 'archive', 'image'],
  capabilities: ['document.preview', 'archive.inspect', 'image.thumbnail'],
  defaultRecipes: ['thumbnail-small', 'pdf-preview'],
  keyScopeMode: 'namespace-only',
  deliveryScopeMode: 'shared-domain-path',
  defaultDeliveryAuthMode: 'signed-url',
  authorizationModel: 'abac-v1',
  metadataSchemaVersion: 'v1',
})
```

The point is not to create two unrelated systems. The point is to keep one platform contract while making scope, policy, and metadata differences executable.

## 6. SQL mapping posture

The default registry should use PostgreSQL + JSONB for namespace-specific metadata because it keeps:

- relational joins for core platform entities
- flexible structured metadata per domain
- indexable metadata fields where hot queries demand it

Deployments that need stronger data-plane isolation may additionally use PostgreSQL row-level security, but application-level auth remains mandatory.

## 6.1 Programmatic scope model

Scope should be carried as data, not as a route naming convention alone.

Minimum scope dimensions:

- `serviceNamespaceId`
- `tenantScopeId` where applicable
- `assetClass`
- `visibilityClass`
- `assetOwner`

Every namespace registration should define whether tenant scope is:

- required
- optional
- forbidden

## 6.2 Policy model

The preferred authorization model is ABAC-style policy evaluation over:

- **subject** attributes
- **resource** attributes
- **action** attributes
- **environment** attributes

That gives the platform enough structure to express:

- creative users uploading only creative assets
- operations users uploading operational artifacts
- shared platform operators with broader but auditable access
- private delivery conditions based on resource visibility and caller context

## 6.3 Delivery-scope model

Every namespace registration should define its default delivery posture:

- shared-domain path
- organization subdomain
- custom hostname allowed or forbidden
- public, signed-URL, or signed-cookie default
- stream-bundle behavior for video classes where applicable

This keeps organization-specific URLs and private streaming behavior out of ad hoc route logic.

## 7. Operational rules

1. Namespace registration changes are reviewed like code.
2. Namespace registration should be traceable to tests and docs.
3. Service-owned policy should not be hidden in one-off migration SQL.
4. Shared registry semantics stay platform-owned even when service policies vary.
5. Metadata schema versions should change intentionally and remain tied to namespace registration.
6. Namespace registration should be discoverable from code, not only from database rows.
7. Tenant-isolation posture must be stated explicitly for every namespace.
8. Authorization scope rules must be code-defined and testable for every namespace.
9. Delivery-scope defaults must be code-defined and testable for every namespace.

## 8. References

- [NIST SP 800-162: Guide to Attribute Based Access Control (ABAC)](https://csrc.nist.gov/pubs/sp/800/162/upd2/final)
- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- [Prisma index configuration](https://docs.prisma.io/docs/orm/prisma-schema/data-model/indexes)
- [PostgreSQL row security policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Temporal documentation](https://docs.temporal.io/)
- [Cloudflare custom hostnames](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/)
- [Cloudflare Tiered Cache](https://developers.cloudflare.com/cache/how-to/tiered-cache/)
- [Amazon CloudFront signed cookies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-signed-cookies.html)
