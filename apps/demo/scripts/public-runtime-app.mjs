/**
 * Purpose: Assembles the local CDNgine public runtime so the public upload workspace can exercise the production upload-session, PATCH upload-target, completion, and public version-read contract against shared in-memory state.
 * Governing docs:
 * - docs/repository-layout.md
 * - docs/api-surface.md
 * - docs/service-architecture.md
 * - docs/testing-strategy.md
 * External references:
 * - https://hono.dev/docs
 * - https://nodejs.org/api/http.html
 * - https://tus.io/protocols/resumable-upload
 * Tests:
 * - apps/demo/test/demo-api-app.test.mjs
 */

import { createHash } from 'node:crypto';
import http from 'node:http';

import {
  createApiApp,
  InMemoryUploadSessionIssuanceStore,
  PublicAssetVersionNotFoundError,
  PublicDownloadLinkNotFoundError,
  PublicVersionNotReadyError,
  registerDeliveryRoutes,
  registerDownloadLinkRoutes,
  registerUploadSessionRoutes
} from '../../api/dist/index.js';

class LocalRuntimeStagingBlobStore {
  constructor(bucket = 'cdngine-ingest') {
    this.bucket = bucket;
    this.objects = new Map();
  }

  buildObjectUrl(objectKey) {
    return `/uploads/${objectKey
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')}`;
  }

  async createUploadTarget(input) {
    return {
      expiresAt: input.expiresAt,
      method: 'PATCH',
      protocol: 'tus',
      url: this.buildObjectUrl(input.objectKey)
    };
  }

  async deleteObject(objectKey) {
    this.objects.delete(objectKey);
  }

  async headObject(objectKey) {
    const object = this.objects.get(objectKey);

    if (!object) {
      return null;
    }

    return {
      bucket: this.bucket,
      byteLength: BigInt(object.bytes.length),
      checksum: object.checksum,
      etag: object.checksum.value,
      key: `ingest/${objectKey}`
    };
  }

  getObject(objectKey) {
    return this.objects.get(objectKey) ?? null;
  }

  getUploadOffset(objectKey) {
    return this.objects.get(objectKey)?.bytes.length ?? 0;
  }

  async writeObject(objectKey, bytes, contentType) {
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const checksum = {
      algorithm: 'sha256',
      value: createHash('sha256').update(buffer).digest('hex')
    };

    this.objects.set(objectKey, {
      bytes: buffer,
      checksum,
      contentType
    });
  }
}

