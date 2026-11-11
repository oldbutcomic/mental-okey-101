import assert from 'node:assert/strict';
import test from 'node:test';
import { freshRoom, recordRoundBadges, type GameState, type Player, type RoundScore } from '../shared/game.js';
import { buildRoundCoinCredits } from './mental-coin-rewards.js';

function finishedState(mode: 'solo' | 'pairs', roundScores: RoundScore[], places?: Array<1 | 2 | 3 | 4>): GameState {
  const players: Player[] = ['A', 'B', 'C', 'D'].map((id, seat) => ({
    id, name: id, avatar: '🙂', online: true, seat, score: roundScores[seat]?.total ?? roundScores[seat]?.points ?? 0, opened: true, pairMode: false,
  }));
  const state = freshRoom({ rounds: 3, mode, folding: false, assisted: true, tableColor: 'burgundy', turnDurationSeconds: 45 }, 'match-coins-test');
  state.status = 'round-end';
  state.round = 1;
  state.scoredRound = 1;
  state.players = players;
  state.roundScores = roundScores;
  if (places) state.matchBadges = players.map((player, index) => ({ round: 1, playerId: player.id, place: places[index] }));
  return state;
}

function finishedMixedState(mode: 'solo' | 'pairs', results: Array<{ id: string; seat: number; points: number }>): GameState {
  const state = freshRoom({ rounds: 3, mode, folding: false, assisted: true, tableColor: 'burgundy', turnDurationSeconds: 45 }, 'match-mixed-coins-test');
  state.status = 'round-end';
  state.round = 1;
  state.scoredRound = 1;
  state.players = results.map(({ id, seat, points }) => ({
    id, name: id, avatar: '🙂', online: !id.startsWith('bot-'), seat, score: points, opened: true, pairMode: false,
  }));
  state.roundScoreStart = Object.fromEntries(results.map(({ id }) => [id, 0]));
  return recordRoundBadges(state);
}

test('solo round awards use the finalized per-round badge placements', () => {
  const state = finishedState('solo', [
    { round: 1, playerId: 'A', points: -101, total: -101 },
    { round: 1, playerId: 'B', points: 25, total: 25 },
    { round: 1, playerId: 'C', points: 80, total: 80 },
    { round: 1, playerId: 'D', points: 202, total: 202 },
  ], [1, 2, 3, 4]);
  const credits = buildRoundCoinCredits(state);
  assert.deepEqual(credits.map(credit => [credit.accountId, credit.amount]), [['A', 1000], ['B', 500], ['C', 250], ['D', 100]]);
  assert.ok(credits.every(credit => credit.gameId === state.matchId && credit.round === state.round));
  assert.equal(new Set(credits.map(credit => credit.idempotencyKey)).size, 4);
});

test('pairs round pays each winner 750 and each losing-team member 150 from team round totals', () => {
  const state = finishedState('pairs', [
    { round: 1, playerId: 'A', points: 10, total: 10 },
    { round: 1, playerId: 'B', points: 15, total: 15 },
    { round: 1, playerId: 'C', points: 20, total: 20 },
    { round: 1, playerId: 'D', points: 30, total: 30 },
  ]);
  const credits = buildRoundCoinCredits(state);
  assert.deepEqual(credits.map(credit => [credit.accountId, credit.amount]), [['A', 750], ['C', 750], ['B', 150], ['D', 150]]);
});

test('mixed solo round: bot first and real player second awards the real player 500 MC', () => {
  const state = finishedMixedState('solo', [
    { id: 'bot-ROOM-0', seat: 0, points: -30 },
    { id: 'human-second', seat: 1, points: 10 },
    { id: 'bot-ROOM-2', seat: 2, points: 30 },
    { id: 'bot-ROOM-3', seat: 3, points: 60 },
  ]);

  assert.deepEqual(state.matchBadges.map(badge => [badge.playerId, badge.place]), [
    ['bot-ROOM-0', 1], ['human-second', 2], ['bot-ROOM-2', 3], ['bot-ROOM-3', 4],
  ]);
  assert.deepEqual(buildRoundCoinCredits(state).map(credit => [credit.accountId, credit.amount]), [['human-second', 500]]);
});

test('mixed solo round: real player first and bot second awards the real player 1000 MC', () => {
  const state = finishedMixedState('solo', [
    { id: 'human-first', seat: 0, points: -40 },
    { id: 'bot-ROOM-1', seat: 1, points: -10 },
    { id: 'human-third', seat: 2, points: 20 },
    { id: 'bot-ROOM-3', seat: 3, points: 50 },
  ]);

  assert.deepEqual(state.matchBadges.map(badge => [badge.playerId, badge.place]), [
    ['human-first', 1], ['bot-ROOM-1', 2], ['human-third', 3], ['bot-ROOM-3', 4],
  ]);
  assert.deepEqual(buildRoundCoinCredits(state).map(credit => [credit.accountId, credit.amount]), [
    ['human-first', 1000], ['human-third', 250],
  ]);
});

