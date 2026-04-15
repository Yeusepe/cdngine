/**
 * Purpose: Verifies public version reads, derivative and manifest access, derivative delivery authorization, and original-source authorization without leaking storage topology.
 * Governing docs:
 * - docs/api-surface.md
 * - docs/original-source-delivery.md
 * - docs/storage-tiering-and-materialization.md
 * Tests:
 * - apps/api/test/delivery-routes.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createApiApp } from '../dist/api-app.js';
import {
  InMemoryPublicVersionReadStore
} from '../dist/public/delivery-service.js';
import {
  registerDeliveryRoutes
} from '../dist/public/delivery-routes.js';

function createAuthedHeaders(overrides = {}) {
  return {
    authorization: 'Bearer user_123',
    'content-type': 'application/json',
    'idempotency-key': 'idem_123',
    'x-cdngine-allowed-namespaces': 'media-platform',
    ...overrides
  };
}

function createPublicApp(store) {
  return createApiApp({
    registerPublicRoutes(publicApp) {
      registerDeliveryRoutes(publicApp, {
        now: () => new Date('2026-01-15T18:45:00.000Z'),
        store
      });
    }
  });
}

test('public delivery routes expose published versions, derivatives, manifests, and authorization handles', async () => {
  const store = new InMemoryPublicVersionReadStore({
    versions: [
      {
        assetId: 'ast_001',
        assetOwner: 'customer:acme',
        deliveries: [
          {
            assetId: 'ast_001',
            byteLength: 512334n,
            contentType: 'image/webp',
            deliveryScopeId: 'public-images',
            deterministicKey: 'deriv/media-platform/ast_001/ver_001/image-default/webp-1600',
            derivativeId: 'drv_001',
            recipeId: 'image-default',
            storageKey: 'derived/public-images/ast_001/ver_001/webp-1600',
            variant: 'webp-1600',
            versionId: 'ver_001'
          }
        ],
        lifecycleState: 'published',
        manifests: [
          {
            assetId: 'ast_001',
            deliveryScopeId: 'public-images',
            manifestPayload: {
              assetId: 'ast_001',
              derivatives: [
                {
                  contentType: 'image/webp',
                  deterministicKey: 'deriv/media-platform/ast_001/ver_001/image-default/webp-1600',
                  variant: 'webp-1600'
                }
              ],
              manifestType: 'image-default',
              schemaVersion: '1.0.0',
              versionId: 'ver_001'
            },
            manifestType: 'image-default',
            objectKey: 'manifests/media-platform/ast_001/ver_001/image-default.json',
            versionId: 'ver_001'
          }
        ],
        serviceNamespaceId: 'media-platform',
        source: {
          byteLength: 1843921n,
          contentType: 'image/png',
          filename: 'hero-banner.png'
        },
        sourceAuthorization: {
          authorizationMode: 'signed-url',
          expiresAt: new Date('2026-01-15T19:00:00.000Z'),
          resolvedOrigin: 'source-export',
          url: 'https://downloads.cdngine.local/source/exp_001'
        },
        tenantId: 'tenant-acme',
        versionId: 'ver_001',
        versionNumber: 3,
        workflowState: 'completed'
      }
    ]
  });
  const app = createPublicApp(store);

  const versionResponse = await app.request('http://localhost/v1/assets/ast_001/versions/ver_001', {
    headers: createAuthedHeaders()
  });
  const derivativesResponse = await app.request(
    'http://localhost/v1/assets/ast_001/versions/ver_001/derivatives',
    { headers: createAuthedHeaders() }
  );
  const manifestResponse = await app.request(
    'http://localhost/v1/assets/ast_001/versions/ver_001/manifests/image-default',
    { headers: createAuthedHeaders() }
  );
  const deliveryAuthResponse = await app.request(
    'http://localhost/v1/assets/ast_001/versions/ver_001/deliveries/public-images/authorize',
    {
      method: 'POST',
      headers: createAuthedHeaders(),
      body: JSON.stringify({
        responseFormat: 'url',
        variant: 'webp-1600'
      })
    }
  );
  const sourceAuthResponse = await app.request(
    'http://localhost/v1/assets/ast_001/versions/ver_001/source/authorize',
    {
      method: 'POST',
      headers: createAuthedHeaders(),
      body: JSON.stringify({
        preferredDisposition: 'attachment'
      })
    }
  );

  assert.equal(versionResponse.status, 200);
  assert.equal((await versionResponse.json()).lifecycleState, 'published');
  assert.equal(derivativesResponse.status, 200);
  assert.equal((await derivativesResponse.json()).derivatives[0].variant, 'webp-1600');
  assert.equal(manifestResponse.status, 200);
  assert.equal((await manifestResponse.json()).manifestType, 'image-default');
  assert.equal(deliveryAuthResponse.status, 200);
  assert.deepEqual(await deliveryAuthResponse.json(), {
    assetId: 'ast_001',
    authorizationMode: 'signed-url',
    deliveryScopeId: 'public-images',
    expiresAt: '2026-01-15T19:00:00.000Z',
    resolvedOrigin: 'cdn-derived',
    url: 'https://cdn.cdngine.local/public-images/webp-1600',
    versionId: 'ver_001'
  });
  assert.equal(sourceAuthResponse.status, 200);
  assert.deepEqual(await sourceAuthResponse.json(), {
    assetId: 'ast_001',
    authorizationMode: 'signed-url',
    expiresAt: '2026-01-15T19:00:00.000Z',
    resolvedOrigin: 'source-export',
    url: 'https://downloads.cdngine.local/source/exp_001',
    versionId: 'ver_001'
  });
});

test('delivery routes reject unpublished versions as not ready', async () => {
  const store = new InMemoryPublicVersionReadStore({
    versions: [
      {
        assetId: 'ast_001',
        assetOwner: 'customer:acme',
        lifecycleState: 'processing',
        serviceNamespaceId: 'media-platform',
        source: {
          byteLength: 1843921n,
          contentType: 'image/png',
          filename: 'hero-banner.png'
        },
        versionId: 'ver_001',
        versionNumber: 3,
        workflowState: 'running'
      }
    ]
  });
  const app = createPublicApp(store);

  const response = await app.request(
    'http://localhost/v1/assets/ast_001/versions/ver_001/derivatives',
    { headers: createAuthedHeaders() }
  );
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.equal(payload.type, 'https://docs.cdngine.dev/problems/version-not-ready');
});

test('public version links and manifest reads support presentation workloads', async () => {
  const store = new InMemoryPublicVersionReadStore({
    versions: [
      {
        assetId: 'ast_002',
        assetOwner: 'customer:acme',
        defaultManifestType: 'presentation-default',
        deliveries: [
          {
            assetId: 'ast_002',
            byteLength: 1024n,
            contentType: 'application/pdf',
            deliveryScopeId: 'presentations',
            deterministicKey: 'deriv/media-platform/ast_002/ver_010/normalized-pdf/normalized-pdf',
            derivativeId: 'drv_010',
            recipeId: 'normalized-pdf',
            storageKey: 'derived/presentations/ast_002/ver_010/normalized-pdf.pdf',
            variant: 'normalized-pdf',
            versionId: 'ver_010'
          },
          {
            assetId: 'ast_002',
            byteLength: 256n,
            contentType: 'image/webp',
            deliveryScopeId: 'presentations',
            deterministicKey: 'deriv/media-platform/ast_002/ver_010/slide-images/slide-001',
            derivativeId: 'drv_011',
            recipeId: 'slide-images',
            storageKey: 'derived/presentations/ast_002/ver_010/slide-001.webp',
            variant: 'slide-001',
            versionId: 'ver_010'
          }
        ],
        lifecycleState: 'published',
        manifests: [
          {
            assetId: 'ast_002',
            deliveryScopeId: 'presentations',
            manifestPayload: {
              assetId: 'ast_002',
              manifestType: 'presentation-default',
              normalizedDocument: {
                contentType: 'application/pdf',
                deterministicKey: 'deriv/media-platform/ast_002/ver_010/normalized-pdf/normalized-pdf',
                variantKey: 'normalized-pdf'
              },
              schemaVersion: '1.0.0',
              slides: [
                {
                  contentType: 'image/webp',
                  deterministicKey: 'deriv/media-platform/ast_002/ver_010/slide-images/slide-001',
                  pageNumber: 1,
                  variantKey: 'slide-001'
                }
              ],
              versionId: 'ver_010'
            },
            manifestType: 'presentation-default',
            objectKey: 'manifests/media-platform/ast_002/ver_010/presentation-default.json',
            versionId: 'ver_010'
          }
        ],
        serviceNamespaceId: 'media-platform',
        source: {
          byteLength: 4096n,
          contentType: 'application/pdf',
          filename: 'event-deck.pdf'
        },
        versionId: 'ver_010',
        versionNumber: 1,
        workflowState: 'completed'
      }
    ]
  });
  const app = createPublicApp(store);

  const versionResponse = await app.request('http://localhost/v1/assets/ast_002/versions/ver_010', {
    headers: createAuthedHeaders()
  });
  const manifestResponse = await app.request(
    'http://localhost/v1/assets/ast_002/versions/ver_010/manifests/presentation-default',
    { headers: createAuthedHeaders() }
  );
  const versionPayload = await versionResponse.json();
  const manifestPayload = await manifestResponse.json();

  assert.equal(versionResponse.status, 200);
  assert.equal(
    versionPayload.links.manifest,
    '/v1/assets/ast_002/versions/ver_010/manifests/presentation-default'
  );
  assert.equal(manifestResponse.status, 200);
  assert.equal(manifestPayload.manifestType, 'presentation-default');
});
