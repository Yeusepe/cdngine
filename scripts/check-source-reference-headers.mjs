import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const workspaceRoots = ['apps', 'packages'];
const requiredMarkers = ['Purpose:', 'Governing docs:', 'External references:', 'Tests:'];

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function walk(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'dist' || entry.name === 'generated' || entry.name === 'node_modules') {
        continue;
      }

      walk(fullPath);
      continue;
    }

    if (!entry.name.endsWith('.ts')) {
      continue;
    }

    const content = readFileSync(fullPath, 'utf8');

    for (const marker of requiredMarkers) {
      if (!content.includes(marker)) {
        fail(`Missing reference-header marker "${marker}" in ${fullPath.replace(`${root}\\`, '')}`);
      }
    }
  }
}

for (const workspaceRoot of workspaceRoots) {
  const fullRoot = join(root, workspaceRoot);

  if (existsSync(fullRoot) && statSync(fullRoot).isDirectory()) {
    walk(fullRoot);
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}
