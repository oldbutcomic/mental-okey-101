import assert from 'node:assert/strict';
import test from 'node:test';
import { freshRoom, type Player } from '../shared/game.js';
import { syncRoomPlayerCoinBalances } from './coin-room-state.js';

function player(id: string, seat: number, mentalCoins?: number): Player {
  return { id, name: id, avatar: '🙂', online: true, seat, score: 0, opened: false, pairMode: false, mentalCoins };
}

test('account balance changes refresh matching seated players without touching other players or rooms', () => {
  const table = freshRoom({ rounds: 3, mode: 'solo', folding: false, assisted: true, tableColor: 'burgundy', turnDurationSeconds: 45 });
  table.players = [player('A', 0, 1000), player('B', 1, 1000), player('bot-C', 2), player('D', 3, 1000)];
  const rooms = new Map([['ROOM1', table]]);

  assert.deepEqual(syncRoomPlayerCoinBalances(rooms, [{ id: 'A', mentalCoins: 2000 }, { id: 'D', mentalCoins: 1250 }, { id: 'not-seated', mentalCoins: 3000 }]), ['ROOM1']);
  const updated = rooms.get('ROOM1')!;
  assert.deepEqual(updated.players.map(seated => [seated.id, seated.mentalCoins]), [['A', 2000], ['B', 1000], ['bot-C', undefined], ['D', 1250]]);
  assert.equal(table.players[0]?.mentalCoins, 1000, 'the previous room snapshot remains immutable');
  assert.deepEqual(syncRoomPlayerCoinBalances(rooms, [{ id: 'A', mentalCoins: 2000 }, { id: 'D', mentalCoins: 1250 }]), [], 'identical balances do not trigger another room update');
});