test('mixed solo round: bots in first and second do not shift real players from third and fourth rewards', () => {
  const state = finishedMixedState('solo', [
    { id: 'bot-ROOM-0', seat: 0, points: -50 },
    { id: 'bot-ROOM-1', seat: 1, points: -20 },
    { id: 'human-third', seat: 2, points: 10 },
    { id: 'human-fourth', seat: 3, points: 40 },
  ]);

  assert.deepEqual(state.matchBadges.map(badge => [badge.playerId, badge.place]), [
    ['bot-ROOM-0', 1], ['bot-ROOM-1', 2], ['human-third', 3], ['human-fourth', 4],
  ]);
  assert.deepEqual(buildRoundCoinCredits(state).map(credit => [credit.accountId, credit.amount]), [
    ['human-third', 250], ['human-fourth', 100],
  ]);
});

test('mixed pairs round: real player with a bot on the winning team receives 750 MC', () => {
  const state = finishedMixedState('pairs', [
    { id: 'human-winner', seat: 0, points: 5 },
    { id: 'bot-ROOM-1', seat: 1, points: 25 },
    { id: 'bot-ROOM-2', seat: 2, points: 5 },
    { id: 'bot-ROOM-3', seat: 3, points: 25 },
  ]);

  assert.deepEqual(buildRoundCoinCredits(state).map(credit => [credit.accountId, credit.amount]), [['human-winner', 750]]);
});

test('mixed pairs round: real player with a bot on the losing team receives 150 MC', () => {
  const state = finishedMixedState('pairs', [
    { id: 'bot-ROOM-0', seat: 0, points: 5 },
    { id: 'human-loser', seat: 1, points: 30 },
    { id: 'bot-ROOM-2', seat: 2, points: 5 },
    { id: 'bot-ROOM-3', seat: 3, points: 20 },
  ]);

  assert.deepEqual(buildRoundCoinCredits(state).map(credit => [credit.accountId, credit.amount]), [['human-loser', 150]]);
});

test('mixed solo tie for first keeps the existing shared-place rule and pays the real player first-place MC', () => {
  const state = finishedMixedState('solo', [
    { id: 'bot-ROOM-0', seat: 0, points: -20 },
    { id: 'human-tied-first', seat: 1, points: -20 },
    { id: 'bot-ROOM-2', seat: 2, points: 10 },
    { id: 'human-fourth', seat: 3, points: 40 },
  ]);

  assert.deepEqual(state.matchBadges.map(badge => [badge.playerId, badge.place]), [
    ['bot-ROOM-0', 1], ['human-tied-first', 1], ['bot-ROOM-2', 3], ['human-fourth', 4],
  ]);
  assert.deepEqual(buildRoundCoinCredits(state).map(credit => [credit.accountId, credit.amount]), [
    ['human-tied-first', 1000], ['human-fourth', 100],
  ]);
});

test('excluding bot credits does not change the four-player ranking or reassign bot rewards', () => {
  const state = finishedMixedState('solo', [
    { id: 'bot-ROOM-0', seat: 0, points: -40 },
    { id: 'human-second', seat: 1, points: 0 },
    { id: 'bot-ROOM-2', seat: 2, points: 20 },
    { id: 'human-fourth', seat: 3, points: 50 },
  ]);
  const credits = buildRoundCoinCredits(state);

  assert.equal(state.matchBadges.length, 4, 'bots remain in the completed round standings');
  assert.deepEqual(state.matchBadges.map(badge => badge.place), [1, 2, 3, 4]);
  assert.ok(credits.every(credit => !credit.accountId.startsWith('bot-')));
  assert.deepEqual(credits.map(credit => [credit.accountId, credit.amount]), [['human-second', 500], ['human-fourth', 100]]);
});

test('unfinished or incompletely scored rounds do not create coin awards', () => {
  const playing = finishedState('solo', [
    { round: 1, playerId: 'A', points: 1, total: 1 }, { round: 1, playerId: 'B', points: 2, total: 2 },
    { round: 1, playerId: 'C', points: 3, total: 3 }, { round: 1, playerId: 'D', points: 4, total: 4 },
  ], [1, 2, 3, 4]);
  playing.status = 'playing';
  assert.deepEqual(buildRoundCoinCredits(playing), []);
  const incomplete = finishedState('solo', [{ round: 1, playerId: 'A', points: 1, total: 1 }], [1, 2, 3, 4]);
  assert.deepEqual(buildRoundCoinCredits(incomplete), []);
});
