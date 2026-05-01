/**
 * Purpose: Verifies that the public product client suggests contract explorer defaults that stay aligned with the public manifest and delivery contract for supported workload families.
 * Governing docs:
 * - docs/api-surface.md
 * - docs/public-api-and-sdk-tutorial.md
 * - docs/testing-strategy.md
 * External references:
 * - https://nodejs.org/api/test.html
 * - https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types
 * Tests:
 * - apps/demo/test/public-surface-helpers.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { suggestContractExplorerDefaults } from '../src/public-surface-helpers.ts'

test('contract explorer defaults map image uploads to the image delivery surface', () => {
  assert.deepEqual(suggestContractExplorerDefaults('image/png'), {
    deliveryScopeId: 'public-images',
    manifestType: 'image-default',
    variant: 'webp-master'
  })
})

test('contract explorer defaults map presentation uploads to the presentation delivery surface', () => {
  assert.deepEqual(suggestContractExplorerDefaults('application/pdf'), {
    deliveryScopeId: 'presentations',
    manifestType: 'presentation-default',
    variant: 'normalized-pdf'
  })
})

test('contract explorer defaults keep generic fallback variants explicit when the delivery scope is product-defined', () => {
  assert.deepEqual(suggestContractExplorerDefaults('application/octet-stream'), {
    deliveryScopeId: '',
    manifestType: 'generic-asset-default',
    variant: 'preserve-original'
  })
})
