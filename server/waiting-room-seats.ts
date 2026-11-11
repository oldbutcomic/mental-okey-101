import type { GameState } from '../shared/game.js';

export const WAITING_ROOM_SEAT_GRACE_MS = 60_000;

export type WaitingSeatReservation = {
  roomCode: string;
  playerId: string;
  seatToken: string;
};

type TimerScheduler<Handle> = {
  setTimeout(callback: () => void, delayMs: number): Handle;
  clearTimeout(handle: Handle): void;
};

type PendingTimer<Handle> = {
  reservation: WaitingSeatReservation;
  handle: Handle;
  expiresAt: number;
};

const defaultScheduler: TimerScheduler<ReturnType<typeof setTimeout>> = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: handle => globalThis.clearTimeout(handle),
};

/** A cancellable, token-fenced timer registry for disconnected waiting-room seats. */
export class WaitingRoomSeatTimers<Handle = ReturnType<typeof setTimeout>> {
  private readonly pending = new Map<string, PendingTimer<Handle>>();

  constructor(
    private readonly scheduler: TimerScheduler<Handle> = defaultScheduler as TimerScheduler<Handle>,
    private readonly now: () => number = Date.now,
  ) {}

  schedule(reservation: WaitingSeatReservation, onExpire: (reservation: WaitingSeatReservation) => void): void {
    const key = this.key(reservation.roomCode, reservation.playerId);
    this.cancel(reservation.roomCode, reservation.playerId);
    let entry: PendingTimer<Handle>;
    const handle = this.scheduler.setTimeout(() => {
      if (this.pending.get(key) !== entry) return;
      this.pending.delete(key);
      onExpire(reservation);
    }, WAITING_ROOM_SEAT_GRACE_MS);
    entry = { reservation, handle, expiresAt: this.now() + WAITING_ROOM_SEAT_GRACE_MS };
    this.pending.set(key, entry);
  }

  isExpired(roomCode: string, playerId: string): boolean {
    const entry = this.pending.get(this.key(roomCode, playerId));
    return !!entry && this.now() >= entry.expiresAt;
  }

  findByPlayerId(playerId: string): WaitingSeatReservation | undefined {
    for (const entry of this.pending.values()) {
      if (entry.reservation.playerId === playerId) return entry.reservation;
    }
    return undefined;
  }

  cancel(roomCode: string, playerId: string): void {
    const key = this.key(roomCode, playerId);
    const entry = this.pending.get(key);
    if (!entry) return;
    this.pending.delete(key);
    this.scheduler.clearTimeout(entry.handle);
  }

  cancelRoom(roomCode: string): void {
    for (const [key, entry] of this.pending) {
      if (entry.reservation.roomCode !== roomCode) continue;
      this.pending.delete(key);
      this.scheduler.clearTimeout(entry.handle);
    }
  }

  private key(roomCode: string, playerId: string): string {
    return `${roomCode}:${playerId}`;
  }
}

/** Releases only the same offline seat reservation while its room is still waiting. */
export function releaseExpiredWaitingSeat(
  rooms: Map<string, GameState>,
  seatTokens: Map<string, Map<string, string>>,
  reservation: WaitingSeatReservation,
): boolean {
  const state = rooms.get(reservation.roomCode);
  if (!state || state.status !== 'waiting') return false;
  const player = state.players.find(candidate => candidate.id === reservation.playerId);
  if (!player || player.online) return false;
  if (seatTokens.get(reservation.roomCode)?.get(reservation.playerId) !== reservation.seatToken) return false;

  const players = state.players.filter(candidate => candidate.id !== reservation.playerId);
  seatTokens.get(reservation.roomCode)?.delete(reservation.playerId);
  if (players.length === 0) {
    rooms.delete(reservation.roomCode);
    seatTokens.delete(reservation.roomCode);
  } else {
    // The existing room convention treats the first remaining player as owner.
    rooms.set(reservation.roomCode, { ...state, players });
  }
  return true;
}
