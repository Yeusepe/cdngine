# Service Registration Model

This document explains how multiple internal domains register with CDNgine.

## 1. Why registration exists

Different services should not invent different asset schemas or delivery behavior when they all need the same platform.

Registration standardizes:

- namespace ownership
- asset classes
- recipe allowlists
- retention and visibility
- workflow bindings

## 2. Registration contract

Each service namespace should declare:

- namespace ID
- owner
- enabled asset classes
- allowed MIME types
- default recipes
- access policy
- retention profile
- audit and notification contacts

Optional but recommended fields:

- delivery visibility default
- allowed metadata schema fragments
- workflow override bindings
- namespace-level validation profiles
- default lifecycle policy

## 2.1 Standardized metadata model

The registration model should let multiple services store data in a standardized platform shape even when they have different business concerns.

For example:

- creative services may attach placement, display-mode, or layout metadata
- operations may attach provenance, audit, or retention overrides

The platform should support this by keeping:

- shared required registry fields relational and stable
- namespace-specific structured metadata in governed JSONB fields by default
- schema versions explicit and code-registered

This gives multiple services one standardized persistence model without forcing every field into one giant rigid table.

## 3. Code-defined registration

Registrations should live in code and be reviewable. The platform should favor explicit module registration over ad hoc database-only configuration.

Qualities to preserve:

- discoverable code registration
- schema near implementation
- clear ownership
- easy refactoring

Illustrative shape:

```ts
export const creativeServicesNamespace = registerServiceNamespace({
  namespaceId: 'creative-services',
  owner: 'creative-platform',
  assetClasses: ['image', 'video', 'presentation', 'archive'],
  defaultRecipes: ['webp-master', 'thumbnail-medium'],
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

## 4. SQL mapping posture

The default registry should use PostgreSQL + JSONB for namespace-specific metadata because it keeps:

- relational joins for core platform entities
- flexible structured metadata per domain
- indexable metadata fields where hot queries demand it

Bring-your-own SQL is acceptable if the same platform contract can be represented without losing traceability, queryability, or schema-version discipline.

## 5. Operational rules

1. Namespace registration changes are reviewed like code.
2. Namespace registration should be traceable to tests and docs.
3. Service-owned policy should not be hidden in one-off migration SQL.
4. Shared registry semantics stay platform-owned even when service policies vary.
5. Metadata schema versions should change intentionally and remain tied to namespace registration.
6. Namespace registration should be discoverable from code, not only from database rows.

## 6. References

- [PostgreSQL JSON types](https://www.postgresql.org/docs/current/datatype-json.html)
- [PostgreSQL GIN indexes](https://www.postgresql.org/docs/current/gin.html)
- [Temporal documentation](https://docs.temporal.io/)

