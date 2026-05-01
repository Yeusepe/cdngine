import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function readWorkspaceFile(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('product client copy no longer points users at legacy upload paths or transports', async () => {
  const appSource = await readWorkspaceFile('src/App.tsx');
  const readmeSource = await readWorkspaceFile('README.md');

  assert.equal(appSource.includes('/_demo/upload'), false);
  assert.equal(appSource.includes('demo SSE transport'), false);
  assert.equal(readmeSource.includes('generated demo principals'), false);
});

test('vite client proxy only exposes the public upload and read surfaces', async () => {
  const viteConfigSource = await readWorkspaceFile('vite.config.ts');

  assert.equal(viteConfigSource.includes("'/_demo'"), false);
});

test('product client surface exposes configurable scope inputs and public contract explorer actions', async () => {
  const appSource = await readWorkspaceFile('src/App.tsx');

  assert.equal(appSource.includes("assetOwner: 'product:web-client'"), false);
  assert.equal(appSource.includes("serviceNamespaceId: 'media-platform'"), false);
  assert.equal(appSource.includes('Version explorer'), true);
  assert.equal(appSource.includes('Load version'), true);
  assert.equal(appSource.includes('Authorize source'), true);
  assert.equal(appSource.includes('Authorize delivery'), true);
});
