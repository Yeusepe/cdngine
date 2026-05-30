/**
 * Purpose: Verifies generic split-history archive adapters preserve content equivalence while enforcing safe archive boundaries.
 * Governing docs:
 * - docs/source-plane-strategy.md
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/storage-tiering-and-materialization.md
 * - docs/testing-strategy.md
 * External references:
 * - https://www.gnu.org/software/tar/manual/html_node/Standard.html
 * - https://www.rfc-editor.org/rfc/rfc1952
 * - https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
 * Tests:
 * - packages/storage/test/split-artifact-adapters.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ArchiveSafetyError,
  compareSplitEntryDigestTrees,
  createSplitArtifactArchive,
  createSplitArtifactManifest,
  detectSplitArtifactFormat,
  planSplitHistoryDemotion,
  splitArtifactArchive
} from '../src/split-artifact-adapters.ts';

const sampleEntries = [
  {
    data: Buffer.from('alpha'),
    logicalPath: 'Assets/Example/a.txt',
    mode: 0o644,
    mtime: new Date('2026-05-01T00:00:00Z')
  },
  {
    data: Buffer.from('beta'),
    logicalPath: 'Assets/Example/Nested/b.txt',
    mode: 0o644,
    mtime: new Date('2026-05-01T00:00:00Z')
  }
];

test('detectSplitArtifactFormat validates supported archive structures', () => {
  const tar = createSplitArtifactArchive({
    entries: sampleEntries,
    format: 'tar'
  });
  const gzipTar = createSplitArtifactArchive({
    entries: sampleEntries,
    format: 'gzip-tar'
  });
  const zip = createSplitArtifactArchive({
    entries: sampleEntries,
    format: 'zip'
  });

  assert.equal(detectSplitArtifactFormat('payload.tar', tar)?.format, 'tar');
  assert.equal(detectSplitArtifactFormat('payload.tgz', gzipTar)?.format, 'gzip-tar');
  assert.equal(detectSplitArtifactFormat('payload.unitypackage', gzipTar)?.format, 'unitypackage');
  assert.equal(detectSplitArtifactFormat('payload.zip', zip)?.format, 'zip');
  assert.equal(detectSplitArtifactFormat('payload.unitypackage', Buffer.from('not gzip')), null);
});

test('splitArtifactArchive and createSplitArtifactArchive round-trip content-equivalent tar gzip and zip archives', () => {
  for (const format of ['tar', 'gzip-tar', 'zip', 'unitypackage'] as const) {
    const archive = createSplitArtifactArchive({
      entries: sampleEntries,
      format
    });
    const unpacked = splitArtifactArchive({
      archive,
      filename: format === 'unitypackage' ? 'asset.unitypackage' : `asset.${format === 'gzip-tar' ? 'tgz' : format}`
    });
    const repacked = createSplitArtifactArchive({
      entries: unpacked.entries,
      format: unpacked.format
    });
    const unpackedAgain = splitArtifactArchive({
      archive: repacked,
      filename: format === 'unitypackage' ? 'asset.unitypackage' : `asset.${format === 'gzip-tar' ? 'tgz' : format}`
    });

    assert.equal(compareSplitEntryDigestTrees(unpacked.entries, unpackedAgain.entries), true);
    assert.equal(unpacked.entries.length, sampleEntries.length);
  }
});

test('createSplitArtifactManifest records original digest, entry digests, and split policy state', () => {
  const archive = createSplitArtifactArchive({
    entries: sampleEntries,
    format: 'zip'
  });
  const split = splitArtifactArchive({
    archive,
    filename: 'sample.zip'
  });
  const manifest = createSplitArtifactManifest({
    assetId: 'ast_1',
    originalArchive: archive,
    originalFilename: 'sample.zip',
    split
  });

  assert.equal(manifest.assetId, 'ast_1');
  assert.equal(manifest.format, 'zip');
  assert.equal(manifest.reconstructionFidelity, 'content-equivalent');
  assert.equal(manifest.entries.length, 2);
  assert.equal(manifest.entries[0]?.sha256.length, 64);
  assert.equal(manifest.originalArchive.sha256.length, 64);
});

test('splitArtifactArchive rejects unsafe archive paths before split evidence can be persisted', () => {
  const archive = createSplitArtifactArchive({
    entries: [
      {
        data: Buffer.from('bad'),
        logicalPath: '../escape.txt'
      }
    ],
    format: 'tar',
    skipPathValidationForTesting: true
  });

  assert.throws(
    () =>
      splitArtifactArchive({
        archive,
        filename: 'unsafe.tar'
      }),
    ArchiveSafetyError
  );
});

test('planSplitHistoryDemotion keeps current whole and selects older eligible archive versions', () => {
  const plan = planSplitHistoryDemotion({
    currentVersionId: 'v3',
    policyEnabled: true,
    versions: [
      { filename: 'a.zip', representation: 'whole', versionId: 'v1' },
      { filename: 'a.txt', representation: 'whole', versionId: 'v2' },
      { filename: 'a.zip', representation: 'whole', versionId: 'v3' },
      { filename: 'a.zip', representation: 'split', versionId: 'v0' }
    ]
  });

  assert.deepEqual(plan.demoteVersionIds, ['v1']);
  assert.equal(plan.currentVersionId, 'v3');
});
