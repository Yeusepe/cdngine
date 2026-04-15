/**
 * Purpose: Proves the demo scenario generator drives multiple authenticated, multi-tenant uploads and downloads through the implemented public API and workflow slices.
 * Governing docs:
 * - docs/conformance.md
 * - docs/testing-strategy.md
 * - docs/service-architecture.md
 * - docs/security-model.md
 * External references:
 * - https://react.dev/
 * - https://www.rfc-editor.org/rfc/rfc9457.html
 * Tests:
 * - tests/conformance/demo-api-flow.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDemoScenario } from '../../apps/demo/scripts/generate-demo-scenario.mjs';

test('demo scenario generator produces multiple objects with authenticated uploads, downloads, and tenant isolation', async () => {
  const scenario = await buildDemoScenario();

  assert.equal(scenario.tenants.length, 2);
  assert.ok(scenario.generatedObjects.length >= 3);
  assert.ok(scenario.generatedObjects.some((item) => item.tenantId === 'tenant-acme'));
  assert.ok(scenario.generatedObjects.some((item) => item.tenantId === 'tenant-beta'));
  assert.ok(
    scenario.generatedObjects.some((item) => item.downloads.some((download) => download.kind === 'source'))
  );
  assert.ok(
    scenario.generatedObjects.some((item) => item.downloads.some((download) => download.kind === 'derivative'))
  );
  assert.equal(scenario.crossTenantDenial.status, 403);
  assert.equal(scenario.crossTenantDenial.type, 'https://docs.cdngine.dev/problems/scope-not-allowed');
});
