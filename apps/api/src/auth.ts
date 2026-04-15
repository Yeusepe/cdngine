/**
 * Purpose: Implements shared authentication and scope-enforcement helpers so route handlers never operate on unscoped naked identifiers.
 * Governing docs:
 * - docs/service-architecture.md
 * - docs/api-surface.md
 * - docs/security-model.md
 * External references:
 * - https://hono.dev/docs
 * - https://datatracker.ietf.org/doc/html/rfc6750
 * - https://datatracker.ietf.org/doc/html/rfc8725
 * - https://owasp.org/www-project-application-security-verification-standard/
 * Tests:
 * - apps/api/test/api-app.test.ts
 */

import type { RequestActorAuthenticator } from '@cdngine/auth';
import type { MiddlewareHandler } from 'hono';

import type { ApiEnv, ApiSurface, AuthenticatedActor, RequestedScope } from './api-types.js';
import { ProblemDetailError, problemTypes } from './problem-details.js';

function ensureSurfaceRole(surface: ApiSurface, actor: AuthenticatedActor) {
  if (
    surface === 'platform-admin' &&
    !actor.roles.some((role: string) => role === 'platform-admin' || role === 'operator')
  ) {
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

export function authenticationMiddleware(
  surface: ApiSurface,
  authenticator?: RequestActorAuthenticator
): MiddlewareHandler<ApiEnv> {
  return async (context, next) => {
    const actor = await authenticator?.authenticateHeaders(context.req.raw.headers);

    if (!actor) {
      throw new ProblemDetailError({
        type: problemTypes.unauthorized,
        title: 'Unauthorized',
        status: 401,
        detail: 'A bearer token is required for this API surface.',
        retryable: false
      });
    }

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
