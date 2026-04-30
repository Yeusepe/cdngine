/**
 * Purpose: Registers public version, derivative, manifest, derivative-delivery, and original-source authorization routes without exposing internal storage topology. Includes optional output-workflow integration.
 * Governing docs:
 * - docs/api-surface.md
 * - docs/original-source-delivery.md
 * - docs/output-workflows.md
 * - docs/storage-tiering-and-materialization.md
 * - docs/security-model.md
 * External references:
 * - https://www.rfc-editor.org/rfc/rfc9111
 * - https://www.rfc-editor.org/rfc/rfc9457.html
 * Tests:
 * - apps/api/test/delivery-routes.test.mjs
 */

import { z } from 'zod';
import type { Context, Hono } from 'hono';

import { requireRequestedScope } from '../api-app.js';
import type { ApiEnv } from '../api-types.js';
import { ProblemDetailError, problemTypes } from '../problem-details.js';
import {
  InMemoryPublicVersionReadStore,
  PublicAssetVersionNotFoundError,
  PublicDownloadLinkNotFoundError,
  PublicVersionNotReadyError,
  type PublicVersionReadStore
} from './delivery-service.js';
import {
  UnknownOutputWorkflowError,
  type OutputWorkflowStore,
  type OutputWorkflowTriggerContext
} from './output-workflow-service.js';
import { validateJsonBody } from '../validation.js';

export interface DeliveryRouteDependencies {
  now?: () => Date;
  outputWorkflowStore?: OutputWorkflowStore;
  store: PublicVersionReadStore;
}

const outputWorkflowSchema = z
  .object({
    outputWorkflowId: z.string().min(1),
    outputParameters: z.record(z.string(), z.unknown()).optional()
  })
  .optional();

const authorizeSourceSchema = z.object({
  oneTime: z.boolean().optional(),
  outputWorkflow: outputWorkflowSchema,
  preferredDisposition: z.enum(['attachment', 'inline']).optional()
});

const authorizeDeliverySchema = z.object({
  oneTime: z.boolean().optional(),
  outputWorkflow: outputWorkflowSchema,
  responseFormat: z.enum(['url', 'cookie-bundle']).optional(),
  variant: z.string().min(1)
});

function getIdempotencyKey(appContext: { req: { header: (name: string) => string | undefined } }) {
  const idempotencyKey = appContext.req.header('idempotency-key')?.trim();

  if (!idempotencyKey) {
    throw new ProblemDetailError({
      type: problemTypes.invalidRequest,
      title: 'Invalid request',
      status: 400,
      detail: 'The Idempotency-Key header is required for authorization operations.',
      retryable: false
    });
  }

  return idempotencyKey;
}

function buildCallerScopeKey(context: {
  get: <TKey extends keyof ApiEnv['Variables']>(key: TKey) => ApiEnv['Variables'][TKey];
}) {
  const actor = context.get('actor');
  const surface = context.get('surface');

  if (!actor || !surface) {
    throw new ProblemDetailError({
      type: problemTypes.unauthorized,
      title: 'Unauthorized',
      status: 401,
      detail: 'Authenticated actor context is required before authorizing public reads.',
      retryable: false
    });
  }

  return `${surface}:${actor.subject}`;
}

function mapPublicReadError(error: unknown): never {
  if (error instanceof PublicAssetVersionNotFoundError) {
    throw new ProblemDetailError({
      type: problemTypes.notFound,
      title: 'Not found',
      status: 404,
      detail: error.message,
      retryable: false
    });
  }

  if (error instanceof PublicDownloadLinkNotFoundError) {
    throw new ProblemDetailError({
      type: problemTypes.notFound,
      title: 'Not found',
      status: 404,
      detail: error.message,
      retryable: false
    });
  }

  if (error instanceof PublicVersionNotReadyError) {
    throw new ProblemDetailError({
      type: problemTypes.versionNotReady,
      title: 'Version not ready',
      status: 409,
      detail: error.message,
      retryable: true
    });
  }

  if (error instanceof UnknownOutputWorkflowError) {
    throw new ProblemDetailError({
      type: problemTypes.outputWorkflowNotFound,
      title: 'Output workflow not found',
      status: 404,
      detail: error.message,
      retryable: false
    });
  }

  throw error;
}

