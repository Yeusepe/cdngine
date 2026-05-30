/**
 * Purpose: Runs a real package corpus through CDNgine's benchmark-facing Xet source-plane boundary and compares whole-archive versus split-entry dedupe.
 * Governing docs:
 * - docs/source-plane-strategy.md
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/environment-and-deployment.md
 * - docs/testing-strategy.md
 * External references:
 * - https://huggingface.co/docs/xet/en/deduplication
 * - https://huggingface.co/docs/xet/en/file-reconstruction
 * - https://nodejs.org/api/child_process.html
 * Tests:
 * - scripts/package-corpus-dedupe.test.mjs
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const defaultCorpusPath = 'C:\\Users\\svalp\\OneDrive\\Documents\\PACKAGES';
const defaultRepositoryPath = resolve('scripts', 'test-output', 'package-corpus-xet-repo');
const restoreScript = resolve('scripts', 'xet-restore.js');
const corpusModes = new Set(['archive', 'split', 'both']);
const minChunkSize = 32 * 1024;
const maxChunkSize = 128 * 1024;
const boundaryMask = 0x0001ffff;

export function parseArgs(argv) {
  const options = {
    corpusPath: defaultCorpusPath,
    mode: 'archive',
    repositoryPath: defaultRepositoryPath,
    reset: true,
    restoreSampleCount: 3
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--corpus') {
      options.corpusPath = argv[++index];
    } else if (arg === '--repo') {
      options.repositoryPath = argv[++index];
    } else if (arg === '--mode') {
      options.mode = argv[++index];
    } else if (arg === '--restore-sample-count') {
      options.restoreSampleCount = Number(argv[++index]);
    } else if (arg === '--keep-repo') {
      options.reset = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.restoreSampleCount) || options.restoreSampleCount < 0) {
    throw new Error('--restore-sample-count must be a non-negative integer.');
  }

  if (!corpusModes.has(options.mode)) {
    throw new Error('--mode must be one of: archive, split, both.');
  }

  return options;
}

function listCorpusFiles(corpusPath) {
  return readdirSync(corpusPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(corpusPath, entry.name))
    .sort((left, right) => basename(left).localeCompare(basename(right)));
}

function runJson(command, args, env, input) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    input,
    maxBuffer: 1024 * 1024 * 32
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Command failed: ${command} ${args.join(' ')}`);
  }

  return JSON.parse(result.stdout);
}

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function sha256File(path) {
  return sha256Buffer(readFileSync(path));
}

function nextDeterministicUint32(state) {
  let value = state >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

function createGearTable() {
  const table = new Uint32Array(256);
  let state = 0x9e3779b9;

  for (let index = 0; index < table.length; index += 1) {
    state = nextDeterministicUint32(state);
    table[index] = state;
  }

  return table;
}

const gearTable = createGearTable();

function chunkBuffer(buffer) {
  if (buffer.length === 0) {
    return [];
  }

  const chunks = [];
  let chunkStart = 0;
  let fingerprint = 0;

  for (let index = 0; index < buffer.length; index += 1) {
    fingerprint = ((fingerprint << 1) + gearTable[buffer[index]]) >>> 0;
    const chunkSize = index + 1 - chunkStart;
    const shouldCut =
      chunkSize >= minChunkSize &&
      ((fingerprint & boundaryMask) === 0 || chunkSize >= maxChunkSize);

    if (!shouldCut) {
      continue;
    }

    chunks.push(buffer.subarray(chunkStart, index + 1));
    chunkStart = index + 1;
    fingerprint = 0;
  }

  if (chunkStart < buffer.length) {
    chunks.push(buffer.subarray(chunkStart));
  }

  return chunks;
}

function normalizeDigests(request, buffer) {
  const digestSet = request.sourceDigests?.map((digest) => ({
    algorithm: digest.algorithm,
    value: digest.value
  })) ?? [];
  const hasSha256 = digestSet.some((digest) => digest.algorithm === 'sha256');

  if (!hasSha256) {
    digestSet.push({
      algorithm: 'sha256',
      value: sha256Buffer(buffer)
    });
  }

  return digestSet;
}

function ensureBenchmarkRepository(repositoryPath) {
  mkdirSync(join(repositoryPath, 'chunks'), { recursive: true });
  mkdirSync(join(repositoryPath, 'manifests'), { recursive: true });
}

function runBenchmarkRequest(request, repositoryPath) {
  ensureBenchmarkRepository(repositoryPath);

  const sourceBuffer = readFileSync(request.localPath);
  const digests = normalizeDigests(request, sourceBuffer);
  const chunks = chunkBuffer(sourceBuffer);
  const terms = [];
  const uploadedChunkHashes = [];
  const reusedChunkHashes = [];
  let storedByteLength = 0;

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const chunkHash = sha256Buffer(chunk);
    const chunkPath = join(repositoryPath, 'chunks', `${chunkHash}.bin`);

    terms.push({
      xorbHash: chunkHash,
      startChunkIndex: index,
      endChunkIndex: index + 1
    });

    if (existsSync(chunkPath)) {
      reusedChunkHashes.push(chunkHash);
      continue;
    }

    writeFileSync(chunkPath, chunk);
    uploadedChunkHashes.push(chunkHash);
    storedByteLength += chunk.length;
  }

  const manifest = {
    assetVersionId: request.assetVersionId,
    digests,
    logicalByteLength: String(sourceBuffer.length),
    logicalPath: request.metadata?.logicalPath ?? request.sourceFilename,
    sourceFilename: request.sourceFilename,
    terms
  };
  const fileId = sha256Buffer(
    Buffer.from(
      JSON.stringify({
        digests,
        logicalByteLength: manifest.logicalByteLength,
        terms
      })
    )
  );

  writeFileSync(join(repositoryPath, 'manifests', `${fileId}.json`), JSON.stringify(manifest, null, 2));

  return {
    fileId,
    terms,
    shardIds: [sha256Buffer(Buffer.from(JSON.stringify(terms)))],
    uploadedXorbHashes: uploadedChunkHashes,
    deduplicatedXorbHashes: reusedChunkHashes,
    logicalPath: manifest.logicalPath,
    digests,
    logicalByteLength: String(sourceBuffer.length),
    storedByteLength: String(storedByteLength),
    chunkCount: terms.length,
    reusedChunkCount: reusedChunkHashes.length
  };
}

function runBenchmarkForFile(filePath, repositoryPath, index, metadata = {}) {
  const stats = statSync(filePath);

  return runBenchmarkRequest(
    {
      assetVersionId: metadata.assetVersionId ?? `package-corpus-${String(index + 1).padStart(4, '0')}`,
      localPath: filePath,
      metadata: {
        logicalPath: metadata.logicalPath ?? basename(filePath),
        ...metadata
      },
      sourceDigests: [{ algorithm: 'sha256', value: sha256File(filePath) }],
      sourceFilename: metadata.sourceFilename ?? basename(filePath),
      sourceMetadata: {
        lastModifiedMs: stats.mtimeMs,
        ...metadata.sourceMetadata
      }
    },
    repositoryPath
  );
}

function runBenchmarkForBuffer(buffer, repositoryPath, request, workspacePath) {
  const tempPath = join(workspacePath, `${sha256Buffer(Buffer.from(request.assetVersionId)).slice(0, 24)}.bin`);
  writeFileSync(tempPath, buffer);

  try {
    return runBenchmarkRequest(
      {
        ...request,
        localPath: tempPath,
        sourceDigests: request.sourceDigests ?? [{ algorithm: 'sha256', value: sha256Buffer(buffer) }]
      },
      repositoryPath
    );
  } finally {
    rmSync(tempPath, { force: true });
  }
}

async function loadSplitArtifacts() {
  try {
    return await import('../packages/storage/dist/split-artifact-adapters.js');
  } catch (error) {
    throw new Error(
      'Split corpus mode requires built storage adapters. Run `npm run build --workspace @cdngine/storage` first.',
      { cause: error }
    );
  }
}

function evidenceToRecord({ evidence, logicalByteLength, name, path, sha256, sourceArchive, splitEntry }) {
  const storedByteLength = Number(evidence.storedByteLength);

  return {
    name,
    path,
    sha256,
    logicalByteLength,
    storedByteLength,
    savingsByteLength: logicalByteLength - storedByteLength,
    savingsRatio: logicalByteLength === 0 ? 0 : 1 - storedByteLength / logicalByteLength,
    chunkCount: Number(evidence.chunkCount),
    reusedChunkCount: Number(evidence.reusedChunkCount),
    ...(sourceArchive ? { sourceArchive } : {}),
    ...(splitEntry ? { splitEntry } : {}),
    evidence
  };
}

function runArchiveCorpus(files, repositoryPath) {
  return files.map((filePath, index) => {
    const evidence = runBenchmarkForFile(filePath, repositoryPath, index);
    const logicalByteLength = Number(evidence.logicalByteLength);

    return evidenceToRecord({
      evidence,
      logicalByteLength,
      name: basename(filePath),
      path: filePath,
      sha256: evidence.digests.find((digest) => digest.algorithm === 'sha256')?.value
    });
  });
}

function filenameForFormat(name, format) {
  if (format === 'unitypackage') {
    return name.toLowerCase().endsWith('.unitypackage') ? name : `${name}.unitypackage`;
  }

  if (format === 'gzip-tar') {
    return name.toLowerCase().endsWith('.tgz') || name.toLowerCase().endsWith('.tar.gz')
      ? name
      : `${name}.tgz`;
  }

  return name.toLowerCase().endsWith(`.${format}`) ? name : `${name}.${format}`;
}

function assertSplitContentEquivalent(splitArtifacts, archiveName, split) {
  const repacked = splitArtifacts.createSplitArtifactArchive({
    entries: split.entries,
    format: split.format
  });
  const unpackedAgain = splitArtifacts.splitArtifactArchive({
    archive: repacked,
    filename: filenameForFormat(archiveName, split.format)
  });

  if (!splitArtifacts.compareSplitEntryDigestTrees(split.entries, unpackedAgain.entries)) {
    throw new Error(`Split adapter failed content-equivalence verification for ${archiveName}.`);
  }
}

function runSplitCorpus(files, repositoryPath, splitArtifacts) {
  const records = [];
  const filesSummary = [];
  const workspacePath = mkdtempSync(join(tmpdir(), 'cdngine-package-corpus-split-'));

  try {
    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      const filePath = files[fileIndex];
      const name = basename(filePath);
      const archive = readFileSync(filePath);
      const originalSha256 = sha256Buffer(archive);
      const detected = splitArtifacts.detectSplitArtifactFormat(name, archive);

      if (!detected) {
        const evidence = runBenchmarkForFile(filePath, repositoryPath, fileIndex, {
          assetVersionId: `package-corpus-${String(fileIndex + 1).padStart(4, '0')}-whole-fallback`,
          representation: 'whole-fallback'
        });
        const record = evidenceToRecord({
          evidence,
          logicalByteLength: Number(evidence.logicalByteLength),
          name,
          path: filePath,
          sha256: originalSha256
        });

        records.push(record);
        filesSummary.push({
          name,
          path: filePath,
          representation: 'whole-fallback',
          format: null,
          originalArchiveByteLength: archive.length,
          originalArchiveSha256: originalSha256,
          entryCount: 0,
          totalEntryByteLength: archive.length,
          storedByteLength: record.storedByteLength,
          chunkCount: record.chunkCount,
          reusedChunkCount: record.reusedChunkCount,
          fileId: record.evidence.fileId
        });
        continue;
      }

      const split = splitArtifacts.splitArtifactArchive({
        archive,
        filename: name
      });
      assertSplitContentEquivalent(splitArtifacts, name, split);

      const manifest = splitArtifacts.createSplitArtifactManifest({
        assetId: `package-corpus-${String(fileIndex + 1).padStart(4, '0')}`,
        originalArchive: archive,
        originalFilename: name,
        split
      });
      const fileRecords = [];

      for (let entryIndex = 0; entryIndex < split.entries.length; entryIndex += 1) {
        const entry = split.entries[entryIndex];
        const entrySha256 = sha256Buffer(entry.data);
        const evidence = runBenchmarkForBuffer(
          entry.data,
          repositoryPath,
          {
            assetVersionId: `package-corpus-${String(fileIndex + 1).padStart(4, '0')}-entry-${String(entryIndex + 1).padStart(5, '0')}`,
            metadata: {
              logicalPath: `${name}!/${entry.logicalPath}`,
              sourceArchiveFilename: name,
              sourceArchiveSha256: originalSha256,
              splitArtifactFormat: split.format,
              splitEntryIndex: entryIndex,
              splitEntryPath: entry.logicalPath
            },
            sourceDigests: [{ algorithm: 'sha256', value: entrySha256 }],
            sourceFilename: entry.logicalPath,
            sourceMetadata: {
              sourceArchiveFilename: name
            }
          },
          workspacePath
        );
        const record = evidenceToRecord({
          evidence,
          logicalByteLength: entry.data.length,
          name: `${name}!/${entry.logicalPath}`,
          path: filePath,
          sha256: entrySha256,
          sourceArchive: {
            name,
            sha256: originalSha256
          },
          splitEntry: {
            index: entryIndex,
            logicalPath: entry.logicalPath
          }
        });

        fileRecords.push(record);
        records.push(record);
      }

      filesSummary.push({
        name,
        path: filePath,
        representation: 'split',
        format: split.format,
        originalArchiveByteLength: archive.length,
        originalArchiveSha256: originalSha256,
        entryCount: split.entries.length,
        totalEntryByteLength: manifest.totalEntryByteLength,
        storedByteLength: fileRecords.reduce((sum, record) => sum + record.storedByteLength, 0),
        chunkCount: fileRecords.reduce((sum, record) => sum + record.chunkCount, 0),
        reusedChunkCount: fileRecords.reduce((sum, record) => sum + record.reusedChunkCount, 0),
        reconstructionFidelity: manifest.reconstructionFidelity,
        contentEquivalentVerified: true
      });
    }
  } finally {
    rmSync(workspacePath, { recursive: true, force: true });
  }

  return { filesSummary, records };
}

function sampleRestoreTargets(results, sampleCount) {
  if (sampleCount === 0 || results.length === 0) {
    return [];
  }

  const indexes = new Set([0, results.length - 1]);
  if (sampleCount > 2) {
    indexes.add(Math.floor((results.length - 1) / 2));
  }

  for (let index = 0; indexes.size < Math.min(sampleCount, results.length); index += 1) {
    indexes.add(index);
  }

  return [...indexes].sort((left, right) => left - right).slice(0, sampleCount).map((index) => results[index]);
}

function verifyRestoreSamples(results, repositoryPath, sampleCount) {
  const restoreRoot = join(tmpdir(), `cdngine-package-corpus-restore-${Date.now()}`);
  const samples = sampleRestoreTargets(results, sampleCount);

  try {
    mkdirSync(restoreRoot, { recursive: true });

    return samples.map((entry, index) => {
      const destinationPath = join(restoreRoot, `${index}-${sha256Buffer(Buffer.from(entry.name)).slice(0, 12)}.bin`);
      runJson(
        process.execPath,
        [restoreScript],
        { CDNGINE_XET_REPO_DIR: repositoryPath },
        JSON.stringify({
          destinationPath,
          evidence: entry.evidence,
          fileId: entry.evidence.fileId
        })
      );

      return {
        file: entry.name,
        restoredSha256: sha256File(destinationPath),
        sourceSha256: entry.sha256,
        verified: sha256File(destinationPath) === entry.sha256
      };
    });
  } finally {
    rmSync(restoreRoot, { recursive: true, force: true });
  }
}

function summarize(results, restoreSamples, options) {
  const totalLogicalByteLength = results.reduce((sum, result) => sum + result.logicalByteLength, 0);
  const totalStoredByteLength = results.reduce((sum, result) => sum + result.storedByteLength, 0);
  const totalChunks = results.reduce((sum, result) => sum + result.chunkCount, 0);
  const reusedChunks = results.reduce((sum, result) => sum + result.reusedChunkCount, 0);
  const uploadedChunks = totalChunks - reusedChunks;

  return {
    corpusPath: options.corpusPath,
    mode: options.mode ?? 'archive',
    repositoryPath: options.repositoryPath,
    engine: 'cdngine-xet-benchmark-boundary',
    fileCount: options.fileCount ?? results.length,
    benchmarkedObjectCount: results.length,
    totalLogicalByteLength,
    totalStoredByteLength,
    totalSavingsByteLength: totalLogicalByteLength - totalStoredByteLength,
    totalSavingsRatio:
      totalLogicalByteLength === 0 ? 0 : 1 - totalStoredByteLength / totalLogicalByteLength,
    totalChunks,
    uploadedChunks,
    reusedChunks,
    reusedChunkRatio: totalChunks === 0 ? 0 : reusedChunks / totalChunks,
    restoreSamples,
    files: results.map(({ evidence, ...result }) => ({
      ...result,
      fileId: evidence.fileId
    }))
  };
}

function summarizeSplit(splitResult, restoreSamples, options) {
  const totalOriginalArchiveByteLength = splitResult.filesSummary.reduce(
    (sum, result) => sum + result.originalArchiveByteLength,
    0
  );
  const totalSplitEntryByteLength = splitResult.filesSummary.reduce(
    (sum, result) => sum + result.totalEntryByteLength,
    0
  );
  const totalStoredByteLength = splitResult.records.reduce((sum, result) => sum + result.storedByteLength, 0);
  const totalChunks = splitResult.records.reduce((sum, result) => sum + result.chunkCount, 0);
  const reusedChunks = splitResult.records.reduce((sum, result) => sum + result.reusedChunkCount, 0);

  return {
    corpusPath: options.corpusPath,
    mode: 'split',
    repositoryPath: options.repositoryPath,
    engine: 'cdngine-xet-benchmark-boundary',
    fileCount: splitResult.filesSummary.length,
    benchmarkedObjectCount: splitResult.records.length,
    splitFileCount: splitResult.filesSummary.filter((file) => file.representation === 'split').length,
    wholeFallbackFileCount: splitResult.filesSummary.filter((file) => file.representation === 'whole-fallback').length,
    totalLogicalByteLength: totalOriginalArchiveByteLength,
    totalOriginalArchiveByteLength,
    totalSplitEntryByteLength,
    totalStoredByteLength,
    totalSavingsByteLength: totalOriginalArchiveByteLength - totalStoredByteLength,
    totalSavingsRatio:
      totalOriginalArchiveByteLength === 0 ? 0 : 1 - totalStoredByteLength / totalOriginalArchiveByteLength,
    totalChunks,
    uploadedChunks: totalChunks - reusedChunks,
    reusedChunks,
    reusedChunkRatio: totalChunks === 0 ? 0 : reusedChunks / totalChunks,
    restoreSamples,
    files: splitResult.filesSummary
  };
}

function compareSummaries(archiveSummary, splitSummary) {
  return {
    archiveStoredByteLength: archiveSummary.totalStoredByteLength,
    splitStoredByteLength: splitSummary.totalStoredByteLength,
    splitDeltaByteLength: splitSummary.totalStoredByteLength - archiveSummary.totalStoredByteLength,
    splitDeltaRatio:
      archiveSummary.totalStoredByteLength === 0
        ? 0
        : splitSummary.totalStoredByteLength / archiveSummary.totalStoredByteLength - 1,
    archiveSavingsRatio: archiveSummary.totalSavingsRatio,
    splitSavingsRatio: splitSummary.totalSavingsRatio,
    archiveReusedChunkRatio: archiveSummary.reusedChunkRatio,
    splitReusedChunkRatio: splitSummary.reusedChunkRatio
  };
}

export async function runPackageCorpusDedupe(options) {
  const resolvedOptions = {
    mode: 'archive',
    reset: true,
    restoreSampleCount: 3,
    ...options,
    corpusPath: resolve(options.corpusPath),
    repositoryPath: resolve(options.repositoryPath)
  };

  if (!existsSync(resolvedOptions.corpusPath)) {
    throw new Error(`Corpus path does not exist: ${resolvedOptions.corpusPath}`);
  }

  if (!corpusModes.has(resolvedOptions.mode)) {
    throw new Error('mode must be one of: archive, split, both.');
  }

  if (resolvedOptions.reset) {
    rmSync(resolvedOptions.repositoryPath, { recursive: true, force: true });
  }

  mkdirSync(resolvedOptions.repositoryPath, { recursive: true });
  const files = listCorpusFiles(resolvedOptions.corpusPath);

  if (resolvedOptions.mode === 'both') {
    const archiveRepositoryPath = join(resolvedOptions.repositoryPath, 'archive');
    const splitRepositoryPath = join(resolvedOptions.repositoryPath, 'split');
    mkdirSync(archiveRepositoryPath, { recursive: true });
    mkdirSync(splitRepositoryPath, { recursive: true });

    const archiveRecords = runArchiveCorpus(files, archiveRepositoryPath);
    const archiveSummary = summarize(
      archiveRecords,
      verifyRestoreSamples(archiveRecords, archiveRepositoryPath, resolvedOptions.restoreSampleCount),
      {
        ...resolvedOptions,
        fileCount: files.length,
        mode: 'archive',
        repositoryPath: archiveRepositoryPath
      }
    );
    const splitArtifacts = resolvedOptions.splitArtifacts ?? (await loadSplitArtifacts());
    const splitResult = runSplitCorpus(files, splitRepositoryPath, splitArtifacts);
    const splitSummary = summarizeSplit(
      splitResult,
      verifyRestoreSamples(splitResult.records, splitRepositoryPath, resolvedOptions.restoreSampleCount),
      {
        ...resolvedOptions,
        repositoryPath: splitRepositoryPath
      }
    );

    return {
      corpusPath: resolvedOptions.corpusPath,
      mode: 'both',
      repositoryPath: resolvedOptions.repositoryPath,
      engine: 'cdngine-xet-benchmark-boundary',
      archive: archiveSummary,
      split: splitSummary,
      comparison: compareSummaries(archiveSummary, splitSummary)
    };
  }

  if (resolvedOptions.mode === 'split') {
    const splitArtifacts = resolvedOptions.splitArtifacts ?? (await loadSplitArtifacts());
    const splitResult = runSplitCorpus(files, resolvedOptions.repositoryPath, splitArtifacts);

    return summarizeSplit(
      splitResult,
      verifyRestoreSamples(splitResult.records, resolvedOptions.repositoryPath, resolvedOptions.restoreSampleCount),
      resolvedOptions
    );
  }

  const results = runArchiveCorpus(files, resolvedOptions.repositoryPath);
  return summarize(
    results,
    verifyRestoreSamples(results, resolvedOptions.repositoryPath, resolvedOptions.restoreSampleCount),
    { ...resolvedOptions, fileCount: files.length }
  );
}

if (process.argv[1]?.endsWith('package-corpus-dedupe.mjs')) {
  const options = parseArgs(process.argv.slice(2));
  const summary = await runPackageCorpusDedupe(options);
  const outputPath = join(options.repositoryPath, 'summary.json');
  mkdirSync(options.repositoryPath, { recursive: true });
  writeFileSync(outputPath, JSON.stringify(summary, null, 2));
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
