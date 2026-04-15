/**
 * Purpose: Verifies lineage-event recording and readiness aggregation for the first operator-facing observability slice.
 * Governing docs:
 * - docs/observability.md
 * - docs/security-model.md
 * Tests:
 * - packages/observability/test/observability.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemoryAssetLineageRecorder
} from '../dist/asset-lineage.js';
import {
  summarizeReadiness
} from '../dist/readiness.js';

test('asset lineage recorder preserves checkpoint order for one version', async () => {
  const recorder = new InMemoryAssetLineageRecorder();

  await recorder.record({
    assetId: 'ast_001',
    checkpoint: 'canonicalized',
    namespace: 'media-platform',
    outcome: 'completed',
    recordedAt: new Date('2026-01-15T18:00:00.000Z'),
    service: 'api',
    versionId: 'ver_001'
  });
  await recorder.record({
    assetId: 'ast_001',
    checkpoint: 'workflow-started',
    namespace: 'media-platform',
    outcome: 'accepted',
    recordedAt: new Date('2026-01-15T18:00:01.000Z'),
    service: 'worker',
    versionId: 'ver_001',
    workflowId: 'wf_001'
  });

  assert.deepEqual(
    (await recorder.listVersionEvents('ver_001')).map((event) => event.checkpoint),
    ['canonicalized', 'workflow-started']
  );
});

test('summarizeReadiness distinguishes degraded from not-ready boundaries', () => {
  assert.deepEqual(
    summarizeReadiness([
      { boundary: 'registry', status: 'ok' },
      { boundary: 'temporal', status: 'degraded' }
    ]),
    {
      degradedBoundaries: ['temporal'],
      failedBoundaries: [],
      status: 'degraded'
    }
  );
  assert.deepEqual(
    summarizeReadiness([
      { boundary: 'registry', status: 'ok' },
      { boundary: 'derived-store', status: 'failed' }
    ]),
    {
      degradedBoundaries: [],
      failedBoundaries: ['derived-store'],
      status: 'not-ready'
    }
  );
});
