/**
 * Purpose: Validates the real package corpus dedupe runner's argument and summary behavior on a tiny local corpus.
 * Governing docs:
 * - docs/source-plane-strategy.md
 * - docs/testing-strategy.md
 * External references:
 * - https://nodejs.org/api/test.html
 * - https://nodejs.org/api/fs.html
 * Tests:
 * - scripts/package-corpus-dedupe.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runPackageCorpusDedupe } from './package-corpus-dedupe.mjs';

function createFakeSplitArtifacts(entriesByArchive) {
  return {
    compareSplitEntryDigestTrees: () => true,
    createSplitArtifactArchive: ({ entries }) => Buffer.concat(entries.map((entry) => entry.data)),
    createSplitArtifactManifest: ({ originalArchive, originalFilename, split }) => ({
      assetId: originalFilename,
      entries: split.entries.map((entry, index) => ({
        index,
        logicalPath: entry.logicalPath,
        sha256: '0'.repeat(64),
        size: entry.data.length
      })),
      format: split.format,
      originalArchive: {
        filename: originalFilename,
        logicalByteLength: originalArchive.length,
        sha256: '1'.repeat(64)
      },
      reconstructionFidelity: 'content-equivalent',
      totalEntryByteLength: split.entries.reduce((sum, entry) => sum + entry.data.length, 0)
    }),
    detectSplitArtifactFormat: (filename) =>
      entriesByArchive.has(filename) ? { format: 'zip' } : null,
    splitArtifactArchive: ({ filename }) => ({
      entries: entriesByArchive.get(filename),
      format: 'zip',
      originalLogicalByteLength: 0
    })
  };
}

test('runPackageCorpusDedupe reports raw and deduped bytes for repeated files', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'cdngine-package-corpus-test-'));
  const corpusPath = join(workspace, 'corpus');
  const repositoryPath = join(workspace, 'repo');
  const repeated = Buffer.alloc(512 * 1024, 7);

  try {
    mkdirSync(corpusPath, { recursive: true });
    writeFileSync(join(corpusPath, 'a.bin'), repeated);
    writeFileSync(join(corpusPath, 'b.bin'), repeated);

    const summary = await runPackageCorpusDedupe({
      corpusPath,
      repositoryPath,
      reset: true,
      restoreSampleCount: 1
    });

    assert.equal(summary.fileCount, 2);
    assert.equal(summary.totalLogicalByteLength, repeated.length * 2);
    assert.equal(summary.totalStoredByteLength < summary.totalLogicalByteLength, true);
    assert.equal(summary.files[1].storedByteLength, 0);
    assert.equal('evidence' in summary.files[0], false);
    assert.equal(typeof summary.files[0].fileId, 'string');
    assert.equal(summary.reusedChunks > 0, true);
    assert.equal(summary.restoreSamples.every((sample) => sample.verified), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('runPackageCorpusDedupe split mode stores archive entries and reports original archive size', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'cdngine-package-corpus-split-test-'));
  const corpusPath = join(workspace, 'corpus');
  const repositoryPath = join(workspace, 'repo');
  const repeated = Buffer.alloc(512 * 1024, 9);
  const splitArtifacts = createFakeSplitArtifacts(
    new Map([
      [
        'bundle-v1.zip',
        [
          { data: repeated, logicalPath: 'payload.bin' },
          { data: Buffer.from('v1 metadata'), logicalPath: 'metadata.txt' }
        ]
      ],
      [
        'bundle-v2.zip',
        [
          { data: repeated, logicalPath: 'payload.bin' },
          { data: Buffer.from('v2 metadata'), logicalPath: 'metadata.txt' }
        ]
      ]
    ])
  );

  try {
    mkdirSync(corpusPath, { recursive: true });
    writeFileSync(join(corpusPath, 'bundle-v1.zip'), Buffer.from('archive-one'));
    writeFileSync(join(corpusPath, 'bundle-v2.zip'), Buffer.from('archive-two'));

    const summary = await runPackageCorpusDedupe({
      corpusPath,
      mode: 'split',
      repositoryPath,
      reset: true,
      restoreSampleCount: 2,
      splitArtifacts
    });

    assert.equal(summary.mode, 'split');
    assert.equal(summary.fileCount, 2);
    assert.equal(summary.benchmarkedObjectCount, 4);
    assert.equal(summary.splitFileCount, 2);
    assert.equal(summary.totalOriginalArchiveByteLength, 'archive-one'.length + 'archive-two'.length);
    assert.equal(summary.totalSplitEntryByteLength, repeated.length * 2 + 'v1 metadata'.length + 'v2 metadata'.length);
    assert.equal(summary.totalStoredByteLength < summary.totalSplitEntryByteLength, true);
    assert.equal(summary.reusedChunks > 0, true);
    assert.equal(summary.files.every((file) => file.contentEquivalentVerified), true);
    assert.equal(summary.restoreSamples.every((sample) => sample.verified), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('runPackageCorpusDedupe both mode compares separate archive and split repositories', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'cdngine-package-corpus-both-test-'));
  const corpusPath = join(workspace, 'corpus');
  const repositoryPath = join(workspace, 'repo');
  const repeated = Buffer.alloc(512 * 1024, 3);
  const splitArtifacts = createFakeSplitArtifacts(
    new Map([
      ['bundle-v1.zip', [{ data: repeated, logicalPath: 'payload.bin' }]],
      ['bundle-v2.zip', [{ data: repeated, logicalPath: 'payload.bin' }]]
    ])
  );

  try {
    mkdirSync(corpusPath, { recursive: true });
    writeFileSync(join(corpusPath, 'bundle-v1.zip'), repeated);
    writeFileSync(join(corpusPath, 'bundle-v2.zip'), repeated);

    const summary = await runPackageCorpusDedupe({
      corpusPath,
      mode: 'both',
      repositoryPath,
      reset: true,
      restoreSampleCount: 1,
      splitArtifacts
    });

    assert.equal(summary.mode, 'both');
    assert.equal(summary.archive.mode, 'archive');
    assert.equal(summary.split.mode, 'split');
    assert.equal(typeof summary.comparison.splitDeltaByteLength, 'number');
    assert.equal(summary.archive.repositoryPath.endsWith(join('repo', 'archive')), true);
    assert.equal(summary.split.repositoryPath.endsWith(join('repo', 'split')), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
