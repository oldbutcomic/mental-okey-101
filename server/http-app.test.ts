import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHttpRequestHandler } from './http-app.js';

async function withDistServer<T>(run: (url: string, distDirectory: string) => Promise<T>, healthCheck: () => Promise<boolean> = async () => true) {
  const distDirectory = await mkdtemp(path.join(tmpdir(), 'mental-okey-dist-'));
  const server = createServer(createHttpRequestHandler({
    distDirectory,
    healthCheck,
    isClientOriginAllowed: origin => origin === undefined || origin === 'https://mental-okey-101.onrender.com',
  }));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate an HTTP test port');
  try {
    return await run(`http://127.0.0.1:${address.port}`, distDirectory);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(distDirectory, { recursive: true, force: true });
  }
}

test('production HTTP server serves Vite assets and falls back to index for SPA paths', async () => {
  await withDistServer(async (url, distDirectory) => {
    await mkdir(path.join(distDirectory, 'assets'), { recursive: true });
    await writeFile(path.join(distDirectory, 'index.html'), '<!doctype html><title>Mental Okey</title>');
    await writeFile(path.join(distDirectory, 'assets', 'index-abcdef123456.js'), 'window.mentalOkeyReady = true;');

    const home = await fetch(url);
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-type') || '', /text\/html/);
    assert.match(await home.text(), /Mental Okey/);

    const route = await fetch(`${url}/room/AB12CD`, { headers: { Accept: 'text/html' } });
    assert.equal(route.status, 200);
    assert.match(await route.text(), /Mental Okey/);

    const asset = await fetch(`${url}/assets/index-abcdef123456.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type') || '', /javascript/);
    assert.match(asset.headers.get('cache-control') || '', /immutable/);
    assert.match(await asset.text(), /mentalOkeyReady/);

    assert.equal((await fetch(`${url}/assets/missing.js`)).status, 404, 'missing assets must not receive the SPA HTML');
    assert.equal((await fetch(`${url}/api/rooms`)).status, 404, 'unknown API URLs must not receive the SPA HTML');
    assert.equal((await fetch(`${url}/%2e%2e%5cserver/index.ts`)).status, 403, 'asset paths cannot escape the dist directory');
  });
});
test('health endpoint preserves CORS and database readiness responses', async () => {
  await withDistServer(async url => {
    const healthy = await fetch(`${url}/healthz`, { headers: { Origin: 'https://mental-okey-101.onrender.com' } });
    assert.equal(healthy.status, 200);
    assert.equal(healthy.headers.get('access-control-allow-origin'), 'https://mental-okey-101.onrender.com');
    assert.deepEqual(await healthy.json(), { status: 'ok' });

    const denied = await fetch(`${url}/healthz`, { headers: { Origin: 'https://unapproved.example' } });
    assert.equal(denied.status, 403);
  });

  await withDistServer(async url => {
    const unavailable = await fetch(`${url}/healthz`);
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), { status: 'unavailable' });
  }, async () => false);
});
