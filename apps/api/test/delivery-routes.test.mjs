/**
 * Purpose: Verifies public version reads, derivative and manifest access, derivative delivery authorization, and original-source authorization without leaking storage topology. Includes output-workflow authorization tests.
 * Governing docs:
 * - docs/api-surface.md
 * - docs/original-source-delivery.md
 * - docs/output-workflows.md
 * - docs/storage-tiering-and-materialization.md
 * Tests:
 * - apps/api/test/delivery-routes.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { createApiApp } from '../dist/api-app.js';
import {
  InMemoryPublicVersionReadStore
} from '../dist/public/delivery-service.js';
import {
  InMemoryOutputWorkflowStore,
  createImmediateOutputWorkflowHandler
} from '../dist/public/output-workflow-service.js';
import {
  registerDeliveryRoutes,
  registerDownloadLinkRoutes
} from '../dist/public/delivery-routes.js';
import {
  createAuthFixture,
  createJsonBearerHeaders,
  provisionPublicActor
} from '../../../tests/auth-fixture.mjs';

async function createPublicApp(store, { principalOverrides = {}, outputWorkflowStore } = {}) {
  const auth = createAuthFixture();
  const actor = await provisionPublicActor(auth, principalOverrides);

  return {
    app: createApiApp({
      auth,
      registerCapabilityRoutes(capabilityApp) {
        registerDownloadLinkRoutes(capabilityApp, {
          now: () => new Date('2026-01-15T18:45:00.000Z'),
          store
        });
      },
      registerPublicRoutes(publicApp) {
        registerDeliveryRoutes(publicApp, {
          now: () => new Date('2026-01-15T18:45:00.000Z'),
          outputWorkflowStore,
          store
        });
      }
    }),
    headers(overrides = {}) {
      return createJsonBearerHeaders(actor.token, {
        'idempotency-key': 'idem_123',
        ...overrides
      });
    }
  };
}

const sourceMaterializationRoot =
  'C:\\Users\\svalp\\OneDrive\\Documents\\Development\\antiwork\\cdngine\\apps\\api\\test-output\\source-materializations';

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
  const { app, headers } = await createPublicApp(store);

  const versionResponse = await app.request('http://localhost/v1/assets/ast_001/versions/ver_001', {
    headers: headers()
  });
  const derivativesResponse = await app.request(
    'http://localhost/v1/assets/ast_001/versions/ver_001/derivatives',
    { headers: headers() }
  );
  const manifestResponse = await app.request(
    'http://localhost/v1/assets/ast_001/versions/ver_001/manifests/image-default',
    { headers: headers() }
  );
  const deliveryAuthResponse = await app.request(
    'http://localhost/v1/assets/ast_001/versions/ver_001/deliveries/public-images/authorize',
    {
      method: 'POST',
      headers: headers(),
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
      headers: headers(),
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

test('source authorization materializes legacy Kopia-backed canonical evidence into the export path during migration', async () => {
  await rm(sourceMaterializationRoot, { force: true, recursive: true });

  const sourceRestores = [];
  const exportPublications = [];
  const exportStore = {
    async deleteObject() {},
    async issueSignedReadUrl(objectKey, expiresAt) {
      return {
        expiresAt,
        url: `https://downloads.cdngine.local/${objectKey}`
      };
    },
    async publishExport(input) {
      const chunks = [];
      for await (const chunk of input.body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      exportPublications.push({
        ...input,
        streamedBody: Buffer.concat(chunks).toString('utf8')
      });
      return {
        bucket: 'cdngine-exports',
        key: `exports/${input.objectKey}`
      };
    }
  };
  const sourceRepository = {
    async listSnapshots() {
      return [];
    },
    async restoreToPath(input) {
      sourceRestores.push(input);
      await mkdir(dirname(input.destinationPath), { recursive: true });
      await writeFile(input.destinationPath, Buffer.from('legacy-source-bytes'));
      return {
        restoredPath: input.destinationPath
      };
    },
    async snapshotFromPath() {
      throw new Error('snapshotFromPath should not run in this source authorization test.');
    }
  };
  const store = new InMemoryPublicVersionReadStore({
    sourceReads: {
      exportsObjectStore: exportStore,
      materializationRootPath: sourceMaterializationRoot,
      sourceDeliveryMode: 'materialized-export',
      sourceRepository
    },
    versions: [
      {
        assetId: 'ast_legacy_001',
        assetOwner: 'customer:acme',
        canonicalSourceEvidence: {
          repositoryEngine: 'kopia',
          canonicalSourceId: 'legacy_src_001',
          canonicalSnapshotId: 'snap_legacy_001',
          canonicalLogicalPath:
            'source/media-platform/ast_legacy_001/ver_legacy_001/original/legacy-source.psd',
          canonicalDigestSet: [
            {
              algorithm: 'sha256',
              value: 'legacy-sha256'
            }
          ],
          sourceReconstructionHandles: [
            {
              kind: 'snapshot',
              value: 'snap_legacy_001'
            }
          ]
        },
        lifecycleState: 'canonical',
        serviceNamespaceId: 'media-platform',
        source: {
          byteLength: 19n,
          contentType: 'image/vnd.adobe.photoshop',
          filename: 'legacy-source.psd'
        },
        tenantId: 'tenant-acme',
        versionId: 'ver_legacy_001',
        versionNumber: 7,
        workflowState: 'completed'
      }
    ]
  });
  const { app, headers } = await createPublicApp(store);

  const response = await app.request(
    'http://localhost/v1/assets/ast_legacy_001/versions/ver_legacy_001/source/authorize',
    {
      method: 'POST',
      headers: headers({
        'idempotency-key': 'idem-source-materialize'
      }),
      body: JSON.stringify({
        preferredDisposition: 'attachment'
      })
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    assetId: 'ast_legacy_001',
    authorizationMode: 'signed-url',
    expiresAt: '2026-01-15T19:00:00.000Z',
    resolvedOrigin: 'source-export',
    tenantId: 'tenant-acme',
    url: 'https://downloads.cdngine.local/source-downloads/media-platform/ast_legacy_001/ver_legacy_001/legacy-source.psd',
    versionId: 'ver_legacy_001'
  });
  assert.equal(sourceRestores[0]?.snapshot?.repositoryEngine, 'kopia');
  assert.equal(
    sourceRestores[0]?.snapshot?.reconstructionHandles?.[0]?.value,
    'snap_legacy_001'
  );
  assert.equal(exportPublications[0]?.streamedBody, 'legacy-source-bytes');

  await rm(sourceMaterializationRoot, { force: true, recursive: true });
});

test('source authorization sanitizes persisted filenames for materialization and streams exports without buffering', async () => {
  await rm(sourceMaterializationRoot, { force: true, recursive: true });

  const sourceRestores = [];
  const exportPublications = [];
  const exportStore = {
    async deleteObject() {},
    async issueSignedReadUrl(objectKey, expiresAt) {
      return {
        expiresAt,
        url: `https://downloads.cdngine.local/${objectKey}`
      };
    },
    async publishExport(input) {
      const chunks = [];
      for await (const chunk of input.body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      exportPublications.push({
        ...input,
        streamedBody: Buffer.concat(chunks).toString('utf8')
      });
      return {
        bucket: 'cdngine-exports',
        key: `exports/${input.objectKey}`
      };
    }
  };
  const sourceRepository = {
    async listSnapshots() {
      return [];
    },
    async restoreToPath(input) {
      sourceRestores.push(input);
      await mkdir(dirname(input.destinationPath), { recursive: true });
      await writeFile(input.destinationPath, Buffer.from('streamed-legacy-source'));
      return {
        restoredPath: input.destinationPath
      };
    },
    async snapshotFromPath() {
      throw new Error('snapshotFromPath should not run in this source authorization test.');
    }
  };
  const store = new InMemoryPublicVersionReadStore({
    sourceReads: {
      exportsObjectStore: exportStore,
      materializationRootPath: sourceMaterializationRoot,
      sourceDeliveryMode: 'materialized-export',
      sourceRepository
    },
    versions: [
      {
        assetId: 'ast_legacy_unsafe',
        assetOwner: 'customer:acme',
        canonicalSourceEvidence: {
          repositoryEngine: 'kopia',
          canonicalSourceId: 'legacy_src_unsafe',
          canonicalSnapshotId: 'snap_legacy_unsafe',
          canonicalLogicalPath:
            'source/media-platform/ast_legacy_unsafe/ver_legacy_unsafe/original/..\\unsafe\\legacy-source.psd',
          canonicalDigestSet: [
            {
              algorithm: 'sha256',
              value: 'legacy-sha256'
            }
          ],
          sourceReconstructionHandles: [
            {
              kind: 'snapshot',
              value: 'snap_legacy_unsafe'
            }
          ]
        },
        lifecycleState: 'canonical',
        serviceNamespaceId: 'media-platform',
        source: {
          byteLength: 22n,
          contentType: 'image/vnd.adobe.photoshop',
          filename: '..\\..\\unsafe\\legacy-source.psd'
        },
        tenantId: 'tenant-acme',
        versionId: 'ver_legacy_unsafe',
        versionNumber: 8,
        workflowState: 'completed'
      }
    ]
  });
  const { app, headers } = await createPublicApp(store);

  const response = await app.request(
    'http://localhost/v1/assets/ast_legacy_unsafe/versions/ver_legacy_unsafe/source/authorize',
    {
      method: 'POST',
      headers: headers({
        'idempotency-key': 'idem-source-sanitized'
      }),
      body: JSON.stringify({
        preferredDisposition: 'attachment'
      })
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    assetId: 'ast_legacy_unsafe',
    authorizationMode: 'signed-url',
    expiresAt: '2026-01-15T19:00:00.000Z',
    resolvedOrigin: 'source-export',
    tenantId: 'tenant-acme',
    url: 'https://downloads.cdngine.local/source-downloads/media-platform/ast_legacy_unsafe/ver_legacy_unsafe/legacy-source.psd',
    versionId: 'ver_legacy_unsafe'
  });
  assert.match(
    sourceRestores[0]?.destinationPath ?? '',
    /source-materializations\\ast_legacy_unsafe\\ver_legacy_unsafe\\legacy-source\.psd$/
  );
  assert.equal(typeof exportPublications[0]?.body?.pipe, 'function');
  assert.equal(exportPublications[0]?.streamedBody, 'streamed-legacy-source');

  await rm(sourceMaterializationRoot, { force: true, recursive: true });
});

test('delivery routes can issue and consume one-time download links', async () => {
  const issuedTokens = ['lnk_delivery_001', 'lnk_source_001'];
  const store = new InMemoryPublicVersionReadStore({
    linkTokenFactory: () => issuedTokens.shift() ?? 'lnk_fallback_001',
    versions: [
      {
        assetId: 'ast_010',
        assetOwner: 'customer:acme',
        deliveries: [
          {
            assetId: 'ast_010',
            byteLength: 512334n,
            contentType: 'image/webp',
            deliveryScopeId: 'paid-downloads',
            deterministicKey: 'deriv/media-platform/ast_010/ver_010/download-pdf/download-pdf',
            derivativeId: 'drv_010',
            recipeId: 'download-pdf',
            storageKey: 'derived/paid-downloads/ast_010/ver_010/download-pdf.pdf',
            variant: 'download-pdf',
            versionId: 'ver_010'
          }
        ],
        lifecycleState: 'published',
        serviceNamespaceId: 'media-platform',
        source: {
          byteLength: 1024n,
          contentType: 'application/pdf',
          filename: 'paid-file.pdf'
        },
        sourceAuthorization: {
          authorizationMode: 'signed-url',
          expiresAt: new Date('2026-01-15T19:00:00.000Z'),
          resolvedOrigin: 'source-export',
          url: 'https://downloads.cdngine.local/source/exp_once_010'
        },
        tenantId: 'tenant-acme',
        versionId: 'ver_010',
        versionNumber: 1,
        workflowState: 'completed'
      }
    ]
  });
  const { app, headers } = await createPublicApp(store);

  const deliveryAuthResponse = await app.request(
    'http://localhost/v1/assets/ast_010/versions/ver_010/deliveries/paid-downloads/authorize',
    {
      method: 'POST',
      headers: headers({
        'idempotency-key': 'idem-delivery-once'
      }),
      body: JSON.stringify({
        oneTime: true,
        responseFormat: 'url',
        variant: 'download-pdf'
      })
    }
  );
  const sourceAuthResponse = await app.request(
    'http://localhost/v1/assets/ast_010/versions/ver_010/source/authorize',
    {
      method: 'POST',
      headers: headers({
        'idempotency-key': 'idem-source-once'
      }),
      body: JSON.stringify({
        oneTime: true,
        preferredDisposition: 'attachment'
      })
    }
  );

  assert.equal(deliveryAuthResponse.status, 200);
  assert.deepEqual(await deliveryAuthResponse.json(), {
    assetId: 'ast_010',
    authorizationMode: 'signed-url',
    deliveryScopeId: 'paid-downloads',
    expiresAt: '2026-01-15T19:00:00.000Z',
    oneTime: true,
    remainingUses: 1,
    resolvedOrigin: 'cdn-derived',
    url: 'https://api.cdngine.local/download-links/lnk_delivery_001',
    versionId: 'ver_010'
  });

  assert.equal(sourceAuthResponse.status, 200);
  assert.deepEqual(await sourceAuthResponse.json(), {
    assetId: 'ast_010',
    authorizationMode: 'signed-url',
    expiresAt: '2026-01-15T19:00:00.000Z',
    oneTime: true,
    remainingUses: 1,
    resolvedOrigin: 'source-export',
    url: 'https://api.cdngine.local/download-links/lnk_source_001',
    versionId: 'ver_010'
  });

  const firstUseResponse = await app.request('http://localhost/download-links/lnk_source_001', {
    redirect: 'manual'
  });
  const secondUseResponse = await app.request('http://localhost/download-links/lnk_source_001', {
    redirect: 'manual'
  });

  assert.equal(firstUseResponse.status, 302);
  assert.equal(
    firstUseResponse.headers.get('location'),
    'https://downloads.cdngine.local/source/exp_once_010'
  );
  assert.equal(secondUseResponse.status, 404);
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
  const { app, headers } = await createPublicApp(store);

  const response = await app.request(
    'http://localhost/v1/assets/ast_001/versions/ver_001/derivatives',
    { headers: headers() }
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
  const { app, headers } = await createPublicApp(store);

  const versionResponse = await app.request('http://localhost/v1/assets/ast_002/versions/ver_010', {
    headers: headers()
  });
  const manifestResponse = await app.request(
    'http://localhost/v1/assets/ast_002/versions/ver_010/manifests/presentation-default',
    { headers: headers() }
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

test('delivery routes deny callers outside the version tenant scope', async () => {
  const store = new InMemoryPublicVersionReadStore({
    versions: [
      {
        assetId: 'ast_003',
        assetOwner: 'customer:acme',
        lifecycleState: 'published',
        serviceNamespaceId: 'media-platform',
        source: {
          byteLength: 128n,
          contentType: 'image/png',
          filename: 'tenant-private.png'
        },
        tenantId: 'tenant-acme',
        versionId: 'ver_003',
        versionNumber: 1,
        workflowState: 'completed'
      }
    ]
  });
  const { app, headers } = await createPublicApp(store, {
    principalOverrides: {
      allowedTenantIds: ['tenant-beta'],
      email: 'tenant-beta-viewer@cdngine.test',
      subject: 'tenant-beta-user'
    }
  });

  const response = await app.request('http://localhost/v1/assets/ast_003/versions/ver_003', {
    headers: headers()
  });
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.equal(payload.type, 'https://docs.cdngine.dev/problems/scope-not-allowed');
});

// ---------------------------------------------------------------------------
// Output-workflow tests
// ---------------------------------------------------------------------------

function buildOutputWorkflowStore() {
  return new InMemoryPublicVersionReadStore({
    versions: [
      {
        assetId: 'ast_ow1',
        assetOwner: 'customer:acme',
        deliveries: [
          {
            assetId: 'ast_ow1',
            byteLength: 204800n,
            contentType: 'image/webp',
            deliveryScopeId: 'paid-scope',
            deterministicKey: 'deriv/media-platform/ast_ow1/ver_ow1/image-default/webp-1600',
            derivativeId: 'drv_ow1',
            recipeId: 'image-default',
            storageKey: 'derived/paid-scope/ast_ow1/ver_ow1/webp-1600',
            variant: 'webp-1600',
            versionId: 'ver_ow1'
          }
        ],
        lifecycleState: 'published',
        serviceNamespaceId: 'media-platform',
        source: {
          byteLength: 1024n,
          contentType: 'application/zip',
          filename: 'software.zip'
        },
        sourceAuthorization: {
          authorizationMode: 'signed-url',
          expiresAt: new Date('2026-01-15T19:00:00.000Z'),
          resolvedOrigin: 'source-export',
          url: 'https://downloads.cdngine.local/source/exp_ow1'
        },
        tenantId: 'tenant-acme',
        versionId: 'ver_ow1',
        versionNumber: 1,
        workflowState: 'completed'
      }
    ]
  });
}

test('source authorization ignores outputWorkflow when no output workflow store is configured', async () => {
  const store = buildOutputWorkflowStore();
  const { app, headers } = await createPublicApp(store);

  const response = await app.request(
    'http://localhost/v1/assets/ast_ow1/versions/ver_ow1/source/authorize',
    {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        outputWorkflow: { outputWorkflowId: 'license-inject-v1' }
      })
    }
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.url, 'https://downloads.cdngine.local/source/exp_ow1');
  assert.equal(payload.outputWorkflowRun, undefined);
});

test('source authorization with output workflow store replaces url and adds outputWorkflowRun', async () => {
  const store = buildOutputWorkflowStore();
  const outputWorkflowStore = new InMemoryOutputWorkflowStore({
    handlers: new Map([
      [
        'license-inject-v1',
        createImmediateOutputWorkflowHandler(
          (_ctx, runId) => `https://transforms.cdngine.local/output/${runId}`
        )
      ]
    ]),
    runIdFactory: () => 'owrun_001'
  });
  const { app, headers } = await createPublicApp(store, { outputWorkflowStore });

  const response = await app.request(
    'http://localhost/v1/assets/ast_ow1/versions/ver_ow1/source/authorize',
    {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        outputWorkflow: {
          outputWorkflowId: 'license-inject-v1',
          outputParameters: { licenseKey: 'XXXX-YYYY', licensee: 'Acme Corp' }
        }
      })
    }
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.url, 'https://transforms.cdngine.local/output/owrun_001');
  assert.equal(payload.outputWorkflowRun.runId, 'owrun_001');
  assert.equal(payload.outputWorkflowRun.state, 'complete');
  assert.equal(payload.outputWorkflowRun.url, 'https://transforms.cdngine.local/output/owrun_001');
  assert.equal(payload.outputWorkflowRun.outputWorkflowId, 'license-inject-v1');
});

test('delivery authorization with output workflow store replaces url and adds outputWorkflowRun', async () => {
  const store = buildOutputWorkflowStore();
  const outputWorkflowStore = new InMemoryOutputWorkflowStore({
    handlers: new Map([
      [
        'watermark-v1',
        createImmediateOutputWorkflowHandler(
          () => 'https://transforms.cdngine.local/watermarked/ast_ow1/ver_ow1/webp-1600'
        )
      ]
    ]),
    runIdFactory: () => 'owrun_002'
  });
  const { app, headers } = await createPublicApp(store, { outputWorkflowStore });

  const response = await app.request(
    'http://localhost/v1/assets/ast_ow1/versions/ver_ow1/deliveries/paid-scope/authorize',
    {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        outputWorkflow: { outputWorkflowId: 'watermark-v1' },
        variant: 'webp-1600'
      })
    }
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(
    payload.url,
    'https://transforms.cdngine.local/watermarked/ast_ow1/ver_ow1/webp-1600'
  );
  assert.equal(payload.outputWorkflowRun.runId, 'owrun_002');
  assert.equal(payload.outputWorkflowRun.state, 'complete');
});

test('source authorization with unknown outputWorkflowId returns 404', async () => {
  const store = buildOutputWorkflowStore();
  const outputWorkflowStore = new InMemoryOutputWorkflowStore({ handlers: new Map() });
  const { app, headers } = await createPublicApp(store, { outputWorkflowStore });

  const response = await app.request(
    'http://localhost/v1/assets/ast_ow1/versions/ver_ow1/source/authorize',
    {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        outputWorkflow: { outputWorkflowId: 'does-not-exist' }
      })
    }
  );
  const payload = await response.json();

  assert.equal(response.status, 404);
  assert.equal(payload.type, 'https://docs.cdngine.dev/problems/output-workflow-not-found');
  assert.equal(payload.retryable, false);
});

test('source authorization with malformed outputWorkflow body returns 400', async () => {
  const store = buildOutputWorkflowStore();
  const { app, headers } = await createPublicApp(store);

  const response = await app.request(
    'http://localhost/v1/assets/ast_ow1/versions/ver_ow1/source/authorize',
    {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        outputWorkflow: { outputWorkflowId: '' }
      })
    }
  );

  assert.equal(response.status, 400);
});
