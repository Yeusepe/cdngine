/**
 * Purpose: Verifies that the operator product surface renders diagnostics, audit history, and action forms around the real operator control store.
 * Governing docs:
 * - docs/service-architecture.md
 * - docs/security-model.md
 * - docs/runbooks/README.md
 * External references:
 * - https://nodejs.org/api/test.html
 * - https://hono.dev/docs
 * Tests:
 * - apps/operator/test/operator-app.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createAuthFixture, createJsonBearerHeaders, provisionOperatorActor } from '../../../tests/auth-fixture.mjs';
import { InMemoryOperatorControlStore } from '../../api/dist/index.js';
import { createOperatorApp } from '../dist/index.js';

async function createOperatorSurface() {
  const auth = createAuthFixture();
  const operator = await provisionOperatorActor(auth);
  const store = new InMemoryOperatorControlStore({
    generateId: () => 'op_surface_001',
    now: () => new Date('2026-01-15T19:15:00.000Z'),
    versions: [
      {
        assetId: 'ast_surface_001',
        derivativeCount: 2,
        lifecycleState: 'published',
        manifestType: 'image-default',
        versionId: 'ver_surface_001',
        workflowId: 'wf_surface_existing',
        workflowState: 'completed'
      }
    ]
  });

  return {
    operator,
    app: createOperatorApp({
      auth,
      store
    })
  };
}

test('operator product surface renders diagnostics and audit-aware action controls', async () => {
  const { app, operator } = await createOperatorSurface();

  const response = await app.request(
    'http://localhost/?assetId=ast_surface_001&versionId=ver_surface_001',
    {
      headers: createJsonBearerHeaders(operator.token)
    }
  );
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /Operator console/);
  assert.match(body, /ast_surface_001/);
  assert.match(body, /ver_surface_001/);
  assert.match(body, /Publication status/);
  assert.match(body, /Recent audit trail/);
  assert.match(body, /Why are you taking this action\?/);
});

test('operator product surface submits privileged actions with recorded reasons and shows the resulting audit evidence', async () => {
  const { app, operator } = await createOperatorSurface();

  const postResponse = await app.request(
    'http://localhost/assets/ast_surface_001/versions/ver_surface_001/actions/reprocess',
    {
      method: 'POST',
      headers: createJsonBearerHeaders(operator.token),
      body: JSON.stringify({
        evidenceReference: 'incident://INC-900',
        reason: 'Rebuild the published version after the delivery tier drifted from registry state.'
      })
    }
  );

  assert.equal(postResponse.status, 302);
  assert.equal(
    postResponse.headers.get('location'),
    '/?assetId=ast_surface_001&versionId=ver_surface_001&flash=reprocess'
  );

  const pageResponse = await app.request(
    'http://localhost/?assetId=ast_surface_001&versionId=ver_surface_001&flash=reprocess',
    {
      headers: createJsonBearerHeaders(operator.token)
    }
  );
  const body = await pageResponse.text();

  assert.equal(pageResponse.status, 200);
  assert.match(body, /Queued operator action: reprocess/);
  assert.match(body, /incident:\/\/INC-900/);
  assert.match(body, /Rebuild the published version after the delivery tier drifted from registry state\./);
  assert.match(body, /op_surface_001/);
});
