/**
 * Purpose: Loads deployment-specific readiness requirements from environment variables so local, integration, and production profiles can demand the same health evidence consistently.
 * Governing docs:
 * - docs/environment-and-deployment.md
 * - docs/observability.md
 * - docs/slo-and-capacity.md
 * External references:
 * - https://docs.docker.com/compose/environment-variables/
 * - https://opentelemetry.io/docs/languages/js/
 * Tests:
 * - packages/observability/test/readiness-profile.test.mjs
 */

export const readinessDependencies = [
  'postgres',
  'redis',
  'temporal',
  'tusd',
  'source-repository',
  'derived-store',
  'exports-store',
  'oci-registry'
] as const;

export type ReadinessDependency = (typeof readinessDependencies)[number];
export type DeploymentReadinessProfile = 'local-fast-start' | 'production-default';

export interface ReadinessProfile {
  deploymentProfile: DeploymentReadinessProfile;
  requiredDependencies: readonly ReadinessDependency[];
}

export class ReadinessProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReadinessProfileError';
  }
}

function ensureDependency(value: string): ReadinessDependency {
  if ((readinessDependencies as readonly string[]).includes(value)) {
    return value as ReadinessDependency;
  }

  throw new ReadinessProfileError(
    `Unknown readiness dependency "${value}". Expected one of ${readinessDependencies.join(', ')}.`
  );
}

export function loadReadinessProfileFromEnvironment(
  environment: NodeJS.ProcessEnv
): ReadinessProfile {
  const deploymentProfile = (environment.CDNGINE_DEPLOYMENT_PROFILE?.trim() ||
    'local-fast-start') as DeploymentReadinessProfile;

  if (deploymentProfile !== 'local-fast-start' && deploymentProfile !== 'production-default') {
    throw new ReadinessProfileError(
      `CDNGINE_DEPLOYMENT_PROFILE must be "local-fast-start" or "production-default". Received "${environment.CDNGINE_DEPLOYMENT_PROFILE}".`
    );
  }

  const explicitDependencies = environment.CDNGINE_READINESS_REQUIRED?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (explicitDependencies && explicitDependencies.length > 0) {
    return {
      deploymentProfile,
      requiredDependencies: [...new Set(explicitDependencies.map((item) => ensureDependency(item)))]
    };
  }

  return {
    deploymentProfile,
    requiredDependencies:
      deploymentProfile === 'local-fast-start'
        ? ['postgres', 'redis', 'temporal', 'tusd', 'source-repository', 'oci-registry']
        : ['postgres', 'redis', 'temporal', 'tusd', 'source-repository', 'derived-store', 'exports-store']
  };
}
