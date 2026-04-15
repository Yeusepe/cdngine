/**
 * Purpose: Implements shared authentication and scope-enforcement helpers so route handlers never operate on unscoped naked identifiers.
 * Governing docs:
 * - docs/service-architecture.md
 * - docs/api-surface.md
 * - docs/security-model.md
 * External references:
 * - https://hono.dev/docs
 * - https://owasp.org/www-project-application-security-verification-standard/
 * Tests:
 * - apps/api/test/api-app.test.ts
 */

import type { MiddlewareHandler } from 'hono';

import type { ApiEnv, ApiSurface, AuthenticatedActor, RequestedScope } from './api-types.js';
import { ProblemDetailError, problemTypes } from './problem-details.js';

function parseCsvHeader(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseBearerToken(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const [scheme, token] = value.split(/\s+/, 2);
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}

function ensureSurfaceRole(surface: ApiSurface, actor: AuthenticatedActor) {
  if (surface === 'platform-admin' && !actor.roles.some((role) => role === 'platform-admin' || role === 'operator')) {
    throw new ProblemDetailError({
      type: problemTypes.forbidden,
      title: 'Forbidden',
      status: 403,
      detail: 'The caller is not allowed to use the platform-admin surface.',
      retryable: false
    });
  }

  if (surface === 'operator' && !actor.roles.includes('operator')) {
    throw new ProblemDetailError({
      type: problemTypes.forbidden,
      title: 'Forbidden',
      status: 403,
      detail: 'The caller is not allowed to use the operator surface.',
      retryable: false
    });
  }
}

export function authenticationMiddleware(surface: ApiSurface): MiddlewareHandler<ApiEnv> {
  return async (context, next) => {
    const subject = parseBearerToken(context.req.header('authorization'));

    if (!subject) {
      throw new ProblemDetailError({
        type: problemTypes.unauthorized,
        title: 'Unauthorized',
        status: 401,
        detail: 'A bearer token is required for this API surface.',
        retryable: false
      });
    }

    const actor: AuthenticatedActor = {
      subject,
      roles: parseCsvHeader(context.req.header('x-cdngine-roles')),
      allowedServiceNamespaces: parseCsvHeader(context.req.header('x-cdngine-allowed-namespaces')),
      allowedTenantIds: parseCsvHeader(context.req.header('x-cdngine-allowed-tenants'))
    };

    ensureSurfaceRole(surface, actor);
    context.set('actor', actor);
    context.set('surface', surface);

    await next();
  };
}

export function assertAuthorizedScope(
  context: {
    get: <TKey extends keyof ApiEnv['Variables']>(key: TKey) => ApiEnv['Variables'][TKey];
  },
  requestedScope: RequestedScope
) {
  const actor = context.get('actor');

  if (!actor) {
    throw new ProblemDetailError({
      type: problemTypes.unauthorized,
      title: 'Unauthorized',
      status: 401,
      detail: 'Authenticated actor context is required before scope checks can run.',
      retryable: false
    });
  }

  if (
    requestedScope.serviceNamespaceId &&
    actor.allowedServiceNamespaces.length > 0 &&
    !actor.allowedServiceNamespaces.includes(requestedScope.serviceNamespaceId)
  ) {
    throw new ProblemDetailError({
      type: problemTypes.scopeNotAllowed,
      title: 'Scope not allowed',
      status: 403,
      detail: `The caller is not allowed to act in service namespace ${requestedScope.serviceNamespaceId}.`,
      retryable: false
    });
  }

  if (
    requestedScope.tenantId &&
    actor.allowedTenantIds.length > 0 &&
    !actor.allowedTenantIds.includes(requestedScope.tenantId)
  ) {
    throw new ProblemDetailError({
      type: problemTypes.scopeNotAllowed,
      title: 'Scope not allowed',
      status: 403,
      detail: `The caller is not allowed to act in tenant scope ${requestedScope.tenantId}.`,
      retryable: false
    });
  }
}
