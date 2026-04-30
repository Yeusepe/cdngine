/**
 * Purpose: Builds the worker-side canonical-source runtime and materializes persisted canonical evidence into worker-local paths without assuming one repository engine.
 * Governing docs:
 * - docs/workflow-extensibility.md
 * - docs/source-plane-strategy.md
 * - docs/canonical-source-and-tiering-contract.md
 * - docs/storage-tiering-and-materialization.md
 * External references:
 * - https://docs.temporal.io/develop/typescript/core-application
 * - https://huggingface.co/docs/xet/en/deduplication
 * - https://kopia.io/docs/features/
 * Tests:
 * - apps/workers/test/source-materialization.test.mjs
 */

import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  buildMaterializedSourcePath,
  InMemoryXetSnapshotStore,
  createSourceRepositoryFromEnvironment,
  materializeCanonicalSourceToPath,
  type CommandRunner,
  type PersistedCanonicalSourceEvidence,
  type SourceRepository,
  type XetSourceRepositoryFactoryDependencies
} from '@cdngine/storage';

export interface CreateWorkerSourceRepositoryFromEnvironmentOptions {
  environment: NodeJS.ProcessEnv;
  runner?: CommandRunner;
  xet?: Omit<XetSourceRepositoryFactoryDependencies, 'snapshotStore'> & {
    snapshotStore?: XetSourceRepositoryFactoryDependencies['snapshotStore'];
  };
}

export interface WorkerSourceMaterializerOptions {
  materializationRootPath: string;
  sourceRepository: SourceRepository;
}

export interface WorkerSourceMaterializationRequest {
  assetId: string;
  canonicalSourceEvidence: PersistedCanonicalSourceEvidence;
  sourceFilename?: string;
  versionId: string;
}

function resolveXetDependencies(
  xet: CreateWorkerSourceRepositoryFromEnvironmentOptions['xet']
): XetSourceRepositoryFactoryDependencies {
  return {
    snapshotStore: xet?.snapshotStore ?? new InMemoryXetSnapshotStore(),
    ...(xet?.evidenceProvider ? { evidenceProvider: xet.evidenceProvider } : {}),
    ...(xet?.fetch ? { fetch: xet.fetch } : {}),
    ...(xet?.materializer ? { materializer: xet.materializer } : {})
  };
}

function buildWorkerSourceMaterializationPath(
  rootPath: string,
  input: WorkerSourceMaterializationRequest
) {
  return buildMaterializedSourcePath({
    rootPath,
    pathSegments: [input.assetId, input.versionId],
    ...(input.sourceFilename ? { sourceFilename: input.sourceFilename } : {}),
    canonicalLogicalPath: input.canonicalSourceEvidence.canonicalLogicalPath
  });
}

export function createWorkerSourceRepositoryFromEnvironment(
  options: CreateWorkerSourceRepositoryFromEnvironmentOptions
) {
  return createSourceRepositoryFromEnvironment({
    environment: options.environment,
    ...(options.runner ? { runner: options.runner } : {}),
    xet: resolveXetDependencies(options.xet)
  });
}

export class WorkerSourceMaterializer {
  constructor(private readonly options: WorkerSourceMaterializerOptions) {}

  async materializeVersion(input: WorkerSourceMaterializationRequest) {
    const destinationPath = buildWorkerSourceMaterializationPath(
      this.options.materializationRootPath,
      input
    );

    await mkdir(dirname(destinationPath), { recursive: true });

    return materializeCanonicalSourceToPath(this.options.sourceRepository, {
      canonicalSource: input.canonicalSourceEvidence,
      destinationPath
    });
  }
}
