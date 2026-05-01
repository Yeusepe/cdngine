/**
 * Purpose: Provides shared defaults and summaries for the public product client so uploads and version inspection stay aligned with the public contract for different workload families.
 * Governing docs:
 * - docs/api-surface.md
 * - docs/public-api-and-sdk-tutorial.md
 * - docs/testing-strategy.md
 * External references:
 * - https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types
 * Tests:
 * - apps/demo/test/public-surface-helpers.test.ts
 */

export interface ContractExplorerDefaults {
  deliveryScopeId: string;
  manifestType: string;
  variant: string;
}

export function suggestContractExplorerDefaults(contentType: string | undefined): ContractExplorerDefaults {
  if (contentType?.startsWith('image/')) {
    return {
      deliveryScopeId: 'public-images',
      manifestType: 'image-default',
      variant: 'webp-master'
    };
  }

  if (contentType === 'application/pdf' || contentType === 'application/vnd.ms-powerpoint') {
    return {
      deliveryScopeId: 'presentations',
      manifestType: 'presentation-default',
      variant: 'normalized-pdf'
    };
  }

  return {
    deliveryScopeId: '',
    manifestType: 'generic-asset-default',
    variant: 'preserve-original'
  };
}

export function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function normalizeOptionalText(value: string) {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
