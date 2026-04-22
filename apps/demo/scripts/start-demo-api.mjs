/**
 * Purpose: Starts a local Node.js HTTP server wrapping the CDNgine Hono API for the interactive demo.
 *   Accepts real file uploads, streams pipeline steps via SSE, and serves downloaded bytes.
 * Governing docs:
 * - docs/repository-layout.md
 * - docs/api-surface.md
 * - docs/service-architecture.md
 * - docs/testing-strategy.md
 * External references:
 * - https://hono.dev/docs
 * - https://nodejs.org/api/http.html
 * - https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events
 * Tests:
 * - apps/demo/package.json
 */

import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';
import { Hono } from 'hono';

import {
  authenticationMiddleware,
  PublicAssetVersionNotFoundError,
  PublicDownloadLinkNotFoundError,
  PublicVersionNotReadyError,
  registerDeliveryRoutes,
  requestContextMiddleware
} from '../../api/dist/index.js';

const PORT = 4000;
const SERVICE_NAMESPACE = 'media-platform';

// In-memory file store: versionId -> { bytes: Buffer, contentType: string, filename: string }
const uploadedFiles = new Map();

// ---------------------------------------------------------------------------
// Mutable delivery store — seeded after each upload
// ---------------------------------------------------------------------------

class MutableDemoVersionStore {
  #versions = new Map();
  #derivatives = new Map();
  #manifests = new Map();
  #sourceUrls = new Map();

  seed({
    assetId,
    assetOwner,
    defaultManifestType,
    derivatives,
    lifecycleState,
    manifests,
    serviceNamespaceId,
    source,
    sourceUrl,
    versionId,
    versionNumber,
    workflowState
  }) {
    const key = `${assetId}:${versionId}`;
    this.#versions.set(key, {
      assetId,
      assetOwner,
      defaultManifestType,
      lifecycleState,
      serviceNamespaceId,
      source,
      versionId,
      versionNumber,
      workflowState
    });
    this.#derivatives.set(key, derivatives ?? []);
    for (const manifest of manifests ?? []) {
      this.#manifests.set(`${key}:${manifest.manifestType}`, manifest);
    }
    if (sourceUrl) {
      this.#sourceUrls.set(key, sourceUrl);
    }
  }

  async getVersion(assetId, versionId) {
    return this.#versions.get(`${assetId}:${versionId}`) ?? null;
  }

  async authorizeSource(assetId, versionId, _preferredDisposition, request) {
    const version = this.#versions.get(`${assetId}:${versionId}`);
    if (!version) throw new PublicAssetVersionNotFoundError(assetId, versionId);
    if (version.lifecycleState === 'quarantined' || version.lifecycleState === 'purged') {
      throw new PublicVersionNotReadyError(assetId, versionId, version.lifecycleState);
    }
    const url = this.#sourceUrls.get(`${assetId}:${versionId}`) ?? `/_demo/files/${versionId}`;
    return {
      assetId,
      authorizationMode: 'signed-url',
      expiresAt: new Date(request.now.getTime() + 15 * 60_000),
      resolvedOrigin: 'source-export',
      url,
      versionId
    };
  }

  async authorizeDelivery(assetId, versionId, deliveryScopeId, variant, request) {
    const version = this.#versions.get(`${assetId}:${versionId}`);
    if (!version) throw new PublicAssetVersionNotFoundError(assetId, versionId);
    if (version.lifecycleState !== 'published') {
      throw new PublicVersionNotReadyError(assetId, versionId, version.lifecycleState);
    }
    const derivatives = this.#derivatives.get(`${assetId}:${versionId}`) ?? [];
    const derivative = derivatives.find(
      (d) => d.deliveryScopeId === deliveryScopeId && d.variant === variant
    );
    if (!derivative) throw new PublicAssetVersionNotFoundError(assetId, versionId);
    return {
      assetId,
      authorizationMode: 'signed-url',
      deliveryScopeId,
      expiresAt: new Date(request.now.getTime() + 15 * 60_000),
      resolvedOrigin: 'cdn-derived',
      url: `/_demo/files/${versionId}`,
      versionId
    };
  }

  async consumeDownloadLink(token) {
    throw new PublicDownloadLinkNotFoundError(token);
  }

  async getManifest(assetId, versionId, manifestType) {
    const version = this.#versions.get(`${assetId}:${versionId}`);
    if (!version) return null;
    if (version.lifecycleState !== 'published') {
      throw new PublicVersionNotReadyError(assetId, versionId, version.lifecycleState);
    }
    return this.#manifests.get(`${assetId}:${versionId}:${manifestType}`) ?? null;
  }

  async listDerivatives(assetId, versionId) {
    const version = this.#versions.get(`${assetId}:${versionId}`);
    if (!version) return [];
    if (version.lifecycleState !== 'published') {
      throw new PublicVersionNotReadyError(assetId, versionId, version.lifecycleState);
    }
    return this.#derivatives.get(`${assetId}:${versionId}`) ?? [];
  }
}

