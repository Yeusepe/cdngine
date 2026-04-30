/**
 * Purpose: Runs the same duplicate and near-duplicate source-plane workload through a real local Kopia filesystem repository so CDNgine can compare measured repo growth and restore correctness against the benchmark-facing Xet-like path.
 * Governing docs:
 * - docs/source-plane-strategy.md
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/environment-and-deployment.md
 * External references:
 * - https://kopia.io/docs/reference/command-line/common/snapshot-create/
 * - https://kopia.io/docs/reference/command-line/common/snapshot-restore/
 * Tests:
 * - Manual validation with `npm run benchmark:source-plane-proof:kopia`
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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

  return {
    base,
    duplicate,
    patch: Buffer.concat(patchBlocks)
  };
}

function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function runKopiaJson(executable, args, env) {
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    env: { ...process.env, ...env }
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Kopia command failed: ${args.join(' ')}`);
  }

  return JSON.parse(result.stdout);
}

function runKopia(executable, args, env) {
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    env: { ...process.env, ...env }
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Kopia command failed: ${args.join(' ')}`);
  }
}

function getDirectorySize(path) {
  let total = 0;

  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const fullPath = join(path, entry.name);

    if (entry.isDirectory()) {
      total += getDirectorySize(fullPath);
      continue;
    }

    total += statSync(fullPath).size;
  }

  return total;
}

function prepareSourceDirectory(root, name, contents) {
  const sourceDirectory = join(root, name);
  mkdirSync(sourceDirectory, { recursive: true });
  writeFileSync(join(sourceDirectory, 'checkpoint.bin'), contents);
  return sourceDirectory;
}

function resolveKopiaExecutable() {
  return resolve(process.env.CDNGINE_KOPIA_EXECUTABLE ?? 'kopia');
}

const workspace = mkdtempSync(join(tmpdir(), 'cdngine-kopia-proof-'));
const repositoryDirectory = join(workspace, 'repo');
const sourceRoot = join(workspace, 'sources');
const restoreDirectory = join(workspace, 'restore');
const configFile = join(workspace, 'repository.config');
const executable = resolveKopiaExecutable();
const password = 'benchmark-pass';
const env = {
  KOPIA_CHECK_FOR_UPDATES: 'false'
};

try {
  const fixtures = createFixtureFamily();
  const baseSource = prepareSourceDirectory(sourceRoot, 'base', fixtures.base);
  const duplicateSource = prepareSourceDirectory(sourceRoot, 'duplicate', fixtures.duplicate);
  const patchSource = prepareSourceDirectory(sourceRoot, 'patch', fixtures.patch);
  mkdirSync(repositoryDirectory, { recursive: true });
  mkdirSync(restoreDirectory, { recursive: true });

  runKopia(
    executable,
    [
      'repository',
      'create',
      'filesystem',
      `--path=${repositoryDirectory}`,
      `--config-file=${configFile}`,
      `--password=${password}`
    ],
    env
  );

  const afterCreateBytes = getDirectorySize(repositoryDirectory);
  const base = runKopiaJson(
    executable,
    [
      'snapshot',
      'create',
      baseSource,
      `--config-file=${configFile}`,
      `--password=${password}`,
      '--json',
      '--description',
      'benchmark-base'
    ],
    env
  );
  const afterBaseBytes = getDirectorySize(repositoryDirectory);
  const duplicate = runKopiaJson(
    executable,
    [
      'snapshot',
      'create',
      duplicateSource,
      `--config-file=${configFile}`,
      `--password=${password}`,
      '--json',
      '--description',
      'benchmark-duplicate'
    ],
    env
  );
  const afterDuplicateBytes = getDirectorySize(repositoryDirectory);
  const patch = runKopiaJson(
    executable,
    [
      'snapshot',
      'create',
      patchSource,
      `--config-file=${configFile}`,
      `--password=${password}`,
      '--json',
      '--description',
      'benchmark-patch'
    ],
    env
  );
  const afterPatchBytes = getDirectorySize(repositoryDirectory);

  runKopia(
    executable,
    [
      'snapshot',
      'restore',
      patch.id,
      restoreDirectory,
      `--config-file=${configFile}`,
      `--password=${password}`
    ],
    env
  );

  const restoredDigest = sha256Hex(readFileSync(join(restoreDirectory, 'checkpoint.bin')));
  const logicalByteLength = fixtures.base.length;
  const baseStoredDelta = afterBaseBytes - afterCreateBytes;
  const duplicateStoredDelta = afterDuplicateBytes - afterBaseBytes;
  const patchStoredDelta = afterPatchBytes - afterDuplicateBytes;

  process.stdout.write(
    JSON.stringify(
      {
        workload: 'near-duplicate-binary-revisions',
        repositoryEngine: 'kopia',
        executable,
        base: {
          logicalByteLength,
          storedByteLength: baseStoredDelta,
          snapshotId: base.id
        },
        duplicate: {
          logicalByteLength,
          storedByteLength: duplicateStoredDelta,
          snapshotId: duplicate.id
        },
        patch: {
          logicalByteLength,
          storedByteLength: patchStoredDelta,
          snapshotId: patch.id
        },
        improvement: {
          duplicateSavingsRatio: 1 - duplicateStoredDelta / logicalByteLength,
          patchSavingsRatio: 1 - patchStoredDelta / logicalByteLength
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
