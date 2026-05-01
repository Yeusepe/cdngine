/**
 * Purpose: Verifies that the worker generic asset processor materializes canonical source evidence and streams the preserved original bytes for publish-time reuse.
 * Governing docs:
 * - docs/workflow-extensibility.md
 * - docs/source-plane-strategy.md
 * - docs/storage-tiering-and-materialization.md
 * - docs/testing-strategy.md
 * Tests:
 * - apps/workers/test/generic-asset-processor.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';

import {
  WorkerGenericAssetProcessor,
  WorkerSourceMaterializer
} from '../dist/index.js';

const materializationRootPath =
  'C:\\Users\\svalp\\OneDrive\\Documents\\Development\\antiwork\\cdngine\\apps\\workers\\test-output';

test('WorkerGenericAssetProcessor restores the canonical source and returns a publishable stream with canonical checksum evidence', async () => {
  await rm(materializationRootPath, { force: true, recursive: true });

  const processor = new WorkerGenericAssetProcessor({
    materializer: new WorkerSourceMaterializer({
      materializationRootPath,
      sourceRepository: {
        async listSnapshots() {
          return [];
        },
        async restoreToPath(input) {
          await writeFile(input.destinationPath, Buffer.from('preserved-generic-asset', 'utf8'));
          return {
            restoredPath: input.destinationPath
          };
        },
        async snapshotFromPath() {
          throw new Error('snapshotFromPath should not run in this test.');
        }
      }
    })
  });

  const result = await processor.processAssetDerivative({
    assetId: 'ast_001',
    canonicalSourceEvidence: {
      repositoryEngine: 'xet',
      canonicalSourceId: 'src_001',
      canonicalSnapshotId: 'snap_001',
      canonicalLogicalPath: 'source/media-platform/ast_001/ver_001/original/archive.bin',
      canonicalDigestSet: [
        {
          algorithm: 'sha256',
          value: 'source-sha'
        }
      ],
      canonicalLogicalByteLength: 23n
    },
    recipeBinding: {
      capabilityId: 'asset.generic',
      contentType: 'application/octet-stream',
      manifestType: 'generic-asset-default',
      recipeId: 'preserve-original',
      schemaVersion: 'v1',
      variantKey: 'preserve-original',
      workflowTemplateId: 'asset-derivation-v1'
    },
    sourceContentType: 'application/octet-stream',
    sourceFilename: 'archive.bin',
    versionId: 'ver_001'
  });

  const chunks = [];
  for await (const chunk of result.body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const publishedBody = Buffer.concat(chunks).toString('utf8');

  assert.equal(publishedBody, 'preserved-generic-asset');
  assert.equal(result.byteLength, 23n);
  assert.equal(result.checksum?.value, 'source-sha');

  await rm(materializationRootPath, { force: true, recursive: true });
});
