// Test the actual production HTTP routes without credentials or paid API calls.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const port = 3107;
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  stdio: 'ignore',
  env: { ...process.env, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', RATE_LIMIT_SALT: '', CRON_SECRET: 'smoke-test-secret-with-at-least-32-characters' },
});
const origin = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { const response = await fetch(`${origin}/api/v1/catalog`); if (response.ok) { ready = true; break; } } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert(ready, 'Production server did not become ready');
  const catalogResponse = await fetch(`${origin}/api/v1/catalog`);
  assert.equal(catalogResponse.status, 200);
  assert((await catalogResponse.json()).interviewModes.includes('mixed'));
  const cron = await fetch(`${origin}/api/cron/monthly-research`);
  assert.equal(cron.status, 401);
  const error = await cron.json();
  assert.equal(error.error.requestId, cron.headers.get('x-request-id'));
  assert.match(cron.headers.get('cache-control'), /no-store/);
  const setup = await fetch(`${origin}/api/v1/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(setup.status, 503);
  const setupError = await setup.json();
  assert.equal(setupError.error.code, 'NOT_CONFIGURED');
  assert.equal(setupError.error.requestId, setup.headers.get('x-request-id'));
  console.log('Production HTTP smoke passed: catalog, cron authorization, private cache policy, safe setup failures and request IDs.');
} finally {
  child.kill('SIGTERM');
}