const versionStore = new MutableDemoVersionStore();

// ---------------------------------------------------------------------------
// Auth: always return a demo actor with no scope restrictions
// ---------------------------------------------------------------------------

const demoAuth = {
  async authenticateHeaders(_headers) {
    return {
      allowedServiceNamespaces: [],
      allowedTenantIds: [],
      roles: [],
      subject: 'demo-actor'
    };
  }
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/gu, '').slice(0, 12)}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Upload handler — streams pipeline steps as SSE events
// ---------------------------------------------------------------------------

async function handleDemoUpload(c) {
  let form;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: 'Expected multipart/form-data with a "file" field.' }, 400);
  }

  const fileField = form.get('file');
  if (!fileField || typeof fileField === 'string') {
    return c.json({ error: 'Missing file field in form data.' }, 400);
  }

  const bytes = Buffer.from(await fileField.arrayBuffer());
  const contentType = fileField.type || 'application/octet-stream';
  const filename = fileField.name || 'file';
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  const assetId = buildId('asset');
  const versionId = buildId('ver');
  const uploadSessionId = buildId('sess');
  const canonicalSourceId = `src_${versionId}`;
  const workflowId = `wf-image-${versionId}`;
  const derivativeId = `drv_${versionId}_001`;

  const encoder = new TextEncoder();
  function sse(data) {
    return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Step 1 — API edge validates and issues upload session
        controller.enqueue(sse({
          component: 'api-edge',
          detail: `Session: ${uploadSessionId} · Asset: ${assetId} · Version: ${versionId}`,
          step: 'Upload session issued',
          type: 'step'
        }));
        await delay(500);

        // Step 2 — bytes land in the staging store
        uploadedFiles.set(versionId, { bytes, contentType, filename });
        controller.enqueue(sse({
          component: 'ingest-staging',
          detail: `${bytes.length.toLocaleString()} bytes staged (SHA-256: ${sha256.slice(0, 16)}…)`,
          step: 'File bytes staged',
          type: 'step'
        }));
        await delay(500);

        // Step 3 — snapshot into canonical source repository
        controller.enqueue(sse({
          component: 'canonical-source',
          detail: `Canonical source ID: ${canonicalSourceId}`,
          step: 'Source canonicalized',
          type: 'step'
        }));
        await delay(600);

        // Step 4 — publication workflow dispatched
        controller.enqueue(sse({
          component: 'workflow-controller',
          detail: `Workflow: ${workflowId} → task queue: image-derivation-v1`,
          step: 'Publication workflow dispatched',
          type: 'step'
        }));
        await delay(700);

        // Step 5 — derivative processing
        controller.enqueue(sse({
          component: 'derivation-worker',
          detail: `Variant "full" published as ${derivativeId} (${contentType})`,
          step: 'Derivative processed',
          type: 'step'
        }));
        await delay(500);

        // Step 6 — manifest written to registry
        controller.enqueue(sse({
          component: 'delivery-registry',
          detail: `image-default manifest ready for ${versionId}`,
          step: 'Manifest published',
          type: 'step'
        }));
        await delay(400);

        // Seed the delivery store before announcing published
        versionStore.seed({
          assetId,
          assetOwner: 'demo:user',
          defaultManifestType: 'image-default',
          derivatives: [
            {
              assetId,
              byteLength: BigInt(bytes.length),
              contentType,
              deliveryScopeId: 'public-images',
              derivativeId,
              deterministicKey: sha256,
              recipeId: 'passthrough',
              storageKey: `derived/${assetId}/${versionId}/full`,
              variant: 'full',
              versionId
            }
          ],
          lifecycleState: 'published',
          manifests: [
            {
              assetId,
              deliveryScopeId: 'public-images',
              manifestPayload: {
                assetId,
                derivatives: [{ contentType, derivativeId, variant: 'full' }],
                versionId
              },
              manifestType: 'image-default',
              objectKey: `manifests/${assetId}/${versionId}/image-default`,
              versionId
            }
          ],
          serviceNamespaceId: SERVICE_NAMESPACE,
          source: {
            byteLength: BigInt(bytes.length),
            contentType,
            filename
          },
          sourceUrl: `/_demo/files/${versionId}`,
          versionId,
          versionNumber: 1,
          workflowState: 'completed'
        });

        // Step 7 — lifecycle state set to published
        controller.enqueue(sse({
          component: 'delivery-registry',
          detail: `lifecycleState: published — ${filename} is ready for delivery`,
          step: 'Lifecycle state updated',
          type: 'step'
        }));
        await delay(300);

        // Final event
        controller.enqueue(sse({
          assetId,
          byteLength: bytes.length,
          contentType,
          downloadUrl: `/_demo/files/${versionId}`,
          filename,
          type: 'complete',
          versionId
        }));
        controller.close();
      } catch (error) {
        controller.enqueue(sse({ error: String(error), type: 'error' }));
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Cache-Control': 'no-cache',
      'Content-Type': 'text/event-stream',
      'X-Accel-Buffering': 'no'
    },
    status: 200
  });
}

