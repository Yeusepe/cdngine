/**
 * Purpose: Configures the public upload client Vite app with React support and the local public-runtime proxy.
 * Governing docs:
 * - docs/repository-layout.md
 * - docs/testing-strategy.md
 * - docs/service-architecture.md
 * External references:
 * - https://vite.dev/config/
 * Tests:
 * - apps/demo/package.json
 */

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  build: {
    cssMinify: 'esbuild',
  },
  plugins: [react()],
  server: {
    proxy: {
      '/download-links': 'http://localhost:4000',
      '/uploads': 'http://localhost:4000',
      '/v1': 'http://localhost:4000'
    }
  }
})
