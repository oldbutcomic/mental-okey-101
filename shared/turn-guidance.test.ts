import assert from 'node:assert/strict';
import test from 'node:test';
import { freshRoom, type GameState, type TableSettings, type Tile } from './game.js';
import { createTurnGuidancePreview, isTurnGuidanceCandidate, type TurnGuidanceCandidate } from './turn-guidance.js';

const settings: TableSettings = { rounds: 3, mode: 'solo', folding: false, assisted: true, tableColor: 'wood', turnDurationSeconds: 45 };
const ids = ['p0', 'p1', 'p2', 'p3'];
const makeTile = (id: number, color: Tile['color'], number: number): Tile => ({ id, color, number, fakeJoker: false });

function playingState(hand: Tile[], overrides: Partial<GameState> = {}, now = 1_000_000): GameState {
  const base = freshRoom(settings, 'guidance-match');
  const players = ids.map((id, seat) => ({ id, name: id.toUpperCase(), avatar: 'O', online: true, seat, score: 0, opened: false, pairMode: false }));
  return {
    ...base,
    status: 'playing',
    players,
    hands: Object.fromEntries(ids.map(id => [id, id === 'p0' ? hand : []])),
    stock: [makeTile(900, 'yellow', 12)],
    discard: [],
    throwsByPlayer: Object.fromEntries(ids.map(id => [id, []])),
    indicator: makeTile(901, 'yellow', 12),
    joker: { color: 'yellow', number: 13 },
    turnPlayerId: 'p0',
    phase: 'draw',
    turnStartedAt: now - 1000,
    turnDeadlineAt: now + 44_000,
    turnId: 'guidance-turn',
    ...overrides,
  };
}

function seriesHand(points = 103): { hand: Tile[]; groups: number[][]; finalTileId: number } {
  const run = Array.from({ length: 13 }, (_, index) => makeTile(index + 1, 'red', index + 1));
  const setNumber = points === 100 ? 3 : 4;
  const set = [makeTile(14, 'blue', setNumber), makeTile(15, 'yellow', setNumber), makeTile(16, 'black', setNumber)];
  const finalTile = makeTile(17, 'blue', 1);
  return { hand: [...run, ...set, finalTile], groups: [run.map(tile => tile.id), set.map(tile => tile.id)], finalTileId: finalTile.id };
}

function pairHand(): { hand: Tile[]; groups: number[][] } {
  const faces: Array<[Tile['color'], number]> = [['red', 5], ['blue', 6], ['yellow', 7], ['black', 8], ['red', 9]];
  const hand: Tile[] = [];
  const groups = faces.map(([color, number], index) => {
    const pair = [makeTile(100 + index * 2, color, number), makeTile(101 + index * 2, color, number)];
    hand.push(...pair);
    return pair.map(tile => tile.id);
  });
  hand.push(makeTile(120, 'blue', 10));
  return { hand, groups };
}

const emptyCandidate: TurnGuidanceCandidate = { seriesGroups: [], pairGroups: [], elden: null };

test('taş alma aşamasında yalnızca sunucunun doğruladığı çekme seçenekleri açılır', () => {
  const state = playingState([makeTile(1, 'red', 1)]);
  const preview = createTurnGuidancePreview(state, 'p0', 'draw-key', emptyCandidate, 1_000_000);
  assert.equal(preview.canDrawStock, true);
  assert.equal(preview.canTakeDiscard, false);
  assert.equal(preview.canOpenSeries, false);
  assert.equal(preview.canDiscard, false);
});

test('seri açma direktifi gerçek sunucu eşiğine göre doğrulanır ve önizleme durumu değiştirmez', () => {
  const valid = seriesHand(103);
  const state = playingState(valid.hand, { phase: 'discard' });
  const before = structuredClone(state);
  const yes = createTurnGuidancePreview(state, 'p0', 'series-key', { ...emptyCandidate, seriesGroups: valid.groups }, 1_000_000);
  assert.equal(yes.canOpenSeries, true);
  assert.equal(yes.canDiscard, true);
  assert.deepEqual(state, before);

  const underThreshold = seriesHand(100);
  const no = createTurnGuidancePreview(playingState(underThreshold.hand, { phase: 'discard' }), 'p0', 'short-key', { ...emptyCandidate, seriesGroups: underThreshold.groups }, 1_000_000);
  assert.equal(no.canOpenSeries, false);
});

