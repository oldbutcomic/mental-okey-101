import assert from 'node:assert/strict';
import test from 'node:test';
import { freshRoom, type GameState, type Player } from '../shared/game.js';
import { releaseExpiredWaitingSeat, WAITING_ROOM_SEAT_GRACE_MS, WaitingRoomSeatTimers } from './waiting-room-seats.js';

class FakeTimers {
  private nextId = 0;
  private now = 0;
  private readonly tasks = new Map<number, { at: number; callback: () => void; cleared: boolean }>();

  readonly scheduler = {
    setTimeout: (callback: () => void, delayMs: number) => {
      const id = ++this.nextId;
      this.tasks.set(id, { at: this.now + delayMs, callback, cleared: false });
      return id;
    },
    clearTimeout: (id: number) => {
      const task = this.tasks.get(id);
      if (task) task.cleared = true;
    },
  };

  advance(ms: number): void {
    this.now += ms;
    for (const [id, task] of [...this.tasks].sort((left, right) => left[1].at - right[1].at)) {
      if (task.cleared || task.at > this.now) continue;
      this.tasks.delete(id);
      task.callback();
    }
  }

  elapseWithoutFiringTimers(ms: number): void {
    this.now += ms;
  }

  fireEvenIfCleared(id: number): void {
    const task = this.tasks.get(id);
    task?.callback();
  }

  get scheduledIds(): number[] {
    return [...this.tasks.keys()];
  }

  get currentTime(): number {
    return this.now;
  }
}

const settings = { rounds: 3, mode: 'solo', folding: false, assisted: true, tableColor: 'wood', turnDurationSeconds: 45 } as const;
function player(id: string, seat: number, online: boolean): Player {
  return { id, name: id, avatar: '', online, seat, score: 0, opened: false, pairMode: false };
}
function waitingRoom(players: Player[]): GameState {
  return { ...freshRoom(settings), players };
}

test('bekleme koltuğu 60 saniye korunur ve süre dolunca boşaltılır', () => {
  const fake = new FakeTimers();
  const timers = new WaitingRoomSeatTimers(fake.scheduler, () => fake.currentTime);
  const reservation = { roomCode: 'ABC123', playerId: 'guest', seatToken: 'token-a' };
  const state = waitingRoom([player('guest', 2, false)]);
  const rooms = new Map([[reservation.roomCode, state]]);
  const seatTokens = new Map([[reservation.roomCode, new Map([[reservation.playerId, reservation.seatToken]])]]);
  let released = 0;

  timers.schedule(reservation, value => {
    if (releaseExpiredWaitingSeat(rooms, seatTokens, value)) released++;
  });
  assert.deepEqual(fake.scheduledIds, [1]);
  assert.equal(released, 0);
  assert.equal(rooms.get(reservation.roomCode)?.players.length, 1);
  fake.advance(WAITING_ROOM_SEAT_GRACE_MS - 1);
  assert.equal(released, 0);
  fake.advance(1);
  assert.equal(released, 1);
  assert.equal(rooms.has(reservation.roomCode), false);
  assert.equal(seatTokens.has(reservation.roomCode), false);
});

test('süre dolunca yalnızca kopan oyuncu çıkar ve bekleme odasında yer açılır', () => {
  const fake = new FakeTimers();
  const timers = new WaitingRoomSeatTimers(fake.scheduler, () => fake.currentTime);
  const reservation = { roomCode: 'ROOM42', playerId: 'guest', seatToken: 'guest-token' };
  const state = waitingRoom([player('owner', 0, true), player('guest', 1, false)]);
  const rooms = new Map([[reservation.roomCode, state]]);
  const seatTokens = new Map([[reservation.roomCode, new Map([['owner', 'owner-token'], ['guest', reservation.seatToken]])]]);
  timers.schedule(reservation, value => releaseExpiredWaitingSeat(rooms, seatTokens, value));

  fake.advance(WAITING_ROOM_SEAT_GRACE_MS);
  const remaining = rooms.get(reservation.roomCode);
  assert.deepEqual(remaining?.players.map(candidate => [candidate.id, candidate.seat]), [['owner', 0]]);
  assert.deepEqual([...seatTokens.get(reservation.roomCode)!.keys()], ['owner']);
});

