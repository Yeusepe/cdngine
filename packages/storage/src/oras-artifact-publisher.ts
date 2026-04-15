/**
 * Purpose: Implements the optional artifact-bundle publisher through the ORAS CLI so OCI graph semantics stay upstream-owned.
 * Governing docs:
 * - docs/upstream-integration-model.md
 * - docs/storage-tiering-and-materialization.md
 * - docs/canonical-source-and-tiering-contract.md
 * External references:
 * - https://oras.land/docs/commands/oras_push/
 * - https://oras.land/docs/
 * Tests:
 * - packages/storage/test/cli-adapters.test.ts
 */

import type { ArtifactPublisher, ArtifactReference, PushBundleInput } from './adapter-contracts.js';
import type { CommandRunner } from './command-runner.js';

export interface OrasArtifactPublisherConfig {
  runner: CommandRunner;
  executable?: string;
  cwd?: string;
  timeoutMs?: number;
}

interface ParsedOrasPushOutput {
  digest?: string;
  mediaType?: string;
  reference?: string;
  descriptor?: {
    digest?: string;
    mediaType?: string;
  };
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function resolveDigest(output: ParsedOrasPushOutput): string {
  const digest = output.descriptor?.digest ?? output.digest;

  if (!digest) {
    throw new Error('ORAS output did not include a digest.');
  }

  return digest;
}

export class OrasArtifactPublisher implements ArtifactPublisher {
  private readonly executable: string;

  constructor(private readonly config: OrasArtifactPublisherConfig) {
    this.executable = config.executable ?? 'oras';
  }

  async pushBundle(input: PushBundleInput): Promise<ArtifactReference> {
    const result = await this.config.runner.run({
      command: this.executable,
      args: [
        'push',
        input.reference,
        `${input.path}:${input.mediaType}`,
        '--artifact-type',
        input.mediaType,
        '--format',
        'json'
      ],
      cwd: this.config.cwd,
      timeoutMs: this.config.timeoutMs
    });

    const parsed = parseJson<ParsedOrasPushOutput>(result.stdout);

    return {
      reference: parsed.reference ?? input.reference,
      digest: resolveDigest(parsed),
      mediaType: parsed.descriptor?.mediaType ?? parsed.mediaType ?? input.mediaType
    };
  }
}