async function handleDemoFiles(c) {
  const versionId = c.req.param('versionId');
  const file = uploadedFiles.get(versionId);

  if (!file) {
    return c.json({ error: 'File not found.' }, 404);
  }

  return new Response(file.bytes, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Content-Length': String(file.bytes.length),
      'Content-Type': file.contentType
    },
    status: 200
  });
}

// ---------------------------------------------------------------------------
// Hono app assembly
// ---------------------------------------------------------------------------

const app = new Hono();
app.use('*', requestContextMiddleware({ timeoutMs: 60_000 }));

// Demo endpoints — no auth required
app.post('/_demo/upload', handleDemoUpload);
app.get('/_demo/files/:versionId', handleDemoFiles);

// Public API surface — permissive demo auth
const publicApp = new Hono();
publicApp.use('*', authenticationMiddleware('public', demoAuth));
registerDeliveryRoutes(publicApp, { store: versionStore });

app.route('/v1', publicApp);

// ---------------------------------------------------------------------------
// Node.js http bridge
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);

  const url = `http://localhost:${PORT}${req.url}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else if (value) {
      headers.set(key, value);
    }
  }

  const method = (req.method ?? 'GET').toUpperCase();
  const hasBody = !['GET', 'HEAD', 'OPTIONS'].includes(method) && body.length > 0;
  const request = new Request(url, {
    body: hasBody ? body : undefined,
    headers,
    method
  });

  let response;
  try {
    response = await app.fetch(request);
  } catch (error) {
    console.error('Demo API error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
    return;
  }

  const responseHeaders = {};
  for (const [key, value] of response.headers.entries()) {
    responseHeaders[key] = value;
  }
  res.writeHead(response.status, responseHeaders);

  if (response.body) {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  }
  res.end();
});

server.listen(PORT, () => {
  console.log(`CDNgine demo API → http://localhost:${PORT}`);
});
