/**
 * Purpose: Starts the local Node.js public runtime server that exposes the CDNgine production upload-session and public-read contract for the public upload workspace.
 * Governing docs:
 * - docs/repository-layout.md
 * - docs/api-surface.md
 * - docs/service-architecture.md
 * - docs/testing-strategy.md
 * External references:
 * - https://hono.dev/docs
 * - https://nodejs.org/api/http.html
 * Tests:
 * - apps/demo/test/demo-api-app.test.mjs
 */

import { createPublicRuntimeServer } from './public-runtime-app.mjs';

const PORT = 4000;
const { server } = createPublicRuntimeServer({
  port: PORT,
  publicBaseUrl: `http://localhost:${PORT}`
});

server.listen(PORT, () => {
  console.log(`CDNgine local public runtime -> http://localhost:${PORT}`);
});
