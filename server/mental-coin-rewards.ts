import { calculateTeamScoreboard, type GameState } from '../shared/game.js';
import type { CoinCredit } from './account-store.js';

const SOLO_REWARDS: Record<1 | 2 | 3 | 4, number> = { 1: 1000, 2: 500, 3: 250, 4: 100 };

/** Builds server-authoritative awards only from a fully scored, completed round. */
export function buildRoundCoinCredits(state: GameState): CoinCredit[] {
  if ((state.status !== 'round-end' && state.status !== 'match-end') || state.scoredRound !== state.round || state.players.length !== 4) return [];
  const roundScores = state.roundScores.filter(entry => entry.round === state.round);
  if (roundScores.length !== state.players.length || state.players.some(player => !roundScores.some(entry => entry.playerId === player.id))) return [];

  if (state.settings.mode === 'pairs') {
    const teams = calculateTeamScoreboard(state.players, state.roundScores, state.round);
    if (teams.length !== 2) return [];
    return teams.flatMap(team => {
      const amount = team.roundRank === 1 ? 750 : 150;
      return team.playerIds.filter(playerId => !playerId.startsWith('bot-')).map(playerId => ({
        accountId: playerId,
        amount,
        idempotencyKey: `round-reward:${state.matchId}:${state.round}:${playerId}`,
        type: 'round_reward' as const,
        description: `${state.round}. el · ${team.roundRank}. takım ödülü`,
        gameId: state.matchId,
        round: state.round,
      }));
    });
  }

  const roundBadges = state.matchBadges.filter(badge => badge.round === state.round);
  if (roundBadges.length !== state.players.length) return [];
  return roundBadges.filter(badge => !badge.playerId.startsWith('bot-')).map(badge => ({
    accountId: badge.playerId,
    amount: SOLO_REWARDS[badge.place],
    idempotencyKey: `round-reward:${state.matchId}:${state.round}:${badge.playerId}`,
    type: 'round_reward' as const,
    description: `${state.round}. el · ${badge.place}. sıra ödülü`,
    gameId: state.matchId,
    round: state.round,
  }));
}
