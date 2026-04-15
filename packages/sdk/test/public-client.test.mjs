/**
 * Purpose: Verifies that the checked-in TypeScript client wraps implemented public flows with stable request paths, idempotency headers, typed problem decoding, and polling behavior.
 * Governing docs:
 * - docs/sdk-strategy.md
 * - docs/spec-governance.md
 * - docs/api-surface.md
 * Tests:
 * - packages/sdk/test/public-client.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CDNgineClientError,
  CDNginePublicClient,
  createCDNgineClient
} from '../dist/public-client.js';

function createJsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json'
    },
    status
  });
}

test('CDNginePublicClient sends expected request paths and idempotency headers for mutating public flows', async () => {
  const requests = [];
  const client = new CDNginePublicClient({
    baseUrl: 'https://api.cdngine.local',
    fetch: async (url, init) => {
      requests.push({
        body: init?.body ? JSON.parse(init.body) : undefined,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        method: init?.method,
        url
      });

      return createJsonResponse({
        ok: true
      });
    },
    getAccessToken: 'token_123'
  });

  await client.createUploadSession({
    body: {
      assetOwner: 'customer:acme',
      serviceNamespaceId: 'media-platform',
      source: {
        contentType: 'image/png',
        filename: 'hero-banner.png'
      },
      upload: {
        byteLength: 1843921,
        checksum: {
          algorithm: 'sha256',
          value: 'abc123'
        },
        objectKey: 'uploads/hero-banner.png'
      }
    },
    idempotencyKey: 'idem-create'
  });
  await client.completeUploadSession({
    body: {
      stagedObject: {
        byteLength: 1843921,
        checksum: {
          algorithm: 'sha256',
          value: 'abc123'
        },
        objectKey: 'uploads/hero-banner.png'
      }
    },
    idempotencyKey: 'idem-complete',
    uploadSessionId: 'upl_001'
  });
  await client.authorizeDelivery({
    assetId: 'ast_001',
    body: {
      responseFormat: 'url',
      variant: 'webp-master'
    },
    deliveryScopeId: 'public-images',
    idempotencyKey: 'idem-delivery',
    versionId: 'ver_001'
  });

  assert.equal(requests.length, 3);
  assert.equal(requests[0].url, 'https://api.cdngine.local/v1/upload-sessions');
  assert.equal(requests[0].headers.authorization, 'Bearer token_123');
  assert.equal(requests[0].headers['idempotency-key'], 'idem-create');
  assert.equal(
    requests[1].url,
    'https://api.cdngine.local/v1/upload-sessions/upl_001/complete'
  );
  assert.equal(
    requests[2].url,
    'https://api.cdngine.local/v1/assets/ast_001/versions/ver_001/deliveries/public-images/authorize'
  );
});

test('CDNginePublicClient decodes RFC 9457 problems as typed client errors', async () => {
  const client = new CDNginePublicClient({
    baseUrl: 'https://api.cdngine.local',
    fetch: async () =>
      createJsonResponse(
        {
          detail: 'Version is still processing.',
          retryable: true,
          status: 409,
          title: 'Version not ready',
          type: 'https://docs.cdngine.dev/problems/version-not-ready'
        },
        409
      )
  });

  await assert.rejects(
    () => client.getAssetVersion('ast_001', 'ver_001'),
    (error) =>
      error instanceof CDNgineClientError &&
      error.problem.type === 'https://docs.cdngine.dev/problems/version-not-ready' &&
      error.problem.retryable === true
  );
});

test('CDNginePublicClient waitForVersion polls until a terminal lifecycle state is reached', async () => {
  let attempt = 0;
  const client = new CDNginePublicClient({
    baseUrl: 'https://api.cdngine.local',
    fetch: async () => {
      attempt += 1;

      return createJsonResponse({
        assetId: 'ast_001',
        lifecycleState: attempt >= 3 ? 'published' : 'processing',
        links: {
          derivatives: '/v1/assets/ast_001/versions/ver_001/derivatives',
          manifest: '/v1/assets/ast_001/versions/ver_001/manifests/image-default',
          self: '/v1/assets/ast_001/versions/ver_001'
        },
        serviceNamespaceId: 'media-platform',
        source: {
          byteLength: 1843921,
          contentType: 'image/png',
          filename: 'hero-banner.png'
        },
        versionId: 'ver_001',
        versionNumber: 1,
        workflowState: attempt >= 3 ? 'completed' : 'running'
      });
    }
  });

  const version = await client.waitForVersion('ast_001', 'ver_001', {
    intervalMs: 1,
    timeoutMs: 100
  });

  assert.equal(version.lifecycleState, 'published');
  assert.equal(attempt, 3);
});

test('fluent asset handles read like task-oriented SDK calls', async () => {
  const requests = [];
  const client = createCDNgineClient({
    baseUrl: 'https://api.cdngine.local',
    fetch: async (url, init) => {
      requests.push({
        body: init?.body ? JSON.parse(init.body) : undefined,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        method: init?.method,
        url
      });

      if (String(url).endsWith('/versions/ver_001')) {
        return createJsonResponse({
          assetId: 'ast_001',
          lifecycleState: 'published',
          links: {
            derivatives: '/v1/assets/ast_001/versions/ver_001/derivatives',
            manifest: '/v1/assets/ast_001/versions/ver_001/manifests/image-default',
            self: '/v1/assets/ast_001/versions/ver_001'
          },
          serviceNamespaceId: 'media-platform',
          source: {
            byteLength: 1843921,
            contentType: 'image/png',
            filename: 'hero-banner.png'
          },
          versionId: 'ver_001',
          versionNumber: 1,
          workflowState: 'completed'
        });
      }

      if (String(url).includes('/manifests/')) {
        return createJsonResponse({
          assetId: 'ast_001',
          manifestType: 'image-default',
          schemaVersion: '1.0.0',
          versionId: 'ver_001'
        });
      }

      return createJsonResponse({
        authorizationMode: 'signed-url',
        url: 'https://cdn.cdngine.local/public-images/webp-master'
      });
    },
    getAccessToken: 'token_123'
  });

  const version = client.asset('ast_001').version('ver_001');
  await version.get();
  await version.manifest('image-default').get();
  await version.delivery('public-images').authorize({
    body: {
      responseFormat: 'url',
      variant: 'webp-master'
    },
    idempotencyKey: 'idem-delivery'
  });

  assert.equal(requests.length, 3);
  assert.equal(requests[0].url, 'https://api.cdngine.local/v1/assets/ast_001/versions/ver_001');
  assert.equal(
    requests[1].url,
    'https://api.cdngine.local/v1/assets/ast_001/versions/ver_001/manifests/image-default'
  );
  assert.equal(
    requests[2].url,
    'https://api.cdngine.local/v1/assets/ast_001/versions/ver_001/deliveries/public-images/authorize'
  );
});

test('assets.uploadAndWait orchestrates create, complete, and wait with one call', async () => {
  let attempt = 0;
  const requests = [];
  const client = new CDNginePublicClient({
    baseUrl: 'https://api.cdngine.local',
    fetch: async (url, init) => {
      const request = {
        body: init?.body ? JSON.parse(init.body) : undefined,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        method: init?.method,
        url: String(url)
      };
      requests.push(request);

      if (request.url.endsWith('/v1/upload-sessions')) {
        return createJsonResponse({
          assetId: 'ast_001',
          isDuplicate: false,
          links: {
            complete: '/v1/upload-sessions/upl_001/complete'
          },
          uploadSessionId: 'upl_001',
          versionId: 'ver_001'
        }, 201);
      }

      if (request.url.endsWith('/v1/upload-sessions/upl_001/complete')) {
        return createJsonResponse({
          assetId: 'ast_001',
          uploadSessionId: 'upl_001',
          versionId: 'ver_001',
          versionState: 'canonical',
          workflowDispatch: {
            dispatchId: 'wd_001',
            state: 'pending',
            workflowKey: 'media-platform:ast_001:ver_001:image-derivation-v1'
          }
        }, 202);
      }

      attempt += 1;

      return createJsonResponse({
        assetId: 'ast_001',
        lifecycleState: attempt >= 2 ? 'published' : 'processing',
        links: {
          derivatives: '/v1/assets/ast_001/versions/ver_001/derivatives',
          manifest: '/v1/assets/ast_001/versions/ver_001/manifests/image-default',
          self: '/v1/assets/ast_001/versions/ver_001'
        },
        serviceNamespaceId: 'media-platform',
        source: {
          byteLength: 1843921,
          contentType: 'image/png',
          filename: 'hero-banner.png'
        },
        versionId: 'ver_001',
        versionNumber: 1,
        workflowState: attempt >= 2 ? 'completed' : 'running'
      });
    },
    getAccessToken: 'token_123'
  });

  const result = await client.assets.uploadAndWait({
    create: {
      body: {
        assetOwner: 'customer:acme',
        serviceNamespaceId: 'media-platform',
        source: {
          contentType: 'image/png',
          filename: 'hero-banner.png'
        },
        upload: {
          byteLength: 1843921,
          checksum: {
            algorithm: 'sha256',
            value: 'abc123'
          },
          objectKey: 'uploads/hero-banner.png'
        }
      },
      idempotencyKey: 'idem-create'
    },
    complete: {
      body: {
        stagedObject: {
          byteLength: 1843921,
          checksum: {
            algorithm: 'sha256',
            value: 'abc123'
          },
          objectKey: 'uploads/hero-banner.png'
        }
      },
      idempotencyKey: 'idem-complete'
    },
    wait: {
      intervalMs: 1,
      timeoutMs: 100
    }
  });

  assert.equal(result.uploadSessionId, 'upl_001');
  assert.equal(result.version.lifecycleState, 'published');
  assert.equal(requests.length, 4);
});

test('assets.uploadFileAndWait uploads bytes through the returned tus target and waits for publication', async () => {
  let attempt = 0;
  const requests = [];
  const client = new CDNginePublicClient({
    baseUrl: 'https://api.cdngine.local',
    fetch: async (url, init) => {
      const request = {
        body: init?.body,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        method: init?.method,
        url: String(url)
      };
      requests.push(request);

      if (request.url.endsWith('/v1/upload-sessions')) {
        return createJsonResponse(
          {
            assetId: 'ast_002',
            isDuplicate: false,
            links: {
              complete: '/v1/upload-sessions/upl_002/complete'
            },
            status: 'awaiting-upload',
            uploadSessionId: 'upl_002',
            uploadTarget: {
              expiresAt: '2026-01-15T18:00:00.000Z',
              method: 'PATCH',
              protocol: 'tus',
              url: 'https://uploads.cdngine.local/files/upl_002'
            },
            versionId: 'ver_002'
          },
          201
        );
      }

      if (request.url === 'https://uploads.cdngine.local/files/upl_002') {
        return new Response(null, {
          status: 204
        });
      }

      if (request.url.endsWith('/v1/upload-sessions/upl_002/complete')) {
        return createJsonResponse(
          {
            assetId: 'ast_002',
            uploadSessionId: 'upl_002',
            versionId: 'ver_002',
            versionState: 'canonical',
            workflowDispatch: {
              dispatchId: 'wd_002',
              state: 'pending',
              workflowKey: 'media-platform:ast_002:ver_002:image-derivation-v1'
            }
          },
          202
        );
      }

      attempt += 1;

      return createJsonResponse({
        assetId: 'ast_002',
        lifecycleState: attempt >= 2 ? 'published' : 'processing',
        links: {
          derivatives: '/v1/assets/ast_002/versions/ver_002/derivatives',
          manifest: '/v1/assets/ast_002/versions/ver_002/manifests/image-default',
          self: '/v1/assets/ast_002/versions/ver_002'
        },
        serviceNamespaceId: 'media-platform',
        source: {
          byteLength: 3,
          contentType: 'image/png',
          filename: 'hero-banner.png'
        },
        versionId: 'ver_002',
        versionNumber: 1,
        workflowState: attempt >= 2 ? 'completed' : 'running'
      });
    },
    getAccessToken: 'token_123'
  });

  const result = await client.assets.uploadFileAndWait({
    assetOwner: 'customer:acme',
    contentType: 'image/png',
    file: new Uint8Array([1, 2, 3]),
    filename: 'hero-banner.png',
    idempotencyKey: 'idem-file-upload',
    objectKey: 'staging/media-platform/tenant-acme/hero-banner.png',
    serviceNamespaceId: 'media-platform',
    tenantId: 'tenant-acme',
    wait: {
      intervalMs: 1,
      timeoutMs: 100
    }
  });

  assert.equal(result.assetId, 'ast_002');
  assert.equal(result.versionId, 'ver_002');
  assert.equal(result.version.lifecycleState, 'published');
  assert.equal(requests.length, 5);
  assert.equal(requests[0].url, 'https://api.cdngine.local/v1/upload-sessions');
  assert.equal(requests[0].headers.authorization, 'Bearer token_123');
  assert.equal(requests[0].headers['idempotency-key'], 'idem-file-upload:create');
  assert.equal(requests[1].url, 'https://uploads.cdngine.local/files/upl_002');
  assert.equal(requests[1].headers['tus-resumable'], '1.0.0');
  assert.equal(requests[1].headers['upload-offset'], '0');
  assert.equal(requests[1].method, 'PATCH');
  assert.equal(requests[2].url, 'https://api.cdngine.local/v1/upload-sessions/upl_002/complete');
  assert.equal(requests[2].headers['idempotency-key'], 'idem-file-upload:complete');
  assert.deepEqual(JSON.parse(requests[0].body), {
    assetOwner: 'customer:acme',
    serviceNamespaceId: 'media-platform',
    source: {
      contentType: 'image/png',
      filename: 'hero-banner.png'
    },
    tenantId: 'tenant-acme',
    upload: {
      byteLength: 3,
      checksum: {
        algorithm: 'sha256',
        value: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'
      },
      objectKey: 'staging/media-platform/tenant-acme/hero-banner.png'
    }
  });
  assert.deepEqual(JSON.parse(requests[2].body), {
    stagedObject: {
      byteLength: 3,
      checksum: {
        algorithm: 'sha256',
        value: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'
      },
      objectKey: 'staging/media-platform/tenant-acme/hero-banner.png'
    }
  });
});

test('assets.get and asset(...).get wrap the logical asset read surface', async () => {
  const requests = [];
  const client = createCDNgineClient({
    baseUrl: 'https://api.cdngine.local',
    fetch: async (url) => {
      requests.push(String(url));

      return createJsonResponse({
        assetId: 'ast_001',
        assetOwner: 'customer:acme',
        latestVersion: {
          assetId: 'ast_001',
          lifecycleState: 'published',
          links: {
            derivatives: '/v1/assets/ast_001/versions/ver_001/derivatives',
            self: '/v1/assets/ast_001/versions/ver_001'
          },
          serviceNamespaceId: 'media-platform',
          source: {
            byteLength: 1843921,
            contentType: 'image/png',
            filename: 'hero-banner.png'
          },
          versionId: 'ver_001',
          versionNumber: 1,
          workflowState: 'completed'
        },
        links: {
          latestVersion: '/v1/assets/ast_001/versions/ver_001',
          self: '/v1/assets/ast_001'
        },
        serviceNamespaceId: 'media-platform',
        tenantId: 'tenant-acme'
      });
    },
    getAccessToken: 'token_123'
  });

  const fromGroup = await client.assets.get('ast_001');
  const fromHandle = await client.asset('ast_001').get();

  assert.equal(fromGroup.assetId, 'ast_001');
  assert.equal(fromHandle.latestVersion.versionId, 'ver_001');
  assert.deepEqual(requests, [
    'https://api.cdngine.local/v1/assets/ast_001',
    'https://api.cdngine.local/v1/assets/ast_001'
  ]);
});

test('CDNginePublicClient forwards caller scope headers for multi-tenant demos', async () => {
  const requests = [];
  const client = new CDNginePublicClient({
    baseUrl: 'https://api.cdngine.local',
    fetch: async (url, init) => {
      requests.push({
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        url
      });

      return createJsonResponse({
        assetId: 'ast_003',
        lifecycleState: 'published',
        links: {
          derivatives: '/v1/assets/ast_003/versions/ver_003/derivatives',
          manifest: '/v1/assets/ast_003/versions/ver_003/manifests/image-default',
          self: '/v1/assets/ast_003/versions/ver_003'
        },
        serviceNamespaceId: 'media-platform',
        source: {
          byteLength: 128,
          contentType: 'image/png',
          filename: 'tenant-private.png'
        },
        tenantId: 'tenant-acme',
        versionId: 'ver_003',
        versionNumber: 1,
        workflowState: 'completed'
      });
    },
    getAccessToken: 'token_123',
    getHeaders: () => ({
      'x-cdngine-allowed-namespaces': 'media-platform',
      'x-cdngine-allowed-tenants': 'tenant-acme'
    })
  });

  await client.getAssetVersion('ast_003', 'ver_003');

  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers['x-cdngine-allowed-namespaces'], 'media-platform');
  assert.equal(requests[0].headers['x-cdngine-allowed-tenants'], 'tenant-acme');
});
