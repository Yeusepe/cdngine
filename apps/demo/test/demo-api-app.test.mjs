/**
 * Purpose: Verifies that the local public runtime uses the production upload-session and public-read contract with a shared in-memory backing state.
 * Governing docs:
 * - docs/api-surface.md
 * - docs/service-architecture.md
 * - docs/testing-strategy.md
 * External references:
 * - https://nodejs.org/api/test.html
 * - https://nodejs.org/api/http.html
 * - https://tus.io/protocols/resumable-upload
 * Tests:
 * - apps/demo/test/demo-api-app.test.mjs
 */

import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import { createPublicRuntimeApp, createPublicRuntimeServer } from '../scripts/public-runtime-app.mjs';

test('local public runtime app exposes the production upload-session flow and shared staged-object reads', async () => {
  const app = createPublicRuntimeApp();

  const issueResponse = await app.request('http://localhost/v1/upload-sessions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': 'create-demo-upload'
    },
    body: JSON.stringify({
      assetOwner: 'demo:user',
      serviceNamespaceId: 'media-platform',
      source: {
        contentType: 'text/plain',
        filename: 'demo.txt'
      },
      upload: {
        byteLength: 12,
        checksum: {
          algorithm: 'sha256',
          value: '7509e5bda0c762d2bac7f90d758b5b2263fa01ccbc542ab5e3df163be08e6ca9'
        },
        objectKey: 'media-platform/demo.txt'
      }
    })
  });

  assert.equal(issueResponse.status, 201);
  const issued = await issueResponse.json();
  assert.equal(issued.uploadTarget.protocol, 'tus');
  assert.equal(issued.uploadTarget.url, '/uploads/media-platform/demo.txt');

  const uploadTargetPath = new URL(issued.uploadTarget.url, 'http://localhost').toString();
  const patchResponse = await app.request(uploadTargetPath, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/offset+octet-stream',
      'tus-resumable': '1.0.0',
      'upload-offset': '0'
    },
    body: 'hello world!'
  });

  assert.equal(patchResponse.status, 204);

  const completeResponse = await app.request(
    `http://localhost/v1/upload-sessions/${issued.uploadSessionId}/complete`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'complete-demo-upload'
      },
      body: JSON.stringify({
        stagedObject: {
          byteLength: 12,
          checksum: {
            algorithm: 'sha256',
            value: '7509e5bda0c762d2bac7f90d758b5b2263fa01ccbc542ab5e3df163be08e6ca9'
          },
          objectKey: 'media-platform/demo.txt'
        }
      })
    }
  );

  assert.equal(completeResponse.status, 202);
  const completion = await completeResponse.json();

  const versionResponse = await app.request(
    `http://localhost/v1/assets/${completion.assetId}/versions/${completion.versionId}`
  );

  assert.equal(versionResponse.status, 200);
  const version = await versionResponse.json();
  assert.equal(version.lifecycleState, 'canonical');
  assert.equal(version.workflowState, 'pending');
  assert.equal(version.source.filename, 'demo.txt');

  const sourceAuthorizeResponse = await app.request(
    `http://localhost/v1/assets/${completion.assetId}/versions/${completion.versionId}/source/authorize`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'authorize-demo-source'
      },
      body: JSON.stringify({
        preferredDisposition: 'attachment'
      })
    }
  );

  assert.equal(sourceAuthorizeResponse.status, 200);
  const sourceAuthorization = await sourceAuthorizeResponse.json();
  assert.equal(sourceAuthorization.url, '/uploads/media-platform/demo.txt');

  const sourceDownloadResponse = await app.request(
    new URL(sourceAuthorization.url, 'http://localhost').toString()
  );

  assert.equal(sourceDownloadResponse.status, 200);
  assert.equal(await sourceDownloadResponse.text(), 'hello world!');
});

test('local public runtime server bridges node http requests into the production public contract', async (context) => {
  const { server } = createPublicRuntimeServer({
    host: '127.0.0.1'
  });

  context.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      })
  );

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected the public runtime server to listen on an address object.');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const issueResponse = await fetch(`${baseUrl}/v1/upload-sessions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': 'create-node-runtime-upload'
    },
    body: JSON.stringify({
      assetOwner: 'demo:user',
      serviceNamespaceId: 'media-platform',
      source: {
        contentType: 'text/plain',
        filename: 'node-runtime.txt'
      },
      upload: {
        byteLength: 17,
        checksum: {
          algorithm: 'sha256',
          value: '8372dfd02a41404fd6d02837458e4aa828d4dbe316cbc4dd077c112fac0a8c0a'
        },
        objectKey: 'media-platform/node-runtime.txt'
      }
    })
  });

  assert.equal(issueResponse.status, 201);
  const issued = await issueResponse.json();

  const uploadTargetUrl = new URL(issued.uploadTarget.url, baseUrl).toString();
  const patchResponse = await fetch(uploadTargetUrl, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/offset+octet-stream',
      'tus-resumable': '1.0.0',
      'upload-offset': '0'
    },
    body: 'runtime assembly!'
  });

  assert.equal(patchResponse.status, 204);

  const uploadHeadResponse = await fetch(uploadTargetUrl, {
    method: 'HEAD'
  });

  assert.equal(uploadHeadResponse.status, 204);
  assert.equal(uploadHeadResponse.headers.get('upload-offset'), '17');
  assert.equal(uploadHeadResponse.headers.get('tus-resumable'), '1.0.0');

  const completeResponse = await fetch(
    `${baseUrl}/v1/upload-sessions/${issued.uploadSessionId}/complete`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'complete-node-runtime-upload'
      },
      body: JSON.stringify({
        stagedObject: {
          byteLength: 17,
          checksum: {
            algorithm: 'sha256',
            value: '8372dfd02a41404fd6d02837458e4aa828d4dbe316cbc4dd077c112fac0a8c0a'
          },
          objectKey: 'media-platform/node-runtime.txt'
        }
      })
    }
  );

  assert.equal(completeResponse.status, 202);
  const completion = await completeResponse.json();

  const versionResponse = await fetch(
    `${baseUrl}/v1/assets/${completion.assetId}/versions/${completion.versionId}`
  );

  assert.equal(versionResponse.status, 200);
  assert.equal((await versionResponse.json()).source.filename, 'node-runtime.txt');

  const sourceAuthorizeResponse = await fetch(
    `${baseUrl}/v1/assets/${completion.assetId}/versions/${completion.versionId}/source/authorize`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'authorize-node-runtime-source'
      },
      body: JSON.stringify({
        preferredDisposition: 'attachment'
      })
    }
  );

  assert.equal(sourceAuthorizeResponse.status, 200);
  const sourceAuthorization = await sourceAuthorizeResponse.json();
  const downloadResponse = await fetch(
    new URL(sourceAuthorization.url, baseUrl).toString()
  );

  assert.equal(downloadResponse.status, 200);
  assert.equal(await downloadResponse.text(), 'runtime assembly!');
});
