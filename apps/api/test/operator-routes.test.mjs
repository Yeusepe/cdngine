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
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

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

const operatorMaterializationRoot =
  'C:\\Users\\svalp\\OneDrive\\Documents\\Development\\antiwork\\cdngine\\apps\\api\\test-output\\operator-restores';

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

test('operator reprocess restores Xet-backed canonical evidence before queueing replay', async () => {
  await rm(operatorMaterializationRoot, { force: true, recursive: true });

  const sourceRestores = [];
  const store = new InMemoryOperatorControlStore({
    generateId: () => 'op_replay_001',
    sourceReplays: {
      materializationRootPath: operatorMaterializationRoot,
      sourceRepository: {
        async listSnapshots() {
          return [];
        },
        async restoreToPath(input) {
          sourceRestores.push(input);
          await mkdir(dirname(input.destinationPath), { recursive: true });
          await writeFile(input.destinationPath, Buffer.from('xet-replay-bytes'));
          return {
            restoredPath: input.destinationPath
          };
        },
        async snapshotFromPath() {
          throw new Error('snapshotFromPath should not run in operator replay tests.');
        }
      }
    },
    versions: [
      {
        assetId: 'ast_900',
        canonicalSourceEvidence: {
          repositoryEngine: 'xet',
          canonicalSourceId: 'xet_file_900',
          canonicalSnapshotId: 'xet_file_900',
          canonicalLogicalPath: 'source/ml-platform/ast_900/ver_900/original/model.bin',
          canonicalDigestSet: [],
          sourceReconstructionHandles: [
            {
              kind: 'manifest',
              value: 'xet_file_900'
            }
          ]
        },
        lifecycleState: 'canonical',
        sourceFilename: 'model.bin',
        versionId: 'ver_900',
        workflowState: 'completed'
      }
    ]
  });
  const { app, defaultOperator } = await createOperatorApp(store);

  const reprocessResponse = await app.request(
    'http://localhost/v1/operator/assets/ast_900/versions/ver_900/reprocess',
    {
      method: 'POST',
      headers: createJsonBearerHeaders(defaultOperator.token)
    }
  );
  const diagnosticsResponse = await app.request(
    'http://localhost/v1/operator/assets/ast_900/versions/ver_900/diagnostics',
    {
      headers: createJsonBearerHeaders(defaultOperator.token)
    }
  );

  assert.equal(reprocessResponse.status, 202);
  assert.equal(sourceRestores[0]?.snapshot?.repositoryEngine, 'xet');
  assert.equal(sourceRestores[0]?.snapshot?.canonicalSourceId, 'xet_file_900');
  assert.deepEqual(await diagnosticsResponse.json(), {
    assetId: 'ast_900',
    lifecycleState: 'processing',
    sourceRestore: {
      repositoryEngine: 'xet',
      restoredPath: 'C:\\Users\\svalp\\OneDrive\\Documents\\Development\\antiwork\\cdngine\\apps\\api\\test-output\\operator-restores\\ast_900\\ver_900\\model.bin'
    },
    versionId: 'ver_900',
    workflow: {
      state: 'queued',
      workflowId: 'ast_900:ver_900:reprocess:op_replay_001'
    }
  });

  await rm(operatorMaterializationRoot, { force: true, recursive: true });
});

test('operator reprocess sanitizes persisted source filenames before restoring into the replay root', async () => {
  await rm(operatorMaterializationRoot, { force: true, recursive: true });

  const sourceRestores = [];
  const store = new InMemoryOperatorControlStore({
    generateId: () => 'op_replay_unsafe',
    sourceReplays: {
      materializationRootPath: operatorMaterializationRoot,
      sourceRepository: {
        async listSnapshots() {
          return [];
        },
        async restoreToPath(input) {
          sourceRestores.push(input);
          await mkdir(dirname(input.destinationPath), { recursive: true });
          await writeFile(input.destinationPath, Buffer.from('unsafe-replay-bytes'));
          return {
            restoredPath: input.destinationPath
          };
        },
        async snapshotFromPath() {
          throw new Error('snapshotFromPath should not run in operator replay tests.');
        }
      }
    },
    versions: [
      {
        assetId: 'ast_unsafe',
        canonicalSourceEvidence: {
          repositoryEngine: 'kopia',
          canonicalSourceId: 'unsafe_src_001',
          canonicalSnapshotId: 'snap_unsafe_001',
          canonicalLogicalPath:
            'source/media-platform/ast_unsafe/ver_unsafe/original/..\\unsafe\\operator-source.zip',
          canonicalDigestSet: [],
          sourceReconstructionHandles: [
            {
              kind: 'snapshot',
              value: 'snap_unsafe_001'
            }
          ]
        },
        lifecycleState: 'canonical',
        sourceFilename: '..\\..\\unsafe\\operator-source.zip',
        versionId: 'ver_unsafe',
        workflowState: 'completed'
      }
    ]
  });
  const { app, defaultOperator } = await createOperatorApp(store);

  const reprocessResponse = await app.request(
    'http://localhost/v1/operator/assets/ast_unsafe/versions/ver_unsafe/reprocess',
    {
      method: 'POST',
      headers: createJsonBearerHeaders(defaultOperator.token)
    }
  );
  const diagnosticsResponse = await app.request(
    'http://localhost/v1/operator/assets/ast_unsafe/versions/ver_unsafe/diagnostics',
    {
      headers: createJsonBearerHeaders(defaultOperator.token)
    }
  );

  assert.equal(reprocessResponse.status, 202);
  assert.match(
    sourceRestores[0]?.destinationPath ?? '',
    /operator-restores\\ast_unsafe\\ver_unsafe\\operator-source\.zip$/
  );
  assert.deepEqual(await diagnosticsResponse.json(), {
    assetId: 'ast_unsafe',
    lifecycleState: 'processing',
    sourceRestore: {
      repositoryEngine: 'kopia',
      restoredPath:
        'C:\\Users\\svalp\\OneDrive\\Documents\\Development\\antiwork\\cdngine\\apps\\api\\test-output\\operator-restores\\ast_unsafe\\ver_unsafe\\operator-source.zip'
    },
    versionId: 'ver_unsafe',
    workflow: {
      state: 'queued',
      workflowId: 'ast_unsafe:ver_unsafe:reprocess:op_replay_unsafe'
    }
  });

  await rm(operatorMaterializationRoot, { force: true, recursive: true });
});
