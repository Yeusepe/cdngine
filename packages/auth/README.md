# Auth Package

`@cdngine/auth` defines CDNgine's auth integration contract and ships the repository's default adapters.

It owns:

- `AuthenticatedActor` and `RequestActorAuthenticator`
- bearer-token header helpers and extractor utilities
- server-side mapping from a validated identity or session into CDNgine actor scope
- the repository's default Better Auth adapter
- an in-memory fixture for tests and the demo

Primary exports:

- `createRequestActorAuthenticator(...)` for any custom bearer-token or session resolver
- `extractBearerToken(...)` for custom integrations that need the raw bearer token
- `buildBearerHeaders(...)` for callers that need a request header helper
- `createCDNgineAuth(...)` and `createBetterAuthAuthenticator(...)` for runtime integration with the default Better Auth adapter
- `loadBetterAuthRuntimeConfigFromEnvironment(...)` and `createCDNgineAuthFromEnvironment(...)` for deployment-managed Better Auth bootstrapping
- `createInMemoryCDNgineAuth(...)` and `createInMemoryBetterAuthAuthenticator(...)` for tests and the demo scenario generator

CDNgine does **not** require Better Auth specifically. The public API only requires a `RequestActorAuthenticator` that can:

1. validate the caller's bearer token or session
2. resolve a CDNgine actor subject
3. map roles, allowed service namespaces, and allowed tenant IDs server-side

Example custom integration:

```ts
import { createRequestActorAuthenticator, extractBearerToken } from '@cdngine/auth';

const authenticator = createRequestActorAuthenticator(async (headers) => {
  const token = extractBearerToken(headers);
  if (!token) {
    return null;
  }

  const claims = await verifyYourJwtOrSession(token);

  return {
    subject: claims.sub,
    roles: claims.roles ?? [],
    allowedServiceNamespaces: claims.cdngine?.serviceNamespaces ?? [],
    allowedTenantIds: claims.cdngine?.tenantIds ?? []
  };
});
```

Use the Better Auth adapter when it fits your host application. Use `createRequestActorAuthenticator(...)` when your host already standardizes on another provider, JWT verifier, gateway, or session system.

Governing docs:

- `docs/security-model.md`
- `docs/service-architecture.md`
- `docs/package-reference.md`
- `docs/problem-types.md`
