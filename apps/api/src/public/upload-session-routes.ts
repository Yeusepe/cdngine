/**
 * Purpose: Registers the public upload-session issuance route that creates first uploads and immutable new revisions under durable idempotency rules.
 * Governing docs:
 * - docs/service-architecture.md
 * - docs/api-surface.md
 * - docs/domain-model.md
 * - docs/persistence-model.md
 * - docs/idempotency-and-dispatch.md
 * External references:
 * - https://tus.io/protocols/resumable-upload
 * - https://tus.github.io/tusd/getting-started/configuration/
 * - https://www.prisma.io/docs/orm/prisma-client/queries/transactions
 * Tests:
 * - apps/api/test/upload-session-routes.test.mjs
 */

import { createHash } from 'node:crypto';

import type { Hono } from 'hono';
import { z } from 'zod';

import type { StagingBlobStore } from '@cdngine/storage';

import type { ApiEnv } from '../api-types.js';
import { requireRequestedScope } from '../api-app.js';
import {
  ProblemDetailError,
  problemTypes
} from '../problem-details.js';
import {
  InMemoryUploadSessionIssuanceStore,
  UploadSessionAssetNotFoundError,
  UploadSessionIdempotencyConflictError,
  type UploadSessionIssuanceStore
} from '../upload-session-service.js';
import { validateJsonBody } from '../validation.js';

export interface UploadSessionRouteDependencies {
  now?: () => Date;
  stagingBlobStore: StagingBlobStore;
  store: UploadSessionIssuanceStore;
  uploadTargetTtlMs?: number;
}

const uploadSessionRequestSchema = z.object({
  serviceNamespaceId: z.string().min(1),
  tenantId: z.string().min(1).optional(),
  assetId: z.string().min(1).optional(),
  assetOwner: z.string().min(1),
  source: z.object({
    filename: z.string().min(1),
    contentType: z.string().min(1)
  }),
  upload: z.object({
    objectKey: z.string().min(1),
    byteLength: z.int().nonnegative(),
    checksum: z.object({
      algorithm: z.literal('sha256'),
      value: z.string().min(1)
    })
  })
});

type UploadSessionRequest = z.infer<typeof uploadSessionRequestSchema>;

function getIdempotencyKey(appContext: { req: { header: (name: string) => string | undefined } }) {
  const idempotencyKey = appContext.req.header('idempotency-key')?.trim();

  if (!idempotencyKey) {
    throw new ProblemDetailError({
      type: problemTypes.invalidRequest,
      title: 'Invalid request',
      status: 400,
      detail: 'The Idempotency-Key header is required for upload-session issuance.',
      retryable: false
    });
  }

  return idempotencyKey;
}

function normalizeRequestHash(request: UploadSessionRequest) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        serviceNamespaceId: request.serviceNamespaceId,
        tenantId: request.tenantId ?? null,
        assetId: request.assetId ?? null,
        assetOwner: request.assetOwner,
        source: {
          filename: request.source.filename,
          contentType: request.source.contentType
        },
        upload: {
          objectKey: request.upload.objectKey,
          byteLength: request.upload.byteLength,
          checksum: request.upload.checksum
        }
      })
    )
    .digest('hex');
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
      detail: 'Authenticated actor context is required before issuing upload sessions.',
      retryable: false
    });
  }

  return `${surface}:${actor.subject}`;
}

export function registerUploadSessionRoutes(
  app: Hono<ApiEnv>,
  dependencies: UploadSessionRouteDependencies
) {
  app.post('/upload-sessions', validateJsonBody(uploadSessionRequestSchema), async (context) => {
    const requestBody = context.get('validatedBody') as UploadSessionRequest;
    const idempotencyKey = getIdempotencyKey(context);

    context.set('requestedScope', {
      serviceNamespaceId: requestBody.serviceNamespaceId,
      ...(requestBody.tenantId ? { tenantId: requestBody.tenantId } : {})
    });

    requireRequestedScope(context);

    const now = dependencies.now ?? (() => new Date());
    const expiresAt = new Date(now().getTime() + (dependencies.uploadTargetTtlMs ?? 15 * 60_000));

    try {
      const issued = await dependencies.store.issueUploadSession({
        assetOwner: requestBody.assetOwner,
        callerScopeKey: buildCallerScopeKey(context),
        checksum: requestBody.upload.checksum,
        contentType: requestBody.source.contentType,
        expiresAt,
        filename: requestBody.source.filename,
        idempotencyKey,
        normalizedRequestHash: normalizeRequestHash(requestBody),
        objectKey: requestBody.upload.objectKey,
        serviceNamespaceId: requestBody.serviceNamespaceId,
        ...(requestBody.assetId ? { assetId: requestBody.assetId } : {}),
        ...(requestBody.tenantId ? { tenantId: requestBody.tenantId } : {}),
        byteLength: BigInt(requestBody.upload.byteLength)
      });

      const uploadTarget = await dependencies.stagingBlobStore.createUploadTarget({
        objectKey: issued.objectKey,
        contentType: issued.contentType,
        byteLength: issued.byteLength,
        expiresAt: issued.expiresAt
      });

      return context.json(
        {
          uploadSessionId: issued.uploadSessionId,
          assetId: issued.assetId,
          versionId: issued.versionId,
          isDuplicate: issued.isDuplicate,
          uploadTarget,
          status: 'awaiting-upload',
          links: {
            complete: `/v1/upload-sessions/${issued.uploadSessionId}/complete`,
            version: `/v1/assets/${issued.assetId}/versions/${issued.versionId}`
          }
        },
        201
      );
    } catch (error) {
      if (error instanceof UploadSessionIdempotencyConflictError) {
        throw new ProblemDetailError({
          type: 'https://docs.cdngine.dev/problems/idempotency-key-conflict',
          title: 'Idempotency key conflict',
          status: 409,
          detail: error.message,
          retryable: false
        });
      }

      if (error instanceof UploadSessionAssetNotFoundError) {
        throw new ProblemDetailError({
          type: problemTypes.notFound,
          title: 'Not found',
          status: 404,
          detail: error.message,
          retryable: false
        });
      }

      throw error;
    }
  });
}

export function createInMemoryUploadSessionRouteDependencies(
  stagingBlobStore: StagingBlobStore,
  options: Omit<UploadSessionRouteDependencies, 'stagingBlobStore' | 'store'> = {}
): UploadSessionRouteDependencies {
  return {
    ...options,
    stagingBlobStore,
    store: new InMemoryUploadSessionIssuanceStore()
  };
}
