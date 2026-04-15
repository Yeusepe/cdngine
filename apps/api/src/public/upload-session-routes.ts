/**
 * Purpose: Registers the public upload-session issuance and completion routes that create immutable revisions and enforce the staged-to-canonical handoff under durable idempotency rules.
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

import { resolveDefaultWorkflowTemplateForSource } from '@cdngine/capabilities';
import type { SourceRepository, StagingBlobStore } from '@cdngine/storage';

import type { ApiEnv } from '../api-types.js';
import { requireRequestedScope } from '../api-app.js';
import {
  ProblemDetailError,
  problemTypes
} from '../problem-details.js';
import {
  InMemoryUploadSessionIssuanceStore,
  UploadSessionCanonicalizationFailedError,
  UploadSessionExpiredError,
  UploadSessionInvalidStateTransitionError,
  UploadSessionNotFoundError,
  UploadSessionNotReadyError,
  UploadSessionValidationFailedError,
  UploadSessionAssetNotFoundError,
  UploadSessionIdempotencyConflictError,
  type UploadSessionCompletionStore,
  type UploadSessionIssuanceStore
} from '../upload-session-service.js';
import { validateJsonBody } from '../validation.js';

export interface UploadSessionRouteDependencies {
  now?: () => Date;
  sourceRepository?: SourceRepository;
  stagingBlobStore: StagingBlobStore;
  store: UploadSessionIssuanceStore & UploadSessionCompletionStore;
  uploadTargetTtlMs?: number;
  workflowTemplate?: string;
  workflowTemplateResolver?: (input: {
    assetId: string;
    assetOwner: string;
    contentType: string;
    filename: string;
    serviceNamespaceId: string;
    tenantId?: string;
    uploadSessionId: string;
    versionId: string;
  }) => string | null | undefined;
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

const uploadCompletionRequestSchema = z.object({
  stagedObject: z.object({
    objectKey: z.string().min(1),
    byteLength: z.int().nonnegative(),
    checksum: z.object({
      algorithm: z.literal('sha256'),
      value: z.string().min(1)
    })
  })
});

type UploadCompletionRequest = z.infer<typeof uploadCompletionRequestSchema>;

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

function normalizeCompletionRequestHash(request: UploadCompletionRequest) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        stagedObject: {
          objectKey: request.stagedObject.objectKey,
          byteLength: request.stagedObject.byteLength,
          checksum: request.stagedObject.checksum
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

  app.post(
    '/upload-sessions/:uploadSessionId/complete',
    validateJsonBody(uploadCompletionRequestSchema),
    async (context) => {
      const requestBody = context.get('validatedBody') as UploadCompletionRequest;
      const uploadSessionId = context.req.param('uploadSessionId');
      const idempotencyKey = getIdempotencyKey(context);
      const uploadSession = await dependencies.store.getUploadSession(uploadSessionId);

      if (!uploadSession) {
        throw new ProblemDetailError({
          type: problemTypes.notFound,
          title: 'Not found',
          status: 404,
          detail: `Upload session "${uploadSessionId}" does not exist.`,
          retryable: false
        });
      }

      context.set('requestedScope', {
        serviceNamespaceId: uploadSession.serviceNamespaceId,
        ...(uploadSession.tenantId ? { tenantId: uploadSession.tenantId } : {})
      });

      requireRequestedScope(context);

      const stagedDescriptor = await dependencies.stagingBlobStore.headObject(uploadSession.objectKey);

      if (!stagedDescriptor) {
        throw new ProblemDetailError({
          type: 'https://docs.cdngine.dev/problems/upload-not-finished',
          title: 'Upload not finished',
          status: 409,
          detail: `Upload session "${uploadSessionId}" does not have durable staged bytes yet.`,
          retryable: true
        });
      }

      if (!dependencies.sourceRepository) {
        throw new ProblemDetailError({
          type: problemTypes.upstreamDependencyFailed,
          title: 'Upstream dependency failed',
          status: 503,
          detail: 'Canonical source repository dependency is not configured for upload completion.',
          retryable: true
        });
        }

        const resolvedWorkflowTemplate =
          dependencies.workflowTemplate ??
          dependencies.workflowTemplateResolver?.({
            assetId: uploadSession.assetId,
            assetOwner: uploadSession.assetOwner,
            contentType: uploadSession.contentType,
            filename: uploadSession.filename,
            serviceNamespaceId: uploadSession.serviceNamespaceId,
            ...(uploadSession.tenantId ? { tenantId: uploadSession.tenantId } : {}),
            uploadSessionId: uploadSession.uploadSessionId,
            versionId: uploadSession.versionId
          }) ??
          resolveDefaultWorkflowTemplateForSource(uploadSession.contentType)?.workflowTemplateId ??
          'asset-derivation-v1';

        try {
          const completed = await dependencies.store.completeUploadSession(
            {
              callerScopeKey: buildCallerScopeKey(context),
              idempotencyKey,
            normalizedRequestHash: normalizeCompletionRequestHash(requestBody),
              stagedObject: {
                byteLength: BigInt(requestBody.stagedObject.byteLength),
                checksum: requestBody.stagedObject.checksum,
                descriptor: stagedDescriptor,
                objectKey: requestBody.stagedObject.objectKey
              },
              uploadSessionId,
              workflowTemplate: resolvedWorkflowTemplate
            },
            async (canonicalizationRequest) =>
              dependencies.sourceRepository!.snapshotFromPath({
              assetVersionId: canonicalizationRequest.versionId,
              localPath: buildStagingSnapshotSourcePath(canonicalizationRequest.stagedObject.descriptor),
              sourceFilename: canonicalizationRequest.filename,
              metadata: {
                assetId: canonicalizationRequest.assetId,
                assetOwner: canonicalizationRequest.assetOwner,
                serviceNamespaceId: canonicalizationRequest.serviceNamespaceId,
                uploadSessionId: canonicalizationRequest.uploadSessionId,
                versionNumber: String(canonicalizationRequest.versionNumber),
                ...(canonicalizationRequest.tenantId
                  ? { tenantId: canonicalizationRequest.tenantId }
                  : {})
              }
            })
        );

        return context.json(
          {
            uploadSessionId: completed.uploadSessionId,
            assetId: completed.assetId,
            versionId: completed.versionId,
            versionState: completed.versionState,
            workflowDispatch: completed.workflowDispatch,
            links: {
              version: `/v1/assets/${completed.assetId}/versions/${completed.versionId}`
            }
          },
          202
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

        if (error instanceof UploadSessionNotFoundError) {
          throw new ProblemDetailError({
            type: problemTypes.notFound,
            title: 'Not found',
            status: 404,
            detail: error.message,
            retryable: false
          });
        }

        if (error instanceof UploadSessionExpiredError) {
          throw new ProblemDetailError({
            type: 'https://docs.cdngine.dev/problems/upload-session-expired',
            title: 'Upload session expired',
            status: 410,
            detail: error.message,
            retryable: false
          });
        }

        if (error instanceof UploadSessionNotReadyError) {
          throw new ProblemDetailError({
            type: 'https://docs.cdngine.dev/problems/upload-not-finished',
            title: 'Upload not finished',
            status: 409,
            detail: error.message,
            retryable: true
          });
        }

        if (error instanceof UploadSessionInvalidStateTransitionError) {
          throw new ProblemDetailError({
            type: 'https://docs.cdngine.dev/problems/invalid-state-transition',
            title: 'Invalid state transition',
            status: 409,
            detail: error.message,
            retryable: false
          });
        }

        if (error instanceof UploadSessionValidationFailedError) {
          throw new ProblemDetailError({
            type: error.problemType,
            title:
              error.problemType === 'https://docs.cdngine.dev/problems/checksum-mismatch'
                ? 'Checksum mismatch'
                : 'Validation failed',
            status: 422,
            detail: error.message,
            retryable: false
          });
        }

        if (error instanceof UploadSessionCanonicalizationFailedError) {
          throw new ProblemDetailError({
            type: problemTypes.upstreamDependencyFailed,
            title: 'Upstream dependency failed',
            status: 503,
            detail: error.message,
            retryable: true
          });
        }

        throw error;
      }
    }
  );
}

function buildStagingSnapshotSourcePath(stagedObject: { bucket: string; key: string }) {
  // The current completion slice snapshots through a stable staging reference string; a later worker/runtime
  // slice will replace this with real mounted or materialized source paths when concrete storage wiring lands.
  return `staging://${stagedObject.bucket}/${stagedObject.key}`;
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
