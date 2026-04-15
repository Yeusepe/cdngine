/**
 * Purpose: Verifies that upload-session issuance and completion create immutable revisions, converge retries through idempotency, and preserve the staged-to-canonical handoff contract.
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
import {
  createAuthFixture,
  createJsonBearerHeaders,
  provisionPublicActor
} from '../../../tests/auth-fixture.mjs';

class FakeStagingBlobStore {
  constructor(objects = {}) {
    this.objects = new Map(
      Object.entries(objects).map(([objectKey, descriptor]) => [
        objectKey,
        {
          bucket: 'cdngine-ingest',
          key: `ingest/${objectKey}`,
          ...descriptor
        }
      ])
    );
  }

  async createUploadTarget(input) {
    return {
      method: 'PATCH',
      protocol: 'tus',
      url: `https://uploads.cdngine.local/files/${input.objectKey}`,
      expiresAt: input.expiresAt
    };
  }

  async deleteObject() {}

  async headObject(objectKey) {
    return this.objects.get(objectKey) ?? null;
  }
}

class FakeSourceRepository {
  constructor(snapshotResult) {
    this.snapshotResult =
      snapshotResult ?? {
        canonicalSourceId: 'src_001',
        snapshotId: 'snap_001',
        logicalPath: 'staging://cdngine-ingest/ingest/media-platform/tenant-acme/upl_001',
        digests: [
          {
            algorithm: 'sha256',
            value: 'abc123'
          }
        ],
        substrateHints: {
          repositoryTool: 'kopia'
        }
      };
    this.snapshotCalls = [];
  }

  async snapshotFromPath(input) {
    this.snapshotCalls.push(input);
    return this.snapshotResult;
  }

  async listSnapshots() {
    return [];
  }

  async restoreToPath(input) {
    return {
      restoredPath: input.destinationPath
    };
  }
}

async function createUploadAuth(overrides = {}) {
  const auth = createAuthFixture();
  const actor = await provisionPublicActor(auth, overrides);

  return {
    auth,
    headers(extraHeaders = {}) {
      return createJsonBearerHeaders(actor.token, {
        'idempotency-key': 'idem_123',
        ...extraHeaders
      });
    }
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
  const { auth, headers } = await createUploadAuth();

  const app = createApiApp({
    auth,
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
    headers: headers(),
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
  const { auth, headers } = await createUploadAuth();

  const app = createApiApp({
    auth,
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
    headers: headers(),
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
  const { auth, headers } = await createUploadAuth();

  const app = createApiApp({
    auth,
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
    headers: headers(),
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
    headers: headers(),
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
  const { auth, headers } = await createUploadAuth();

  const app = createApiApp({
    auth,
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
    headers: headers({
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
    headers: headers({
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

test('upload-session completion snapshots staged bytes and exposes a pending workflow dispatch', async () => {
  const sequence = {
    ast: ['ast_001'],
    ver: ['ver_001'],
    upl: ['upl_001'],
    wd: ['wd_001']
  };
  const store = new InMemoryUploadSessionIssuanceStore({
    generateId(prefix) {
      const next = sequence[prefix].shift();

      if (!next) {
        throw new Error(`No more ids configured for prefix ${prefix}`);
      }

      return next;
    },
    now: () => new Date('2026-01-15T18:00:00Z')
  });
  const stagingBlobStore = new FakeStagingBlobStore({
    'media-platform/tenant-acme/upl_001': {
      byteLength: 1234n,
      checksum: {
        algorithm: 'sha256',
        value: 'abc123'
      }
    }
  });
  const sourceRepository = new FakeSourceRepository();
  const { auth, headers } = await createUploadAuth();

  const app = createApiApp({
    auth,
    registerPublicRoutes(publicApp) {
      registerUploadSessionRoutes(publicApp, {
        store,
        sourceRepository,
        stagingBlobStore,
        workflowTemplate: 'image-derivation-v1'
      });
    }
  });

  await app.request('http://localhost/v1/upload-sessions', {
    method: 'POST',
    headers: headers({
      'idempotency-key': 'idem_create'
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

  const response = await app.request('http://localhost/v1/upload-sessions/upl_001/complete', {
    method: 'POST',
    headers: headers({
      'idempotency-key': 'idem_complete'
    }),
    body: JSON.stringify({
      stagedObject: {
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

  assert.equal(response.status, 202);
  assert.equal(payload.uploadSessionId, 'upl_001');
  assert.equal(payload.assetId, 'ast_001');
  assert.equal(payload.versionId, 'ver_001');
  assert.equal(payload.versionState, 'canonical');
  assert.deepEqual(payload.workflowDispatch, {
    dispatchId: 'wd_001',
    state: 'pending',
    workflowKey: 'media-platform:ast_001:ver_001:image-derivation-v1'
  });
  assert.equal(sourceRepository.snapshotCalls.length, 1);
  assert.deepEqual(sourceRepository.snapshotCalls[0], {
    assetVersionId: 'ver_001',
    localPath: 'staging://cdngine-ingest/ingest/media-platform/tenant-acme/upl_001',
    sourceFilename: 'hero-banner.png',
    metadata: {
      assetId: 'ast_001',
      assetOwner: 'customer:acme',
      serviceNamespaceId: 'media-platform',
      uploadSessionId: 'upl_001',
      versionNumber: '1'
    }
  });
});

test('same completion idempotency key and same request replay the original workflow dispatch', async () => {
  const sequence = {
    ast: ['ast_001'],
    ver: ['ver_001'],
    upl: ['upl_001'],
    wd: ['wd_001']
  };
  const store = new InMemoryUploadSessionIssuanceStore({
    generateId(prefix) {
      const next = sequence[prefix].shift();

      if (!next) {
        throw new Error(`No more ids configured for prefix ${prefix}`);
      }

      return next;
    },
    now: () => new Date('2026-01-15T18:00:00Z')
  });
  const stagingBlobStore = new FakeStagingBlobStore({
    'media-platform/tenant-acme/upl_001': {
      byteLength: 1234n,
      checksum: {
        algorithm: 'sha256',
        value: 'abc123'
      }
    }
  });
  const sourceRepository = new FakeSourceRepository();
  const { auth, headers } = await createUploadAuth();
  const app = createApiApp({
    auth,
    registerPublicRoutes(publicApp) {
      registerUploadSessionRoutes(publicApp, {
        store,
        sourceRepository,
        stagingBlobStore,
        workflowTemplate: 'image-derivation-v1'
      });
    }
  });

  await app.request('http://localhost/v1/upload-sessions', {
    method: 'POST',
    headers: headers({
      'idempotency-key': 'idem_create'
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

  const request = {
    method: 'POST',
    headers: headers({
      'idempotency-key': 'idem_complete'
    }),
    body: JSON.stringify({
      stagedObject: {
        objectKey: 'media-platform/tenant-acme/upl_001',
        byteLength: 1234,
        checksum: {
          algorithm: 'sha256',
          value: 'abc123'
        }
      }
    })
  };

  await app.request('http://localhost/v1/upload-sessions/upl_001/complete', request);
  const replayResponse = await app.request('http://localhost/v1/upload-sessions/upl_001/complete', request);
  const replayPayload = await replayResponse.json();

  assert.equal(replayResponse.status, 202);
  assert.equal(replayPayload.workflowDispatch.dispatchId, 'wd_001');
  assert.equal(sourceRepository.snapshotCalls.length, 1);
});

test('completion returns a retryable conflict when staged bytes are not durable yet', async () => {
  const sequence = {
    ast: ['ast_001'],
    ver: ['ver_001'],
    upl: ['upl_001']
  };
  const store = new InMemoryUploadSessionIssuanceStore({
    generateId(prefix) {
      const next = sequence[prefix].shift();

      if (!next) {
        throw new Error(`No more ids configured for prefix ${prefix}`);
      }

      return next;
    },
    now: () => new Date('2026-01-15T18:00:00Z')
  });
  const { auth, headers } = await createUploadAuth();
  const app = createApiApp({
    auth,
    registerPublicRoutes(publicApp) {
      registerUploadSessionRoutes(publicApp, {
        store,
        sourceRepository: new FakeSourceRepository(),
        stagingBlobStore: new FakeStagingBlobStore()
      });
    }
  });

  await app.request('http://localhost/v1/upload-sessions', {
    method: 'POST',
    headers: headers({
      'idempotency-key': 'idem_create'
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

  const response = await app.request('http://localhost/v1/upload-sessions/upl_001/complete', {
    method: 'POST',
    headers: headers({
      'idempotency-key': 'idem_complete'
    }),
    body: JSON.stringify({
      stagedObject: {
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

  assert.equal(response.status, 409);
  assert.equal(payload.type, 'https://docs.cdngine.dev/problems/upload-not-finished');
  assert.equal(payload.retryable, true);
});

test('upload-session completion resolves the presentation workflow template from source content type when no explicit template is pinned', async () => {
  const sequence = {
    ast: ['ast_001'],
    ver: ['ver_001'],
    upl: ['upl_001'],
    wd: ['wd_001']
  };
  const store = new InMemoryUploadSessionIssuanceStore({
    generateId(prefix) {
      const next = sequence[prefix].shift();

      if (!next) {
        throw new Error(`No more ids configured for prefix ${prefix}`);
      }

      return next;
    },
    now: () => new Date('2026-01-15T18:00:00Z')
  });
  const stagingBlobStore = new FakeStagingBlobStore({
    'media-platform/tenant-acme/upl_001': {
      byteLength: 4096n,
      checksum: {
        algorithm: 'sha256',
        value: 'deck-sha'
      }
    }
  });
  const sourceRepository = new FakeSourceRepository({
    canonicalSourceId: 'src_deck',
    digests: [
      {
        algorithm: 'sha256',
        value: 'deck-sha'
      }
    ],
    logicalPath: 'staging://cdngine-ingest/ingest/media-platform/tenant-acme/upl_001',
    snapshotId: 'snap_deck'
  });
  const { auth, headers } = await createUploadAuth();

  const app = createApiApp({
    auth,
    registerPublicRoutes(publicApp) {
      registerUploadSessionRoutes(publicApp, {
        store,
        sourceRepository,
        stagingBlobStore
      });
    }
  });

  await app.request('http://localhost/v1/upload-sessions', {
    method: 'POST',
    headers: headers({
      'idempotency-key': 'idem_create'
    }),
    body: JSON.stringify({
      serviceNamespaceId: 'media-platform',
      assetOwner: 'customer:acme',
      source: {
        filename: 'event-deck.pdf',
        contentType: 'application/pdf'
      },
      upload: {
        objectKey: 'media-platform/tenant-acme/upl_001',
        byteLength: 4096,
        checksum: {
          algorithm: 'sha256',
          value: 'deck-sha'
        }
      }
    })
  });

  const response = await app.request('http://localhost/v1/upload-sessions/upl_001/complete', {
    method: 'POST',
    headers: headers({
      'idempotency-key': 'idem_complete'
    }),
    body: JSON.stringify({
      stagedObject: {
        objectKey: 'media-platform/tenant-acme/upl_001',
        byteLength: 4096,
        checksum: {
          algorithm: 'sha256',
          value: 'deck-sha'
        }
      }
    })
  });
  const payload = await response.json();

  assert.equal(response.status, 202);
  assert.deepEqual(payload.workflowDispatch, {
    dispatchId: 'wd_001',
    state: 'pending',
    workflowKey: 'media-platform:ast_001:ver_001:presentation-normalization-v1'
  });
});
