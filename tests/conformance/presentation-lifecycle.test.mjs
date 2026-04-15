/**
 * Purpose: Proves the implemented presentation lifecycle across upload completion, workflow-template resolution, deterministic publication, and public manifest delivery.
 * Governing docs:
 * - docs/conformance.md
 * - docs/testing-strategy.md
 * - docs/architecture.md
 * - docs/workload-and-recipe-matrix.md
 * External references:
 * - https://gotenberg.dev/
 * - https://www.rfc-editor.org/rfc/rfc9457.html
 * Tests:
 * - tests/conformance/presentation-lifecycle.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createApiApp } from '../../apps/api/dist/api-app.js';
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
  InMemoryPresentationPublicationStore
} from '../../packages/registry/dist/index.js';
import {
  runPresentationPublicationWorkflow
} from '../../packages/workflows/dist/index.js';
import {
  createAuthFixture,
  createJsonBearerHeaders,
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
    this.snapshotResult = snapshotResult;
  }

  async snapshotFromPath() {
    return this.snapshotResult;
  }
}

class FakeDerivedObjectStore {
  constructor(bucket = 'cdngine-derived') {
    this.bucket = bucket;
  }

  async publishObject(input) {
    return {
      bucket: this.bucket,
      key: `derived/${input.objectKey}`
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

test('presentation lifecycle conformance covers workflow selection, deterministic publication, and public manifest resolution', async () => {
  const auth = createAuthFixture();
  const publicActor = await provisionPublicActor(auth);
  const now = () => new Date('2026-01-15T18:50:00.000Z');
  const uploadStore = new InMemoryUploadSessionIssuanceStore({
    generateId: createIdGenerator(),
    now
  });
  const uploadApp = createApiApp({
    auth,
    registerPublicRoutes(publicApp) {
      registerUploadSessionRoutes(publicApp, {
        now,
        sourceRepository: new FakeSourceRepository({
          canonicalSourceId: 'src_001',
          digests: [
            {
              algorithm: 'sha256',
              value: 'deck-sha'
            }
          ],
          logicalPath: 'source/media-platform/ast_001/ver_001/original',
          snapshotId: 'snap_001'
        }),
        stagingBlobStore: new FakeStagingBlobStore({
          'ingest/media-platform/event-deck.pdf': {
            bucket: 'cdngine-ingest',
            checksum: {
              algorithm: 'sha256',
              value: 'deck-sha'
            },
            key: 'ingest/media-platform/event-deck.pdf'
          }
        }),
        store: uploadStore
      });
    }
  });

  const issueResponse = await uploadApp.request('http://localhost/v1/upload-sessions', {
    method: 'POST',
    headers: createJsonBearerHeaders(publicActor.token, {
      'idempotency-key': 'issue-001'
    }),
    body: JSON.stringify({
      assetOwner: 'customer:acme',
      serviceNamespaceId: 'media-platform',
      source: {
        contentType: 'application/pdf',
        filename: 'event-deck.pdf'
      },
      upload: {
        byteLength: 4096,
        checksum: {
          algorithm: 'sha256',
          value: 'deck-sha'
        },
        objectKey: 'ingest/media-platform/event-deck.pdf'
      }
    })
  });
  const issued = await issueResponse.json();

  const completeResponse = await uploadApp.request(
    `http://localhost/v1/upload-sessions/${issued.uploadSessionId}/complete`,
    {
      method: 'POST',
      headers: createJsonBearerHeaders(publicActor.token, {
        'idempotency-key': 'complete-001'
      }),
      body: JSON.stringify({
        stagedObject: {
          byteLength: 4096,
          checksum: {
            algorithm: 'sha256',
            value: 'deck-sha'
          },
          objectKey: 'ingest/media-platform/event-deck.pdf'
        }
      })
    }
  );
  const completed = await completeResponse.json();

  assert.equal(completeResponse.status, 202);
  assert.equal(
    completed.workflowDispatch.workflowKey,
    'media-platform:ast_001:ver_001:presentation-normalization-v1'
  );

  const publicationStore = new InMemoryPresentationPublicationStore({
    versions: [
      {
        assetId: completed.assetId,
        canonicalLogicalPath: 'source/media-platform/ast_001/ver_001/original',
        canonicalSourceId: 'src_001',
        detectedContentType: 'application/pdf',
        serviceNamespaceId: 'media-platform',
        sourceByteLength: 4096n,
        sourceChecksumValue: 'deck-sha',
        sourceFilename: 'event-deck.pdf',
        versionId: completed.versionId,
        versionNumber: 1
      }
    ]
  });

  const workflowResult = await runPresentationPublicationWorkflow(
    {
      deliveryScopeId: 'presentations',
      versionId: completed.versionId,
      workflowId: completed.workflowDispatch.workflowKey
    },
    {
      derivedObjectStore: new FakeDerivedObjectStore(),
      now,
      processorActivity: {
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
      publicationStore
    }
  );

  const publicApp = createApiApp({
    auth,
    registerPublicRoutes(publicRouteApp) {
      registerDeliveryRoutes(publicRouteApp, {
        now,
        store: new InMemoryPublicVersionReadStore({
          versions: [
            {
              assetId: completed.assetId,
              assetOwner: 'customer:acme',
              defaultManifestType: 'presentation-default',
              deliveries: workflowResult.derivatives.map((derivative, index) => ({
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
                  deliveryScopeId: 'presentations',
                  manifestPayload: workflowResult.manifest.manifestPayload,
                  manifestType: 'presentation-default',
                  objectKey: workflowResult.manifest.objectKey,
                  versionId: completed.versionId
                }
              ],
              serviceNamespaceId: 'media-platform',
              source: {
                byteLength: 4096n,
                contentType: 'application/pdf',
                filename: 'event-deck.pdf'
              },
              versionId: completed.versionId,
              versionNumber: 1,
              workflowState: 'completed'
            }
          ]
        })
      });
    }
  });

  const versionResponse = await publicApp.request(
    `http://localhost/v1/assets/${completed.assetId}/versions/${completed.versionId}`,
    {
      headers: createJsonBearerHeaders(publicActor.token, {
        'idempotency-key': 'version-001'
      })
    }
  );
  const manifestResponse = await publicApp.request(
    `http://localhost/v1/assets/${completed.assetId}/versions/${completed.versionId}/manifests/presentation-default`,
    {
      headers: createJsonBearerHeaders(publicActor.token, {
        'idempotency-key': 'manifest-001'
      })
    }
  );
  const deliveryResponse = await publicApp.request(
    `http://localhost/v1/assets/${completed.assetId}/versions/${completed.versionId}/deliveries/presentations/authorize`,
    {
      method: 'POST',
      headers: createJsonBearerHeaders(publicActor.token, {
        'idempotency-key': 'delivery-001'
      }),
      body: JSON.stringify({
        responseFormat: 'url',
        variant: 'slide-001'
      })
    }
  );
  const versionPayload = await versionResponse.json();
  const manifestPayload = await manifestResponse.json();

  assert.equal(versionResponse.status, 200);
  assert.equal(
    versionPayload.links.manifest,
    `/v1/assets/${completed.assetId}/versions/${completed.versionId}/manifests/presentation-default`
  );
  assert.equal(manifestResponse.status, 200);
  assert.equal(manifestPayload.manifestType, 'presentation-default');
  assert.equal(deliveryResponse.status, 200);
});
