import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

const requiredPracticeDocs = [
  'docs/regular-programming-practices/resilient-coding-debugging-and-performance.md',
  'docs/regular-programming-practices/interfaces-and-data-flow.md',
  'docs/regular-programming-practices/storage-and-state.md',
  'docs/regular-programming-practices/testing-and-scale.md',
  'docs/regular-programming-practices/security-verification-baseline.md'
];

const workspaceRelativePaths = [
  'apps/api',
  'apps/operator',
  'apps/workers',
  'packages/auth',
  'packages/capabilities',
  'packages/contracts',
  'packages/manifests',
  'packages/observability',
  'packages/registry',
  'packages/storage',
  'packages/testing',
  'packages/workflows'
];

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

for (const relativePath of workspaceRelativePaths) {
  const packageJsonPath = join(root, relativePath, 'package.json');

  if (!existsSync(packageJsonPath)) {
    fail(`Missing workspace package.json: ${relativePath}`);
    continue;
  }

  const packageJson = readJson(packageJsonPath);
  const metadata = packageJson.cdngine;

  if (!metadata) {
    fail(`Missing cdngine metadata in ${relativePath}\\package.json`);
    continue;
  }

  const governingDocs = metadata.governingDocs ?? [];
  const programmingPractices = metadata.programmingPractices ?? [];
  const externalReferences = metadata.externalReferences ?? [];

  if (!Array.isArray(governingDocs) || governingDocs.length === 0) {
    fail(`Missing governingDocs metadata in ${relativePath}\\package.json`);
  }

  if (!Array.isArray(programmingPractices) || programmingPractices.length === 0) {
    fail(`Missing programmingPractices metadata in ${relativePath}\\package.json`);
  }

  if (!Array.isArray(externalReferences) || externalReferences.length === 0) {
    fail(`Missing externalReferences metadata in ${relativePath}\\package.json`);
  }

  for (const docPath of [...governingDocs, ...programmingPractices]) {
    if (!existsSync(join(root, docPath))) {
      fail(`Referenced documentation path does not exist: ${docPath} (${relativePath})`);
    }
  }

  for (const practiceDoc of requiredPracticeDocs) {
    if (!programmingPractices.includes(practiceDoc)) {
      fail(`Workspace ${relativePath} is missing mandatory practice doc: ${practiceDoc}`);
    }
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}
