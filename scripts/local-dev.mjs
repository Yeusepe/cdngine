/**
 * Purpose: Provides cross-platform one-command startup for the local dependency stack and demo.
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
 * - scripts/local-dev.test.mjs
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptFilePath = fileURLToPath(import.meta.url);
const rootDirectory = dirname(dirname(scriptFilePath));

export function resolveExecutable(command, platform = process.platform) {
  return platform === 'win32' ? `${command}.cmd` : command;
}

export function getLocalPlatformPaths(rootPath = rootDirectory) {
  const localPlatformDirectory = join(rootPath, 'deploy', 'local-platform');

  return {
    rootDirectory: rootPath,
    localPlatformDirectory,
    envFile: join(localPlatformDirectory, '.env'),
    exampleFile: join(localPlatformDirectory, '.env.example'),
    composeFile: join(localPlatformDirectory, 'compose.fast-start.yaml')
  };
}

export function ensureLocalEnvFile(paths = getLocalPlatformPaths()) {
  if (existsSync(paths.envFile)) {
    return false;
  }

  copyFileSync(paths.exampleFile, paths.envFile);
  return true;
}

export function buildComposeArgs(action, paths = getLocalPlatformPaths()) {
  const args = ['compose'];

  if (existsSync(paths.envFile)) {
    args.push('--env-file', paths.envFile);
  }

  args.push('-f', paths.composeFile, action);

  if (action === 'up') {
    args.push('-d');
  } else if (action === 'down') {
    args.push('--remove-orphans');
  } else {
    throw new Error(`Unsupported docker compose action: ${action}`);
  }

  return args;
}

function runCommand(command, args, cwd = rootDirectory) {
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

async function startStack({ fresh = false } = {}) {
  const paths = getLocalPlatformPaths();
  const createdEnvFile = ensureLocalEnvFile(paths);

  if (createdEnvFile) {
    console.log(`Created ${relative(paths.rootDirectory, paths.envFile)} from .env.example`);
  }

  if (fresh) {
    await runCommand('docker', buildComposeArgs('down', paths));
  }

  await runCommand('docker', buildComposeArgs('up', paths));
  console.log('CDNgine local platform is running.');
}

async function stopStack() {
  await runCommand('docker', buildComposeArgs('down'));
  console.log('CDNgine local platform is stopped.');
}

async function startDemo({ fresh = false } = {}) {
  await startStack({ fresh });
  console.log('Starting the demo on http://localhost:5173');
  await runCommand(resolveExecutable('npm'), ['run', 'demo:start']);
}

export async function main(argv = process.argv.slice(2)) {
  const [mode = 'stack', ...rest] = argv;
  const fresh = rest.includes('--fresh');

  switch (mode) {
    case 'stack':
      await startStack({ fresh });
      return;
    case 'demo':
      await startDemo({ fresh });
      return;
    case 'stop':
      await stopStack();
      return;
    default:
      throw new Error(`Unknown mode "${mode}". Use "stack", "demo", or "stop".`);
  }
}

if (process.argv[1] === scriptFilePath) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
