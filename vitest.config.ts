import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)), 'server-only': fileURLToPath(new URL('./tests/server-only.ts', import.meta.url)) } },
  test: { environment: 'node', include: ['tests/personalization.test.ts', 'tests/interviews.test.ts', 'tests/providers.test.ts', 'tests/research.test.ts', 'tests/trends.test.ts', 'tests/audio.test.ts', 'tests/live.test.ts', 'tests/live-audio.test.ts', 'tests/oauth.test.ts', 'tests/oauth-ownership.test.ts'], testTimeout: 20000 }
});
