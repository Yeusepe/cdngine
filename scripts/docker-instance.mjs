/**
 * Purpose: Provides one-command startup for a portable Dockerized CDNgine demo/runtime instance.
 * Governing docs:
 * - README.md
 * - deploy/local-platform/README.md
 * - docs/environment-and-deployment.md
 * - docs/contributor-guide.md
 * External references:
 * - https://docs.docker.com/reference/cli/docker/compose/
 * - https://nodejs.org/api/child_process.html
 * - https://nodejs.org/api/fs.html
 * Tests:
 * - scripts/docker-instance.test.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';

import { ensureLocalEnvFile, getLocalPlatformPaths } from './local-dev.mjs';

export function getDockerInstancePaths(rootPath) {
  const paths = getLocalPlatformPaths(rootPath);

  return {
    ...paths,
    instanceComposeFile: join(paths.localPlatformDirectory, 'compose.instance.yaml')
  };
}

export function buildDockerInstanceArgs(action, paths = getDockerInstancePaths()) {
  const args = ['compose'];

  if (existsSync(paths.envFile)) {
    args.push('--env-file', paths.envFile);
  }

  args.push('-f', paths.composeFile, '-f', paths.instanceComposeFile);

  if (action === 'up') {
    args.push('up', '-d', '--build', 'cdngine-runtime');
  } else if (action === 'up-demo') {
    args.push('--profile', 'demo', 'up', '-d', '--build', 'cdngine-runtime', 'cdngine-demo');
  } else if (action === 'down') {
    args.push('down', '--remove-orphans');
  } else if (action === 'config') {
    args.push('config');
  } else {
    throw new Error(`Unsupported docker instance action: ${action}`);
  }

  return args;
}

function runCommand(command, args, cwd = getLocalPlatformPaths().rootDirectory) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit'
    });

    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Command failed with exit code ${code}: ${command} ${args.join(' ')}`));
    });
  });
}

async function startInstance({ demo = false, fresh = false } = {}) {
  const paths = getDockerInstancePaths();
  const createdEnvFile = ensureLocalEnvFile(paths);

  if (createdEnvFile) {
    console.log(`Created ${relative(paths.rootDirectory, paths.envFile)} from .env.example`);
  }

  if (fresh) {
    await runCommand('docker', buildDockerInstanceArgs('down', paths), paths.rootDirectory);
  }

  await runCommand('docker', buildDockerInstanceArgs(demo ? 'up-demo' : 'up', paths), paths.rootDirectory);
  console.log('CDNgine Docker instance is running.');
  console.log('Public runtime: http://localhost:4000/healthz');
  if (demo) {
    console.log('Demo UI: http://localhost:5173');
  }
}

async function stopInstance() {
  await runCommand('docker', buildDockerInstanceArgs('down'), getLocalPlatformPaths().rootDirectory);
  console.log('CDNgine Docker instance is stopped.');
}

async function renderConfig() {
  const paths = getDockerInstancePaths();
  ensureLocalEnvFile(paths);
  await runCommand('docker', buildDockerInstanceArgs('config', paths), paths.rootDirectory);
}

export async function main(argv = process.argv.slice(2)) {
  const [firstArg, ...remainingArgs] = argv;
  const mode = firstArg?.startsWith('--') ? 'up' : (firstArg ?? 'up');
  const rest = firstArg?.startsWith('--') ? argv : remainingArgs;
  const fresh = rest.includes('--fresh');

  switch (mode) {
    case 'up':
    case 'start':
      await startInstance({ fresh });
      return;
    case 'demo':
    case 'up-demo':
    case 'start-demo':
      await startInstance({ demo: true, fresh });
      return;
    case 'down':
    case 'stop':
      await stopInstance();
      return;
    case 'config':
      await renderConfig();
      return;
    default:
      throw new Error(`Unknown mode "${mode}". Use "up", "demo", "down", or "config".`);
  }
}

if (process.argv[1]?.endsWith('docker-instance.mjs')) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
