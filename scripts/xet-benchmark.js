/**
 * Purpose: Computes benchmark-facing Xet-like chunk-reuse evidence from real file bytes so CDNgine can measure near-duplicate storage savings without flipping the default source engine.
 * Governing docs:
 * - docs/source-plane-strategy.md
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/upstream-integration-model.md
 * External references:
 * - https://huggingface.co/docs/xet/en/deduplication
 * - https://huggingface.co/docs/xet/en/file-reconstruction
 * Tests:
 * - packages/storage/test/xet-benchmark-proof.test.ts
 * - packages/storage/test/xet-source-repository.test.ts
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const MIN_CHUNK_SIZE = 32 * 1024;
const MAX_CHUNK_SIZE = 128 * 1024;
const BOUNDARY_MASK = 0x0001ffff;

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

const GEAR_TABLE = createGearTable();

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function getRepositoryDirectory() {
  return resolve(process.env.CDNGINE_XET_REPO_DIR ?? '.cdngine-xet-benchmark');
}

function ensureRepositoryLayout(repositoryDirectory) {
  mkdirSync(join(repositoryDirectory, 'chunks'), { recursive: true });
  mkdirSync(join(repositoryDirectory, 'manifests'), { recursive: true });
}

function chunkBuffer(buffer) {
  if (buffer.length === 0) {
    return [];
  }

  const chunks = [];
  let chunkStart = 0;
  let fingerprint = 0;

  for (let index = 0; index < buffer.length; index += 1) {
    fingerprint = ((fingerprint << 1) + GEAR_TABLE[buffer[index]]) >>> 0;
    const chunkSize = index + 1 - chunkStart;
    const shouldCut =
      chunkSize >= MIN_CHUNK_SIZE &&
      ((fingerprint & BOUNDARY_MASK) === 0 || chunkSize >= MAX_CHUNK_SIZE);

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
      value: sha256Hex(buffer)
    });
  }

  return digestSet;
}

function persistManifest(repositoryDirectory, fileId, manifest) {
  const manifestPath = join(repositoryDirectory, 'manifests', `${fileId}.json`);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
}

async function readStdinJson() {
  let input = '';

  for await (const chunk of process.stdin) {
    input += chunk;
  }

  return JSON.parse(input || '{}');
}

const request = await readStdinJson();
const repositoryDirectory = getRepositoryDirectory();
ensureRepositoryLayout(repositoryDirectory);

const sourceBuffer = readFileSync(request.localPath);
const digests = normalizeDigests(request, sourceBuffer);
const chunks = chunkBuffer(sourceBuffer);
const terms = [];
const uploadedChunkHashes = [];
const reusedChunkHashes = [];
let storedByteLength = 0n;

for (let index = 0; index < chunks.length; index += 1) {
  const chunk = chunks[index];
  const chunkHash = sha256Hex(chunk);
  const chunkPath = join(repositoryDirectory, 'chunks', `${chunkHash}.bin`);

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
  storedByteLength += BigInt(chunk.length);
}

const manifest = {
  assetVersionId: request.assetVersionId,
  digests,
  logicalByteLength: BigInt(sourceBuffer.length).toString(),
  logicalPath: request.metadata?.logicalPath ?? request.sourceFilename,
  sourceFilename: request.sourceFilename,
  terms
};
const fileId = sha256Hex(
  JSON.stringify({
    digests,
    logicalByteLength: manifest.logicalByteLength,
    terms
  })
);
persistManifest(repositoryDirectory, fileId, manifest);

process.stdout.write(
  JSON.stringify({
    fileId,
    terms,
    shardIds: [sha256Hex(JSON.stringify(terms))],
    uploadedXorbHashes: uploadedChunkHashes,
    deduplicatedXorbHashes: reusedChunkHashes,
    logicalPath: manifest.logicalPath,
    digests,
    logicalByteLength: String(sourceBuffer.length),
    storedByteLength: storedByteLength.toString(),
    chunkCount: terms.length,
    reusedChunkCount: reusedChunkHashes.length
  })
);
