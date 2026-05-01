/**
 * Purpose: Verifies that the worker runtime turns durable workflow-dispatch starts into real registry-backed publication so public reads reflect canonical, processing, and published truth without shortcut writes.
 * Governing docs:
 * - docs/service-architecture.md
 * - docs/workflow-extensibility.md
 * - docs/testing-strategy.md
 * Tests:
 * - apps/workers/test/publication-worker-runtime.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { rm, writeFile } from 'node:fs/promises';

import { WorkerPublicationRuntime } from '../dist/index.js';
import {
  PrismaGenericAssetPublicationStore,
  PrismaImagePublicationStore,
  PrismaPresentationPublicationStore,
  PrismaPublicVersionReadStore,
  PrismaPublicationTargetStore,
  PrismaUploadSessionStore,
  PrismaWorkflowDispatchStore,
  PrismaWorkflowExecutionStore
} from '../../../packages/registry/dist/index.js';
import { withRegistryTestDatabase } from '../../../packages/registry/test/prisma-test-helpers.mjs';
import { WorkflowDispatchRuntime } from '../../../packages/workflows/dist/index.js';
import { WorkerGenericAssetProcessor } from '../dist/index.js';
import { WorkerSourceMaterializer } from '../dist/index.js';

async function resetRegistryState(prisma) {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AuditEvent",
      "DeliveryAuthorizationAudit",
      "SourceAccessGrant",
      "AssetManifest",
      "Derivative",
      "ProcessingJob",
      "WorkflowRun",
      "WorkflowDispatch",
      "ValidationResult",
      "UploadSession",
      "IdempotencyRecord",
      "QuarantineCase",
      "AssetVersion",
      "Asset",
      "DeliveryScope",
      "TenantScope",
      "ServiceNamespace"
    RESTART IDENTITY CASCADE
  `);
}

async function seedScope(prisma, scope, options = {}) {
  const serviceNamespaceId = options.serviceNamespaceId ?? `media-platform-${scope}`;
  const tenantId = options.tenantId ?? `tenant-acme-${scope}`;
  const scopeKey = options.scopeKey ?? `public-${scope}`;
  const namespace = await prisma.serviceNamespace.create({
    data: {
      displayName: 'Media Platform',
      serviceNamespaceId,
      tenantIsolationMode: 'shared-tenant'
    }
  });
  const tenant = await prisma.tenantScope.create({
    data: {
      externalTenantId: tenantId,
      serviceNamespaceId: namespace.id
    }
  });
  const deliveryScope = await prisma.deliveryScope.create({
    data: {
      authorizationMode: 'signed_url',
      deliveryMode: 'shared-path',
      hostname: 'cdn.cdngine.local',
      pathPrefix: 'media',
      scopeKey,
      serviceNamespaceId: namespace.id,
      tenantScopeId: tenant.id
    }
  });

  return { deliveryScope, serviceNamespaceId, tenantId };
}

class FakeDerivedObjectStore {
  constructor(bucket = 'cdngine-derived') {
    this.bucket = bucket;
    this.published = [];
  }

  async publishObject(input) {
    let body = input.body;

    if (body instanceof Readable) {
      const chunks = [];
      for await (const chunk of body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      body = Buffer.concat(chunks);
    }

    this.published.push({
      ...input,
      body
    });
    return {
      bucket: this.bucket,
      key: `derived/${input.objectKey}`
    };
  }
}

class ExecutingWorkflowStartClient {
  constructor(workerRuntime) {
    this.requests = [];
    this.executions = [];
    this.pendingExecutions = [];
    this.workerRuntime = workerRuntime;
  }

  async startWorkflow(input) {
    this.requests.push(input);
    this.pendingExecutions.push(input);

    return {
      workflowId: input.workflowId
    };
  }

  startQueuedExecutions() {
    const executions = this.pendingExecutions.splice(0).map((input) => {
      const execution = this.workerRuntime.executeWorkflow({
        workflow: input.args[0],
        workflowId: input.workflowId
      });
      this.executions.push(execution);
      return execution;
    });

    return Promise.all(executions);
  }
}

class ControlledImageProcessorActivity {
  constructor() {
    this.calls = [];
    this.firstCall = new Promise((resolve) => {
      this.resolveFirstCall = resolve;
    });
    this.release = new Promise((resolve) => {
      this.releaseProcessing = resolve;
    });
  }

  async processDerivative(input) {
    this.calls.push(input);
    this.resolveFirstCall?.();
    await this.release;
    const body = JSON.stringify({
      canonicalSourceId: input.canonicalSourceId,
      variantKey: input.recipeBinding.variantKey
    });

    return {
      body,
      byteLength: BigInt(Buffer.byteLength(body)),
      contentType: input.recipeBinding.contentType,
      metadata: {
        variantKey: input.recipeBinding.variantKey
      }
    };
  }
}

const materializationRootPath =
  'C:\\Users\\svalp\\OneDrive\\Documents\\Development\\antiwork\\cdngine\\apps\\workers\\test-output';

test('WorkerPublicationRuntime advances an uploaded image version from canonical to processing to published through dispatch and worker execution', async () => {
  await withRegistryTestDatabase(async ({ prisma, schema }) => {
    await resetRegistryState(prisma);
    const now = new Date('2026-03-01T12:00:00.000Z');
    const { deliveryScope, serviceNamespaceId, tenantId } = await seedScope(prisma, schema);
    const callerScopeKey = `public:user-${schema}`;
    const uploadStore = new PrismaUploadSessionStore({
      now: () => now,
      prisma
    });
    const publicReadStore = new PrismaPublicVersionReadStore({ prisma });

    const issued = await uploadStore.issueUploadSession({
      assetOwner: 'customer:acme',
      byteLength: 4096n,
      callerScopeKey,
      checksum: {
        algorithm: 'sha256',
        value: 'img-sha-001'
      },
      contentType: 'image/png',
      expiresAt: new Date('2026-03-01T12:15:00.000Z'),
      filename: 'hero-banner.png',
      idempotencyKey: `issue-${schema}`,
      normalizedRequestHash: `issue-hash-${schema}`,
      objectKey: `uploads/${serviceNamespaceId}/${tenantId}/hero-banner.png`,
      serviceNamespaceId,
      tenantId
    });
    const completed = await uploadStore.completeUploadSession(
      {
        callerScopeKey,
        idempotencyKey: `complete-${schema}`,
        normalizedRequestHash: `complete-hash-${schema}`,
        stagedObject: {
          byteLength: 4096n,
          checksum: {
            algorithm: 'sha256',
            value: 'img-sha-001'
          },
          descriptor: {
            bucket: 'cdngine-ingest',
            byteLength: 4096n,
            checksum: {
              algorithm: 'sha256',
              value: 'img-sha-001'
            },
            etag: 'img-sha-001',
            key: `ingest/${serviceNamespaceId}/${tenantId}/hero-banner.png`
          },
          objectKey: `uploads/${serviceNamespaceId}/${tenantId}/hero-banner.png`
        },
        uploadSessionId: issued.uploadSessionId,
        workflowTemplate: 'image-derivation-v1'
      },
      async () => ({
        canonicalSourceId: `xet-file-${schema}`,
        digests: [
          {
            algorithm: 'sha256',
            value: 'img-sha-001'
          }
        ],
        logicalByteLength: 4096n,
        logicalPath: `source/${serviceNamespaceId}/${issued.assetId}/${issued.versionId}/original/hero-banner.png`,
        repositoryEngine: 'xet',
        snapshotId: `xet-snapshot-${schema}`
      })
    );

    assert.equal(completed.versionState, 'canonical');

    const initialVersion = await publicReadStore.getVersion(issued.assetId, issued.versionId);
    assert.equal(initialVersion?.lifecycleState, 'canonical');
    assert.equal(initialVersion?.workflowState, 'pending');

    const processorActivity = new ControlledImageProcessorActivity();
    const workerRuntime = new WorkerPublicationRuntime({
      derivedObjectStore: new FakeDerivedObjectStore(),
      executionStore: new PrismaWorkflowExecutionStore({ prisma }),
      imageProcessorActivity: processorActivity,
      imagePublicationStore: new PrismaImagePublicationStore({ prisma }),
      now: () => now,
      publicationTargets: new PrismaPublicationTargetStore({ prisma })
    });
    const workflowClient = new ExecutingWorkflowStartClient(workerRuntime);
    const dispatchRuntime = new WorkflowDispatchRuntime(
      new PrismaWorkflowDispatchStore({ prisma }),
      workflowClient,
      {
        now: () => now
      }
    );

    const dispatchResult = await dispatchRuntime.dispatchPending();
    assert.deepEqual(dispatchResult, {
      claimedCount: 1,
      duplicateCount: 0,
      retryableFailureCount: 0,
      startedCount: 1,
      terminalFailureCount: 0
    });

    const execution = workflowClient.startQueuedExecutions();
    await processorActivity.firstCall;

    const processingVersion = await publicReadStore.getVersion(issued.assetId, issued.versionId);
    assert.equal(processingVersion?.lifecycleState, 'processing');
    assert.equal(processingVersion?.workflowState, 'running');

    await assert.rejects(
      () =>
        publicReadStore.authorizeDelivery(
          issued.assetId,
          issued.versionId,
          deliveryScope.id,
          'webp-master',
          {
            callerScopeKey,
            idempotencyKey: `delivery-before-publish-${schema}`,
            now,
            oneTime: false
          }
        ),
      (error) =>
        error?.name === 'RegistryPublicVersionNotReadyError' &&
        error.lifecycleState === 'processing'
    );

    processorActivity.releaseProcessing();
    await execution;

    const publishedVersion = await publicReadStore.getVersion(issued.assetId, issued.versionId);
    const derivatives = await publicReadStore.listDerivatives(issued.assetId, issued.versionId);
    const manifest = await publicReadStore.getManifest(
      issued.assetId,
      issued.versionId,
      'image-default'
    );
    const deliveryAuthorization = await publicReadStore.authorizeDelivery(
      issued.assetId,
      issued.versionId,
      deliveryScope.id,
      'webp-master',
      {
        callerScopeKey,
        idempotencyKey: `delivery-after-publish-${schema}`,
        now,
        oneTime: true
      }
    );

    assert.equal(publishedVersion?.lifecycleState, 'published');
    assert.equal(publishedVersion?.workflowState, 'completed');
    assert.equal(derivatives.length, 2);
    assert.deepEqual(
      derivatives.map((derivative) => derivative.variant),
      ['thumbnail-small', 'webp-master']
    );
    assert.equal(manifest?.manifestType, 'image-default');
    assert.match(deliveryAuthorization.url, /^\/download-links\//u);
  });
});

test('WorkerPublicationRuntime publishes presentation manifests and derivatives through the durable registry path', async () => {
  await withRegistryTestDatabase(async ({ prisma, schema }) => {
    await resetRegistryState(prisma);
    const now = new Date('2026-03-02T09:30:00.000Z');
    const { deliveryScope, serviceNamespaceId, tenantId } = await seedScope(prisma, schema, {
      scopeKey: `presentations-${schema}`
    });
    const callerScopeKey = `public:user-${schema}`;
    const uploadStore = new PrismaUploadSessionStore({
      now: () => now,
      prisma
    });
    const publicReadStore = new PrismaPublicVersionReadStore({ prisma });

    const issued = await uploadStore.issueUploadSession({
      assetOwner: 'customer:acme',
      byteLength: 8192n,
      callerScopeKey,
      checksum: {
        algorithm: 'sha256',
        value: 'deck-sha-001'
      },
      contentType: 'application/pdf',
      expiresAt: new Date('2026-03-02T09:45:00.000Z'),
      filename: 'event-deck.pdf',
      idempotencyKey: `issue-${schema}`,
      normalizedRequestHash: `issue-hash-${schema}`,
      objectKey: `uploads/${serviceNamespaceId}/${tenantId}/event-deck.pdf`,
      serviceNamespaceId,
      tenantId
    });
    await uploadStore.completeUploadSession(
      {
        callerScopeKey,
        idempotencyKey: `complete-${schema}`,
        normalizedRequestHash: `complete-hash-${schema}`,
        stagedObject: {
          byteLength: 8192n,
          checksum: {
            algorithm: 'sha256',
            value: 'deck-sha-001'
          },
          descriptor: {
            bucket: 'cdngine-ingest',
            byteLength: 8192n,
            checksum: {
              algorithm: 'sha256',
              value: 'deck-sha-001'
            },
            etag: 'deck-sha-001',
            key: `ingest/${serviceNamespaceId}/${tenantId}/event-deck.pdf`
          },
          objectKey: `uploads/${serviceNamespaceId}/${tenantId}/event-deck.pdf`
        },
        uploadSessionId: issued.uploadSessionId,
        workflowTemplate: 'presentation-normalization-v1'
      },
      async () => ({
        canonicalSourceId: `xet-file-${schema}`,
        digests: [
          {
            algorithm: 'sha256',
            value: 'deck-sha-001'
          }
        ],
        logicalByteLength: 8192n,
        logicalPath: `source/${serviceNamespaceId}/${issued.assetId}/${issued.versionId}/original/event-deck.pdf`,
        repositoryEngine: 'xet',
        snapshotId: `xet-snapshot-${schema}`
      })
    );

    const workerRuntime = new WorkerPublicationRuntime({
      derivedObjectStore: new FakeDerivedObjectStore(),
      executionStore: new PrismaWorkflowExecutionStore({ prisma }),
      now: () => now,
      presentationProcessorActivity: {
        async processPresentation(input) {
          const normalizedBody = JSON.stringify({
            canonicalSourceId: input.canonicalSourceId,
            variantKey: 'normalized-pdf'
          });
          const slideOneBody = JSON.stringify({
            canonicalSourceId: input.canonicalSourceId,
            variantKey: 'slide-001'
          });
          const slideTwoBody = JSON.stringify({
            canonicalSourceId: input.canonicalSourceId,
            variantKey: 'slide-002'
          });

          return {
            normalizedDocument: {
              body: normalizedBody,
              byteLength: BigInt(Buffer.byteLength(normalizedBody)),
              contentType: 'application/pdf'
            },
            slides: [
              {
                body: slideOneBody,
                byteLength: BigInt(Buffer.byteLength(slideOneBody)),
                contentType: 'image/webp',
                pageNumber: 1
              },
              {
                body: slideTwoBody,
                byteLength: BigInt(Buffer.byteLength(slideTwoBody)),
                contentType: 'image/webp',
                pageNumber: 2
              }
            ]
          };
        }
      },
      presentationPublicationStore: new PrismaPresentationPublicationStore({ prisma }),
      publicationTargets: new PrismaPublicationTargetStore({ prisma })
    });
    const workflowClient = new ExecutingWorkflowStartClient(workerRuntime);
    const dispatchRuntime = new WorkflowDispatchRuntime(
      new PrismaWorkflowDispatchStore({ prisma }),
      workflowClient,
      {
        now: () => now
      }
    );

    await dispatchRuntime.dispatchPending();
    await workflowClient.startQueuedExecutions();

    const version = await publicReadStore.getVersion(issued.assetId, issued.versionId);
    const derivatives = await publicReadStore.listDerivatives(issued.assetId, issued.versionId);
    const manifest = await publicReadStore.getManifest(
      issued.assetId,
      issued.versionId,
      'presentation-default'
    );
    const deliveryAuthorization = await publicReadStore.authorizeDelivery(
      issued.assetId,
      issued.versionId,
      deliveryScope.id,
      'slide-001',
      {
        callerScopeKey,
        idempotencyKey: `delivery-after-publish-${schema}`,
        now,
        oneTime: false
      }
    );

    assert.equal(version?.lifecycleState, 'published');
    assert.equal(version?.workflowState, 'completed');
    assert.equal(version?.defaultManifestType, 'presentation-default');
    assert.deepEqual(
      derivatives.map((derivative) => derivative.variant),
      ['normalized-pdf', 'slide-001', 'slide-002']
    );
    assert.equal(manifest?.manifestType, 'presentation-default');
    assert.equal(deliveryAuthorization.url.startsWith('https://cdn.cdngine.local/'), true);
  });
});

test('WorkerPublicationRuntime publishes generic preserve-original assets through durable dispatch and worker execution', async () => {
  await withRegistryTestDatabase(async ({ prisma, schema }) => {
    await resetRegistryState(prisma);
    await rm(materializationRootPath, { force: true, recursive: true });
    const now = new Date('2026-03-03T11:15:00.000Z');
    const { deliveryScope, serviceNamespaceId, tenantId } = await seedScope(prisma, schema, {
      scopeKey: `generic-${schema}`
    });
    const callerScopeKey = `public:user-${schema}`;
    const uploadStore = new PrismaUploadSessionStore({
      now: () => now,
      prisma
    });
    const publicReadStore = new PrismaPublicVersionReadStore({ prisma });

    const issued = await uploadStore.issueUploadSession({
      assetOwner: 'customer:acme',
      byteLength: 1024n,
      callerScopeKey,
      checksum: {
        algorithm: 'sha256',
        value: 'pkg-sha-001'
      },
      contentType: 'application/octet-stream',
      expiresAt: new Date('2026-03-03T11:30:00.000Z'),
      filename: 'creator-package.bin',
      idempotencyKey: `issue-${schema}`,
      normalizedRequestHash: `issue-hash-${schema}`,
      objectKey: `uploads/${serviceNamespaceId}/${tenantId}/creator-package.bin`,
      serviceNamespaceId,
      tenantId
    });
    await uploadStore.completeUploadSession(
      {
        callerScopeKey,
        idempotencyKey: `complete-${schema}`,
        normalizedRequestHash: `complete-hash-${schema}`,
        stagedObject: {
          byteLength: 1024n,
          checksum: {
            algorithm: 'sha256',
            value: 'pkg-sha-001'
          },
          descriptor: {
            bucket: 'cdngine-ingest',
            byteLength: 1024n,
            checksum: {
              algorithm: 'sha256',
              value: 'pkg-sha-001'
            },
            etag: 'pkg-sha-001',
            key: `ingest/${serviceNamespaceId}/${tenantId}/creator-package.bin`
          },
          objectKey: `uploads/${serviceNamespaceId}/${tenantId}/creator-package.bin`
        },
        uploadSessionId: issued.uploadSessionId,
        workflowTemplate: 'asset-derivation-v1'
      },
      async () => ({
        canonicalSourceId: `xet-file-${schema}`,
        digests: [
          {
            algorithm: 'sha256',
            value: 'pkg-sha-001'
          }
        ],
        logicalByteLength: 1024n,
        logicalPath: `source/${serviceNamespaceId}/${issued.assetId}/${issued.versionId}/original/creator-package.bin`,
        repositoryEngine: 'xet',
        snapshotId: `xet-snapshot-${schema}`
      })
    );

    const workerRuntime = new WorkerPublicationRuntime({
      derivedObjectStore: new FakeDerivedObjectStore(),
      executionStore: new PrismaWorkflowExecutionStore({ prisma }),
      genericAssetProcessorActivity: new WorkerGenericAssetProcessor({
        materializer: new WorkerSourceMaterializer({
          materializationRootPath,
          sourceRepository: {
            async listSnapshots() {
              return [];
            },
            async restoreToPath(input) {
              await writeFile(input.destinationPath, Buffer.from('preserved-generic-asset', 'utf8'));
              return {
                restoredPath: input.destinationPath
              };
            },
            async snapshotFromPath() {
              throw new Error('snapshotFromPath should not run in this test.');
            }
          }
        })
      }),
      genericAssetPublicationStore: new PrismaGenericAssetPublicationStore({ prisma }),
      now: () => now,
      publicationTargets: new PrismaPublicationTargetStore({ prisma })
    });
    const workflowClient = new ExecutingWorkflowStartClient(workerRuntime);
    const dispatchRuntime = new WorkflowDispatchRuntime(
      new PrismaWorkflowDispatchStore({ prisma }),
      workflowClient,
      {
        now: () => now
      }
    );

    await dispatchRuntime.dispatchPending();
    await workflowClient.startQueuedExecutions();

    const version = await publicReadStore.getVersion(issued.assetId, issued.versionId);
    const derivatives = await publicReadStore.listDerivatives(issued.assetId, issued.versionId);
    const manifest = await publicReadStore.getManifest(
      issued.assetId,
      issued.versionId,
      'generic-asset-default'
    );
    const deliveryAuthorization = await publicReadStore.authorizeDelivery(
      issued.assetId,
      issued.versionId,
      deliveryScope.id,
      'preserve-original',
      {
        callerScopeKey,
        idempotencyKey: `delivery-after-publish-${schema}`,
        now,
        oneTime: false
      }
    );

    assert.equal(version?.lifecycleState, 'published');
    assert.equal(version?.workflowState, 'completed');
    assert.equal(version?.defaultManifestType, 'generic-asset-default');
    assert.deepEqual(
      derivatives.map((derivative) => derivative.variant),
      ['preserve-original']
    );
    assert.equal(derivatives[0]?.recipeId, 'preserve-original');
    assert.equal(manifest?.manifestType, 'generic-asset-default');
    assert.equal(deliveryAuthorization.url.startsWith('https://cdn.cdngine.local/'), true);

    await rm(materializationRootPath, { force: true, recursive: true });
  });
});
