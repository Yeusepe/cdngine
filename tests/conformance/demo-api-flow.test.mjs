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
  assert.equal(scenario.environment.storage.configurationSource, 'auto-created-defaults');
  assert.equal(scenario.environment.apiBaseUrl, 'https://api.cdngine.local');
  assert.equal(scenario.environment.storage.buckets.ingest, 'cdngine-demo-ingest');
  assert.equal(scenario.environment.storage.buckets.derived, 'cdngine-demo-derived');
  assert.match(scenario.examples.api.code, /curl -X POST "\$API_BASE_URL\/v1\/upload-sessions"/);
  assert.match(scenario.examples.api.code, /replace-with-host-access-token/);
  assert.match(scenario.examples.sdk.code, /createCDNgineClient/);
  assert.match(scenario.examples.sdk.code, /withDefaults/);
  assert.match(scenario.examples.sdk.code, /media\.upload\(/);
  assert.match(scenario.examples.sdk.code, /\.delivery\("/);
  assert.doesNotMatch(scenario.examples.api.code, /x-cdngine-allowed/);
  assert.doesNotMatch(scenario.examples.sdk.code, /getHeaders/);
  assert.equal(scenario.simulation.storageProfiles.length, 2);
  assert.ok(
    scenario.simulation.storageProfiles.some((profile) => profile.profileId === 'standard-tiering')
  );
  assert.ok(
    scenario.simulation.storageProfiles.some((profile) => profile.profileId === 'instant-cold-demo')
  );
  assert.ok(
    scenario.simulation.architectureComponents.some(
      (component) => component.componentId === 'cold-origin-tier'
    )
  );
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
  assert.ok(
    scenario.simulation.storageProfiles.every((profile) =>
      profile.traces.some((trace) => trace.traceType === 'cold-delivery')
    )
  );
});
