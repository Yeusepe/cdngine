/**
 * Purpose: Restores benchmark-facing Xet-like files from the persisted chunk store so CDNgine can prove replay and restore from captured reconstruction evidence.
 * Governing docs:
 * - docs/source-plane-strategy.md
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/upstream-integration-model.md
 * External references:
 * - https://huggingface.co/docs/xet/en/file-reconstruction
 * - https://huggingface.co/docs/xet/en/deduplication
 * Tests:
 * - packages/storage/test/xet-benchmark-proof.test.ts
 * - packages/storage/test/xet-source-repository.test.ts
 */

import {
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

function getRepositoryDirectory() {
  return resolve(process.env.CDNGINE_XET_REPO_DIR ?? '.cdngine-xet-benchmark');
}

async function readStdinJson() {
  let input = '';

  for await (const chunk of process.stdin) {
    input += chunk;
  }

  return JSON.parse(input || '{}');
}

function readManifest(repositoryDirectory, fileId) {
  const manifestPath = join(repositoryDirectory, 'manifests', `${fileId}.json`);
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

const request = await readStdinJson();
const repositoryDirectory = getRepositoryDirectory();
const evidence = request.evidence ?? readManifest(repositoryDirectory, request.fileId);
const terms = [...(evidence.terms ?? [])].sort(
  (left, right) => left.startChunkIndex - right.startChunkIndex
);
const buffers = [];

for (const term of terms) {
  const chunkPath = join(repositoryDirectory, 'chunks', `${term.xorbHash}.bin`);
  buffers.push(readFileSync(chunkPath));
}

mkdirSync(dirname(request.destinationPath), { recursive: true });
writeFileSync(request.destinationPath, Buffer.concat(buffers));
process.stdout.write(JSON.stringify({ restoredPath: request.destinationPath }));
