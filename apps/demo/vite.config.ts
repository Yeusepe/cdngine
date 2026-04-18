/**
 * Purpose: Configures the demo Vite app with React support and the shared @ alias required by the shadcn component registry.
 * Governing docs:
 * - docs/repository-layout.md
 * - docs/testing-strategy.md
 * - docs/service-architecture.md
 * External references:
 * - https://vite.dev/config/
 * - https://ui.shadcn.com/docs/installation/vite
 * Tests:
 * - apps/demo/package.json
 */

import path from 'node:path'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  build: {
    cssMinify: 'esbuild',
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/_demo': 'http://localhost:4000',
      '/download-links': 'http://localhost:4000',
      '/v1': 'http://localhost:4000'
    }
  }
})
