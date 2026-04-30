/**
 * Purpose: Runs the duplicate and near-duplicate source-plane workload through a local Oxen repository so CDNgine can compare version-store growth and restore behavior against the current benchmark set.
 * Governing docs:
 * - docs/source-plane-strategy.md
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/format-agnostic-upstream-review.md
 * External references:
 * - https://docs.oxen.ai/getting-started/install
 * - https://docs.oxen.ai/getting-started/versioning
 * Tests:
 * - Manual validation with `npm run benchmark:source-plane-proof:oxen`
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
  unlinkSync,
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

function resolveOxenExecutable() {
  return resolve(process.env.CDNGINE_OXEN_EXECUTABLE ?? 'oxen');
}

function runOxen(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...options.env
    }
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n');

  if (result.status !== 0) {
    throw new Error(output || `Oxen command failed: ${args.join(' ')}`);
  }

  return output;
}

function parseCommitId(output) {
  const match = output.match(/commit ([0-9a-f]{7,64}) ->/i);

  if (!match) {
    throw new Error(`Could not parse Oxen commit id from output:\n${output}`);
  }

  return match[1];
}

const workspace = mkdtempSync(join(tmpdir(), 'cdngine-oxen-proof-'));
const configDirectory = join(workspace, 'config');
const executable = resolveOxenExecutable();
const sourcePath = join(workspace, 'checkpoint.bin');

try {
  const fixtures = createFixtureFamily();
  mkdirSync(configDirectory, { recursive: true });

  runOxen(executable, ['config', '--config-dir', configDirectory, '--name', 'CDNgine Bench', '--email', 'bench@example.com']);
  runOxen(executable, ['init', workspace], { cwd: workspace });

  writeFileSync(sourcePath, fixtures.base);
  runOxen(executable, ['add', '--config-dir', configDirectory, 'checkpoint.bin'], { cwd: workspace });
  const baseCommitId = parseCommitId(
    runOxen(executable, ['commit', '--config-dir', configDirectory, '-m', 'benchmark-base'], { cwd: workspace })
  );
  const afterBaseBytes = getDirectorySize(join(workspace, '.oxen'));

  writeFileSync(sourcePath, fixtures.duplicate);
  runOxen(executable, ['add', '--config-dir', configDirectory, 'checkpoint.bin'], { cwd: workspace });
  const duplicateCommitId = parseCommitId(
    runOxen(executable, ['commit', '--config-dir', configDirectory, '--allow-empty', '-m', 'benchmark-duplicate'], { cwd: workspace })
  );
  const afterDuplicateBytes = getDirectorySize(join(workspace, '.oxen'));

  writeFileSync(sourcePath, fixtures.patch);
  runOxen(executable, ['add', '--config-dir', configDirectory, 'checkpoint.bin'], { cwd: workspace });
  const patchCommitId = parseCommitId(
    runOxen(executable, ['commit', '--config-dir', configDirectory, '-m', 'benchmark-patch'], { cwd: workspace })
  );
  const afterPatchBytes = getDirectorySize(join(workspace, '.oxen'));

  unlinkSync(sourcePath);
  runOxen(
    executable,
    ['restore', '--config-dir', configDirectory, 'checkpoint.bin', '--source', patchCommitId],
    { cwd: workspace }
  );

  const restoredDigest = sha256Hex(readFileSync(sourcePath));
  const logicalByteLength = fixtures.base.length;
  const baseStoredDelta = afterBaseBytes;
  const duplicateStoredDelta = afterDuplicateBytes - afterBaseBytes;
  const patchStoredDelta = afterPatchBytes - afterDuplicateBytes;

  process.stdout.write(
    JSON.stringify(
      {
        workload: 'near-duplicate-binary-revisions',
        repositoryEngine: 'oxen',
        executable,
        note: 'Oxen is measured here as a local dataset-VCS repository, so stored-byte growth includes commit and Merkle metadata in addition to versioned file bytes.',
        base: {
          logicalByteLength,
          storedByteLength: baseStoredDelta,
          commitId: baseCommitId
        },
        duplicate: {
          logicalByteLength,
          storedByteLength: duplicateStoredDelta,
          commitId: duplicateCommitId
        },
        patch: {
          logicalByteLength,
          storedByteLength: patchStoredDelta,
          commitId: patchCommitId
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
