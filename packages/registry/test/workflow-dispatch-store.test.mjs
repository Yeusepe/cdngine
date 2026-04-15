/**
 * Purpose: Verifies that the registry-side workflow-dispatch store claims pending rows, projects started or duplicate runs, and preserves retryable failure evidence.
 * Governing docs:
 * - docs/persistence-model.md
 * - docs/idempotency-and-dispatch.md
 * - docs/state-machines.md
 * Tests:
 * - packages/registry/test/workflow-dispatch-store.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemoryWorkflowDispatchStore
} from '../dist/workflow-dispatch-store.js';

test('claimPendingDispatches moves pending rows to starting in creation order', async () => {
  const store = new InMemoryWorkflowDispatchStore({
    dispatches: [
      {
        assetVersionId: 'ver_002',
        createdAt: new Date('2026-01-15T18:05:00.000Z'),
        dispatchId: 'wd_002',
        dispatchReason: 'upload-complete',
        workflowKey: 'media:ast_002:ver_002:image-derivation-v1',
        workflowTemplateId: 'image-derivation-v1'
      },
      {
        assetVersionId: 'ver_001',
        createdAt: new Date('2026-01-15T18:00:00.000Z'),
        dispatchId: 'wd_001',
        dispatchReason: 'upload-complete',
        workflowKey: 'media:ast_001:ver_001:image-derivation-v1',
        workflowTemplateId: 'image-derivation-v1'
      }
    ]
  });

  const claimed = await store.claimPendingDispatches({
    claimedAt: new Date('2026-01-15T18:10:00.000Z'),
    limit: 2
  });

  assert.deepEqual(
    claimed.map((dispatch) => dispatch.dispatchId),
    ['wd_001', 'wd_002']
  );
  assert.deepEqual(
    claimed.map((dispatch) => dispatch.dispatchState),
    ['starting', 'starting']
  );
  assert.deepEqual(
    claimed.map((dispatch) => dispatch.versionToken),
    [2, 2]
  );
});

test('recordStarted projects a queued workflow run after Temporal accepts the start', async () => {
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

  const [claimed] = await store.claimPendingDispatches({
    claimedAt: new Date('2026-01-15T18:10:00.000Z'),
    limit: 1
  });

  await store.recordStarted({
    currentPhase: 'accepted',
    dispatchId: claimed.dispatchId,
    expectedVersionToken: claimed.versionToken,
    startedAt: new Date('2026-01-15T18:10:01.000Z'),
    workflowId: claimed.workflowKey
  });

  const dispatch = await store.getDispatch('wd_001');
  const [workflowRun] = await store.listWorkflowRuns('ver_001');

  assert.equal(dispatch?.dispatchState, 'started');
  assert.equal(dispatch?.versionToken, 3);
  assert.equal(workflowRun.workflowRunId, 'wfr_001');
  assert.equal(workflowRun.workflowId, 'media:ast_001:ver_001:image-derivation-v1');
  assert.equal(workflowRun.state, 'queued');
  assert.equal(workflowRun.currentPhase, 'accepted');
});

test('recordDuplicate converges on an existing workflow run instead of creating another start intent', async () => {
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

  const [claimed] = await store.claimPendingDispatches({
    claimedAt: new Date('2026-01-15T18:10:00.000Z'),
    limit: 1
  });

  await store.recordDuplicate({
    currentPhase: 'already-running',
    dispatchId: claimed.dispatchId,
    expectedVersionToken: claimed.versionToken,
    observedAt: new Date('2026-01-15T18:10:05.000Z'),
    workflowId: claimed.workflowKey
  });

  const dispatch = await store.getDispatch('wd_001');
  const workflowRuns = await store.listWorkflowRuns('ver_001');

  assert.equal(dispatch?.dispatchState, 'duplicate');
  assert.equal(workflowRuns.length, 1);
  assert.equal(workflowRuns[0].workflowId, claimed.workflowKey);
  assert.equal(workflowRuns[0].state, 'running');
});

test('recordFailedRetryable preserves retry evidence for operator visibility', async () => {
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

  const [claimed] = await store.claimPendingDispatches({
    claimedAt: new Date('2026-01-15T18:10:00.000Z'),
    limit: 1
  });

  await store.recordFailedRetryable({
    dispatchId: claimed.dispatchId,
    expectedVersionToken: claimed.versionToken,
    failedAt: new Date('2026-01-15T18:10:03.000Z'),
    failureClass: 'temporal-unavailable',
    retrySummary: {
      attempts: 1,
      nextBackoffMs: 5000
    }
  });

  const dispatch = await store.getDispatch('wd_001');

  assert.equal(dispatch?.dispatchState, 'failed_retryable');
  assert.equal(dispatch?.lastFailureClass, 'temporal-unavailable');
  assert.deepEqual(dispatch?.retrySummary, {
    attempts: 1,
    nextBackoffMs: 5000
  });
});
