/**
 * Purpose: Verifies that the workflow dispatch runtime starts pending dispatches, converges Temporal workflow-ID conflicts, and records terminal template-resolution failures.
 * Governing docs:
 * - docs/idempotency-and-dispatch.md
 * - docs/workflow-extensibility.md
 * - docs/versioning-and-compatibility.md
 * Tests:
 * - packages/workflows/test/dispatch-runtime.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemoryWorkflowDispatchStore
} from '@cdngine/registry';

import {
  WorkflowAlreadyStartedError,
  WorkflowDispatchRuntime
} from '../dist/dispatch-runtime.js';
import {
  UnknownWorkflowTemplateError,
  WorkflowTemplateRegistry
} from '../dist/workflow-registry.js';

class FakeWorkflowStartClient {
  constructor(behavior = 'success') {
    this.behavior = behavior;
    this.requests = [];
  }

  async startWorkflow(input) {
    this.requests.push(input);

    if (this.behavior === 'duplicate') {
      throw new WorkflowAlreadyStartedError(input.workflowId);
    }

    if (this.behavior === 'retryable-failure') {
      const error = new Error('Temporal service unavailable');
      error.name = 'ServiceError';
      throw error;
    }

    return {
      workflowId: input.workflowId
    };
  }
}

test('dispatchPending starts pending workflow intents through the resolved template task queue', async () => {
  const store = new InMemoryWorkflowDispatchStore({
    dispatches: [
      {
        assetVersionId: 'ver_001',
        dispatchId: 'wd_001',
        dispatchReason: 'upload-complete',
        workflowKey: 'media:ast_001:ver_001:image-derivation-v1',
        workflowTemplateId: 'image-derivation-v1'
      }
    ],
    generateId: () => 'wfr_001'
  });
  const client = new FakeWorkflowStartClient();
  const runtime = new WorkflowDispatchRuntime(store, client, {
    now: () => new Date('2026-01-15T18:10:00.000Z')
  });

  const result = await runtime.dispatchPending();
  const dispatch = await store.getDispatch('wd_001');
  const [workflowRun] = await store.listWorkflowRuns('ver_001');

  assert.deepEqual(result, {
    claimedCount: 1,
    duplicateCount: 0,
    retryableFailureCount: 0,
    startedCount: 1,
    terminalFailureCount: 0
  });
  assert.deepEqual(client.requests, [
    {
      args: [
        {
          assetVersionId: 'ver_001',
          dispatchId: 'wd_001',
          dispatchReason: 'upload-complete',
          workflowKey: 'media:ast_001:ver_001:image-derivation-v1',
          workflowTemplateId: 'image-derivation-v1'
        }
      ],
      taskQueue: 'image-processing',
      workflowId: 'media:ast_001:ver_001:image-derivation-v1',
      workflowType: 'imageDerivationWorkflow'
    }
  ]);
  assert.equal(dispatch?.dispatchState, 'started');
  assert.equal(workflowRun.state, 'queued');
});

test('dispatchPending records duplicates when Temporal reports the workflow already exists', async () => {
  const store = new InMemoryWorkflowDispatchStore({
    dispatches: [
      {
        assetVersionId: 'ver_001',
        dispatchId: 'wd_001',
        dispatchReason: 'upload-complete',
        workflowKey: 'media:ast_001:ver_001:image-derivation-v1',
        workflowTemplateId: 'image-derivation-v1'
      }
    ]
  });
  const runtime = new WorkflowDispatchRuntime(
    store,
    new FakeWorkflowStartClient('duplicate'),
    {
      now: () => new Date('2026-01-15T18:10:00.000Z')
    }
  );

  const result = await runtime.dispatchPending();
  const dispatch = await store.getDispatch('wd_001');
  const [workflowRun] = await store.listWorkflowRuns('ver_001');

  assert.equal(result.duplicateCount, 1);
  assert.equal(dispatch?.dispatchState, 'duplicate');
  assert.equal(workflowRun.workflowId, 'media:ast_001:ver_001:image-derivation-v1');
  assert.equal(workflowRun.state, 'running');
});

test('dispatchPending records terminal failures when a dispatch references an unknown template', async () => {
  const store = new InMemoryWorkflowDispatchStore({
    dispatches: [
      {
        assetVersionId: 'ver_001',
        dispatchId: 'wd_001',
        dispatchReason: 'upload-complete',
        workflowKey: 'media:ast_001:ver_001:unknown-template-v1',
        workflowTemplateId: 'unknown-template-v1'
      }
    ]
  });
  const runtime = new WorkflowDispatchRuntime(
    store,
    new FakeWorkflowStartClient(),
    {
      now: () => new Date('2026-01-15T18:10:00.000Z'),
      templateRegistry: new WorkflowTemplateRegistry([])
    }
  );

  const result = await runtime.dispatchPending();
  const dispatch = await store.getDispatch('wd_001');

  assert.equal(result.terminalFailureCount, 1);
  assert.equal(dispatch?.dispatchState, 'failed_terminal');
  assert.equal(dispatch?.lastFailureClass, 'unknown-workflow-template');
});

test('template registry rejects unknown workflow-template identifiers explicitly', () => {
  const registry = new WorkflowTemplateRegistry([]);

  assert.throws(() => registry.resolve('missing-template'), (error) => {
    assert.ok(error instanceof UnknownWorkflowTemplateError);
    assert.equal(error.workflowTemplateId, 'missing-template');
    return true;
  });
});
