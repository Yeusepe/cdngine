/**
 * Purpose: Verifies that the durable workflow-dispatch repository claims pending rows, records duplicate starts, and projects workflow runs in PostgreSQL.
 * Governing docs:
 * - docs/idempotency-and-dispatch.md
 * - docs/persistence-model.md
 * - docs/service-architecture.md
 * Tests:
 * - packages/registry/test/prisma-workflow-dispatch-store.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PrismaWorkflowDispatchStore
} from '../dist/index.js';
import { withRegistryTestDatabase } from './prisma-test-helpers.mjs';

async function seedDispatchFixture(prisma, scope) {
  const serviceNamespaceId = `media-platform-${scope}`;
  const namespace = await prisma.serviceNamespace.create({
    data: {
      displayName: 'Media Platform',
      serviceNamespaceId,
      tenantIsolationMode: 'shared-tenant'
    }
  });
  const asset = await prisma.asset.create({
    data: {
      assetOwner: 'customer:acme',
      lookupKey: 'fixture-asset',
      serviceNamespaceId: namespace.id
    }
  });
  const version = await prisma.assetVersion.create({
    data: {
      assetId: asset.id,
      canonicalLogicalPath: 'source/media-platform/fixture.png',
      canonicalSnapshotId: `snap_fixture_${scope}`,
      canonicalSourceId: `src_fixture_${scope}`,
      detectedContentType: 'image/png',
      lifecycleState: 'canonical',
      repositoryEngine: 'xet',
      sourceByteLength: 123n,
      sourceChecksumAlgorithm: 'sha256',
      sourceChecksumValue: 'abc123',
      sourceFilename: 'fixture.png',
      versionNumber: 1
    }
  });
  await prisma.workflowDispatch.createMany({
    data: [
      {
        assetVersionId: version.id,
        createdAt: new Date('2026-02-01T12:00:00.000Z'),
        dispatchReason: 'upload-complete',
        id: `wd_001_${scope}`,
        updatedAt: new Date('2026-02-01T12:00:00.000Z'),
        workflowKey: `${serviceNamespaceId}:${asset.id}:${version.id}:image-derivation-v1`,
        workflowTemplateId: 'image-derivation-v1'
      },
      {
        assetVersionId: version.id,
        createdAt: new Date('2026-02-01T12:05:00.000Z'),
        dispatchReason: 'upload-complete',
        id: `wd_002_${scope}`,
        updatedAt: new Date('2026-02-01T12:05:00.000Z'),
        workflowKey: `${serviceNamespaceId}:${asset.id}:${version.id}:image-derivation-v2`,
        workflowTemplateId: 'image-derivation-v2'
      }
    ]
  });

  return { asset, version };
}

test('Prisma workflow-dispatch store claims and projects durable runs', async () => {
  await withRegistryTestDatabase(async ({ prisma, schema }) => {
    const { version } = await seedDispatchFixture(prisma, schema);
    const store = new PrismaWorkflowDispatchStore({ prisma });

    const claimed = await store.claimPendingDispatches({
      claimedAt: new Date('2026-02-01T12:10:00.000Z'),
      limit: 2
    });

    assert.deepEqual(
      claimed.map((dispatch) => dispatch.dispatchId),
      [`wd_001_${schema}`, `wd_002_${schema}`]
    );
    assert.deepEqual(
      claimed.map((dispatch) => dispatch.dispatchState),
      ['starting', 'starting']
    );

    await store.recordStarted({
      currentPhase: 'accepted',
      dispatchId: claimed[0].dispatchId,
      expectedVersionToken: claimed[0].versionToken,
      startedAt: new Date('2026-02-01T12:10:01.000Z'),
      workflowId: claimed[0].workflowKey
    });
    await store.recordDuplicate({
      currentPhase: 'already-running',
      dispatchId: claimed[1].dispatchId,
      expectedVersionToken: claimed[1].versionToken,
      observedAt: new Date('2026-02-01T12:10:02.000Z'),
      workflowId: claimed[1].workflowKey
    });

    const dispatches = await Promise.all([
      store.getDispatch(`wd_001_${schema}`),
      store.getDispatch(`wd_002_${schema}`)
    ]);
    const workflowRuns = await store.listWorkflowRuns(version.id);

    assert.equal(dispatches[0]?.dispatchState, 'started');
    assert.equal(dispatches[1]?.dispatchState, 'duplicate');
    assert.equal(workflowRuns.length, 2);
    assert.deepEqual(
      workflowRuns.map((run) => run.state),
      ['queued', 'running']
    );
  });
});
