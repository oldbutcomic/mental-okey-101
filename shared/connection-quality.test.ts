import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyConnectionLatency, classifyRecentConnectionLatency } from './connection-quality';

test('Socket.IO round-trip latency is classified into stable quality bands', () => {
  assert.equal(classifyConnectionLatency(0), 'good');
  assert.equal(classifyConnectionLatency(120), 'good');
  assert.equal(classifyConnectionLatency(121), 'medium');
  assert.equal(classifyConnectionLatency(300), 'medium');
  assert.equal(classifyConnectionLatency(301), 'weak');
  assert.equal(classifyConnectionLatency(Number.NaN), 'weak');
});

test('steady connection quality uses the last-five median and waits for enough samples', () => {
  assert.equal(classifyRecentConnectionLatency([]), 'unknown');
  assert.equal(classifyRecentConnectionLatency([40, 42]), 'unknown');
  assert.equal(classifyRecentConnectionLatency([40, 42, 850]), 'good', 'one delayed callback must not outweigh two stable samples');
  assert.equal(classifyRecentConnectionLatency([330, 360, 390]), 'weak');
  assert.equal(classifyRecentConnectionLatency([35, 40, 45, 50, 55, 700]), 'good', 'only the most recent five samples are used');
  assert.equal(classifyRecentConnectionLatency([40, 42, 44], 2), 'weak', 'two unanswered probes mean a weak link');
});
