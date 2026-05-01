/**
 * Purpose: Materializes canonical fallback assets inside the worker process and streams the preserved original into the generic publication workflow.
 * Governing docs:
 * - docs/workflow-extensibility.md
 * - docs/source-plane-strategy.md
 * - docs/storage-tiering-and-materialization.md
 * - docs/workload-and-recipe-matrix.md
 * External references:
 * - https://docs.temporal.io/develop/typescript/core-application
 * - https://nodejs.org/api/fs.html#fscreatereadstreampath-options
 * Tests:
 * - apps/workers/test/generic-asset-processor.test.mjs
 * - apps/workers/test/publication-worker-runtime.test.mjs
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

import type {
  GenericAssetDerivativeActivity,
  GenericAssetDerivativeActivityInput,
  GenericAssetDerivativeActivityResult
} from '@cdngine/workflows';

import type { WorkerSourceMaterializer } from './source-materialization.js';

export interface WorkerGenericAssetProcessorOptions {
  materializer: WorkerSourceMaterializer;
}

export class WorkerGenericAssetProcessor implements GenericAssetDerivativeActivity {
  constructor(private readonly options: WorkerGenericAssetProcessorOptions) {}

  async processAssetDerivative(
    input: GenericAssetDerivativeActivityInput
  ): Promise<GenericAssetDerivativeActivityResult> {
    const restored = await this.options.materializer.materializeVersion({
      assetId: input.assetId,
      canonicalSourceEvidence: input.canonicalSourceEvidence,
      sourceFilename: input.sourceFilename,
      versionId: input.versionId
    });
    const restoredFile = await stat(restored.restoredPath);
    const checksum = input.canonicalSourceEvidence.canonicalDigestSet.find(
      (digest) => digest.algorithm === 'sha256'
    );

    return {
      body: createReadStream(restored.restoredPath),
      byteLength:
        input.canonicalSourceEvidence.canonicalLogicalByteLength ?? BigInt(restoredFile.size),
      ...(checksum ? { checksum } : {}),
      contentType: input.sourceContentType
    };
  }
}
