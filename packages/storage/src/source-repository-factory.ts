/**
 * Purpose: Creates the runtime-selected canonical source adapter from typed storage environment config while keeping the public surface engine-neutral and testable.
 * Governing docs:
 * - docs/source-plane-strategy.md
 * - docs/environment-and-deployment.md
 * - docs/service-architecture.md
 * - docs/upstream-integration-model.md
 * - docs/package-reference.md
 * External references:
 * - https://huggingface.co/docs/xet/en/api
 * - https://kopia.io/docs/reference/command-line/common/snapshot-create/
 * Tests:
 * - packages/storage/test/runtime-storage-config.test.mjs
 */

import type {
  RestoreSnapshotInput,
  SourceRepository,
  SourceRepositoryEngine
} from './adapter-contracts.js';
import {
  ChildProcessCommandRunner,
  type CommandRunner
} from './command-runner.js';
import {
  KopiaSourceRepository
} from './kopia-source-repository.js';
import {
  loadSourceRepositoryRuntimeConfigFromEnvironment,
  type SourceRepositoryRuntimeConfig
} from './runtime-storage-config.js';
import {
  CommandBackedXetFileMaterializer,
  CommandBackedXetSnapshotEvidenceProvider,
  ServiceBackedXetFileMaterializer,
  ServiceBackedXetSnapshotEvidenceProvider,
  type XetFileMaterializer,
  type XetSnapshotEvidenceProvider,
  type XetSnapshotStore,
  XetSourceRepository
} from './xet-source-repository.js';

export interface XetSourceRepositoryFactoryDependencies {
  evidenceProvider?: XetSnapshotEvidenceProvider;
  fetch?: typeof fetch;
  materializer?: XetFileMaterializer;
  snapshotStore: XetSnapshotStore;
}

export interface CreateSourceRepositoryOptions {
  runner?: CommandRunner;
  runtimeConfig: SourceRepositoryRuntimeConfig;
  xet?: XetSourceRepositoryFactoryDependencies;
}

export interface CreateSourceRepositoryFromEnvironmentOptions {
  environment: NodeJS.ProcessEnv;
  runner?: CommandRunner;
  xet?: XetSourceRepositoryFactoryDependencies;
}

export class SourceRepositoryFactoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceRepositoryFactoryError';
  }
}

type SupportedRuntimeEngine = SourceRepositoryRuntimeConfig['engine'];

function isSupportedRuntimeEngine(engine: SourceRepositoryEngine): engine is SupportedRuntimeEngine {
  return engine === 'kopia' || engine === 'xet';
}

class RuntimeSelectedSourceRepository implements SourceRepository {
  private readonly repositories = new Map<SupportedRuntimeEngine, SourceRepository>();

  constructor(
    private readonly defaultEngine: SupportedRuntimeEngine,
    private readonly repositoryFactory: (engine: SupportedRuntimeEngine) => SourceRepository
  ) {}

  async snapshotFromPath(input: Parameters<SourceRepository['snapshotFromPath']>[0]) {
    return this.getRepository(this.defaultEngine).snapshotFromPath(input);
  }

  async listSnapshots(assetVersionId: string) {
    return this.getRepository(this.defaultEngine).listSnapshots(assetVersionId);
  }

  async restoreToPath(input: RestoreSnapshotInput) {
    const engine = input.snapshot?.repositoryEngine ?? this.defaultEngine;

    if (!isSupportedRuntimeEngine(engine)) {
      throw new SourceRepositoryFactoryError(
        `Canonical source restore does not support repository engine "${engine}" in the current runtime.`
      );
    }

    return this.getRepository(engine).restoreToPath(input);
  }

  private getRepository(engine: SupportedRuntimeEngine) {
    let repository = this.repositories.get(engine);

    if (!repository) {
      repository = this.repositoryFactory(engine);
      this.repositories.set(engine, repository);
    }

    return repository;
  }
}

function getRunner(runner: CommandRunner | undefined): CommandRunner {
  return runner ?? new ChildProcessCommandRunner();
}

