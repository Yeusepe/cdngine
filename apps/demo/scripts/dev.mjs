/**
 * Purpose: Launches the demo API server and Vite dev server in parallel for local development.
 * Governing docs:
 * - docs/repository-layout.md
 * - docs/testing-strategy.md
 * External references:
 * - https://nodejs.org/api/child_process.html
 * Tests:
 * - apps/demo/package.json
 */

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function run(cmd, args, cwd) {
  return spawn(cmd, args, { cwd, shell: process.platform === 'win32', stdio: 'inherit' });
}

const api = run('node', ['./scripts/start-demo-api.mjs'], root);
const vite = run('node', ['./node_modules/.bin/vite', '--host'], root);

function exit(code) {
  api.kill();
  vite.kill();
  process.exit(code ?? 0);
}

api.on('exit', (code) => exit(code));
vite.on('exit', (code) => exit(code));
process.on('SIGINT', () => exit(0));
process.on('SIGTERM', () => exit(0));