class LocalRuntimeSourceRepository {
  async snapshotFromPath(input) {
    return {
      canonicalSourceId: `src_${input.assetVersionId}`,
      digests:
        input.sourceDigests && input.sourceDigests.length > 0
          ? input.sourceDigests
          : [{ algorithm: 'sha256', value: 'missing-runtime-digest' }],
      logicalByteLength: input.logicalByteLength,
      logicalPath: input.localPath,
      repositoryEngine: 'xet',
      snapshotId: `snap_${input.assetVersionId}`,
      substrateHints: {
        repositoryTool: 'local-runtime'
      }
    };
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

class UploadSessionPublicReadStore {
  constructor(uploadSessionStore, stagingBlobStore) {
    this.uploadSessionStore = uploadSessionStore;
    this.stagingBlobStore = stagingBlobStore;
  }

  async authorizeDelivery(assetId, versionId, deliveryScopeId, variant, request) {
    const version = this.getRequiredVersion(assetId, versionId);

    if (version.lifecycleState !== 'published') {
      throw new PublicVersionNotReadyError(assetId, versionId, version.lifecycleState);
    }

    return {
      assetId,
      authorizationMode: 'signed-url',
      deliveryScopeId,
      expiresAt: new Date(request.now.getTime() + 15 * 60_000),
      resolvedOrigin: 'cdn-derived',
      url: this.stagingBlobStore.buildObjectUrl(this.getPersistedVersion(assetId, versionId).objectKey),
      versionId
    };
  }

  async authorizeSource(assetId, versionId, _preferredDisposition, request) {
    const version = this.getRequiredVersion(assetId, versionId);
    const persistedVersion = this.getPersistedVersion(assetId, versionId);

    if (version.lifecycleState === 'quarantined' || version.lifecycleState === 'purged') {
      throw new PublicVersionNotReadyError(assetId, versionId, version.lifecycleState);
    }

    return {
      assetId,
      authorizationMode: 'signed-url',
      expiresAt: new Date(request.now.getTime() + 15 * 60_000),
      resolvedOrigin: 'source-export',
      ...(version.tenantId ? { tenantId: version.tenantId } : {}),
      url: this.stagingBlobStore.buildObjectUrl(persistedVersion.objectKey),
      versionId
    };
  }

  async consumeDownloadLink(token) {
    throw new PublicDownloadLinkNotFoundError(token);
  }

  async getManifest(assetId, versionId, manifestType) {
    const version = this.getRequiredVersion(assetId, versionId);

    if (version.lifecycleState !== 'published') {
      throw new PublicVersionNotReadyError(assetId, versionId, version.lifecycleState);
    }

    return {
      assetId,
      deliveryScopeId: 'public-default',
      manifestPayload: {
        assetId,
        derivatives: [],
        manifestType,
        versionId
      },
      manifestType,
      objectKey: `manifests/${assetId}/${versionId}/${manifestType}`,
      versionId
    };
  }

  async getVersion(assetId, versionId) {
    const persistedVersion = this.uploadSessionStore.getPersistedVersion(versionId);

    if (!persistedVersion || persistedVersion.assetId !== assetId || !persistedVersion.canonicalSourceEvidence) {
      return null;
    }

    return {
      assetId: persistedVersion.assetId,
      assetOwner: persistedVersion.assetOwner,
      canonicalSourceEvidence: persistedVersion.canonicalSourceEvidence,
      lifecycleState: this.mapLifecycleState(persistedVersion.lifecycleState),
      serviceNamespaceId: persistedVersion.serviceNamespaceId,
      source: {
        byteLength: persistedVersion.byteLength,
        contentType: persistedVersion.contentType,
        filename: persistedVersion.filename
      },
      ...(persistedVersion.tenantId ? { tenantId: persistedVersion.tenantId } : {}),
      versionId: persistedVersion.versionId,
      versionNumber: persistedVersion.versionNumber,
      workflowState: persistedVersion.workflowDispatch?.state ?? 'pending'
    };
  }

  async listDerivatives(assetId, versionId) {
    const version = this.getRequiredVersion(assetId, versionId);

    if (version.lifecycleState !== 'published') {
      throw new PublicVersionNotReadyError(assetId, versionId, version.lifecycleState);
    }

    return [];
  }

  getPersistedVersion(assetId, versionId) {
    const persistedVersion = this.uploadSessionStore.getPersistedVersion(versionId);

    if (!persistedVersion || persistedVersion.assetId !== assetId || !persistedVersion.canonicalSourceEvidence) {
      throw new PublicAssetVersionNotFoundError(assetId, versionId);
    }

    return persistedVersion;
  }

  getRequiredVersion(assetId, versionId) {
    const version = this.uploadSessionStore.getPersistedVersion(versionId);

    if (!version || version.assetId !== assetId || !version.canonicalSourceEvidence) {
      throw new PublicAssetVersionNotFoundError(assetId, versionId);
    }

    return {
      ...(version.tenantId ? { tenantId: version.tenantId } : {}),
      lifecycleState: this.mapLifecycleState(version.lifecycleState)
    };
  }

  mapLifecycleState(versionLifecycleState) {
    switch (versionLifecycleState) {
      case 'canonical':
        return 'canonical';
      case 'processing':
        return 'processing';
      case 'quarantined':
        return 'quarantined';
      case 'failed_retryable':
      case 'failed_validation':
        return 'failed_retryable';
      case 'session_created':
      case 'uploaded':
      case 'canonicalizing':
      default:
        return 'processing';
    }
  }
}

const localRuntimeAuth = {
  async authenticateHeaders() {
    return {
      allowedServiceNamespaces: [],
      allowedTenantIds: [],
      roles: [],
      subject: 'local-public-runtime-actor'
    };
  }
};

function getUploadObjectKey(pathname) {
  return decodeURIComponent(pathname.replace(/^\/uploads\//u, ''));
}

function createNodeRequestHandler(app, fallbackOrigin) {
  return async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) {
        for (const headerValue of value) {
          headers.append(key, headerValue);
        }
      } else if (value) {
        headers.set(key, value);
      }
    }

    const method = (req.method ?? 'GET').toUpperCase();
    const request = new Request(new URL(req.url ?? '/', fallbackOrigin), {
      body: !['GET', 'HEAD', 'OPTIONS'].includes(method) && body.length > 0 ? body : undefined,
      headers,
      method
    });

    let response;
    try {
      response = await app.fetch(request);
    } catch (error) {
      console.error('Public runtime error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
      return;
    }

    const responseHeaders = {};
    for (const [key, value] of response.headers.entries()) {
      responseHeaders[key] = value;
    }
    res.writeHead(response.status, responseHeaders);

    if (method === 'HEAD' || !response.body) {
      res.end();
      return;
    }

    res.end(Buffer.from(await response.arrayBuffer()));
  };
}

function createTusErrorResponse(detail, status) {
  return Response.json({ detail, error: 'Upload target request rejected.' }, { status });
}

export function createPublicRuntimeApp() {
  const uploadSessionStore = new InMemoryUploadSessionIssuanceStore();
  const stagingBlobStore = new LocalRuntimeStagingBlobStore();
  const sourceRepository = new LocalRuntimeSourceRepository();
  const publicReadStore = new UploadSessionPublicReadStore(uploadSessionStore, stagingBlobStore);

  return createApiApp({
    auth: localRuntimeAuth,
    requestTimeoutMs: 60_000,
    registerCapabilityRoutes(app) {
      app.on('HEAD', '/uploads/*', async (context) => {
        const objectKey = getUploadObjectKey(context.req.path);
        const object = stagingBlobStore.getObject(objectKey);

        if (!object) {
          return new Response(null, { status: 404 });
        }

        return new Response(null, {
          headers: {
            'Cache-Control': 'no-store',
            'Content-Length': String(object.bytes.length),
            'Content-Type': object.contentType,
            'Tus-Resumable': '1.0.0',
            'Upload-Length': String(object.bytes.length),
            'Upload-Offset': String(stagingBlobStore.getUploadOffset(objectKey))
          },
          status: 204
        });
      });

      app.patch('/uploads/*', async (context) => {
        const tusResumable = context.req.header('tus-resumable');
        const uploadOffset = context.req.header('upload-offset');

        if (tusResumable !== '1.0.0') {
          return createTusErrorResponse('Tus-Resumable: 1.0.0 is required.', 412);
        }

        if (uploadOffset !== '0') {
          return createTusErrorResponse(
            'This local runtime accepts upload patches that start at Upload-Offset: 0.',
            409
          );
        }

        const objectKey = getUploadObjectKey(context.req.path);
        const body = new Uint8Array(await context.req.arrayBuffer());
        await stagingBlobStore.writeObject(
          objectKey,
          body,
          context.req.header('content-type') ?? 'application/offset+octet-stream'
        );

        return new Response(null, {
          headers: {
            'Tus-Resumable': '1.0.0',
            'Upload-Offset': String(body.byteLength)
          },
          status: 204
        });
      });

      app.get('/uploads/*', async (context) => {
        const objectKey = getUploadObjectKey(context.req.path);
        const object = stagingBlobStore.getObject(objectKey);
        const isHeadRequest =
          context.req.method === 'HEAD' || context.req.raw.method?.toUpperCase() === 'HEAD';

        if (!object) {
          return context.json({ error: 'File not found.' }, 404);
        }

        return new Response(isHeadRequest ? null : object.bytes, {
          headers: {
            'Cache-Control': 'no-store',
            'Content-Disposition': `attachment; filename="${objectKey.split('/').pop() ?? 'download'}"`,
            'Content-Length': String(object.bytes.length),
            'Content-Type': object.contentType,
            'Tus-Resumable': '1.0.0',
            'Upload-Length': String(object.bytes.length),
            'Upload-Offset': String(stagingBlobStore.getUploadOffset(objectKey))
          },
          status: isHeadRequest ? 204 : 200
        });
      });
    },
    registerPublicRoutes(publicApp) {
      registerUploadSessionRoutes(publicApp, {
        sourceRepository,
        stagingBlobStore,
        store: uploadSessionStore
      });
      registerDeliveryRoutes(publicApp, { store: publicReadStore });
      registerDownloadLinkRoutes(publicApp, { store: publicReadStore });
    }
  });
}

export function createPublicRuntimeServer(options = {}) {
  const fallbackOrigin =
    options.publicBaseUrl ?? `http://${options.host ?? '127.0.0.1'}:${options.port ?? 4000}`;
  const app = createPublicRuntimeApp();

  return {
    app,
    server: http.createServer(createNodeRequestHandler(app, fallbackOrigin))
  };
}
