import assert from 'node:assert/strict';
import test from 'node:test';
import type { TurnGuidancePreview } from '../shared/turn-guidance';
import { describeTurnGuidance, turnGuidanceReplyIsCurrent, turnGuidanceRequestKey, turnGuidanceWindow } from './turn-guidance.js';

const room = { status: 'playing' as const, matchId: 'm1', turnId: 't1', turnPlayerId: 'p0', phase: 'discard' as const, players: [{ id: 'p0', name: 'Ada', online: true }, { id: 'bot-1', name: 'Bot', online: true }] };
const preview = (overrides: Partial<TurnGuidancePreview> = {}): TurnGuidancePreview => ({
  ok: true, requestKey: 'key', matchId: 'm1', turnId: 't1', active: true, phase: 'discard', expired: false,
  canDrawStock: false, canTakeDiscard: false, canDiscard: true, canOpenSeries: false, canOpenPairs: false,
  canFinishFromHand: false, canLaySeries: false, canLayPairs: false, canProcessMeld: false,
  ...overrides,
});

test('istek anahtarı aynı el, tur ve aday düzeninde kararlı; grup/elde değişince farklı', () => {
  const base = { matchId: 'm1', turnId: 't1', phase: 'discard' as const, handTileIds: [3, 1, 2], opened: false, pairMode: false, serialThreshold: 101, pairThreshold: 5, roomRevision: 'r1', candidate: { seriesGroups: [[1, 2, 3]], pairGroups: [], elden: null } };
  assert.equal(turnGuidanceRequestKey(base), turnGuidanceRequestKey({ ...base, handTileIds: [1, 2, 3] }));
  assert.notEqual(turnGuidanceRequestKey(base), turnGuidanceRequestKey({ ...base, candidate: { ...base.candidate, seriesGroups: [] } }));
  assert.notEqual(turnGuidanceRequestKey(base), turnGuidanceRequestKey({ ...base, handTileIds: [1, 2, 4] }));
  assert.notEqual(turnGuidanceRequestKey(base), turnGuidanceRequestKey({ ...base, roomRevision: 'r2' }));
  const longHistoryKey = turnGuidanceRequestKey({ ...base, roomRevision: 'discard-and-meld-history/'.repeat(10_000) });
  assert.ok(longHistoryKey.length < 64, 'large room histories must not create oversized Socket.IO request keys');
  assert.notEqual(longHistoryKey, turnGuidanceRequestKey({ ...base, roomRevision: 'different long history'.repeat(10_000) }));
});

test('direktif yalnızca doğrulanmış seçenekleri gösterir ve kontrol sürerken eylem önermez', () => {
  const checking = describeTurnGuidance({ room, playerId: 'p0', connected: true, checking: true, failed: false, preview: null, urgent: false, expired: false });
  assert.equal(checking?.text, 'SIRA SENDE');
  const noOpening = describeTurnGuidance({ room, playerId: 'p0', connected: true, checking: false, failed: false, preview: preview(), urgent: false, expired: false });
  assert.equal(noOpening?.text, 'TAŞ AT');
  const opening = describeTurnGuidance({ room, playerId: 'p0', connected: true, checking: false, failed: false, preview: preview({ canOpenSeries: true, canOpenPairs: true, canFinishFromHand: true }), urgent: false, expired: false });
  assert.equal(opening?.text, 'PER AÇ · ÇİFT AÇ · ELDEN BİT · TAŞ AT');
});

test('taş alma, açtıktan sonraki indirme/işleme ve zaman uyarıları doğrulanmış aşamaya göre gösterilir', () => {
  const draw = describeTurnGuidance({ room: { ...room, phase: 'draw' }, playerId: 'p0', connected: true, checking: false, failed: false, preview: preview({ phase: 'draw', canDrawStock: true, canTakeDiscard: true }), urgent: false, expired: false });
  assert.equal(draw?.text, 'YERDEN TAŞ ÇEK veya SOLDAN TAŞ AL');
  const opened = describeTurnGuidance({ room, playerId: 'p0', connected: true, checking: false, failed: false, preview: preview({ canProcessMeld: true, canLayPairs: true }), urgent: true, expired: false });
  assert.equal(opened?.text, 'PER İŞLE · ÇİFT İNDİR · TAŞ AT');
  assert.equal(opened?.warning, 'SON 10 SANİYE · HAMLENİ TAMAMLA');
});

test('sıra bekleyen oyuncuda bot/devralma ve bağlantı durumu eski hamle direktifi göstermez', () => {
  const bot = describeTurnGuidance({ room: { ...room, turnPlayerId: 'bot-1' }, playerId: 'p0', connected: true, checking: false, failed: false, preview: null, urgent: false, expired: false });
  assert.equal(bot?.text, 'Bot OYNUYOR');
  const offline = describeTurnGuidance({ room: { ...room, players: room.players.map(player => player.id === 'bot-1' ? { ...player, id: 'p1', online: false } : player), turnPlayerId: 'p1' }, playerId: 'p0', connected: true, checking: false, failed: false, preview: null, urgent: false, expired: false });
  assert.equal(offline?.text, 'Bot OYUNCUSUNDA · BOT DEVİR ALIYOR');
  const disconnected = describeTurnGuidance({ room, playerId: 'p0', connected: false, checking: false, failed: false, preview: preview(), urgent: false, expired: false });
  assert.equal(disconnected?.text, 'SUNUCU BAĞLANTISI YOK');
});

test('geç veya farklı maç/turdan gelen önizleme cevabı reddedilir', () => {
  const response = preview();
  assert.equal(turnGuidanceReplyIsCurrent(response, 'key', room), true);
  assert.equal(turnGuidanceReplyIsCurrent(response, 'new-key', room), false);
  assert.equal(turnGuidanceReplyIsCurrent(response, 'key', { ...room, turnId: 't2' }), false);
  assert.equal(turnGuidanceReplyIsCurrent(response, 'key', { ...room, matchId: 'm2' }), false);
});

test('sunucu deadline değerine göre son 10 saniye ve süre sonu sınırı hesaplanır', () => {
  assert.deepEqual(turnGuidanceWindow(20_000, 9_999), { urgent: false, expired: false });
  assert.deepEqual(turnGuidanceWindow(20_000, 10_000), { urgent: true, expired: false });
  assert.deepEqual(turnGuidanceWindow(20_000, 20_000), { urgent: false, expired: true });
  const serverExpired = describeTurnGuidance({ room, playerId: 'p0', connected: true, checking: false, failed: false, preview: preview({ expired: true, active: false }), urgent: false, expired: false });
  assert.equal(serverExpired?.text, 'SÜRE DOLDU · OTOMATİK HAMLE BEKLENİYOR');
});
