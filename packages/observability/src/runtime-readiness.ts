/**
 * Purpose: Runs typed readiness checks for required deployment dependencies so `/readyz` reflects real dependency state instead of placeholder booleans.
 * Governing docs:
 * - docs/environment-and-deployment.md
 * - docs/observability.md
 * - docs/security-model.md
 * External references:
 * - https://opentelemetry.io/docs/
 * Tests:
 * - packages/observability/test/runtime-observability.test.mjs
 */

import type { DeploymentReadinessProfile, ReadinessDependency } from './readiness-profile.js';
import { summarizeReadiness, type ReadinessSignal } from './readiness.js';

export interface RuntimeReadinessDependencyReport extends ReadinessSignal {
  boundary: ReadinessDependency;
  checkedAt: Date;
  required: true;
}

export interface RuntimeReadinessReport {
  checkedAt: Date;
  degradedBoundaries: string[];
  dependencies: RuntimeReadinessDependencyReport[];
  deploymentProfile: DeploymentReadinessProfile;
  failedBoundaries: string[];
  status: 'degraded' | 'not-ready' | 'ready';
}

export interface ReadinessCheckContext {
  checkedAt: Date;
  dependency: ReadinessDependency;
  signal: AbortSignal;
}

export type ReadinessCheckResult =
  | Omit<ReadinessSignal, 'boundary'>
  | ReadinessSignal['status'];

export type ReadinessCheck = (
  context: ReadinessCheckContext
) => Promise<ReadinessCheckResult> | ReadinessCheckResult;

export interface RuntimeReadinessMonitorOptions {
  checks?: Partial<Record<ReadinessDependency, ReadinessCheck>>;
  deploymentProfile: DeploymentReadinessProfile;
  now?: () => Date;
  requiredDependencies: readonly ReadinessDependency[];
  timeoutMs?: number;
}

function normalizeResult(
  dependency: ReadinessDependency,
  checkedAt: Date,
  result: ReadinessCheckResult
): RuntimeReadinessDependencyReport {
  if (typeof result === 'string') {
    return {
      boundary: dependency,
      checkedAt,
      required: true,
      status: result
    };
  }

  return {
    boundary: dependency,
    checkedAt,
    required: true,
    status: result.status,
    ...(result.detail ? { detail: result.detail } : {})
  };
}

export class RuntimeReadinessMonitor {
  private readonly checks: Partial<Record<ReadinessDependency, ReadinessCheck>>;
  private readonly deploymentProfile: DeploymentReadinessProfile;
  private readonly now: () => Date;
  private readonly requiredDependencies: readonly ReadinessDependency[];
  private readonly timeoutMs: number;

  constructor(options: RuntimeReadinessMonitorOptions) {
    this.checks = options.checks ?? {};
    this.deploymentProfile = options.deploymentProfile;
    this.now = options.now ?? (() => new Date());
    this.requiredDependencies = [...options.requiredDependencies];
    this.timeoutMs = options.timeoutMs ?? 3_000;
  }

  async check(): Promise<RuntimeReadinessReport> {
    const dependencies: RuntimeReadinessDependencyReport[] = [];

    for (const dependency of this.requiredDependencies) {
      const checkedAt = this.now();
      const check = this.checks[dependency];

      if (!check) {
        dependencies.push({
          boundary: dependency,
          checkedAt,
          detail: `No readiness check configured for required dependency "${dependency}".`,
          required: true,
          status: 'failed'
        });
        continue;
      }

      const controller = new AbortController();
      const abortTimeoutId = setTimeout(() => {
        controller.abort('readiness-timeout');
      }, this.timeoutMs);
      let raceTimeoutId: NodeJS.Timeout | undefined;

      try {
        const result = await Promise.race([
          Promise.resolve(
            check({
              checkedAt,
              dependency,
              signal: controller.signal
            })
          ),
          new Promise<ReadinessCheckResult>((_, reject) => {
            raceTimeoutId = setTimeout(() => {
              reject(new Error(`Readiness check timed out after ${this.timeoutMs}ms.`));
            }, this.timeoutMs);
          })
        ]);

        dependencies.push(normalizeResult(dependency, checkedAt, result));
      } catch (error) {
        dependencies.push({
          boundary: dependency,
          checkedAt,
          detail: error instanceof Error ? error.message : 'Unknown readiness failure.',
          required: true,
          status: 'failed'
        });
      } finally {
        clearTimeout(abortTimeoutId);
        if (raceTimeoutId) {
          clearTimeout(raceTimeoutId);
        }
      }
    }

    const summary = summarizeReadiness(dependencies);

    return {
      checkedAt: this.now(),
      dependencies,
      deploymentProfile: this.deploymentProfile,
      degradedBoundaries: summary.degradedBoundaries,
      failedBoundaries: summary.failedBoundaries,
      status: summary.status
    };
  }
}

