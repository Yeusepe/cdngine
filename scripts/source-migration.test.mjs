/**
 * Purpose: Verifies that the source-migration tooling inventories legacy Kopia rows and produces explicit dry-run or apply-time re-canonicalization reports without rewriting registry evidence.
 * Governing docs:
 * - docs/source-plane-strategy.md
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/testing-strategy.md
 * - docs/review-playbook.md
 * External references:
 * - https://nodejs.org/api/test.html
 * - https://nodejs.org/api/fs.html
 * Tests:
 * - scripts/source-migration.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildInventoryReport,
  buildRecanonicalizationPlan,
  runInventoryCommand,
  runRecanonicalizeCommand
} from './source-migration.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const testOutputRoot = join(scriptDirectory, 'test-output', 'source-migration');

const fixtureRecords = [
  {
    assetId: 'ast_xet_001',
    versionId: 'ver_xet_001',
    versionNumber: 1,
    serviceNamespaceId: 'svc_media',
    lifecycleState: 'canonical',
    sourceFilename: 'hero.psd',
    repositoryEngine: 'xet',
    canonicalSourceId: 'xet-src-001',
    canonicalSnapshotId: 'xet-src-001',
    canonicalLogicalPath: 'source/media/ast_xet_001/ver_xet_001/original/hero.psd'
  },
  {
    assetId: 'ast_legacy_001',
    versionId: 'ver_legacy_001',
    versionNumber: 3,
    serviceNamespaceId: 'svc_media',
    tenantScopeId: 'tenant_alpha',
    lifecycleState: 'published',
    sourceFilename: 'legacy.psd',
    repositoryEngine: 'kopia',
    canonicalSourceId: 'legacy-src-001',
    canonicalSnapshotId: 'snap-legacy-001',
    canonicalLogicalPath: 'source/media/ast_legacy_001/ver_legacy_001/original/legacy.psd',
    canonicalDigestSet: [
      {
        algorithm: 'sha256',
        value: 'legacy-sha256'
      }
    ],
    canonicalLogicalByteLength: '4096',
    sourceReconstructionHandles: [
      {
        kind: 'snapshot',
        value: 'snap-legacy-001'
      }
    ],
    isCurrentCanonicalVersion: true
  },
  {
    assetId: 'ast_missing_001',
    versionId: 'ver_missing_001',
    versionNumber: 5,
    serviceNamespaceId: 'svc_media',
    lifecycleState: 'canonical',
    sourceFilename: 'unknown.bin',
    canonicalSourceId: 'missing-src-001',
    canonicalSnapshotId: 'missing-src-001',
    canonicalLogicalPath: 'source/media/ast_missing_001/ver_missing_001/original/unknown.bin'
  }
];

function resetTestOutput() {
  rmSync(testOutputRoot, { recursive: true, force: true });
  mkdirSync(testOutputRoot, { recursive: true });
}

test.beforeEach(() => {
  resetTestOutput();
});

test.after(() => {
  rmSync(testOutputRoot, { recursive: true, force: true });
});

test('buildInventoryReport classifies risky legacy rows without guessing missing engines', () => {
  const report = buildInventoryReport(fixtureRecords, {
    sourceMode: 'file'
  });

  assert.deepEqual(report.summary, {
    totalRows: 3,
    xetRows: 1,
    legacyKopiaRows: 1,
    missingEngineRows: 1,
    otherEngineRows: 0,
    eligibleLegacyRows: 1,
    manualReviewRows: 1
  });
  assert.equal(report.riskyRows.length, 2);
  assert.equal(report.riskyRows[0].inventoryStatus, 'legacy-kopia');
  assert.equal(report.riskyRows[0].recanonicalizationStatus, 'eligible');
  assert.equal(report.riskyRows[1].inventoryStatus, 'missing-engine');
  assert.equal(report.riskyRows[1].recanonicalizationStatus, 'manual-review');
});

test('buildRecanonicalizationPlan produces an explicit dry-run plan', () => {
  const report = buildRecanonicalizationPlan(fixtureRecords, {
    apply: false,
    sourceMode: 'file',
    targetEngine: 'xet'
  });

  assert.equal(report.mode, 'dry-run');
  assert.equal(report.summary.selectedRows, 2);
  assert.equal(report.summary.eligibleRows, 1);
  assert.equal(report.summary.manualReviewRows, 1);
  assert.equal(report.operations[0].registryMutation, 'none');
  assert.equal(report.operations[1].reason, 'repository-engine-missing');
});

test('runInventoryCommand reads a JSON inventory file and writes a report', async () => {
  const inputPath = join(testOutputRoot, 'inventory-input.json');
  const outputPath = join(testOutputRoot, 'inventory-report.json');
  writeFileSync(inputPath, JSON.stringify({ versions: fixtureRecords }, null, 2));

  const report = await runInventoryCommand({
    fromFile: inputPath,
    output: outputPath
  });

  assert.equal(report.summary.legacyKopiaRows, 1);
  assert.equal(existsSync(outputPath), true);
  const writtenReport = JSON.parse(readFileSync(outputPath, 'utf8'));
  assert.equal(writtenReport.summary.missingEngineRows, 1);
});

test('runRecanonicalizeCommand apply mode restores legacy Kopia rows and captures Xet candidates', async () => {
  const outputPath = join(testOutputRoot, 'recanonicalize-report.json');
  const workDir = join(testOutputRoot, 'workspace');
  const restoreInvocations = [];
  const snapshotInvocations = [];

  const report = await runRecanonicalizeCommand(
    {
      apply: true,
      output: outputPath,
      workDir
    },
    {
      loadRecords: async () => fixtureRecords,
      resolveTargetEngine: () => 'xet',
      createSourceRepository: async () => ({
        async restoreToPath(input) {
          restoreInvocations.push(input);
          mkdirSync(dirname(input.destinationPath), { recursive: true });
          writeFileSync(input.destinationPath, Buffer.from('legacy-bytes'));
          return {
            restoredPath: input.destinationPath
          };
        },
        async snapshotFromPath(input) {
          snapshotInvocations.push(input);
          return {
            repositoryEngine: 'xet',
            canonicalSourceId: 'xet-file-001',
            snapshotId: 'xet-file-001',
            logicalPath: `source/migrated/${input.assetVersionId}/${input.sourceFilename}`,
            digests: input.sourceDigests ?? [],
            logicalByteLength: input.logicalByteLength
          };
        },
        async listSnapshots() {
          return [];
        }
      })
    }
  );

  assert.equal(report.summary.materializedRows, 1);
  assert.equal(report.summary.failedRows, 0);
  assert.equal(restoreInvocations[0]?.snapshot?.repositoryEngine, 'kopia');
  assert.equal(snapshotInvocations[0]?.assetVersionId, 'ver_legacy_001');
  assert.equal(report.operations[0].recanonicalizationStatus, 'recanonicalized');
  assert.equal(report.operations[0].candidateCanonicalSource.repositoryEngine, 'xet');
  assert.equal(report.operations[0].registryMutation, 'none');
  assert.equal(report.operations[1].recanonicalizationStatus, 'manual-review');
  assert.equal(existsSync(join(workDir, 'restores')), false);
  assert.equal(existsSync(outputPath), true);
});