test('çift açma direktifi beş geçerli çift olmadan verilmez', () => {
  const valid = pairHand();
  const state = playingState(valid.hand, { phase: 'discard' });
  const yes = createTurnGuidancePreview(state, 'p0', 'pairs-key', { ...emptyCandidate, pairGroups: valid.groups }, 1_000_000);
  assert.equal(yes.canOpenPairs, true);
  const fourPairs = createTurnGuidancePreview(state, 'p0', 'four-key', { ...emptyCandidate, pairGroups: valid.groups.slice(0, 4) }, 1_000_000);
  assert.equal(fourPairs.canOpenPairs, false);
});

test('elden bitiş yalnızca bütün el geçerli gruplar ve tek son taşla doğrulanınca görünür', () => {
  const valid = seriesHand(103);
  const candidate = { groups: valid.groups, pairMode: false, finalTileId: valid.finalTileId };
  const state = playingState(valid.hand, { phase: 'discard' });
  assert.equal(createTurnGuidancePreview(state, 'p0', 'finish-key', { ...emptyCandidate, elden: candidate }, 1_000_000).canFinishFromHand, true);
  assert.equal(createTurnGuidancePreview(state, 'p0', 'bad-finish', { ...emptyCandidate, elden: { ...candidate, groups: [valid.groups[0]] } }, 1_000_000).canFinishFromHand, false);
});

test('açmış çift oyuncusuna seri indirme direktifi verilmez; açık seri taş işleme sunucu hedeflerinden doğrulanır', () => {
  const candidateRun = [makeTile(30, 'red', 7), makeTile(31, 'red', 8), makeTile(32, 'red', 9)];
  const hand = [...candidateRun, makeTile(33, 'black', 2)];
  const openedPlayers = ids.map((id, seat) => ({ id, name: id, avatar: 'O', online: true, seat, score: 0, opened: id === 'p0', pairMode: id === 'p0' }));
  const pairState = playingState(hand, {
    phase: 'discard',
    players: openedPlayers,
  });
  const pairPreview = createTurnGuidancePreview(pairState, 'p0', 'pair-player', { ...emptyCandidate, seriesGroups: [candidateRun.map(tile => tile.id)] }, 1_000_000);
  assert.equal(pairPreview.canLaySeries, false);

  const openedRun = [makeTile(40, 'red', 4), makeTile(41, 'red', 5), makeTile(42, 'red', 6)];
  const addableHand = [makeTile(43, 'red', 3), makeTile(44, 'black', 10)];
  const seriesPlayers = ids.map((id, seat) => ({ id, name: id, avatar: 'O', online: true, seat, score: 0, opened: id === 'p0', pairMode: false }));
  const meldState = playingState(addableHand, {
    phase: 'discard',
    players: seriesPlayers,
    melds: [{ id: 'open-run', ownerId: 'p1', tileIds: openedRun.map(tile => tile.id), tiles: openedRun, kind: 'run', realOkeyAssignments: {} }],
  });
  const meldPreview = createTurnGuidancePreview(meldState, 'p0', 'process-key', emptyCandidate, 1_000_000);
  assert.equal(meldPreview.canProcessMeld, true);
});

test('açılış veya işleme tamamlandıktan sonra geçerli başka eylem yoksa taş atma doğrulanmaya devam eder', () => {
  const hand = [makeTile(45, 'black', 10)];
  const openedPlayers = ids.map((id, seat) => ({ id, name: id, avatar: 'O', online: true, seat, score: 0, opened: id === 'p0', pairMode: false }));
  const state = playingState(hand, { phase: 'discard', players: openedPlayers });
  const preview = createTurnGuidancePreview(state, 'p0', 'after-open-key', emptyCandidate, 1_000_000);
  assert.equal(preview.canProcessMeld, false);
  assert.equal(preview.canLaySeries, false);
  assert.equal(preview.canLayPairs, false);
  assert.equal(preview.canDiscard, true);
});

test('yanlış sıra, süresi dolmuş tur ve bozuk aday grupları hiçbir eylem göstermez', () => {
  const state = playingState([makeTile(1, 'red', 1)]);
  const wrongTurn = createTurnGuidancePreview(state, 'p1', 'wrong-turn', emptyCandidate, 1_000_000);
  assert.equal(wrongTurn.active, false);
  assert.equal(wrongTurn.canDrawStock, false);
  const expired = createTurnGuidancePreview({ ...state, phase: 'discard' }, 'p0', 'expired', emptyCandidate, state.turnDeadlineAt!);
  assert.equal(expired.expired, true);
  assert.equal(expired.canDiscard, false);
  assert.equal(isTurnGuidanceCandidate({ seriesGroups: [[]], pairGroups: [], elden: null }), false);
});
