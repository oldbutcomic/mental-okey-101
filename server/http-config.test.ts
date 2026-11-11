import assert from 'node:assert/strict';
import test from 'node:test';
import { clientOriginIsAllowed, resolveAllowedClientOrigins } from './http-config.js';

test('production CORS allows only explicitly configured frontend origins', () => {
  const origins = resolveAllowedClientOrigins({ NODE_ENV: 'production', CLIENT_ORIGIN: 'https://beta.example, https://preview.example' }, ['http://192.168.1.20:5173']);
  assert.deepEqual([...origins], ['https://beta.example', 'https://preview.example']);
  assert.equal(clientOriginIsAllowed('http://localhost:5173', origins), false);
  assert.equal(clientOriginIsAllowed('https://beta.example', origins), true);
});

test('production CORS fails closed when CLIENT_ORIGIN is missing while development keeps local defaults', () => {
  const productionOrigins = resolveAllowedClientOrigins({ NODE_ENV: 'production' }, ['http://192.168.1.20:5173']);
  assert.equal(productionOrigins.size, 0);
  assert.equal(clientOriginIsAllowed('http://localhost:5173', productionOrigins), false);

  const developmentOrigins = resolveAllowedClientOrigins({ NODE_ENV: 'development' }, ['http://192.168.1.20:5173']);
  assert.equal(clientOriginIsAllowed('http://localhost:5173', developmentOrigins), true);
  assert.equal(clientOriginIsAllowed('http://192.168.1.20:5173', developmentOrigins), true);
  assert.equal(clientOriginIsAllowed('https://unknown.example', developmentOrigins), false);
  assert.equal(clientOriginIsAllowed(undefined, productionOrigins), true);
});
