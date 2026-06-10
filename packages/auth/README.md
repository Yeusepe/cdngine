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
- `hashBearerTokenForServiceAccount(...)`, `createStaticServiceAccountAuthenticator(...)`, and `createStaticServiceAccountAuthenticatorFromEnvironment(...)` for deployment-managed service-account tokens stored as SHA-256 digests
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

Service-to-service deployments that do not need interactive Better Auth sessions can use static service accounts. Generate a high-entropy token, store the raw token only in the calling service's secret manager, and store only its SHA-256 digest plus server-side scopes in the CDNgine runtime:

```bash
node -e "const { createHash, randomBytes } = require('node:crypto'); const token = randomBytes(32).toString('base64url'); console.log('raw token for caller:', token); console.log('CDNgine tokenSha256:', createHash('sha256').update(token, 'utf8').digest('hex'));"
```

`CDNGINE_SERVICE_ACCOUNT_TOKENS_JSON` expects an array like:

```json
[
  {
    "subject": "creator-assistant-api",
    "tokenSha256": "<64-character-sha256-hex>",
    "roles": ["public-user"],
    "allowedServiceNamespaces": ["yucp-backstage"],
    "allowedTenantIds": []
  }
]
```

For a single service account, deployments may use CLI-friendly variables instead:

```bash
CDNGINE_SERVICE_ACCOUNT_SUBJECT=creator-assistant-api
CDNGINE_SERVICE_ACCOUNT_TOKEN_SHA256=<64-character-sha256-hex>
CDNGINE_SERVICE_ACCOUNT_ROLES=public-user
CDNGINE_SERVICE_ACCOUNT_ALLOWED_SERVICE_NAMESPACES=yucp-backstage
```

The raw token should never be copied into `CDNGINE_SERVICE_ACCOUNT_TOKENS_JSON` and should never be logged.

Governing docs:

- `docs/security-model.md`
- `docs/service-architecture.md`
- `docs/package-reference.md`
- `docs/problem-types.md`
