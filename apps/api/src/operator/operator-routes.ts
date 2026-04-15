/**
 * Purpose: Registers the operator-control and diagnostics routes for replay, quarantine, release, purge, and audited version diagnostics.
 * Governing docs:
 * - docs/api-surface.md
 * - docs/observability.md
 * - docs/security-model.md
 * - docs/runbooks/quarantine-and-release.md
 * External references:
 * - https://hono.dev/docs
 * - https://docs.temporal.io/develop/typescript/workflows/message-passing
 * Tests:
 * - apps/api/test/operator-routes.test.mjs
 */

import type { Hono } from 'hono';

import type { ApiEnv } from '../api-types.js';
import { ProblemDetailError, problemTypes } from '../problem-details.js';
import {
  InMemoryOperatorControlStore,
  OperatorActionRejectedError,
  OperatorVersionNotFoundError,
  type OperatorControlStore
} from './operator-service.js';

export interface OperatorRouteDependencies {
  store: OperatorControlStore;
}

function getOperatorActor(context: {
  get: <TKey extends keyof ApiEnv['Variables']>(key: TKey) => ApiEnv['Variables'][TKey];
}) {
  const actor = context.get('actor');

  if (!actor) {
    throw new ProblemDetailError({
      type: problemTypes.unauthorized,
      title: 'Unauthorized',
      status: 401,
      detail: 'Operator routes require an authenticated actor.',
      retryable: false
    });
  }

  return actor;
}

async function performOperatorAction(
  context: {
    req: { param: (name: string) => string };
    json: (body: unknown, status?: 200 | 202) => Response;
    get: <TKey extends keyof ApiEnv['Variables']>(key: TKey) => ApiEnv['Variables'][TKey];
  },
  action: 'reprocess' | 'quarantine' | 'release' | 'purge',
  store: OperatorControlStore
) {
  const actor = getOperatorActor(context);
  const assetId = context.req.param('assetId');
  const versionId = context.req.param('versionId');

  try {
    const accepted =
      action === 'reprocess'
        ? await store.reprocessVersion(assetId, versionId, actor.subject)
        : action === 'quarantine'
          ? await store.quarantineVersion(assetId, versionId, actor.subject)
          : action === 'release'
            ? await store.releaseVersion(assetId, versionId, actor.subject)
            : await store.purgeVersion(assetId, versionId, actor.subject);

    return context.json(accepted, 202);
  } catch (error) {
    if (error instanceof OperatorVersionNotFoundError) {
      throw new ProblemDetailError({
        type: problemTypes.notFound,
        title: 'Not found',
        status: 404,
        detail: error.message,
        retryable: false
      });
    }

    if (error instanceof OperatorActionRejectedError) {
      throw new ProblemDetailError({
        type: problemTypes.operatorActionRejected,
        title: 'Operator action rejected',
        status: 409,
        detail: error.message,
        retryable: false
      });
    }

    throw error;
  }
}

export function registerOperatorRoutes(app: Hono<ApiEnv>, dependencies: OperatorRouteDependencies) {
  app.post('/assets/:assetId/versions/:versionId/reprocess', (context) =>
    performOperatorAction(context, 'reprocess', dependencies.store)
  );
  app.post('/assets/:assetId/versions/:versionId/quarantine', (context) =>
    performOperatorAction(context, 'quarantine', dependencies.store)
  );
  app.post('/assets/:assetId/versions/:versionId/release', (context) =>
    performOperatorAction(context, 'release', dependencies.store)
  );
  app.post('/assets/:assetId/versions/:versionId/purge', (context) =>
    performOperatorAction(context, 'purge', dependencies.store)
  );
  app.get('/assets/:assetId/versions/:versionId/diagnostics', async (context) => {
    const assetId = context.req.param('assetId');
    const versionId = context.req.param('versionId');
    const diagnostics = await dependencies.store.getDiagnostics(assetId, versionId);

    if (!diagnostics) {
      throw new ProblemDetailError({
        type: problemTypes.notFound,
        title: 'Not found',
        status: 404,
        detail: `Version "${versionId}" for asset "${assetId}" does not exist.`,
        retryable: false
      });
    }

    return context.json(diagnostics);
  });
}

export function createInMemoryOperatorRouteDependencies(
  options: ConstructorParameters<typeof InMemoryOperatorControlStore>[0] = {}
): OperatorRouteDependencies {
  return {
    store: new InMemoryOperatorControlStore(options)
  };
}
