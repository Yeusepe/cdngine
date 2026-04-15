/**
 * Purpose: Verifies that the operator surface accepts replay, quarantine, release, purge, and diagnostics requests with audited state-aware behavior.
 * Governing docs:
 * - docs/api-surface.md
 * - docs/observability.md
 * - docs/security-model.md
 * Tests:
 * - apps/api/test/operator-routes.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createApiApp } from '../dist/api-app.js';
import {
  InMemoryOperatorControlStore
} from '../dist/operator/operator-service.js';
import {
  registerOperatorRoutes
} from '../dist/operator/operator-routes.js';
import {
  createAuthFixture,
  createJsonBearerHeaders,
  provisionOperatorActor
} from '../../../tests/auth-fixture.mjs';

async function createOperatorApp(store) {
  const auth = createAuthFixture();
  const defaultOperator = await provisionOperatorActor(auth);
  const secondaryOperator = await provisionOperatorActor(auth, {
    email: 'operator-2@cdngine.test',
    name: 'Operator User Two',
    subject: 'operator_456'
  });

  return {
    app: createApiApp({
      auth,
      registerOperatorRoutes(operatorApp) {
        registerOperatorRoutes(operatorApp, { store });
      }
    }),
    defaultOperator,
    secondaryOperator
  };
}

test('readyz returns a readiness payload', async () => {
  const app = createApiApp();
  const response = await app.request('http://localhost/readyz');
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.status, 'ready');
});

test('operator routes accept reprocess, quarantine, release, and diagnostics flows', async () => {
  const store = new InMemoryOperatorControlStore({
    generateId: () => 'op_001',
    now: () => new Date('2026-01-15T18:30:00.000Z'),
    versions: [
      {
        assetId: 'ast_001',
        derivativeCount: 2,
        lifecycleState: 'published',
        manifestType: 'image-default',
        versionId: 'ver_001',
        workflowId: 'wf_existing',
        workflowState: 'completed'
      },
      {
        assetId: 'ast_002',
        lifecycleState: 'quarantined',
        versionId: 'ver_002',
        workflowState: 'waiting'
      }
    ]
  });
  const { app, defaultOperator, secondaryOperator } = await createOperatorApp(store);

  const reprocessResponse = await app.request(
    'http://localhost/v1/operator/assets/ast_001/versions/ver_001/reprocess',
    {
      method: 'POST',
      headers: createJsonBearerHeaders(defaultOperator.token)
    }
  );
  const quarantineResponse = await app.request(
    'http://localhost/v1/operator/assets/ast_001/versions/ver_001/quarantine',
    {
      method: 'POST',
      headers: createJsonBearerHeaders(secondaryOperator.token)
    }
  );
  const releaseResponse = await app.request(
    'http://localhost/v1/operator/assets/ast_002/versions/ver_002/release',
    {
      method: 'POST',
      headers: createJsonBearerHeaders(defaultOperator.token)
    }
  );
  const diagnosticsResponse = await app.request(
    'http://localhost/v1/operator/assets/ast_001/versions/ver_001/diagnostics',
    {
      headers: createJsonBearerHeaders(defaultOperator.token)
    }
  );

  assert.equal(reprocessResponse.status, 202);
  assert.deepEqual(await reprocessResponse.json(), {
    action: 'reprocess',
    operationId: 'op_001',
    state: 'accepted',
    workflowId: 'ast_001:ver_001:reprocess:op_001'
  });
  assert.equal(quarantineResponse.status, 202);
  assert.deepEqual(await quarantineResponse.json(), {
    action: 'quarantine',
    operationId: 'op_001',
    state: 'accepted'
  });
  assert.equal(releaseResponse.status, 202);
  assert.deepEqual(await releaseResponse.json(), {
    action: 'release',
    operationId: 'op_001',
    state: 'accepted',
    workflowId: 'ast_002:ver_002:release:op_001'
  });
  assert.equal(diagnosticsResponse.status, 200);
  assert.deepEqual(await diagnosticsResponse.json(), {
    assetId: 'ast_001',
    lifecycleState: 'quarantined',
    publication: {
      derivativeCount: 2,
      manifestType: 'image-default'
    },
    versionId: 'ver_001',
    workflow: {
      state: 'waiting',
      workflowId: 'ast_001:ver_001:reprocess:op_001'
    }
  });
});

test('operator routes reject invalid state transitions with audited problem details', async () => {
  const store = new InMemoryOperatorControlStore({
    versions: [
      {
        assetId: 'ast_001',
        lifecycleState: 'published',
        versionId: 'ver_001',
        workflowState: 'completed'
      }
    ]
  });
  const { app, defaultOperator } = await createOperatorApp(store);

  const response = await app.request(
    'http://localhost/v1/operator/assets/ast_001/versions/ver_001/release',
    {
      method: 'POST',
      headers: createJsonBearerHeaders(defaultOperator.token)
    }
  );
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.equal(payload.type, 'https://docs.cdngine.dev/problems/operator-action-rejected');
});
