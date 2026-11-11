import type { GameState } from '../shared/game.js';

export type AccountCoinBalance = { id: string; mentalCoins: number };

/** Copies authoritative account balances into any in-memory room containing those players. */
export function syncRoomPlayerCoinBalances(rooms: Map<string, GameState>, accounts: readonly AccountCoinBalance[]): string[] {
  const balances = new Map(accounts.map(account => [account.id, account.mentalCoins]));
  const changedRooms: string[] = [];

  for (const [code, room] of rooms) {
    let changed = false;
    const players = room.players.map(player => {
      const balance = balances.get(player.id);
      if (balance === undefined || player.mentalCoins === balance) return player;
      changed = true;
      return { ...player, mentalCoins: balance };
    });
    if (!changed) continue;
    rooms.set(code, { ...room, players });
    changedRooms.push(code);
  }

  return changedRooms;
}
