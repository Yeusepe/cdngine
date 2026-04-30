/**
 * Purpose: Proves with real generated binary revisions that the benchmark-facing Xet command boundary preserves restoreable reconstruction evidence while storing far fewer bytes for duplicate and near-duplicate uploads.
 * Governing docs:
 * - docs/source-plane-strategy.md
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/testing-strategy.md
 * External references:
 * - https://huggingface.co/docs/xet/en/deduplication
 * - https://huggingface.co/docs/xet/en/file-reconstruction
 * Tests:
 * - packages/storage/test/xet-benchmark-proof.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CommandBackedXetFileMaterializer,
  CommandBackedXetSnapshotEvidenceProvider,
  ExperimentalXetSourceRepository,
  InMemoryXetSnapshotStore
} from '../src/xet-source-repository.ts';

class LocalChildProcessRunner {
  async run(execution: {
    args: string[];
    command: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdin?: string;
    timeoutMs?: number;
  }) {
    return new Promise<{ exitCode: number; stderr: string; stdout: string }>((resolve, reject) => {
      const child = spawn(execution.command, execution.args, {
        cwd: execution.cwd,
        env: { ...process.env, ...execution.env },
        shell: false,
        stdio: 'pipe'
      });
      let stdout = '';
      let stderr = '';
      let timeoutId: NodeJS.Timeout | undefined;

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.on('error', reject);
      child.on('close', (exitCode) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        if ((exitCode ?? -1) !== 0) {
          reject(new Error(stderr || stdout || `Command failed: ${execution.command}`));
          return;
        }

        resolve({
          exitCode: exitCode ?? 0,
          stderr,
          stdout
        });
      });

      if (typeof execution.stdin === 'string') {
        child.stdin.write(execution.stdin);
      }

      child.stdin.end();

      if (execution.timeoutMs) {
        timeoutId = setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error(`Command exceeded timeout of ${execution.timeoutMs}ms.`));
        }, execution.timeoutMs);
      }
    });
  }
}

function makeBlock(seed: number, size: number) {
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
  const blocks: Buffer[] = [];

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

function sha256Hex(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

test('command-backed Xet proof workload stores zero new bytes for duplicates and far fewer bytes for near-duplicate revisions', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'cdngine-xet-proof-'));
  const repositoryDirectory = join(workspace, 'repo');
  const fixtureDirectory = join(workspace, 'fixtures');
  const restoreDirectory = join(workspace, 'restore');
  const benchmarkScript = fileURLToPath(new URL('../../../scripts/xet-benchmark.js', import.meta.url));
  const restoreScript = fileURLToPath(new URL('../../../scripts/xet-restore.js', import.meta.url));
  const runner = new LocalChildProcessRunner();
  const repository = new ExperimentalXetSourceRepository({
    evidenceProvider: new CommandBackedXetSnapshotEvidenceProvider({
      runner,
      command: process.execPath,
      args: [benchmarkScript],
      env: {
        CDNGINE_XET_REPO_DIR: repositoryDirectory
      }
    }),
    snapshotStore: new InMemoryXetSnapshotStore(),
    materializer: new CommandBackedXetFileMaterializer({
      runner,
      command: process.execPath,
      args: [restoreScript],
      env: {
        CDNGINE_XET_REPO_DIR: repositoryDirectory
      }
    })
  });

  try {
    const fixtures = createFixtureFamily();
    mkdirSync(fixtureDirectory, { recursive: true });
    mkdirSync(restoreDirectory, { recursive: true });
    const basePath = join(fixtureDirectory, 'checkpoint-base.bin');
    const duplicatePath = join(fixtureDirectory, 'checkpoint-duplicate.bin');
    const patchPath = join(fixtureDirectory, 'checkpoint-patch.bin');
    const restoredPath = join(restoreDirectory, 'checkpoint-patch.bin');

    writeFileSync(basePath, fixtures.base);
    writeFileSync(duplicatePath, fixtures.duplicate);
    writeFileSync(patchPath, fixtures.patch);

    const base = await repository.snapshotFromPath({
      assetVersionId: 'ver_base',
      localPath: basePath,
      logicalByteLength: BigInt(fixtures.base.length),
      sourceFilename: 'checkpoint-base.bin',
      sourceDigests: [
        {
          algorithm: 'sha256',
          value: sha256Hex(fixtures.base)
        }
      ]
    });
    const duplicate = await repository.snapshotFromPath({
      assetVersionId: 'ver_duplicate',
      localPath: duplicatePath,
      logicalByteLength: BigInt(fixtures.duplicate.length),
      sourceFilename: 'checkpoint-duplicate.bin',
      sourceDigests: [
        {
          algorithm: 'sha256',
          value: sha256Hex(fixtures.duplicate)
        }
      ]
    });
    const patch = await repository.snapshotFromPath({
      assetVersionId: 'ver_patch',
      localPath: patchPath,
      logicalByteLength: BigInt(fixtures.patch.length),
      sourceFilename: 'checkpoint-patch.bin',
      sourceDigests: [
        {
          algorithm: 'sha256',
          value: sha256Hex(fixtures.patch)
        }
      ]
    });
    const restored = await repository.restoreToPath({
      canonicalSourceId: patch.canonicalSourceId,
      destinationPath: restoredPath
    });

    assert.equal(base.repositoryEngine, 'xet');
    assert.equal(base.logicalByteLength, BigInt(fixtures.base.length));
    assert.ok((base.storedByteLength ?? 0n) > 0n);
    assert.ok((base.storedByteLength ?? BigInt(fixtures.base.length)) <= BigInt(fixtures.base.length));
    assert.equal(duplicate.canonicalSourceId, base.canonicalSourceId);
    assert.equal(duplicate.storedByteLength, 0n);
    assert.equal(duplicate.dedupeMetrics?.reusedChunkCount, duplicate.dedupeMetrics?.chunkCount);
    assert.notEqual(patch.canonicalSourceId, base.canonicalSourceId);
    assert.ok((patch.dedupeMetrics?.reusedChunkCount ?? 0) > 0);
    assert.ok((patch.storedByteLength ?? BigInt(fixtures.patch.length)) < BigInt(fixtures.patch.length / 2));
    assert.equal((await repository.listSnapshots('ver_base')).length, 1);
    assert.equal((await repository.listSnapshots('ver_duplicate')).length, 1);
    assert.equal((await repository.listSnapshots('ver_patch')).length, 1);
    assert.equal(restored.restoredPath, restoredPath);
    assert.equal(sha256Hex(readFileSync(restoredPath)), sha256Hex(fixtures.patch));
  } finally {
    rmSync(workspace, { force: true, recursive: true });
  }
});