test('aynı oyuncu süresi dolmadan dönerse timer iptal edilir ve koltuk korunur', () => {
  const fake = new FakeTimers();
  const timers = new WaitingRoomSeatTimers(fake.scheduler, () => fake.currentTime);
  const reservation = { roomCode: 'ABC123', playerId: 'guest', seatToken: 'token-a' };
  const state = waitingRoom([player('guest', 1, false)]);
  const rooms = new Map([[reservation.roomCode, state]]);
  const seatTokens = new Map([[reservation.roomCode, new Map([[reservation.playerId, reservation.seatToken]])]]);
  let released = 0;

  timers.schedule(reservation, value => {
    if (releaseExpiredWaitingSeat(rooms, seatTokens, value)) released++;
  });
  state.players[0]!.online = true;
  timers.cancel(reservation.roomCode, reservation.playerId);
  fake.advance(WAITING_ROOM_SEAT_GRACE_MS);
  assert.equal(released, 0);
  assert.equal(rooms.get(reservation.roomCode)?.players[0]?.seat, 1);
  assert.equal(seatTokens.get(reservation.roomCode)?.get(reservation.playerId), reservation.seatToken);
});

test('eski timer yeni oturumu boşaltamaz; token ve bekleme durumu doğrulanır', () => {
  const fake = new FakeTimers();
  const timers = new WaitingRoomSeatTimers(fake.scheduler);
  const oldReservation = { roomCode: 'ABC123', playerId: 'guest', seatToken: 'old-token' };
  const newReservation = { ...oldReservation, seatToken: 'new-token' };
  const state = waitingRoom([player('guest', 3, false)]);
  const rooms = new Map([[oldReservation.roomCode, state]]);
  const seatTokens = new Map([[oldReservation.roomCode, new Map([[oldReservation.playerId, newReservation.seatToken]])]]);
  let expired = 0;
  timers.schedule(oldReservation, value => {
    if (releaseExpiredWaitingSeat(rooms, seatTokens, value)) expired++;
  });
  const oldTimerId = fake.scheduledIds[0]!;
  timers.schedule(newReservation, value => {
    if (releaseExpiredWaitingSeat(rooms, seatTokens, value)) expired++;
  });
  const newTimerId = fake.scheduledIds.at(-1)!;

  fake.fireEvenIfCleared(oldTimerId);
  assert.equal(expired, 0);
  assert.equal(rooms.get(oldReservation.roomCode)?.players[0]?.seat, 3);
  state.status = 'playing';
  fake.fireEvenIfCleared(newTimerId);
  assert.equal(expired, 0, 'a started match is never subject to waiting-room seat eviction');
  assert.equal(rooms.get(oldReservation.roomCode)?.players[0]?.seat, 3);
});

test('timer eski tokenla veya çevrimiçi oyuncuyu boşaltamaz', () => {
  const reservation = { roomCode: 'ABC123', playerId: 'guest', seatToken: 'old-token' };
  const state = waitingRoom([player('guest', 0, true)]);
  const rooms = new Map([[reservation.roomCode, state]]);
  const seatTokens = new Map([[reservation.roomCode, new Map([[reservation.playerId, 'rotated-token']])]]);
  assert.equal(releaseExpiredWaitingSeat(rooms, seatTokens, reservation), false);
  assert.equal(rooms.get(reservation.roomCode)?.players[0]?.online, true);
  assert.equal(releaseExpiredWaitingSeat(rooms, seatTokens, { ...reservation, seatToken: 'rotated-token' }), false);
  assert.equal(rooms.get(reservation.roomCode)?.players[0]?.id, 'guest');
});

test('event loop gecikse bile 60 saniye geçmiş tokenla koltuk geri alınamaz', () => {
  const fake = new FakeTimers();
  const timers = new WaitingRoomSeatTimers(fake.scheduler, () => fake.currentTime);
  const reservation = { roomCode: 'DELAY1', playerId: 'guest', seatToken: 'token-a' };
  const rooms = new Map([[reservation.roomCode, waitingRoom([player('guest', 2, false)])]]);
  const seatTokens = new Map([[reservation.roomCode, new Map([[reservation.playerId, reservation.seatToken]])]]);
  let expired = 0;
  timers.schedule(reservation, value => {
    if (releaseExpiredWaitingSeat(rooms, seatTokens, value)) expired++;
  });
  const oldTimerId = fake.scheduledIds[0]!;

  fake.elapseWithoutFiringTimers(WAITING_ROOM_SEAT_GRACE_MS);
  assert.equal(timers.isExpired(reservation.roomCode, reservation.playerId), true);
  timers.cancel(reservation.roomCode, reservation.playerId);
  assert.equal(releaseExpiredWaitingSeat(rooms, seatTokens, reservation), true);
  fake.fireEvenIfCleared(oldTimerId);
  assert.equal(expired, 0, 'the delayed timer cannot repeat the seat release');
  assert.equal(rooms.has(reservation.roomCode), false);
  assert.equal(seatTokens.has(reservation.roomCode), false);
});
