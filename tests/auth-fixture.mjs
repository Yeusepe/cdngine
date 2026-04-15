import { buildBearerHeaders, createInMemoryCDNgineAuth } from '../packages/auth/dist/index.js';

export function createAuthFixture() {
  return createInMemoryCDNgineAuth();
}

export function createJsonBearerHeaders(token, headers = {}) {
  return {
    ...buildBearerHeaders(token),
    'content-type': 'application/json',
    ...headers
  };
}

export async function provisionPublicActor(auth, overrides = {}) {
  return auth.provisionPrincipal({
    allowedServiceNamespaces: ['media-platform'],
    email: 'public-user@cdngine.test',
    name: 'Public User',
    roles: ['public-user'],
    subject: 'user_123',
    ...overrides
  });
}

export async function provisionOperatorActor(auth, overrides = {}) {
  return auth.provisionPrincipal({
    allowedServiceNamespaces: ['media-platform'],
    email: 'operator@cdngine.test',
    name: 'Operator User',
    roles: ['operator'],
    subject: 'operator_123',
    ...overrides
  });
}