async function maybeRunOutputWorkflow(
  outputWorkflowRequest:
    | { outputWorkflowId: string; outputParameters?: Record<string, unknown> | undefined }
    | undefined,
  context: Omit<OutputWorkflowTriggerContext, 'outputWorkflowId' | 'outputParameters'>,
  store: OutputWorkflowStore | undefined
) {
  if (!outputWorkflowRequest || !store) {
    return undefined;
  }

  return store.triggerOutputWorkflow({
    ...context,
    outputWorkflowId: outputWorkflowRequest.outputWorkflowId,
    ...(outputWorkflowRequest.outputParameters
      ? { outputParameters: outputWorkflowRequest.outputParameters }
      : {})
  });
}

async function requireScopedVersion(
  context: Context<ApiEnv>,
  dependencies: DeliveryRouteDependencies,
  assetId: string,
  versionId: string
) {
  const version = await dependencies.store.getVersion(assetId, versionId);

  if (!version) {
    throw new PublicAssetVersionNotFoundError(assetId, versionId);
  }

  context.set('requestedScope', {
    serviceNamespaceId: version.serviceNamespaceId,
    ...(version.tenantId ? { tenantId: version.tenantId } : {})
  });
  requireRequestedScope(context);

  return version;
}

export function registerDeliveryRoutes(app: Hono<ApiEnv>, dependencies: DeliveryRouteDependencies) {
  app.get('/assets/:assetId/versions/:versionId', async (context) => {
    try {
      const assetId = context.req.param('assetId');
      const versionId = context.req.param('versionId');
      const version = await requireScopedVersion(context, dependencies, assetId, versionId);

      return context.json({
        assetId: version.assetId,
        assetOwner: version.assetOwner,
        lifecycleState: version.lifecycleState,
        serviceNamespaceId: version.serviceNamespaceId,
        ...(version.tenantId ? { tenantId: version.tenantId } : {}),
        versionId: version.versionId,
        versionNumber: version.versionNumber,
        workflowState: version.workflowState,
        source: {
          byteLength: Number(version.source.byteLength),
          contentType: version.source.contentType,
          filename: version.source.filename
        },
        links: {
          self: `/v1/assets/${version.assetId}/versions/${version.versionId}`,
          derivatives: `/v1/assets/${version.assetId}/versions/${version.versionId}/derivatives`,
          manifest: `/v1/assets/${version.assetId}/versions/${version.versionId}/manifests/${version.defaultManifestType ?? 'image-default'}`
        }
      });
    } catch (error) {
      mapPublicReadError(error);
    }
  });

  app.get('/assets/:assetId/versions/:versionId/derivatives', async (context) => {
    try {
      const assetId = context.req.param('assetId');
      const versionId = context.req.param('versionId');
      await requireScopedVersion(context, dependencies, assetId, versionId);
      const derivatives = await dependencies.store.listDerivatives(assetId, versionId);

      return context.json({
        assetId,
        derivatives: derivatives.map((derivative) => ({
          byteLength: Number(derivative.byteLength),
          contentType: derivative.contentType,
          derivativeId: derivative.derivativeId,
          deterministicKey: derivative.deterministicKey,
          recipeId: derivative.recipeId,
          variant: derivative.variant
        })),
        versionId
      });
    } catch (error) {
      mapPublicReadError(error);
    }
  });

  app.get('/assets/:assetId/versions/:versionId/manifests/:manifestType', async (context) => {
    try {
      const assetId = context.req.param('assetId');
      const versionId = context.req.param('versionId');
      const manifestType = context.req.param('manifestType');
      await requireScopedVersion(context, dependencies, assetId, versionId);
      const manifest = await dependencies.store.getManifest(assetId, versionId, manifestType);

      if (!manifest) {
        throw new PublicAssetVersionNotFoundError(assetId, versionId);
      }

      return context.json(manifest.manifestPayload);
    } catch (error) {
      mapPublicReadError(error);
    }
  });

  app.post(
    '/assets/:assetId/versions/:versionId/source/authorize',
    validateJsonBody(authorizeSourceSchema),
    async (context) => {
      try {
        const idempotencyKey = getIdempotencyKey(context);
        const assetId = context.req.param('assetId');
        const versionId = context.req.param('versionId');
        await requireScopedVersion(context, dependencies, assetId, versionId);
        const body = context.get('validatedBody') as z.infer<typeof authorizeSourceSchema>;
        const now = (dependencies.now ?? (() => new Date()))();
        const authorization = await dependencies.store.authorizeSource(
          assetId,
          versionId,
          body.preferredDisposition,
          {
            callerScopeKey: buildCallerScopeKey(context),
            idempotencyKey,
            now,
            ...(body.oneTime ? { oneTime: true } : {})
          }
        );

        const outputRun = await maybeRunOutputWorkflow(
          body.outputWorkflow,
          {
            assetId,
            authorizationKind: 'source',
            idempotencyKey,
            now,
            resolvedUrl: authorization.url,
            versionId
          },
          dependencies.outputWorkflowStore
        );

        return context.json({
          ...authorization,
          ...(outputRun
            ? {
                outputWorkflowRun: outputRun,
                ...(outputRun.url ? { url: outputRun.url } : {})
              }
            : {})
        });
      } catch (error) {
        mapPublicReadError(error);
      }
    }
  );

  app.post(
    '/assets/:assetId/versions/:versionId/deliveries/:deliveryScopeId/authorize',
    validateJsonBody(authorizeDeliverySchema),
    async (context) => {
      try {
        const idempotencyKey = getIdempotencyKey(context);
        const assetId = context.req.param('assetId');
        const versionId = context.req.param('versionId');
        const deliveryScopeId = context.req.param('deliveryScopeId');
        await requireScopedVersion(context, dependencies, assetId, versionId);
        const body = context.get('validatedBody') as z.infer<typeof authorizeDeliverySchema>;
        const now = (dependencies.now ?? (() => new Date()))();
        const authorization = await dependencies.store.authorizeDelivery(
          assetId,
          versionId,
          deliveryScopeId,
          body.variant,
          {
            callerScopeKey: buildCallerScopeKey(context),
            idempotencyKey,
            now,
            ...(body.oneTime ? { oneTime: true } : {})
          }
        );

        const outputRun = await maybeRunOutputWorkflow(
          body.outputWorkflow,
          {
            assetId,
            authorizationKind: 'delivery',
            deliveryScopeId,
            idempotencyKey,
            now,
            resolvedUrl: authorization.url,
            versionId
          },
          dependencies.outputWorkflowStore
        );

        return context.json({
          ...authorization,
          ...(outputRun
            ? {
                outputWorkflowRun: outputRun,
                ...(outputRun.url ? { url: outputRun.url } : {})
              }
            : {})
        });
      } catch (error) {
        mapPublicReadError(error);
      }
    }
  );
}

export function registerDownloadLinkRoutes(
  app: Hono<ApiEnv>,
  dependencies: DeliveryRouteDependencies
) {
  app.get('/download-links/:downloadToken', async (context) => {
    try {
      const link = await dependencies.store.consumeDownloadLink(
        context.req.param('downloadToken'),
        (dependencies.now ?? (() => new Date()))()
      );

      return context.redirect(link.url, 302);
    } catch (error) {
      mapPublicReadError(error);
    }
  });
}

export function createInMemoryDeliveryRouteDependencies(
  options: ConstructorParameters<typeof InMemoryPublicVersionReadStore>[0] = {}
): DeliveryRouteDependencies {
  return {
    store: new InMemoryPublicVersionReadStore(options)
  };
}
