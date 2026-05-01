/**
 * Purpose: Verifies that deployment-time Better Auth configuration is loaded with explicit secrets, trusted origins, and session settings before production wiring boots.
 * Governing docs:
 * - docs/security-model.md
 * - docs/service-architecture.md
 * - docs/environment-and-deployment.md
 * External references:
 * - https://www.better-auth.com/docs/concepts/session-management
 * Tests:
 * - packages/auth/test/runtime-auth-config.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BetterAuthRuntimeConfigError,
  loadBetterAuthRuntimeConfigFromEnvironment
} from '../dist/index.js';

test('loadBetterAuthRuntimeConfigFromEnvironment requires explicit base URL and secret', () => {
  assert.throws(
    () =>
      loadBetterAuthRuntimeConfigFromEnvironment({
        CDNGINE_AUTH_BASE_URL: 'https://api.cdngine.example'
      }),
    BetterAuthRuntimeConfigError
  );
});

test('loadBetterAuthRuntimeConfigFromEnvironment parses trusted origins and session posture', () => {
  assert.deepEqual(
    loadBetterAuthRuntimeConfigFromEnvironment({
      CDNGINE_AUTH_BASE_URL: 'https://api.cdngine.example',
      CDNGINE_AUTH_SECRET: 'secret-value-that-is-long-enough-for-production',
      CDNGINE_AUTH_TRUSTED_ORIGINS_JSON:
        '["https://app.cdngine.example","https://ops.cdngine.example"]',
      CDNGINE_AUTH_SESSION_EXPIRES_IN_SECONDS: '604800',
      CDNGINE_AUTH_SESSION_UPDATE_AGE_SECONDS: '86400',
      CDNGINE_AUTH_SESSION_FRESH_AGE_SECONDS: '300',
      CDNGINE_AUTH_DEFER_SESSION_REFRESH: 'true',
      CDNGINE_AUTH_DISABLE_SESSION_REFRESH: 'false'
    }),
    {
      baseURL: 'https://api.cdngine.example',
      secret: 'secret-value-that-is-long-enough-for-production',
      session: {
        deferSessionRefresh: true,
        disableSessionRefresh: false,
        expiresInSeconds: 604800,
        freshAgeSeconds: 300,
        updateAgeSeconds: 86400
      },
      trustedOrigins: ['https://app.cdngine.example', 'https://ops.cdngine.example']
    }
  );
});

