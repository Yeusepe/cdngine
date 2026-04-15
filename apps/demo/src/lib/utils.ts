/**
 * Purpose: Provides the shared class-name merge helper used by shadcn and ReUI demo components in the demo app.
 * Governing docs:
 * - docs/repository-layout.md
 * - docs/testing-strategy.md
 * - docs/service-architecture.md
 * External references:
 * - https://ui.shadcn.com/docs/installation/vite
 * - https://github.com/dcastil/tailwind-merge
 * Tests:
 * - tests/conformance/demo-api-flow.test.mjs
 */

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
