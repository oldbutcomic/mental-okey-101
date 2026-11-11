import {
  addToMeld,
  availableMeldProcessingTargets,
  discardTile,
  drawStock,
  finishFromHand,
  layNewPairMelds,
  layNewSeriesMelds,
  openMelds,
  openSeriesMelds,
  reclaimRealOkey,
  takeDiscard,
  type GameState,
} from './game.js';

export type TurnGuidanceCandidate = {
  seriesGroups: number[][];
  pairGroups: number[][];
  elden: { groups: number[][]; pairMode: boolean; finalTileId: number } | null;
};

export type TurnGuidancePreview = {
  ok: boolean;
  requestKey: string;
  matchId: string;
  turnId: string;
  active: boolean;
  phase: 'draw' | 'discard';
  expired: boolean;
  canDrawStock: boolean;
  canTakeDiscard: boolean;
  canDiscard: boolean;
  canOpenSeries: boolean;
  canOpenPairs: boolean;
  canFinishFromHand: boolean;
  canLaySeries: boolean;
  canLayPairs: boolean;
  canProcessMeld: boolean;
};

export type TurnGuidanceRequest = {
  code: string;
  playerId: string;
  matchId: string;
  turnId: string;
  requestKey: string;
  candidate: TurnGuidanceCandidate;
};

function safely<T>(run: () => T, accepts: (result: T) => boolean = () => true): boolean {
  try {
    return accepts(run());
  } catch {
    return false;
  }
}

function validCandidateGroups(groups: unknown): groups is number[][] {
  if (!Array.isArray(groups) || groups.length > 22) return false;
  let total = 0;
  for (const group of groups) {
    if (!Array.isArray(group) || group.length === 0 || group.length > 22) return false;
    total += group.length;
    if (total > 22 || group.some(id => !Number.isSafeInteger(id))) return false;
  }
  return true;
}

export function isTurnGuidanceCandidate(value: unknown): value is TurnGuidanceCandidate {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (!validCandidateGroups(candidate.seriesGroups) || !validCandidateGroups(candidate.pairGroups)) return false;
  if (candidate.elden === null) return true;
  if (!candidate.elden || typeof candidate.elden !== 'object') return false;
  const elden = candidate.elden as Record<string, unknown>;
  return validCandidateGroups(elden.groups)
    && typeof elden.pairMode === 'boolean'
    && Number.isSafeInteger(elden.finalTileId);
}

export function createTurnGuidancePreview(
  state: GameState,
  playerId: string,
  requestKey: string,
  candidate: TurnGuidanceCandidate,
  now = Date.now(),
): TurnGuidancePreview {
  const turnId = state.turnId || '';
  const expired = state.turnDeadlineAt !== null && now >= state.turnDeadlineAt;
  const active = state.status === 'playing'
    && !!turnId
    && state.turnPlayerId === playerId
    && !expired;
  const result: TurnGuidancePreview = {
    ok: true,
    requestKey,
    matchId: state.matchId,
    turnId,
    active,
    phase: state.phase,
    expired,
    canDrawStock: false,
    canTakeDiscard: false,
    canDiscard: false,
    canOpenSeries: false,
    canOpenPairs: false,
    canFinishFromHand: false,
    canLaySeries: false,
    canLayPairs: false,
    canProcessMeld: false,
  };
  if (!active) return result;

  if (state.phase === 'draw') {
    result.canDrawStock = safely(() => drawStock(state, playerId), next => next.status === 'playing');
    result.canTakeDiscard = safely(() => takeDiscard(state, playerId), next => next.status === 'playing');
    return result;
  }

  const hand = state.hands[playerId] || [];
  result.canDiscard = hand.some(tile => safely(() => discardTile(state, playerId, tile.id)));
  const player = state.players.find(entry => entry.id === playerId);
  if (!player?.opened) {
    if (candidate.seriesGroups.length) {
      result.canOpenSeries = safely(() => openSeriesMelds(state, playerId, candidate.seriesGroups));
    }
    if (candidate.pairGroups.length) {
      result.canOpenPairs = safely(() => openMelds(state, playerId, candidate.pairGroups, true));
    }
    if (candidate.elden) {
      const elden = candidate.elden;
      result.canFinishFromHand = safely(() => finishFromHand(
        state,
        playerId,
        elden.groups,
        elden.finalTileId,
        elden.pairMode,
        `guidance-${state.matchId}-${state.turnId}`,
        now,
      ), next => next.status === 'round-end' || next.status === 'match-end');
    }
    return result;
  }

  if (candidate.seriesGroups.length) {
    result.canLaySeries = safely(() => layNewSeriesMelds(state, playerId, candidate.seriesGroups, turnId));
  }
  if (candidate.pairGroups.length) {
    result.canLayPairs = safely(() => layNewPairMelds(state, playerId, candidate.pairGroups, turnId));
  }
  result.canProcessMeld = availableMeldProcessingTargets(state, playerId, now).some(target => safely(() => {
    if (target.target === 'reclaim-okey') {
      if (target.realOkeyTileId === undefined) return false;
      return reclaimRealOkey(state, playerId, target.meldId, target.realOkeyTileId, target.tileId, turnId);
    }
    return addToMeld(state, playerId, target.tileId, target.meldId, target.target, turnId);
  }));
  return result;
}
