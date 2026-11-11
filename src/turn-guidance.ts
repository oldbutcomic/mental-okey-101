import type { TurnGuidanceCandidate, TurnGuidancePreview } from '../shared/turn-guidance';

type GuidancePlayer = { id: string; name: string; online: boolean };
type GuidanceRoom = {
  status: 'waiting' | 'playing' | 'round-end' | 'match-end';
  matchId: string;
  turnId: string | null;
  turnPlayerId: string | null;
  phase: 'draw' | 'discard';
  players: GuidancePlayer[];
};

export type GuidanceRequestKeyInput = {
  matchId: string;
  turnId: string | null;
  phase: 'draw' | 'discard';
  handTileIds: number[];
  opened: boolean;
  pairMode: boolean;
  serialThreshold: number;
  pairThreshold: number;
  roomRevision: string;
  candidate: TurnGuidanceCandidate;
};

export function turnGuidanceRequestKey(input: GuidanceRequestKeyInput): string {
  const canonical = JSON.stringify([
    input.matchId,
    input.turnId,
    input.phase,
    [...input.handTileIds].sort((a, b) => a - b),
    input.opened,
    input.pairMode,
    input.serialThreshold,
    input.pairThreshold,
    input.roomRevision,
    input.candidate.seriesGroups,
    input.candidate.pairGroups,
    input.candidate.elden,
  ]);
  // This key only correlates a preview response with the exact client snapshot;
  // the server still validates every candidate against authoritative game state.
  // Hashing keeps the Socket.IO field bounded even when discard/meld history grows.
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  const primes = [0x01000193, 0x27d4eb2d, 0x165667b1, 0x9e3779b1];
  const hashes = [...seeds];
  for (let index = 0; index < canonical.length; index += 1) {
    const code = canonical.charCodeAt(index);
    for (let lane = 0; lane < hashes.length; lane += 1) {
      const mixed = code ^ Math.imul(index + 1, lane + 1);
      hashes[lane] = Math.imul(hashes[lane] ^ mixed, primes[lane]) >>> 0;
    }
  }
  return `tg1-${hashes.map(hash => hash.toString(16).padStart(8, '0')).join('')}`;
}

export function turnGuidanceReplyIsCurrent(
  reply: Pick<TurnGuidancePreview, 'ok' | 'requestKey' | 'matchId' | 'turnId'>,
  latestRequestKey: string,
  room: Pick<GuidanceRoom, 'matchId' | 'turnId'> | null,
): boolean {
  return reply.ok
    && !!room
    && reply.requestKey === latestRequestKey
    && reply.matchId === room.matchId
    && reply.turnId === room.turnId;
}

export function turnGuidanceWindow(deadlineAt: number, serverNow: number): { urgent: boolean; expired: boolean } {
  const remaining = deadlineAt - serverNow;
  return { urgent: remaining > 0 && remaining <= 10_000, expired: remaining <= 0 };
}

export function describeTurnGuidance(input: {
  room: GuidanceRoom | null;
  playerId: string;
  connected: boolean;
  checking: boolean;
  failed: boolean;
  preview: TurnGuidancePreview | null;
  urgent: boolean;
  expired: boolean;
}): { text: string; warning: string | null } | null {
  const { room, playerId, connected, checking, failed, preview, urgent, expired } = input;
  if (!room || room.status !== 'playing') return null;
  if (!connected) return { text: 'SUNUCU BAĞLANTISI YOK', warning: null };

  const active = room.players.find(player => player.id === room.turnPlayerId);
  if (room.turnPlayerId !== playerId) {
    if (!active) return { text: 'SIRA BEKLENİYOR', warning: null };
    if (!active.online) return { text: `${active.name} OYUNCUSUNDA · BOT DEVİR ALIYOR`, warning: null };
    return { text: `${active.name} OYNUYOR`, warning: null };
  }
  if (expired || preview?.expired) return { text: 'SÜRE DOLDU · OTOMATİK HAMLE BEKLENİYOR', warning: null };
  if (failed) return { text: 'DURUM DOĞRULANAMADI', warning: null };
  if (checking || !preview) return { text: 'SIRA SENDE', warning: null };
  if (!preview.ok || !preview.active || preview.matchId !== room.matchId || preview.turnId !== room.turnId) {
    return { text: 'DURUM DOĞRULANAMADI', warning: null };
  }

  let text: string;
  if (preview.phase === 'draw') {
    const actions = [
      preview.canDrawStock ? 'YERDEN TAŞ ÇEK' : '',
      preview.canTakeDiscard ? 'SOLDAN TAŞ AL' : '',
    ].filter(Boolean);
    text = actions.length ? actions.join(' veya ') : 'ŞU ANDA TAŞ ALINAMIYOR';
  } else {
    const actions = preview.canOpenSeries ? ['PER AÇ'] : [];
    if (preview.canOpenPairs) actions.push('ÇİFT AÇ');
    if (preview.canFinishFromHand) actions.push('ELDEN BİT');
    if (preview.canProcessMeld) actions.push('PER İŞLE');
    if (preview.canLaySeries) actions.push('YENİ PER İNDİR');
    if (preview.canLayPairs) actions.push('ÇİFT İNDİR');
    if (preview.canDiscard) actions.push('TAŞ AT');
    text = actions.length ? actions.join(' · ') : 'GEÇERLİ HAMLE BULUNAMADI';
  }
  return { text, warning: urgent ? 'SON 10 SANİYE · HAMLENİ TAMAMLA' : null };
}
