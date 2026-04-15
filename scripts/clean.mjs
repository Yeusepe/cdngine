import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const targets = [
  'contracts\\dist',
  'dist',
  'coverage',
  'apps\\api\\dist',
  'apps\\operator\\dist',
  'apps\\workers\\dist',
  'packages\\auth\\dist',
  'packages\\capabilities\\dist',
  'packages\\contracts\\dist',
  'packages\\manifests\\dist',
  'packages\\observability\\dist',
  'packages\\registry\\dist',
  'packages\\storage\\dist',
  'packages\\testing\\dist',
  'packages\\workflows\\dist'
];

for (const target of targets) {
  const fullPath = join(root, target);

  if (existsSync(fullPath)) {
    rmSync(fullPath, { recursive: true, force: true });
  }
}
