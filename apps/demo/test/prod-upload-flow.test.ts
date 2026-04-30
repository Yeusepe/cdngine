/**
 * Purpose: Verifies that the public upload client uses the production upload-session lifecycle rather than the legacy SSE transport.
 * Governing docs:
 * - docs/api-surface.md
 * - docs/service-architecture.md
 * - docs/testing-strategy.md
 * External references:
 * - https://tus.io/protocols/resumable-upload
 * - https://nodejs.org/api/test.html
 * Tests:
 * - apps/demo/test/prod-upload-flow.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { uploadFileThroughProdApi } from '../src/prod-upload-flow.ts';

test('prod upload flow uses upload sessions, target patch, completion, and version read instead of the legacy sse endpoint', async () => {
  const requests: Array<{
    body?: string;
    method?: string;
    url: string;
  }> = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    requests.push({
      body: typeof init?.body === 'string' ? init.body : undefined,
      method: init?.method,
      url
    });

    if (url === 'http://localhost:3000/v1/upload-sessions') {
      return Response.json(
        {
          assetId: 'ast_demo_001',
          isDuplicate: false,
          links: {
            complete: '/v1/upload-sessions/upl_demo_001/complete',
            version: '/v1/assets/ast_demo_001/versions/ver_demo_001'
          },
          status: 'awaiting-upload',
          uploadSessionId: 'upl_demo_001',
          uploadTarget: {
            expiresAt: '2026-04-30T20:00:00.000Z',
            method: 'PATCH',
            protocol: 'tus',
            url: '/uploads/media-platform/demo.txt'
          },
          versionId: 'ver_demo_001'
        },
        { status: 201 }
      );
    }

    if (url === '/uploads/media-platform/demo.txt') {
      return new Response(null, { status: 204 });
    }

    if (url === 'http://localhost:3000/v1/upload-sessions/upl_demo_001/complete') {
      return Response.json(
        {
          assetId: 'ast_demo_001',
          canonicalSource: {
            canonicalSourceId: 'src_demo_001',
            digests: [{ algorithm: 'sha256', value: 'abc123' }],
            logicalPath: 'staging://demo/uploads/media-platform/demo.txt',
            repositoryEngine: 'xet',
            snapshotId: 'snap_demo_001'
          },
          links: {
            version: '/v1/assets/ast_demo_001/versions/ver_demo_001'
          },
          uploadSessionId: 'upl_demo_001',
          versionId: 'ver_demo_001',
          versionState: 'canonical',
          workflowDispatch: {
            dispatchId: 'wd_demo_001',
            state: 'pending',
            workflowKey: 'media-platform:ast_demo_001:ver_demo_001:asset-derivation-v1'
          }
        },
        { status: 202 }
      );
    }

    if (url === 'http://localhost:3000/v1/assets/ast_demo_001/versions/ver_demo_001') {
      return Response.json(
        {
          assetId: 'ast_demo_001',
          assetOwner: 'demo:user',
          lifecycleState: 'canonical',
          links: {
            derivatives: '/v1/assets/ast_demo_001/versions/ver_demo_001/derivatives',
            self: '/v1/assets/ast_demo_001/versions/ver_demo_001'
          },
          serviceNamespaceId: 'media-platform',
          source: {
            byteLength: 12,
            contentType: 'text/plain',
            filename: 'demo.txt'
          },
          versionId: 'ver_demo_001',
          versionNumber: 1,
          workflowState: 'pending'
        },
        { status: 200 }
      );
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await uploadFileThroughProdApi({
    assetOwner: 'demo:user',
    baseUrl: 'http://localhost:3000',
    fetchImpl,
    file: new Blob(['hello world!'], { type: 'text/plain' }),
    filename: 'demo.txt',
    serviceNamespaceId: 'media-platform'
  });

  assert.equal(result.assetId, 'ast_demo_001');
  assert.equal(result.versionId, 'ver_demo_001');
  assert.equal(result.version.lifecycleState, 'canonical');
  assert.equal(result.completion.workflowDispatch.workflowKey, 'media-platform:ast_demo_001:ver_demo_001:asset-derivation-v1');
  assert.deepEqual(
    requests.map((request) => `${request.method ?? 'GET'} ${request.url}`),
    [
      'POST http://localhost:3000/v1/upload-sessions',
      'PATCH /uploads/media-platform/demo.txt',
      'POST http://localhost:3000/v1/upload-sessions/upl_demo_001/complete',
      'GET http://localhost:3000/v1/assets/ast_demo_001/versions/ver_demo_001'
    ]
  );
  assert.equal(
    requests.some((request) => request.url.includes('/_demo/upload')),
    false
  );
});

test('prod upload flow returns the first honest lifecycle state instead of waiting for publication', async () => {
  let versionReads = 0;

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url === 'http://localhost:3000/v1/upload-sessions') {
      return Response.json(
        {
          assetId: 'ast_prod_001',
          isDuplicate: false,
          links: {
            complete: '/v1/upload-sessions/upl_prod_001/complete',
            version: '/v1/assets/ast_prod_001/versions/ver_prod_001'
          },
          status: 'awaiting-upload',
          uploadSessionId: 'upl_prod_001',
          uploadTarget: {
            expiresAt: '2026-04-30T20:00:00.000Z',
            method: 'PATCH',
            protocol: 'tus',
            url: '/uploads/media-platform/prod.txt'
          },
          versionId: 'ver_prod_001'
        },
        { status: 201 }
      );
    }

    if (url === '/uploads/media-platform/prod.txt') {
      return new Response(null, { status: 204 });
    }

    if (url === 'http://localhost:3000/v1/upload-sessions/upl_prod_001/complete') {
      return Response.json(
        {
          assetId: 'ast_prod_001',
          canonicalSource: {
            canonicalSourceId: 'src_prod_001',
            digests: [{ algorithm: 'sha256', value: 'def456' }],
            logicalPath: 'staging://prod/uploads/media-platform/prod.txt',
            repositoryEngine: 'xet',
            snapshotId: 'snap_prod_001'
          },
          links: {
            version: '/v1/assets/ast_prod_001/versions/ver_prod_001'
          },
          uploadSessionId: 'upl_prod_001',
          versionId: 'ver_prod_001',
          versionState: 'processing',
          workflowDispatch: {
            dispatchId: 'wd_prod_001',
            state: 'running',
            workflowKey: 'media-platform:ast_prod_001:ver_prod_001:asset-derivation-v1'
          }
        },
        { status: 202 }
      );
    }

    if (url === 'http://localhost:3000/v1/assets/ast_prod_001/versions/ver_prod_001') {
      versionReads += 1;

      return Response.json(
        {
          assetId: 'ast_prod_001',
          assetOwner: 'product:web-client',
          lifecycleState: 'processing',
          links: {
            derivatives: '/v1/assets/ast_prod_001/versions/ver_prod_001/derivatives',
            self: '/v1/assets/ast_prod_001/versions/ver_prod_001'
          },
          serviceNamespaceId: 'media-platform',
          source: {
            byteLength: 18,
            contentType: 'text/plain',
            filename: 'prod.txt'
          },
          versionId: 'ver_prod_001',
          versionNumber: 1,
          workflowState: 'running'
        },
        { status: 200 }
      );
    }

    throw new Error(`Unexpected request: ${url} (${init?.method ?? 'GET'})`);
  };

  const result = await uploadFileThroughProdApi({
    assetOwner: 'product:web-client',
    baseUrl: 'http://localhost:3000',
    fetchImpl,
    file: new Blob(['hello product flow'], { type: 'text/plain' }),
    filename: 'prod.txt',
    serviceNamespaceId: 'media-platform'
  });

  assert.equal(result.version.lifecycleState, 'processing');
  assert.equal(result.version.workflowState, 'running');
  assert.equal(versionReads, 1);
});
