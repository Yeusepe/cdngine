/**
 * Purpose: Runs a deterministic source-plane proof workload that shows exact-duplicate and near-duplicate storage savings through the benchmark-facing Xet-like command boundary.
 * Governing docs:
 * - docs/source-plane-strategy.md
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/environment-and-deployment.md
 * External references:
 * - https://huggingface.co/docs/xet/en/deduplication
 * - https://huggingface.co/docs/xet/en/file-reconstruction
 * Tests:
 * - packages/storage/test/xet-benchmark-proof.test.ts
 */

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function makeBlock(seed, size) {
  const block = Buffer.alloc(size);
  let state = ((seed + 1) * 2654435761) >>> 0;

  for (let index = 0; index < size; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    block[index] = (state >>> 16) & 0xff;
  }

  return block;
}

function createFixtureFamily() {
  const blockSize = 256 * 1024;
  const blocks = [];

  for (let index = 0; index < 32; index += 1) {
    blocks.push(makeBlock(index + 1, blockSize));
  }

  const base = Buffer.concat(blocks);
  const duplicate = Buffer.from(base);
  const patchBlocks = [...blocks];
  patchBlocks[10] = makeBlock(211, blockSize);
  patchBlocks[21] = makeBlock(223, blockSize);
  const patch = Buffer.concat(patchBlocks);

  return { base, duplicate, patch };
}

function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function runJson(command, args, env, input) {
  const result = spawnSync(command, args, {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    input
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Command failed: ${command} ${args.join(' ')}`);
  }

  return JSON.parse(result.stdout);
}

const workspace = mkdtempSync(join(tmpdir(), 'cdngine-source-proof-'));
const repositoryDirectory = join(workspace, 'repo');
const fixtureDirectory = join(workspace, 'fixtures');
const restoreDirectory = join(workspace, 'restore');
const benchmarkScript = resolve('scripts', 'xet-benchmark.js');
const restoreScript = resolve('scripts', 'xet-restore.js');
const command = process.execPath;
const env = {
  CDNGINE_XET_REPO_DIR: repositoryDirectory
};

try {
  const fixtures = createFixtureFamily();
  mkdirSync(fixtureDirectory, { recursive: true });
  mkdirSync(restoreDirectory, { recursive: true });
  const basePath = join(fixtureDirectory, 'checkpoint-base.bin');
  const duplicatePath = join(fixtureDirectory, 'checkpoint-duplicate.bin');
  const patchPath = join(fixtureDirectory, 'checkpoint-patch.bin');
  const restorePath = join(restoreDirectory, 'checkpoint-patch.bin');

  writeFileSync(basePath, fixtures.base);
  writeFileSync(duplicatePath, fixtures.duplicate);
  writeFileSync(patchPath, fixtures.patch);

  const base = runJson(
    command,
    [benchmarkScript],
    env,
    JSON.stringify({
      assetVersionId: 'ver_base',
      localPath: basePath,
      sourceFilename: 'checkpoint-base.bin',
      sourceDigests: [{ algorithm: 'sha256', value: sha256Hex(fixtures.base) }]
    })
  );
  const duplicate = runJson(
    command,
    [benchmarkScript],
    env,
    JSON.stringify({
      assetVersionId: 'ver_duplicate',
      localPath: duplicatePath,
      sourceFilename: 'checkpoint-duplicate.bin',
      sourceDigests: [{ algorithm: 'sha256', value: sha256Hex(fixtures.duplicate) }]
    })
  );
  const patch = runJson(
    command,
    [benchmarkScript],
    env,
    JSON.stringify({
      assetVersionId: 'ver_patch',
      localPath: patchPath,
      sourceFilename: 'checkpoint-patch.bin',
      sourceDigests: [{ algorithm: 'sha256', value: sha256Hex(fixtures.patch) }]
    })
  );

  runJson(
    command,
    [restoreScript],
    env,
    JSON.stringify({
      fileId: patch.fileId,
      destinationPath: restorePath,
      evidence: patch
    })
  );

  const restoredDigest = sha256Hex(readFileSync(restorePath));
  process.stdout.write(
    JSON.stringify(
      {
        workload: 'near-duplicate-binary-revisions',
        base: {
          logicalByteLength: Number(base.logicalByteLength),
          storedByteLength: Number(base.storedByteLength),
          chunkCount: base.chunkCount,
          reusedChunkCount: base.reusedChunkCount
        },
        duplicate: {
          logicalByteLength: Number(duplicate.logicalByteLength),
          storedByteLength: Number(duplicate.storedByteLength),
          chunkCount: duplicate.chunkCount,
          reusedChunkCount: duplicate.reusedChunkCount
        },
        patch: {
          logicalByteLength: Number(patch.logicalByteLength),
          storedByteLength: Number(patch.storedByteLength),
          chunkCount: patch.chunkCount,
          reusedChunkCount: patch.reusedChunkCount
        },
        improvement: {
          duplicateSavingsRatio:
            1 - Number(duplicate.storedByteLength) / Number(duplicate.logicalByteLength),
          patchSavingsRatio:
            1 - Number(patch.storedByteLength) / Number(patch.logicalByteLength)
        },
        restoreVerified: restoredDigest === sha256Hex(fixtures.patch)
      },
      null,
      2
    )
  );
} finally {
  rmSync(workspace, { force: true, recursive: true });
}