function createXetSourceRepository(
  runtimeConfig: SourceRepositoryRuntimeConfig,
  runner: CommandRunner,
  xet: XetSourceRepositoryFactoryDependencies | undefined
): SourceRepository {
  if (!xet?.snapshotStore) {
    throw new SourceRepositoryFactoryError(
      'Xet source repository factory requires a snapshotStore dependency.'
    );
  }

  const evidenceProvider =
    xet.evidenceProvider ??
    (runtimeConfig.xet.service
      ? new ServiceBackedXetSnapshotEvidenceProvider({
          endpoint: runtimeConfig.xet.service.endpoint,
          timeoutMs: runtimeConfig.xet.timeoutMs,
          ...(xet?.fetch ? { fetchImpl: xet.fetch } : {}),
          ...(runtimeConfig.xet.service.authToken
            ? { authToken: runtimeConfig.xet.service.authToken }
            : {}),
          ...(runtimeConfig.xet.workspacePath
            ? { workspacePath: runtimeConfig.xet.workspacePath }
            : {})
        })
      : runtimeConfig.xet.command
      ? new CommandBackedXetSnapshotEvidenceProvider({
          runner,
          command: runtimeConfig.xet.command.command,
          args: runtimeConfig.xet.command.args,
          ...(runtimeConfig.xet.command.cwd ? { cwd: runtimeConfig.xet.command.cwd } : {}),
          timeoutMs: runtimeConfig.xet.timeoutMs
        })
      : undefined);

  if (!evidenceProvider) {
    throw new SourceRepositoryFactoryError(
      'Xet runtime selection requires command or service wiring. Provide CDNGINE_XET_COMMAND, CDNGINE_XET_SERVICE_ENDPOINT, or inject an evidenceProvider.'
    );
  }

  const materializer =
    xet.materializer ??
    (runtimeConfig.xet.service
      ? new ServiceBackedXetFileMaterializer({
          endpoint: runtimeConfig.xet.service.endpoint,
          timeoutMs: runtimeConfig.xet.timeoutMs,
          ...(xet?.fetch ? { fetchImpl: xet.fetch } : {}),
          ...(runtimeConfig.xet.service.authToken
            ? { authToken: runtimeConfig.xet.service.authToken }
            : {}),
          ...(runtimeConfig.xet.workspacePath
            ? { workspacePath: runtimeConfig.xet.workspacePath }
            : {})
        })
      : runtimeConfig.xet.command
      ? new CommandBackedXetFileMaterializer({
          runner,
          command: runtimeConfig.xet.command.command,
          args: runtimeConfig.xet.command.args,
          ...(runtimeConfig.xet.command.cwd ? { cwd: runtimeConfig.xet.command.cwd } : {}),
          timeoutMs: runtimeConfig.xet.timeoutMs
        })
      : undefined);

  return new XetSourceRepository({
    evidenceProvider,
    snapshotStore: xet.snapshotStore,
    ...(materializer ? { materializer } : {})
  });
}

export function createSourceRepository(options: CreateSourceRepositoryOptions): SourceRepository {
  const runner = getRunner(options.runner);

  switch (options.runtimeConfig.engine) {
    case 'kopia':
      return new KopiaSourceRepository({
        runner,
        executable: options.runtimeConfig.kopia.executable,
        ...(options.runtimeConfig.kopia.cwd ? { cwd: options.runtimeConfig.kopia.cwd } : {}),
        timeoutMs: options.runtimeConfig.kopia.timeoutMs
      });
    case 'xet':
      return createXetSourceRepository(options.runtimeConfig, runner, options.xet);
  }
}

export function createSourceRepositoryFromEnvironment(
  options: CreateSourceRepositoryFromEnvironmentOptions
): SourceRepository {
  const runtimeConfig = loadSourceRepositoryRuntimeConfigFromEnvironment(options.environment);
  const runner = getRunner(options.runner);

  return new RuntimeSelectedSourceRepository(runtimeConfig.engine, (engine) =>
    createSourceRepository({
      runtimeConfig: {
        ...runtimeConfig,
        engine
      },
      runner,
      ...(options.xet ? { xet: options.xet } : {})
    })
  );
}
