import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';

const checkMode = process.argv.includes('--check');
const rootDir = resolve(import.meta.dirname, '..');
const inputPath = join(rootDir, 'contracts', 'dist', 'openapi', 'public.openapi.yaml');
const outputPath = join(rootDir, 'packages', 'sdk', 'src', 'generated', 'public-api.ts');
const header = `/**
 * Purpose: Generated TypeScript contract types for the public CDNgine API surface.
 * Governing docs:
 * - docs/sdk-strategy.md
 * - docs/spec-governance.md
 * - docs/api-surface.md
 * External references:
 * - https://spec.openapis.org/oas/latest.html
 * - https://openapi-ts.dev/
 * Tests:
 * - packages/sdk/test/public-client.test.mjs
 */

`;

async function runOpenapiTypescript(targetPath) {
  const ast = await openapiTS(pathToFileURL(inputPath));
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, astToString(ast), 'utf8');
}

async function buildExpectedOutput() {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'cdngine-sdk-'));
  const tempOutputPath = join(tempDirectory, 'public-api.ts');

  try {
    await runOpenapiTypescript(tempOutputPath);
    const generated = await readFile(tempOutputPath, 'utf8');
    return `${header}${generated}`;
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
}

const expectedOutput = await buildExpectedOutput();

if (checkMode) {
  const actualOutput = await readFile(outputPath, 'utf8');

  if (actualOutput !== expectedOutput) {
    throw new Error('Generated TypeScript SDK artifacts are out of date. Run "npm run sdk:generate".');
  }
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, expectedOutput, 'utf8');
}
