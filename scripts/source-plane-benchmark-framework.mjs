/**
 * Purpose: Defines the rigorous source-plane benchmark matrix, deterministic workload materialization, and summary helpers used by the cross-engine benchmark suite.
 * Governing docs:
 * - docs/source-plane-strategy.md
 * - docs/testing-strategy.md
 * - docs/format-agnostic-upstream-review.md
 * External references:
 * - https://nodejs.org/api/fs.html
 * - https://nodejs.org/api/crypto.html
 * Tests:
 * - scripts/source-plane-benchmark-framework.test.mjs
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const LARGE_BLOCK_SIZE = 256 * 1024;
const SMALL_BLOCK_SIZE = 32 * 1024;
const TINY_BLOCK_SIZE = 8 * 1024;

function createSegment(seed, size) {
  return { seed, size };
}

function createFile(relativePath, segmentSeeds, segmentSize = LARGE_BLOCK_SIZE) {
  return {
    relativePath,
    segments: segmentSeeds.map((seed) => createSegment(seed, segmentSize))
  };
}

function createSingleSegmentFile(relativePath, seed, size) {
  return {
    relativePath,
    segments: [createSegment(seed, size)]
  };
}

function createRepeatedSingleSegmentFile(relativePath, originalFile) {
  return {
    relativePath,
    segments: originalFile.segments.map((segment) => ({ ...segment }))
  };
}

export function makeBlock(seed, size) {
  const block = Buffer.alloc(size);
  let state = ((seed + 1) * 2654435761) >>> 0;

  for (let index = 0; index < size; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    block[index] = (state >>> 16) & 0xff;
  }

  return block;
}

function buildFileBuffer(file) {
  return Buffer.concat(file.segments.map((segment) => makeBlock(segment.seed, segment.size)));
}

export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function listBenchmarkWorkloads() {
  const singleLargeBase = createFile(
    'payload\\checkpoint.bin',
    Array.from({ length: 32 }, (_, index) => index + 1)
  );
  const singleLargePatch = {
    relativePath: singleLargeBase.relativePath,
    segments: singleLargeBase.segments.map((segment, index) =>
      index === 10
        ? createSegment(211, segment.size)
        : index === 21
          ? createSegment(223, segment.size)
          : { ...segment }
    )
  };

  const moduleBase = [
    ...Array.from({ length: 8 }, (_, index) =>
      createSingleSegmentFile(`deps\\lib-${index.toString().padStart(2, '0')}.bin`, 100 + index, LARGE_BLOCK_SIZE)
    ),
    ...Array.from({ length: 8 }, (_, index) =>
      createSingleSegmentFile(`assets\\asset-${index.toString().padStart(2, '0')}.bin`, 200 + index, LARGE_BLOCK_SIZE)
    ),
    ...Array.from({ length: 8 }, (_, index) =>
      createRepeatedSingleSegmentFile(
        `shared\\copy-${index.toString().padStart(2, '0')}.bin`,
        createSingleSegmentFile(`ignored-${index}`, 100 + index, LARGE_BLOCK_SIZE)
      )
    ),
    ...Array.from({ length: 16 }, (_, index) =>
      createSingleSegmentFile(
        `configs\\manifest-${index.toString().padStart(2, '0')}.bin`,
        300 + index,
        SMALL_BLOCK_SIZE
      )
    )
  ];
  const modulePatch = moduleBase
    .filter((file) => file.relativePath !== 'shared\\copy-07.bin')
    .map((file) => {
      if (file.relativePath === 'assets\\asset-02.bin') {
        return createSingleSegmentFile(file.relativePath, 1202, LARGE_BLOCK_SIZE);
      }

      if (file.relativePath === 'assets\\asset-05.bin') {
        return createSingleSegmentFile(file.relativePath, 1205, LARGE_BLOCK_SIZE);
      }

      if (file.relativePath === 'deps\\lib-03.bin') {
        return createSingleSegmentFile(file.relativePath, 1103, LARGE_BLOCK_SIZE);
      }

      if (file.relativePath === 'shared\\copy-03.bin') {
        return createSingleSegmentFile(file.relativePath, 1303, LARGE_BLOCK_SIZE);
      }

      if (file.relativePath === 'configs\\manifest-01.bin') {
        return createSingleSegmentFile(file.relativePath, 1401, SMALL_BLOCK_SIZE);
      }

      return {
        relativePath: file.relativePath,
        segments: file.segments.map((segment) => ({ ...segment }))
      };
    })
    .concat([
      createSingleSegmentFile('plugins\\plugin-00.bin', 1500, LARGE_BLOCK_SIZE),
      createRepeatedSingleSegmentFile(
        'plugins\\plugin-01.bin',
        createSingleSegmentFile('ignored-plugin', 102, LARGE_BLOCK_SIZE)
      ),
      createSingleSegmentFile('configs\\manifest-16.bin', 316, SMALL_BLOCK_SIZE)
    ]);

  const smallCorpusBase = Array.from({ length: 256 }, (_, index) => {
    const repeatedSeed = index >= 224 ? 2000 + (index % 32) : 2000 + index;
    return createSingleSegmentFile(
      `chunks\\group-${Math.floor(index / 32)
        .toString()
        .padStart(2, '0')}\\item-${index.toString().padStart(3, '0')}.bin`,
      repeatedSeed,
      SMALL_BLOCK_SIZE
    );
  });
  const smallCorpusPatch = smallCorpusBase
    .map((file, index) => {
      if (index % 17 === 0) {
        return createSingleSegmentFile(file.relativePath, 2600 + index, SMALL_BLOCK_SIZE);
      }

      return {
        relativePath: file.relativePath,
        segments: file.segments.map((segment) => ({ ...segment }))
      };
    })
    .concat(
      Array.from({ length: 16 }, (_, index) =>
        createSingleSegmentFile(
          `meta\\delta-${index.toString().padStart(2, '0')}.bin`,
          3000 + index,
          TINY_BLOCK_SIZE
        )
      )
    );

  return [
    {
      id: 'single-large-binary',
      title: 'Single large binary revision',
      description:
        'One 8 MiB file with two 256 KiB chunk changes between base and patch, used to probe near-duplicate reuse inside one large binary.',
      versions: {
        base: [singleLargeBase],
        duplicate: [singleLargeBase],
        patch: [singleLargePatch]
      }
    },
    {
      id: 'multi-file-module-tree',
      title: 'Multi-file module tree',
      description:
        'A medium-sized tree with unique binaries, repeated shared binaries, and small manifests so engines are measured on cross-file reuse and tree-level restore behavior.',
      versions: {
        base: moduleBase,
        duplicate: moduleBase,
        patch: modulePatch
      }
    },
    {
      id: 'small-file-corpus',
      title: 'Small-file corpus',
      description:
        'Hundreds of small binary files with repeated content near the tail plus a patch revision that changes a subset and adds metadata files to stress metadata-heavy workloads.',
      versions: {
        base: smallCorpusBase,
        duplicate: smallCorpusBase,
        patch: smallCorpusPatch
      }
    }
  ];
}

export function materializeBenchmarkVersion(rootDirectory, files) {
  let logicalByteLength = 0;

  for (const file of files) {
    const filePath = join(rootDirectory, file.relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    const buffer = buildFileBuffer(file);
    logicalByteLength += buffer.length;
    writeFileSync(filePath, buffer);
  }

  return {
    fileCount: files.length,
    logicalByteLength
  };
}

export function hashMaterializedTree(rootDirectory) {
  const digestMap = {};

  function visit(currentPath) {
    for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
      const fullPath = join(currentPath, entry.name);

      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }

      digestMap[relative(rootDirectory, fullPath)] = sha256Hex(readFileSync(fullPath));
    }
  }

  visit(rootDirectory);

  return Object.fromEntries(
    Object.entries(digestMap).sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
  );
}

function summarizeNumbers(values) {
  const total = values.reduce((sum, value) => sum + value, 0);

  return {
    min: Math.min(...values),
    max: Math.max(...values),
    mean: total / values.length
  };
}

function summarizeStage(runs, stageName, includeStoredBytes = true) {
  const stageRuns = runs.map((run) => run[stageName]);
  const summary = {
    fileCount: summarizeNumbers(stageRuns.map((stage) => stage.fileCount)),
    logicalByteLength: summarizeNumbers(stageRuns.map((stage) => stage.logicalByteLength)),
    durationMs: summarizeNumbers(stageRuns.map((stage) => stage.durationMs))
  };

  if (includeStoredBytes) {
    summary.storedByteLength = summarizeNumbers(stageRuns.map((stage) => stage.storedByteLength));
    summary.savingsRatio = summarizeNumbers(
      stageRuns.map((stage) =>
        stage.logicalByteLength === 0 ? 0 : 1 - stage.storedByteLength / stage.logicalByteLength
      )
    );
  }

  return summary;
}

export function summarizeWorkloadRuns(runs) {
  return {
    runs: runs.length,
    base: summarizeStage(runs, 'base'),
    duplicate: summarizeStage(runs, 'duplicate'),
    patch: summarizeStage(runs, 'patch'),
    restore: {
      ...summarizeStage(runs, 'restore', false),
      allVerified: runs.every((run) => run.restore.verified)
    }
  };
}
