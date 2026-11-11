import assert from 'node:assert/strict';
import test from 'node:test';
import { findPlayerInteractionItem, PLAYER_INTERACTION_CATALOG, PLAYER_INTERACTION_CATALOG_STATUS, PLAYER_INTERACTION_COOLDOWN_MS } from './player-interactions.js';

test('interaction catalogue has unique draft items in separate gift and joke tabs', () => {
  const ids = PLAYER_INTERACTION_CATALOG.map(item => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(PLAYER_INTERACTION_CATALOG.some(item => item.kind === 'gift'));
  assert.ok(PLAYER_INTERACTION_CATALOG.some(item => item.kind === 'joke'));
  assert.ok(PLAYER_INTERACTION_CATALOG.every(item => Number.isSafeInteger(item.price) && item.price > 0 && item.icon && item.description && item.receivedText));
  assert.equal(PLAYER_INTERACTION_CATALOG_STATUS, 'draft');
  assert.equal(PLAYER_INTERACTION_COOLDOWN_MS, 30_000);
});

test('server catalogue lookup rejects unknown item ids', () => {
  assert.equal(findPlayerInteractionItem('tea')?.kind, 'gift');
  assert.equal(findPlayerInteractionItem('applause')?.kind, 'joke');
  assert.equal(findPlayerInteractionItem('client-invented-item'), undefined);
  assert.equal(findPlayerInteractionItem(123), undefined);
});
