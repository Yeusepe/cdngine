/**
 * Purpose: Implements the canonical source adapter through a controlled Kopia CLI boundary instead of reimplementing repository semantics in TypeScript.
 * Governing docs:
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/source-plane-strategy.md
 * - docs/upstream-integration-model.md
 * - docs/storage-tiering-and-materialization.md
 * External references:
 * - https://kopia.io/docs/reference/command-line/common/snapshot-create/
 * - https://kopia.io/docs/features/
 * - https://restic.readthedocs.io/en/stable/design.html
 * Tests:
 * - packages/storage/test/cli-adapters.test.ts
 */

import type {
  RestoreResult,
  SnapshotFromPathInput,
  SnapshotResult,
  SnapshotSummary,
  SourceRepository,
  RestoreSnapshotInput
} from './adapter-contracts.js';
import type { CommandRunner } from './command-runner.js';

export interface KopiaSourceRepositoryConfig {
  runner: CommandRunner;
  executable?: string;
  cwd?: string;
  timeoutMs?: number;
}

function buildCommandOptions(config: Pick<KopiaSourceRepositoryConfig, 'cwd' | 'timeoutMs'>) {
  return {
    ...(config.cwd ? { cwd: config.cwd } : {}),
    ...(typeof config.timeoutMs === 'number' ? { timeoutMs: config.timeoutMs } : {})
  };
}

interface ParsedKopiaSnapshot {
  id?: string;
  rootEntry?: {
    obj?: string;
  };
  source?: {
    path?: string;
  };
  startTime?: string;
  endTime?: string;
}

function parseJson<T>(value: string, context: string): T {
  return JSON.parse(value) as T;
}

function resolveSnapshotId(snapshot: ParsedKopiaSnapshot): string {
  if (typeof snapshot.id === 'string' && snapshot.id.length > 0) {
    return snapshot.id;
  }

  if (typeof snapshot.rootEntry?.obj === 'string' && snapshot.rootEntry.obj.length > 0) {
    return snapshot.rootEntry.obj;
  }

  throw new Error('Kopia output did not include a snapshot identifier.');
}

function cloneDigests(digests: SnapshotFromPathInput['sourceDigests']): SnapshotResult['digests'] {
  const seen = new Set<string>();
  const result: SnapshotResult['digests'] = [];

  for (const digest of digests ?? []) {
    const key = `${digest.algorithm}:${digest.value}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push({
      algorithm: digest.algorithm,
      value: digest.value
    });
  }

  return result;
}

export class KopiaSourceRepository implements SourceRepository {
  private readonly config: KopiaSourceRepositoryConfig;
  private readonly executable: string;

  constructor(config: KopiaSourceRepositoryConfig) {
    this.config = config;
    this.executable = config.executable ?? 'kopia';
  }

  async snapshotFromPath(input: SnapshotFromPathInput): Promise<SnapshotResult> {
    const args = [
      'snapshot',
      'create',
      input.localPath,
      '--json',
      '--description',
      input.sourceFilename,
      '--tags',
      `assetVersionId:${input.assetVersionId}`
    ];

    for (const [key, value] of Object.entries(input.metadata ?? {})) {
      args.push('--tags', `${key}:${value}`);
    }

    const result = await this.config.runner.run({
      command: this.executable,
      args,
      ...buildCommandOptions(this.config)
    });

    const parsed = parseJson<ParsedKopiaSnapshot>(result.stdout, 'snapshot create');
    const snapshotId = resolveSnapshotId(parsed);
    const digests = cloneDigests(input.sourceDigests);

    return {
      repositoryEngine: 'kopia',
      canonicalSourceId: snapshotId,
      snapshotId,
      logicalPath: parsed.source?.path ?? input.localPath,
      digests,
      ...(input.logicalByteLength === undefined ? {} : { logicalByteLength: input.logicalByteLength }),
      reconstructionHandles: [
        {
          kind: 'snapshot',
          value: snapshotId
        }
      ],
      substrateHints: {
        repositoryTool: 'kopia'
      }
    };
  }

  async listSnapshots(assetVersionId: string): Promise<SnapshotSummary[]> {
    const result = await this.config.runner.run({
      command: this.executable,
      args: ['snapshot', 'list', '--json', '--tags', `assetVersionId:${assetVersionId}`],
      ...buildCommandOptions(this.config)
    });

    const parsed = parseJson<ParsedKopiaSnapshot[] | { snapshots?: ParsedKopiaSnapshot[] }>(
      result.stdout,
      'snapshot list'
    );
    const snapshots = Array.isArray(parsed) ? parsed : parsed.snapshots ?? [];

    return snapshots.map((snapshot) => ({
      canonicalSourceId: resolveSnapshotId(snapshot),
      snapshotId: resolveSnapshotId(snapshot),
      createdAt: new Date(snapshot.endTime ?? snapshot.startTime ?? Date.now())
    }));
  }

  async restoreToPath(input: RestoreSnapshotInput): Promise<RestoreResult> {
    await this.config.runner.run({
      command: this.executable,
      args: ['snapshot', 'restore', input.canonicalSourceId, input.destinationPath],
      ...buildCommandOptions(this.config)
    });

    return {
      restoredPath: input.destinationPath
    };
  }
}
