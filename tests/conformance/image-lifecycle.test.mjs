/**
 * Purpose: Proves the implemented image lifecycle across upload issuance, canonicalization, dispatch projection, deterministic publication, public delivery authorization, and operator audit controls.
 * Governing docs:
 * - docs/conformance.md
 * - docs/testing-strategy.md
 * - docs/architecture.md
 * - docs/original-source-delivery.md
 * External references:
 * - https://docs.temporal.io/develop/typescript/testing-suite
 * - https://www.rfc-editor.org/rfc/rfc9457.html
 * Tests:
 * - tests/conformance/image-lifecycle.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createApiApp } from '../../apps/api/dist/api-app.js';
import {
  InMemoryOperatorControlStore
} from '../../apps/api/dist/operator/operator-service.js';
import {
  registerOperatorRoutes
} from '../../apps/api/dist/operator/operator-routes.js';
import {
  registerDeliveryRoutes
} from '../../apps/api/dist/public/delivery-routes.js';
import {
  InMemoryPublicVersionReadStore
} from '../../apps/api/dist/public/delivery-service.js';
import {
  registerUploadSessionRoutes
} from '../../apps/api/dist/public/upload-session-routes.js';
import {
  InMemoryUploadSessionIssuanceStore
} from '../../apps/api/dist/upload-session-service.js';
import {
  InMemoryImagePublicationStore,
  InMemoryWorkflowDispatchStore
} from '../../packages/registry/dist/index.js';
import {
  WorkflowAlreadyStartedError,
  WorkflowDispatchRuntime,
  runImagePublicationWorkflow
} from '../../packages/workflows/dist/index.js';
import {
  createAuthFixture,
  createJsonBearerHeaders,
  provisionOperatorActor,
  provisionPublicActor
} from '../auth-fixture.mjs';

class FakeStagingBlobStore {
  constructor(descriptors = {}) {
    this.descriptors = new Map(Object.entries(descriptors));
  }

  async createUploadTarget(input) {
    return {
      expiresAt: input.expiresAt.toISOString(),
      headers: {},
      method: 'PATCH',
      url: `https://ingest.cdngine.local/${input.objectKey}`
    };
  }

  async headObject(objectKey) {
    return this.descriptors.get(objectKey) ?? null;
  }
}

class FakeSourceRepository {
  constructor(snapshotResult) {
    this.snapshotRequests = [];
    this.snapshotResult = snapshotResult;
  }

  async snapshotFromPath(input) {
    this.snapshotRequests.push(input);
    return this.snapshotResult;
  }
}

class FakeWorkflowStartClient {
  constructor(mode = 'success') {
    this.mode = mode;
    this.requests = [];
  }

  async startWorkflow(input) {
    this.requests.push(input);

    if (this.mode === 'duplicate') {
      throw new WorkflowAlreadyStartedError(input.workflowId);
    }

    return {
      workflowId: input.workflowId
    };
  }
}

class FakeDerivedObjectStore {
  constructor(bucket = 'cdngine-derived') {
    this.bucket = bucket;
    this.published = [];
  }

  async publishObject(input) {
    this.published.push(input);

    return {
      bucket: this.bucket,
      key: input.objectKey
    };
  }
}

function createIdGenerator() {
  const counters = new Map();

  return (prefix) => {
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return `${prefix}_${String(next).padStart(3, '0')}`;
  };
}

test('image lifecycle conformance covers issue, complete, dispatch, deterministic publication, and delivery authorization', async () => {
  const auth = createAuthFixture();
  const publicActor = await provisionPublicActor(auth, {
    allowedTenantIds: ['tenant-acme']
  });
  const generateId = createIdGenerator();
  const now = () => new Date('2026-01-15T18:45:00.000Z');
  const uploadStore = new InMemoryUploadSessionIssuanceStore({
    generateId,
    now
  });
  const stagingStore = new FakeStagingBlobStore({
    'ingest/media-platform/hero-banner.png': {
      bucket: 'cdngine-ingest',
      checksum: {
        algorithm: 'sha256',
        value: 'abc123'
      },
      key: 'ingest/media-platform/hero-banner.png'
    }
  });
  const sourceRepository = new FakeSourceRepository({
    canonicalSourceId: 'src_001',
    digests: [
      {
        algorithm: 'sha256',
        value: 'abc123'
      }
    ],
    logicalPath: 'source/media-platform/ast_001/ver_001/original',
    snapshotId: 'snap_001'
  });
  const uploadApp = createApiApp({
    auth,
    registerPublicRoutes(publicApp) {
      registerUploadSessionRoutes(publicApp, {
        now,
        sourceRepository,
        stagingBlobStore: stagingStore,
        store: uploadStore,
        workflowTemplate: 'image-derivation-v1'
      });
    }
  });

  const createResponse = await uploadApp.request('http://localhost/v1/upload-sessions', {
    method: 'POST',
    headers: createJsonBearerHeaders(publicActor.token, {
      'idempotency-key': 'idem-create-001'
    }),
    body: JSON.stringify({
      assetOwner: 'customer:acme',
      serviceNamespaceId: 'media-platform',
      source: {
        contentType: 'image/png',
        filename: 'hero-banner.png'
      },
      tenantId: 'tenant-acme',
      upload: {
        byteLength: 1843921,
        checksum: {
          algorithm: 'sha256',
          value: 'abc123'
        },
        objectKey: 'ingest/media-platform/hero-banner.png'
      }
    })
  });
  const issued = await createResponse.json();

  assert.equal(createResponse.status, 201);
  assert.equal(issued.assetId, 'ast_001');
  assert.equal(issued.versionId, 'ver_001');

  const completionRequest = {
    stagedObject: {
      byteLength: 1843921,
      checksum: {
        algorithm: 'sha256',
        value: 'abc123'
      },
      objectKey: 'ingest/media-platform/hero-banner.png'
    }
  };
  const firstCompleteResponse = await uploadApp.request(
    `http://localhost/v1/upload-sessions/${issued.uploadSessionId}/complete`,
    {
      method: 'POST',
      headers: createJsonBearerHeaders(publicActor.token, {
        'idempotency-key': 'idem-complete-001'
      }),
      body: JSON.stringify(completionRequest)
    }
  );
  const secondCompleteResponse = await uploadApp.request(
    `http://localhost/v1/upload-sessions/${issued.uploadSessionId}/complete`,
    {
      method: 'POST',
      headers: createJsonBearerHeaders(publicActor.token, {
        'idempotency-key': 'idem-complete-001'
      }),
      body: JSON.stringify(completionRequest)
    }
  );
  const completed = await firstCompleteResponse.json();
  const replayedCompletion = await secondCompleteResponse.json();

  assert.equal(firstCompleteResponse.status, 202);
  assert.equal(secondCompleteResponse.status, 202);
  assert.deepEqual(replayedCompletion.workflowDispatch, completed.workflowDispatch);
  assert.equal(sourceRepository.snapshotRequests.length, 1);

  const dispatchStore = new InMemoryWorkflowDispatchStore({
    dispatches: [
      {
        assetVersionId: completed.versionId,
        dispatchId: completed.workflowDispatch.dispatchId,
        dispatchReason: 'asset-version-canonicalized',
        workflowKey: completed.workflowDispatch.workflowKey,
        workflowTemplateId: 'image-derivation-v1'
      }
    ],
    generateId: () => 'wfr_001'
  });
  const startClient = new FakeWorkflowStartClient();
  const dispatchRuntime = new WorkflowDispatchRuntime(dispatchStore, startClient, {
    now
  });
  const dispatchResult = await dispatchRuntime.dispatchPending();
  const dispatchRuns = await dispatchStore.listWorkflowRuns(completed.versionId);

  assert.deepEqual(dispatchResult, {
    claimedCount: 1,
    duplicateCount: 0,
    retryableFailureCount: 0,
    startedCount: 1,
    terminalFailureCount: 0
  });
  assert.equal(dispatchRuns.length, 1);
  assert.equal(dispatchRuns[0].workflowId, completed.workflowDispatch.workflowKey);

  const publicationStore = new InMemoryImagePublicationStore({
    versions: [
      {
        assetId: completed.assetId,
        canonicalLogicalPath: sourceRepository.snapshotResult.logicalPath,
        canonicalSourceId: sourceRepository.snapshotResult.canonicalSourceId,
        detectedContentType: 'image/png',
        serviceNamespaceId: 'media-platform',
        sourceByteLength: 1843921n,
        sourceChecksumValue: 'abc123',
        sourceFilename: 'hero-banner.png',
        versionId: completed.versionId,
        versionNumber: 1
      }
    ]
  });
  const derivedObjectStore = new FakeDerivedObjectStore();
  const processorActivity = {
    async processDerivative(input) {
      return {
        body: `${input.canonicalSourceId}:${input.recipeBinding.variantKey}`,
        byteLength: BigInt(Buffer.byteLength(`${input.canonicalSourceId}:${input.recipeBinding.variantKey}`)),
        contentType: input.recipeBinding.outputContentType,
        metadata: {
          variant: input.recipeBinding.variantKey
        }
      };
    }
  };
  const firstPublication = await runImagePublicationWorkflow(
    {
      deliveryScopeId: 'public-images',
      versionId: completed.versionId,
      workflowId: completed.workflowDispatch.workflowKey
    },
    {
      derivedObjectStore,
      now,
      processorActivity,
      publicationStore
    }
  );
  const replayPublication = await runImagePublicationWorkflow(
    {
      deliveryScopeId: 'public-images',
      versionId: completed.versionId,
      workflowId: completed.workflowDispatch.workflowKey
    },
    {
      derivedObjectStore,
      now,
      processorActivity,
      publicationStore
    }
  );
  const publishedDerivatives = await publicationStore.listPublishedDerivatives(completed.versionId);
  const publishedManifest = await publicationStore.readManifest(
    completed.versionId,
    'image-default',
    'public-images'
  );

  assert.deepEqual(
    replayPublication.derivatives.map((item) => item.deterministicKey),
    firstPublication.derivatives.map((item) => item.deterministicKey)
  );
  assert.deepEqual(replayPublication.manifest.manifestPayload, firstPublication.manifest.manifestPayload);
  assert.equal(publishedDerivatives.length, 2);
  assert.ok(publishedManifest);

  const publicStore = new InMemoryPublicVersionReadStore({
    versions: [
      {
        assetId: completed.assetId,
        assetOwner: 'customer:acme',
        deliveries: publishedDerivatives.map((derivative, index) => ({
          assetId: completed.assetId,
          byteLength: derivative.byteLength,
          contentType: derivative.contentType,
          deliveryScopeId: derivative.deliveryScopeId,
          deterministicKey: derivative.deterministicKey,
          derivativeId: `drv_${String(index + 1).padStart(3, '0')}`,
          recipeId: derivative.recipeId,
          storageKey: derivative.storageKey,
          variant: derivative.variantKey,
          versionId: completed.versionId
        })),
        lifecycleState: 'published',
        manifests: [
          {
            assetId: completed.assetId,
            deliveryScopeId: 'public-images',
            manifestPayload: publishedManifest.manifestPayload,
            manifestType: publishedManifest.manifestType,
            objectKey: publishedManifest.objectKey,
            versionId: completed.versionId
          }
        ],
        serviceNamespaceId: 'media-platform',
        source: {
          byteLength: 1843921n,
          contentType: 'image/png',
          filename: 'hero-banner.png'
        },
        tenantId: 'tenant-acme',
        versionId: completed.versionId,
        versionNumber: 1,
        workflowState: 'completed'
      }
    ]
  });
  const publicReadApp = createApiApp({
    auth,
    registerPublicRoutes(publicApp) {
      registerDeliveryRoutes(publicApp, {
        now,
        store: publicStore
      });
    }
  });

  const versionResponse = await publicReadApp.request(
    `http://localhost/v1/assets/${completed.assetId}/versions/${completed.versionId}`,
    {
      headers: createJsonBearerHeaders(publicActor.token)
    }
  );
  const deliveryAuthResponse = await publicReadApp.request(
    `http://localhost/v1/assets/${completed.assetId}/versions/${completed.versionId}/deliveries/public-images/authorize`,
    {
      method: 'POST',
      headers: createJsonBearerHeaders(publicActor.token, {
        'idempotency-key': 'idem-delivery-001'
      }),
      body: JSON.stringify({
        responseFormat: 'url',
        variant: firstPublication.derivatives[0].variantKey
      })
    }
  );
  const sourceAuthResponse = await publicReadApp.request(
    `http://localhost/v1/assets/${completed.assetId}/versions/${completed.versionId}/source/authorize`,
    {
      method: 'POST',
      headers: createJsonBearerHeaders(publicActor.token, {
        'idempotency-key': 'idem-source-001'
      }),
      body: JSON.stringify({
        preferredDisposition: 'attachment'
      })
    }
  );

  assert.equal(versionResponse.status, 200);
  assert.equal((await versionResponse.json()).lifecycleState, 'published');
  assert.equal(deliveryAuthResponse.status, 200);
  assert.deepEqual(await deliveryAuthResponse.json(), {
    assetId: completed.assetId,
    authorizationMode: 'signed-url',
    deliveryScopeId: 'public-images',
    expiresAt: '2026-01-15T19:00:00.000Z',
    resolvedOrigin: 'cdn-derived',
    url: `https://cdn.cdngine.local/public-images/${firstPublication.derivatives[0].variantKey}`,
    versionId: completed.versionId
  });
  assert.equal(sourceAuthResponse.status, 200);
  assert.deepEqual(await sourceAuthResponse.json(), {
    assetId: completed.assetId,
    authorizationMode: 'signed-url',
    expiresAt: '2026-01-15T19:00:00.000Z',
    resolvedOrigin: 'source-proxy',
    url: `https://api.cdngine.local/v1/assets/${completed.assetId}/versions/${completed.versionId}/source/proxy`,
    versionId: completed.versionId
  });
});

test('dispatch duplicate conformance keeps one workflow identity when Temporal reports an existing execution', async () => {
  const workflowKey = 'media-platform:ast_001:ver_001:image-derivation-v1';
  const store = new InMemoryWorkflowDispatchStore({
    dispatches: [
      {
        assetVersionId: 'ver_001',
        dispatchId: 'wd_001',
        dispatchReason: 'asset-version-canonicalized',
        workflowKey,
        workflowTemplateId: 'image-derivation-v1'
      }
    ],
    generateId: () => 'wfr_001'
  });
  const runtime = new WorkflowDispatchRuntime(store, new FakeWorkflowStartClient('duplicate'), {
    now: () => new Date('2026-01-15T18:45:00.000Z')
  });

  const result = await runtime.dispatchPending();
  const dispatch = await store.getDispatch('wd_001');
  const runs = await store.listWorkflowRuns('ver_001');

  assert.deepEqual(result, {
    claimedCount: 1,
    duplicateCount: 1,
    retryableFailureCount: 0,
    startedCount: 0,
    terminalFailureCount: 0
  });
  assert.equal(dispatch?.dispatchState, 'duplicate');
  assert.equal(runs[0].workflowId, workflowKey);
  assert.equal(runs[0].state, 'running');
});

test('operator conformance preserves audited quarantine and release behavior', async () => {
  const auth = createAuthFixture();
  const defaultOperator = await provisionOperatorActor(auth);
  const secondaryOperator = await provisionOperatorActor(auth, {
    email: 'operator-2@cdngine.test',
    subject: 'operator_456'
  });
  const store = new InMemoryOperatorControlStore({
    generateId: () => 'op_001',
    now: () => new Date('2026-01-15T18:45:00.000Z'),
    versions: [
      {
        assetId: 'ast_001',
        derivativeCount: 2,
        lifecycleState: 'published',
        manifestType: 'image-default',
        versionId: 'ver_001',
        workflowId: 'wf_001',
        workflowState: 'completed'
      }
    ]
  });
  const app = createApiApp({
    auth,
    registerOperatorRoutes(operatorApp) {
      registerOperatorRoutes(operatorApp, { store });
    }
  });

  const quarantineResponse = await app.request(
    'http://localhost/v1/operator/assets/ast_001/versions/ver_001/quarantine',
    {
      method: 'POST',
      headers: createJsonBearerHeaders(defaultOperator.token)
    }
  );
  const releaseResponse = await app.request(
    'http://localhost/v1/operator/assets/ast_001/versions/ver_001/release',
    {
      method: 'POST',
      headers: createJsonBearerHeaders(secondaryOperator.token)
    }
  );
  const diagnostics = await store.getDiagnostics('ast_001', 'ver_001');
  const auditEvents = await store.getAuditEvents('ver_001');

  assert.equal(quarantineResponse.status, 202);
  assert.equal(releaseResponse.status, 202);
  assert.deepEqual(diagnostics, {
    assetId: 'ast_001',
    lifecycleState: 'processing',
    publication: {
      derivativeCount: 2,
      manifestType: 'image-default'
    },
    versionId: 'ver_001',
    workflow: {
      state: 'queued',
      workflowId: 'ast_001:ver_001:release:op_001'
    }
  });
  assert.deepEqual(
    auditEvents.map((event) => ({
      action: event.action,
      actorSubject: event.actorSubject
    })),
    [
      {
        action: 'quarantine',
        actorSubject: 'operator_123'
      },
      {
        action: 'release',
        actorSubject: 'operator_456'
      }
    ]
  );
});
