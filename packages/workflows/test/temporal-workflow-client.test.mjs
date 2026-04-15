/**
 * Purpose: Verifies that the concrete Temporal client adapter preserves workflow IDs on success and maps duplicate-start conflicts into the runtime's explicit duplicate path.
 * Governing docs:
 * - docs/workflow-extensibility.md
 * - docs/idempotency-and-dispatch.md
 * - docs/versioning-and-compatibility.md
 * Tests:
 * - packages/workflows/test/temporal-workflow-client.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';

import {
  WorkflowAlreadyStartedError
} from '../dist/dispatch-runtime.js';
import {
  TemporalWorkflowStartClient
} from '../dist/temporal-workflow-client.js';

test('TemporalWorkflowStartClient forwards a successful start through the shared start result shape', async () => {
  const client = new TemporalWorkflowStartClient({
    async start(workflowType, options) {
      assert.equal(workflowType, 'imageDerivationWorkflow');
      assert.equal(options.workflowId, 'media:ast_001:ver_001:image-derivation-v1');
      assert.equal(options.taskQueue, 'image-processing');
      return {
        workflowId: options.workflowId
      };
    }
  });

  const result = await client.startWorkflow({
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
  });

  assert.deepEqual(result, {
    workflowId: 'media:ast_001:ver_001:image-derivation-v1'
  });
});

test('TemporalWorkflowStartClient maps workflow-id conflicts to WorkflowAlreadyStartedError', async () => {
  const client = new TemporalWorkflowStartClient({
    async start() {
      throw new WorkflowExecutionAlreadyStartedError(
        'Workflow execution already started',
        'media:ast_001:ver_001:image-derivation-v1',
        'imageDerivationWorkflow'
      );
    }
  });

  await assert.rejects(
    client.startWorkflow({
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
    }),
    (error) => {
      assert.ok(error instanceof WorkflowAlreadyStartedError);
      assert.equal(error.workflowId, 'media:ast_001:ver_001:image-derivation-v1');
      return true;
    }
  );
});
