/**
 * Purpose: Verifies that the Better Auth-backed CDNgine auth subsystem resolves bearer tokens into scoped actors and supports in-memory principal provisioning for tests and demos.
 * Governing docs:
 * - docs/security-model.md
 * - docs/service-architecture.md
 * - docs/package-reference.md
 * External references:
 * - https://www.better-auth.com/docs/concepts/session-management
 * - https://www.better-auth.com/docs/plugins/bearer
 * Tests:
 * - packages/auth/test/auth.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBearerHeaders,
  createStaticServiceAccountAuthenticator,
  createStaticServiceAccountAuthenticatorFromEnvironment,
  createRequestActorAuthenticator,
  extractBearerToken,
  hashBearerTokenForServiceAccount,
  loadStaticServiceAccountRuntimeConfigFromEnvironment,
  createInMemoryCDNgineAuth
} from '../dist/index.js';

test('createInMemoryCDNgineAuth provisions principals and resolves bearer sessions into scoped actors', async () => {
  const auth = createInMemoryCDNgineAuth();
  const principal = await auth.provisionPrincipal({
    allowedServiceNamespaces: ['media-platform'],
    allowedTenantIds: ['tenant-acme'],
    email: 'tenant-acme@example.com',
    roles: ['public-user'],
    subject: 'customer-acme-demo'
  });

  const actor = await auth.authenticateHeaders(buildBearerHeaders(principal.token));

  assert.deepEqual(actor, {
    allowedServiceNamespaces: ['media-platform'],
    allowedTenantIds: ['tenant-acme'],
    roles: ['public-user'],
    subject: 'customer-acme-demo'
  });
});

test('createInMemoryCDNgineAuth returns null for invalid bearer tokens', async () => {
  const auth = createInMemoryCDNgineAuth();
  const actor = await auth.authenticateHeaders(buildBearerHeaders('invalid-token'));

  assert.equal(actor, null);
});

test('createRequestActorAuthenticator lets hosts plug in any bearer-token validator', async () => {
  const auth = createRequestActorAuthenticator(async (headers) => {
    const token = extractBearerToken(headers);

    if (token !== 'custom-jwt-token') {
      return null;
    }

    return {
      allowedServiceNamespaces: ['media-platform'],
      allowedTenantIds: ['tenant-acme'],
      roles: ['public-user'],
      subject: 'customer-acme-demo'
    };
  });

  const actor = await auth.authenticateHeaders(
    new Headers({
      Authorization: 'Bearer custom-jwt-token'
    })
  );

  assert.deepEqual(actor, {
    allowedServiceNamespaces: ['media-platform'],
    allowedTenantIds: ['tenant-acme'],
    roles: ['public-user'],
    subject: 'customer-acme-demo'
  });
  assert.equal(await auth.authenticateHeaders(buildBearerHeaders('different-token')), null);
});

test('createStaticServiceAccountAuthenticator resolves hashed service-account bearer tokens into scoped actors', async () => {
  const serviceToken = 'creator-assistant-prod-token';
  const auth = createStaticServiceAccountAuthenticator([
    {
      allowedServiceNamespaces: ['yucp-backstage'],
      allowedTenantIds: ['tenant-prod'],
      roles: ['public-user'],
      subject: 'creator-assistant-api',
      tokenSha256: hashBearerTokenForServiceAccount(serviceToken)
    }
  ]);

  const actor = await auth.authenticateHeaders(buildBearerHeaders(serviceToken));

  assert.deepEqual(actor, {
    allowedServiceNamespaces: ['yucp-backstage'],
    allowedTenantIds: ['tenant-prod'],
    roles: ['public-user'],
    subject: 'creator-assistant-api'
  });
  assert.equal(await auth.authenticateHeaders(buildBearerHeaders('wrong-token')), null);
  assert.equal(await auth.authenticateHeaders(new Headers()), null);
});

test('createStaticServiceAccountAuthenticator rejects malformed service-account configuration', () => {
  assert.throws(
    () =>
      createStaticServiceAccountAuthenticator([
        {
          roles: ['public-user'],
          subject: 'creator-assistant-api',
          tokenSha256: 'not-a-sha256'
        }
      ]),
    /tokenSha256/
  );
});

test('createStaticServiceAccountAuthenticator rejects duplicate service-account token hashes', () => {
  const tokenSha256 = hashBearerTokenForServiceAccount('shared-service-token');

  assert.throws(
    () =>
      createStaticServiceAccountAuthenticator([
        {
          subject: 'creator-assistant-api',
          tokenSha256
        },
        {
          subject: 'another-caller',
          tokenSha256
        }
      ]),
    /duplicate tokenSha256/
  );
});

test('createStaticServiceAccountAuthenticatorFromEnvironment parses service-account scope configuration', async () => {
  const serviceToken = 'environment-service-token';
  const auth = createStaticServiceAccountAuthenticatorFromEnvironment({
    CDNGINE_SERVICE_ACCOUNT_TOKENS_JSON: JSON.stringify([
      {
        allowedServiceNamespaces: ['media-platform'],
        roles: ['public-user'],
        subject: 'creator-assistant-api',
        tokenSha256: hashBearerTokenForServiceAccount(serviceToken)
      }
    ])
  });

  assert.deepEqual(await auth.authenticateHeaders(buildBearerHeaders(serviceToken)), {
    allowedServiceNamespaces: ['media-platform'],
    allowedTenantIds: [],
    roles: ['public-user'],
    subject: 'creator-assistant-api'
  });
});

test('createStaticServiceAccountAuthenticatorFromEnvironment accepts single service-account env keys for CLI wiring', async () => {
  const serviceToken = 'cli-friendly-service-token';
  const auth = createStaticServiceAccountAuthenticatorFromEnvironment({
    CDNGINE_SERVICE_ACCOUNT_ALLOWED_SERVICE_NAMESPACES: 'yucp-backstage',
    CDNGINE_SERVICE_ACCOUNT_ROLES: 'public-user',
    CDNGINE_SERVICE_ACCOUNT_SUBJECT: 'creator-assistant-api',
    CDNGINE_SERVICE_ACCOUNT_TOKEN_SHA256: hashBearerTokenForServiceAccount(serviceToken)
  });

  assert.deepEqual(await auth.authenticateHeaders(buildBearerHeaders(serviceToken)), {
    allowedServiceNamespaces: ['yucp-backstage'],
    allowedTenantIds: [],
    roles: ['public-user'],
    subject: 'creator-assistant-api'
  });
});

test('loadStaticServiceAccountRuntimeConfigFromEnvironment rejects malformed single service-account token digests', () => {
  assert.throws(
    () =>
      loadStaticServiceAccountRuntimeConfigFromEnvironment({
        CDNGINE_SERVICE_ACCOUNT_SUBJECT: 'creator-assistant-api',
        CDNGINE_SERVICE_ACCOUNT_TOKEN_SHA256: 'not-a-sha256'
      }),
    /tokenSha256/
  );
});

test('extractBearerToken ignores missing or non-bearer authorization values', () => {
  assert.equal(extractBearerToken(new Headers()), null);
  assert.equal(extractBearerToken(new Headers({ authorization: 'Basic abc123' })), null);
  assert.equal(extractBearerToken(new Headers({ authorization: 'bearer token-123' })), 'token-123');
});

test('provisioned scope updates are reflected on later session reads', async () => {
  const auth = createInMemoryCDNgineAuth();
  const first = await auth.provisionPrincipal({
    allowedServiceNamespaces: ['media-platform'],
    email: 'operator@example.com',
    roles: ['operator'],
    subject: 'operator_123'
  });

  await auth.provisionPrincipal({
    allowedServiceNamespaces: ['media-platform', 'creative-services'],
    allowedTenantIds: ['tenant-beta'],
    email: 'operator@example.com',
    roles: ['operator', 'platform-admin'],
    subject: 'operator_123'
  });

  const actor = await auth.authenticateHeaders(buildBearerHeaders(first.token));

  assert.deepEqual(actor, {
    allowedServiceNamespaces: ['media-platform', 'creative-services'],
    allowedTenantIds: ['tenant-beta'],
    roles: ['operator', 'platform-admin'],
    subject: 'operator_123'
  });
});
