# ADR 0005: Programmatic Scope And Authorization Model

## Status

Accepted

## Context

CDNgine is intended to serve multiple internal domains such as creative services and operations, both of which upload files and consume asset workflows.

If this scoping model is left as prose only, implementation will drift into:

- route-layer checks without matching data-layer isolation
- inconsistent use of namespace and tenant fields
- object lookups by asset ID alone
- storage and cache keys that omit tenant or scope context
- authorization logic that cannot express shared but policy-distinct domains cleanly

Authoritative guidance for this problem space points toward:

- attribute-based access control for policy decisions
- tenant-aware data access checks
- defense in depth with database isolation features where needed

## Decision

Adopt a programmatic scope model with these rules:

1. access decisions are modeled as **ABAC-style** policy evaluation over subject, resource, action, and environment attributes
2. every asset belongs to a **service namespace** and optionally to a **tenant scope**
3. every resource lookup, cache key, and storage key includes scope context, not just a bare resource ID
4. authorization checks are enforced in the data access layer as well as the API layer
5. PostgreSQL row-level security is an optional defense-in-depth layer for deployments that need stronger tenant isolation
6. service namespaces register capabilities, asset classes, lifecycle defaults, and policy bindings in code

## Alternatives considered

### RBAC-only authorization

Rejected because multi-tenant and cross-organizational scenarios become cumbersome when roles are the primary unit of policy.

### API-layer-only tenancy checks

Rejected because object-level authorization failures often appear when lower layers perform lookups without scope context.

### Database-per-domain as the default

Rejected as the default because the platform is explicitly trying to support shared infrastructure with strong logical isolation and portable contracts.

## Consequences

- the architecture should model service namespace, tenant scope, and asset owner separately
- composite scoped lookups become a default rule
- storage prefixes and cache keys must carry scope context
- tests must verify cross-scope denial behavior
- policy registration becomes a first-class code artifact rather than an informal convention

## References

- [NIST SP 800-162: Guide to Attribute Based Access Control (ABAC)](https://csrc.nist.gov/pubs/sp/800/162/upd2/final)
- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- [PostgreSQL row security policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
