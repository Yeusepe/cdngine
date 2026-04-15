/**
 * Purpose: Verifies that upload-session issuance creates immutable revisions, converges retries through idempotency, and rejects conflicting reuse.
 * Governing docs:
 * - docs/service-architecture.md
 * - docs/api-surface.md
 * - docs/domain-model.md
 * - docs/idempotency-and-dispatch.md
 * External references:
 * - https://tus.io/protocols/resumable-upload
 * - https://tus.github.io/tusd/getting-started/configuration/
 * - https://www.prisma.io/docs/orm/prisma-client/queries/transactions
 * Tests:
 * - apps/api/test/upload-session-routes.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createApiApp } from '../dist/api-app.js';
import {
  registerUploadSessionRoutes
} from '../dist/public/upload-session-routes.js';
import {
  InMemoryUploadSessionIssuanceStore
} from '../dist/upload-session-service.js';

class FakeStagingBlobStore {
  async createUploadTarget(input) {
    return {
      method: 'PATCH',
      protocol: 'tus',
      url: `https://uploads.cdngine.local/files/${input.objectKey}`,
      expiresAt: input.expiresAt
    };
  }

  async deleteObject() {}

  async headObject() {
    return null;
  }
}

function createAuthedHeaders(overrides = {}) {
  return {
    authorization: 'Bearer user_123',
    'content-type': 'application/json',
    'idempotency-key': 'idem_123',
    'x-cdngine-allowed-namespaces': 'media-platform',
    ...overrides
  };
}

test('upload-session issuance creates a new logical asset when no asset id is supplied', async () => {
  const store = new InMemoryUploadSessionIssuanceStore({
    generateId(prefix) {
      return {
        ast: 'ast_001',
        ver: 'ver_001',
        upl: 'upl_001'
      }[prefix];
    }
  });

  const app = createApiApp({
    registerPublicRoutes(publicApp) {
      registerUploadSessionRoutes(publicApp, {
        store,
        stagingBlobStore: new FakeStagingBlobStore(),
        now: () => new Date('2026-01-15T18:00:00Z')
      });
    }
  });

  const response = await app.request('http://localhost/v1/upload-sessions', {
    method: 'POST',
    headers: createAuthedHeaders(),
    body: JSON.stringify({
      serviceNamespaceId: 'media-platform',
      assetOwner: 'customer:acme',
      source: {
        filename: 'hero-banner.png',
        contentType: 'image/png'
      },
      upload: {
        objectKey: 'media-platform/tenant-acme/upl_001',
        byteLength: 1234,
        checksum: {
          algorithm: 'sha256',
          value: 'abc123'
        }
      }
    })
  });
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.equal(payload.assetId, 'ast_001');
  assert.equal(payload.versionId, 'ver_001');
  assert.equal(payload.uploadSessionId, 'upl_001');
  assert.equal(payload.isDuplicate, false);
  assert.equal(payload.links.complete, '/v1/upload-sessions/upl_001/complete');
});

test('same idempotency key and same request replay the original upload session', async () => {
  const store = new InMemoryUploadSessionIssuanceStore({
    generateId(prefix) {
      return {
        ast: 'ast_001',
        ver: 'ver_001',
        upl: 'upl_001'
      }[prefix];
    }
  });

  const app = createApiApp({
    registerPublicRoutes(publicApp) {
      registerUploadSessionRoutes(publicApp, {
        store,
        stagingBlobStore: new FakeStagingBlobStore(),
        now: () => new Date('2026-01-15T18:00:00Z')
      });
    }
  });

  const request = {
    method: 'POST',
    headers: createAuthedHeaders(),
    body: JSON.stringify({
      serviceNamespaceId: 'media-platform',
      assetOwner: 'customer:acme',
      source: {
        filename: 'hero-banner.png',
        contentType: 'image/png'
      },
      upload: {
        objectKey: 'media-platform/tenant-acme/upl_001',
        byteLength: 1234,
        checksum: {
          algorithm: 'sha256',
          value: 'abc123'
        }
      }
    })
  };

  await app.request('http://localhost/v1/upload-sessions', request);
  const replayResponse = await app.request('http://localhost/v1/upload-sessions', request);
  const replayPayload = await replayResponse.json();

  assert.equal(replayResponse.status, 201);
  assert.equal(replayPayload.isDuplicate, true);
  assert.equal(replayPayload.uploadSessionId, 'upl_001');
  assert.equal(replayPayload.versionId, 'ver_001');
});

test('same idempotency key with a different semantic request returns a conflict', async () => {
  const store = new InMemoryUploadSessionIssuanceStore();

  const app = createApiApp({
    registerPublicRoutes(publicApp) {
      registerUploadSessionRoutes(publicApp, {
        store,
        stagingBlobStore: new FakeStagingBlobStore(),
        now: () => new Date('2026-01-15T18:00:00Z')
      });
    }
  });

  await app.request('http://localhost/v1/upload-sessions', {
    method: 'POST',
    headers: createAuthedHeaders(),
    body: JSON.stringify({
      serviceNamespaceId: 'media-platform',
      assetOwner: 'customer:acme',
      source: {
        filename: 'hero-banner.png',
        contentType: 'image/png'
      },
      upload: {
        objectKey: 'media-platform/tenant-acme/upl_001',
        byteLength: 1234,
        checksum: {
          algorithm: 'sha256',
          value: 'abc123'
        }
      }
    })
  });

  const response = await app.request('http://localhost/v1/upload-sessions', {
    method: 'POST',
    headers: createAuthedHeaders(),
    body: JSON.stringify({
      serviceNamespaceId: 'media-platform',
      assetOwner: 'customer:acme',
      source: {
        filename: 'hero-banner-v2.png',
        contentType: 'image/png'
      },
      upload: {
        objectKey: 'media-platform/tenant-acme/upl_002',
        byteLength: 2345,
        checksum: {
          algorithm: 'sha256',
          value: 'def456'
        }
      }
    })
  });
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.equal(payload.type, 'https://docs.cdngine.dev/problems/idempotency-key-conflict');
});

test('supplying an existing asset id creates a new immutable revision', async () => {
  const sequence = {
    ast: ['ast_001'],
    ver: ['ver_001', 'ver_002'],
    upl: ['upl_001', 'upl_002']
  };
  const store = new InMemoryUploadSessionIssuanceStore({
    generateId(prefix) {
      const next = sequence[prefix].shift();

      if (!next) {
        throw new Error(`No more ids configured for prefix ${prefix}`);
      }

      return next;
    }
  });

  const app = createApiApp({
    registerPublicRoutes(publicApp) {
      registerUploadSessionRoutes(publicApp, {
        store,
        stagingBlobStore: new FakeStagingBlobStore(),
        now: () => new Date('2026-01-15T18:00:00Z')
      });
    }
  });

  const firstResponse = await app.request('http://localhost/v1/upload-sessions', {
    method: 'POST',
    headers: createAuthedHeaders({
      'idempotency-key': 'idem_first'
    }),
    body: JSON.stringify({
      serviceNamespaceId: 'media-platform',
      assetOwner: 'customer:acme',
      source: {
        filename: 'hero-banner.png',
        contentType: 'image/png'
      },
      upload: {
        objectKey: 'media-platform/tenant-acme/upl_001',
        byteLength: 1234,
        checksum: {
          algorithm: 'sha256',
          value: 'abc123'
        }
      }
    })
  });
  const firstPayload = await firstResponse.json();

  const secondResponse = await app.request('http://localhost/v1/upload-sessions', {
    method: 'POST',
    headers: createAuthedHeaders({
      'idempotency-key': 'idem_second'
    }),
    body: JSON.stringify({
      serviceNamespaceId: 'media-platform',
      assetId: firstPayload.assetId,
      assetOwner: 'customer:acme',
      source: {
        filename: 'hero-banner.png',
        contentType: 'image/png'
      },
      upload: {
        objectKey: 'media-platform/tenant-acme/upl_002',
        byteLength: 2345,
        checksum: {
          algorithm: 'sha256',
          value: 'def456'
        }
      }
    })
  });
  const secondPayload = await secondResponse.json();

  assert.equal(secondResponse.status, 201);
  assert.equal(secondPayload.assetId, firstPayload.assetId);
  assert.equal(secondPayload.versionId, 'ver_002');
  assert.equal(secondPayload.isDuplicate, false);
});
