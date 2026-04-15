import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const redocly = join(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'redocly.cmd' : 'redocly'
);

const artifacts = [
  {
    source: 'contracts\\openapi\\public.openapi.yaml',
    output: 'contracts\\dist\\openapi\\public.openapi.yaml'
  },
  {
    source: 'contracts\\openapi\\platform-admin.openapi.yaml',
    output: 'contracts\\dist\\openapi\\platform-admin.openapi.yaml'
  },
  {
    source: 'contracts\\openapi\\operator.openapi.yaml',
    output: 'contracts\\dist\\openapi\\operator.openapi.yaml'
  },
  {
    source: 'contracts\\asyncapi\\lifecycle.asyncapi.yaml',
    output: 'contracts\\dist\\asyncapi\\lifecycle.asyncapi.yaml'
  },
  {
    source: 'contracts\\arazzo\\public-upload.arazzo.yaml',
    output: 'contracts\\dist\\arazzo\\public-upload.arazzo.yaml'
  }
];

for (const artifact of artifacts) {
  const outputPath = join(root, artifact.output);
  mkdirSync(dirname(outputPath), { recursive: true });

  const result =
    process.platform === 'win32'
      ? spawnSync(
          'cmd.exe',
          ['/d', '/c', redocly, 'bundle', artifact.source, '--output', artifact.output],
          {
            cwd: root,
            stdio: 'inherit'
          }
        )
      : spawnSync(redocly, ['bundle', artifact.source, '--output', artifact.output], {
          cwd: root,
          stdio: 'inherit'
        });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
