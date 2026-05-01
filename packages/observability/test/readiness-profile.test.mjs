/**
 * Purpose: Verifies that deployment profiles and explicit overrides resolve to one stable readiness requirement set.
 * Governing docs:
 * - docs/environment-and-deployment.md
 * - docs/observability.md
 * - docs/slo-and-capacity.md
 * Tests:
 * - packages/observability/test/readiness-profile.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ReadinessProfileError,
  loadReadinessProfileFromEnvironment
} from '../dist/readiness-profile.js';

test('loadReadinessProfileFromEnvironment provides local fast-start defaults', () => {
  assert.deepEqual(loadReadinessProfileFromEnvironment({}), {
    deploymentProfile: 'local-fast-start',
    requiredDependencies: [
      'auth',
      'postgres',
      'redis',
      'temporal',
      'tusd',
      'source-repository',
      'oci-registry'
    ]
  });
});

test('loadReadinessProfileFromEnvironment accepts explicit dependency overrides', () => {
  assert.deepEqual(
    loadReadinessProfileFromEnvironment({
      CDNGINE_DEPLOYMENT_PROFILE: 'production-default',
      CDNGINE_READINESS_REQUIRED: 'auth,postgres,redis,temporal,derived-store,exports-store'
    }),
    {
      deploymentProfile: 'production-default',
      requiredDependencies: [
        'auth',
        'postgres',
        'redis',
        'temporal',
        'derived-store',
        'exports-store'
      ]
    }
  );
});

test('loadReadinessProfileFromEnvironment rejects unknown readiness dependencies', () => {
  assert.throws(
    () =>
      loadReadinessProfileFromEnvironment({
        CDNGINE_READINESS_REQUIRED: 'postgres,unknown-dependency'
      }),
    ReadinessProfileError
  );
});
