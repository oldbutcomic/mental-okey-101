import {
  addToMeld,
  availableMeldProcessingTargets,
  discardTile,
  drawStock,
  effectiveTile,
  findRackPairGroups,
  isRealOkey,
  isValidPair,
  isPenaltyDiscardTile,
  layNewPairMelds,
  layNewSeriesMelds,
  openMelds,
  openSeriesMelds,
  pairOpeningThreshold,
  reclaimRealOkey,
  returnTakenDiscard,
  serialMeldPointValue,
  serialOpeningThreshold,
  takeDiscard,
  updateRealOkeyRecognition,
  type GameState,
  type Meld,
  type Player,
  type Tile,
  type TileColor,
} from '../shared/game.js';
import { findRackAutoSortGroups } from '../shared/rack-layout.js';

export type BotDifficulty = 'medium' | 'hard';
export type BotMemoryEvent = { kind: 'discard' | 'take'; playerId: string; tile: Tile; round: number };
export type BotMemory = { matchId: string; round: number; events: BotMemoryEvent[] };
export type BotPublicPlayer = Pick<Player, 'id' | 'seat' | 'opened' | 'pairMode' | 'score'>;

/** This is the complete information the decision logic is allowed to inspect. */
export type BotObservation = {
  matchId: string;
  round: number;
  playerId: string;
  player: BotPublicPlayer;
  players: BotPublicPlayer[];
  hand: Tile[];
  joker: GameState['joker'];
  melds: Meld[];
  discardTop: Tile | null;
  stockCount: number;
  recentThrows: { playerId: string; tiles: Tile[] }[];
  memory: BotMemoryEvent[];
  ownPlayableTileIds: number[];
  penaltyDiscardTileIds: number[];
  autoMode: boolean;
  mode: GameState['settings']['mode'];
  folding: boolean;
  phase: GameState['phase'];
  turnId: string | null;
  serialThreshold: number;
  pairThreshold: number;
};

export type BotAction =
  | 'take-discard'
  | 'draw-stock'
  | 'open-series'
  | 'open-pairs'
  | 'lay-new-series'
  | 'lay-new-pairs'
  | 'meld-lay'
  | 'reclaim-okey'
  | 'discard';

export type BotTurnResult = { state: GameState; actions: BotAction[]; discardedTile?: Tile };

type OpeningChoice = { kind: 'series' | 'pairs'; groups: number[][]; value: number; remainder: Tile[] };

function nextRandom(random: () => number): number {
  const value = random();
  return Number.isFinite(value) ? Math.min(0.999999999, Math.max(0, value)) : 0;
}

export function observeBotTransition(memory: BotMemory | undefined, previous: GameState, next: GameState): BotMemory {
  const events = !memory || memory.matchId !== next.matchId || memory.round !== next.round ? [] : [...memory.events];
  for (const player of next.players) {
    const before = previous.throwsByPlayer[player.id] || [];
    const after = next.throwsByPlayer[player.id] || [];
    if (after.length > before.length) events.push({ kind: 'discard', playerId: player.id, tile: after.at(-1)!, round: next.round });
  }
  const taken = next.takenDiscardUse;
  const oldTaken = previous.takenDiscardUse;
  if (taken && (!oldTaken || oldTaken.turnId !== taken.turnId || oldTaken.tileId !== taken.tileId || oldTaken.playerId !== taken.playerId)) {
    const tile = previous.discard.find(candidate => candidate.id === taken.tileId);
    if (tile) events.push({ kind: 'take', playerId: taken.playerId, tile, round: next.round });
  }
  return { matchId: next.matchId, round: next.round, events: events.filter(event => event.round === next.round).slice(-8) };
}

export function createBotObservation(state: GameState, playerId: string, memory?: BotMemory): BotObservation | null {
  const player = state.players.find(candidate => candidate.id === playerId);
  if (!player || state.status !== 'playing') return null;
  const publicPlayer = (candidate: Player): BotPublicPlayer => ({
    id: candidate.id,
    seat: candidate.seat,
    opened: candidate.opened,
    pairMode: candidate.pairMode,
    score: candidate.score,
  });
  return {
    matchId: state.matchId,
    round: state.round,
    playerId,
    player: publicPlayer(player),
    players: state.players.map(publicPlayer),
    hand: [...(state.hands[playerId] || [])],
    joker: state.joker ? { ...state.joker } : null,
    melds: state.melds.map(meld => ({ ...meld, tileIds: [...meld.tileIds], tiles: [...meld.tiles], realOkeyAssignments: meld.realOkeyAssignments ? { ...meld.realOkeyAssignments } : {} })),
    discardTop: state.discard.at(-1) || null,
    stockCount: state.stock.length,
    recentThrows: state.players.filter(candidate => candidate.id !== playerId).map(candidate => ({
      playerId: candidate.id,
      tiles: (state.throwsByPlayer[candidate.id] || []).slice(-2),
    })),
    memory: memory?.matchId === state.matchId && memory.round === state.round ? memory.events.slice(-8) : [],
    ownPlayableTileIds: availableMeldProcessingTargets(state, playerId).map(target => target.tileId),
    penaltyDiscardTileIds: (state.hands[playerId] || []).filter(tile => isPenaltyDiscardTile(state, tile)).map(tile => tile.id),
    autoMode: player.autoPlay === true,
    mode: state.settings.mode,
    folding: state.settings.folding,
    phase: state.phase,
    turnId: state.turnId,
    serialThreshold: serialOpeningThreshold(state, playerId),
    pairThreshold: pairOpeningThreshold(state, playerId),
  };
}

function faceValue(tile: Tile, joker: GameState['joker']): number {
  return effectiveTile(tile, joker).number || 0;
}

function totalHandPoints(hand: Tile[], joker: GameState['joker']): number {
  return hand.reduce((sum, tile) => sum + (effectiveTile(tile, joker).wild ? 101 : faceValue(tile, joker)), 0);
}

function selectGroupsLeavingDiscard(groups: number[][], hand: Tile[], scoreGroup: (group: number[]) => number, maxGroups?: number): number[][] {
  const byId = new Map(hand.map(tile => [tile.id, tile]));
  const available = groups.filter(group => group.every(id => byId.has(id)));
  const ordered = [...available].sort((a, b) => scoreGroup(b) - scoreGroup(a) || b.length - a.length || a[0] - b[0]);
  const selected: number[][] = [];
  let used = 0;
  for (const group of ordered) {
    if (maxGroups !== undefined && selected.length >= maxGroups) break;
    if (used + group.length >= hand.length) continue;
    selected.push(group);
    used += group.length;
  }
  return selected;
}

function seriesGroups(hand: Tile[], joker: GameState['joker']): number[][] {
  return findRackAutoSortGroups(hand, joker, 'series');
}

function pairGroups(hand: Tile[], joker: GameState['joker']): number[][] {
  return findRackPairGroups(hand, joker);
}

function markBotUsedRealOkeys(state: GameState, playerId: string, tileIds: number[]): GameState {
  const hand = state.hands[playerId] || [];
  const usedOkeys = tileIds.filter(tileId => {
    const tile = hand.find(candidate => candidate.id === tileId);
    return !!tile && isRealOkey(tile, state.joker);
  });
  return usedOkeys.length ? updateRealOkeyRecognition(state, playerId, usedOkeys, 'mark') : state;
}

type OpeningCandidate = { ids:number[]; mask:number; score:number; tieValue:number; firstIndex:number };
type OpeningSolution = { score:number; tieValue:number; covered:number; leftovers:number; groups:OpeningCandidate[] };

function selectOptimalOpeningGroups(hand:Tile[],joker:GameState['joker'],kind:'series'|'pairs'):number[][] {
  if(hand.length<2||hand.length>30)return [];
  const effective=hand.map(tile=>effectiveTile(tile,joker));
  const byFace=new Map<string,number[]>(),wildIndexes:number[]=[];
  for(let index=0;index<hand.length;index++){
    const face=effective[index];
    if(face.wild){wildIndexes.push(index);continue;}
    if(face.color===null||face.number===null)continue;
    const key=`${face.color}:${face.number}`,bucket=byFace.get(key)||[];bucket.push(index);byFace.set(key,bucket);
  }
  const candidatesByMask=new Map<number,OpeningCandidate>();
  const addCandidate=(indexes:number[],score:number,tieValue=0)=>{
    if(new Set(indexes).size!==indexes.length)return;
    const mask=indexes.reduce((value,index)=>value|(1<<index),0);
    const candidate:OpeningCandidate={ids:indexes.map(index=>hand[index].id),mask,score,tieValue,firstIndex:Math.min(...indexes)};
    const old=candidatesByMask.get(mask);
    if(!old||candidate.score>old.score||(candidate.score===old.score&&(candidate.tieValue>old.tieValue||(candidate.tieValue===old.tieValue&&candidate.ids.join(',')<old.ids.join(',')))))candidatesByMask.set(mask,candidate);
  };

  if(kind==='pairs'){
    for(let first=0;first<hand.length;first++)for(let second=first+1;second<hand.length;second++){
      const tiles=[hand[first],hand[second]];
      if(isValidPair(tiles,joker))addCandidate([first,second],1,faceValue(tiles[0],joker)+faceValue(tiles[1],joker));
    }
  }else{
    const enumerate=(slots:{color:TileColor;number:number}[])=>{
      const selected:number[]=[],used=new Set<number>();
      const choose=(offset:number)=>{
        if(offset===slots.length){
          const members=selected.map(index=>hand[index]);
          const points=serialMeldPointValue(members,joker);
          if(points!==null)addCandidate(selected,points);
          return;
        }
        const slot=slots[offset],matching=byFace.get(`${slot.color}:${slot.number}`)||[];
        for(const index of [...matching,...wildIndexes]){
          if(used.has(index))continue;
          used.add(index);selected.push(index);choose(offset+1);selected.pop();used.delete(index);
        }
      };
      choose(0);
    };
    const colors:TileColor[]=['red','yellow','blue','black'];
    for(const color of colors)for(let start=1;start<=13;start++)for(let length=3;length<=13&&start+length-1<=13;length++){
      enumerate(Array.from({length},(_,offset)=>({color,number:start+offset})));
    }
    for(let number=1;number<=13;number++)for(let colorMask=0;colorMask<1<<colors.length;colorMask++){
      const selectedColors=colors.filter((_,index)=>(colorMask&(1<<index))!==0);
      if(selectedColors.length===3||selectedColors.length===4)enumerate(selectedColors.map(color=>({color,number})));
    }
  }

  const candidates=[...candidatesByMask.values()].sort((a,b)=>b.score-a.score||b.tieValue-a.tieValue||b.ids.length-a.ids.length||a.firstIndex-b.firstIndex);
  const candidatesByIndex=hand.map((_,index)=>candidates.filter(candidate=>(candidate.mask&(1<<index))!==0));
  const empty:OpeningSolution={score:0,tieValue:0,covered:0,leftovers:0,groups:[]};
  const better=(candidate:OpeningSolution,best:OpeningSolution|null):boolean=>!best||candidate.score>best.score||
    (candidate.score===best.score&&(candidate.tieValue>best.tieValue||
      (candidate.tieValue===best.tieValue&&(candidate.covered>best.covered||
        (candidate.covered===best.covered&&candidate.groups.length<best.groups.length)))));
  const allMemo=new Map<number,OpeningSolution>(),leaveMemo=new Map<number,OpeningSolution|null>();
  const combine=(head:OpeningCandidate,tail:OpeningSolution):OpeningSolution=>({
    score:head.score+tail.score,tieValue:head.tieValue+tail.tieValue,
    covered:head.ids.length+tail.covered,leftovers:tail.leftovers,groups:[head,...tail.groups],
  });
  const solveAll=(available:number):OpeningSolution=>{
    if(!available)return empty;
    const cached=allMemo.get(available);if(cached)return cached;
    const bit=available&-available,index=31-Math.clz32(bit),rest=available^bit;
    const skipped=solveAll(rest);
    let best:OpeningSolution={...skipped,leftovers:skipped.leftovers+1};
    for(const candidate of candidatesByIndex[index]){
      if((candidate.mask&available)!==candidate.mask)continue;
      const next=combine(candidate,solveAll(available^candidate.mask));
      if(better(next,best))best=next;
    }
    allMemo.set(available,best);return best;
  };
  const solveLeavingDiscard=(available:number):OpeningSolution|null=>{
    if(!available)return null;
    if(leaveMemo.has(available))return leaveMemo.get(available)!;
    const bit=available&-available,index=31-Math.clz32(bit),rest=available^bit,tail=solveAll(rest);
    let best:OpeningSolution={...tail,leftovers:tail.leftovers+1};
    for(const candidate of candidatesByIndex[index]){
      if((candidate.mask&available)!==candidate.mask)continue;
      const remaining=solveLeavingDiscard(available^candidate.mask);
      if(!remaining)continue;
      const next=combine(candidate,remaining);
      if(better(next,best))best=next;
    }
    leaveMemo.set(available,best);return best;
  };
  const solution=solveLeavingDiscard((1<<hand.length)-1);
  if(!solution||!solution.groups.length)return [];
  // Retain the first occurrence order for stable, repeatable server meld creation.
  return solution.groups.sort((a,b)=>a.firstIndex-b.firstIndex).map(group=>group.ids);
}

function buildOpeningChoices(observation: BotObservation): OpeningChoice[] {
  const hand = observation.hand;
  const series = selectOptimalOpeningGroups(hand,observation.joker,'series');
  const seriesValue = series.reduce((sum, group) => sum + (serialMeldPointValue(group.map(id => hand.find(tile => tile.id === id)!).filter(Boolean), observation.joker) || 0), 0);
  const seriesUsed = new Set(series.flat());
  const pair = selectOptimalOpeningGroups(hand,observation.joker,'pairs');
  const pairUsed = new Set(pair.flat());
  const choices: OpeningChoice[] = [];
  if (series.length && seriesValue >= observation.serialThreshold) choices.push({ kind: 'series', groups: series, value: seriesValue, remainder: hand.filter(tile => !seriesUsed.has(tile.id)) });
  if (pair.length >= observation.pairThreshold) choices.push({ kind: 'pairs', groups: pair, value: pair.length, remainder: hand.filter(tile => !pairUsed.has(tile.id)) });
  return choices;
}

function openingChoice(observation: BotObservation, difficulty: BotDifficulty): OpeningChoice | null {
  const choices = buildOpeningChoices(observation);
  if (choices.length < 2) return choices[0] || null;
  const series = choices.find(choice => choice.kind === 'series')!;
  const pairs = choices.find(choice => choice.kind === 'pairs')!;
  const seriesRemainder = totalHandPoints(series.remainder, observation.joker);
  const pairRemainder = totalHandPoints(pairs.remainder, observation.joker) * 2;
  // Pair mode doubles hand-end points. Prefer it only when its larger immediate
  // reduction is worth that strategic commitment; medium bots lean toward runs.
  const pairAdvantage = seriesRemainder - pairRemainder;
  return pairAdvantage > (difficulty === 'hard' ? 8 : 14) ? pairs : series;
}

export function hasBotOpeningOpportunity(observation:BotObservation):boolean {
  return buildOpeningChoices(observation).length>0;
}

function handShapeValue(tile: Tile, hand: Tile[], joker: GameState['joker'], completedGroups: Set<number>): number {
  if (isRealOkey(tile, joker)) return 24;
  const face = effectiveTile(tile, joker);
  if (!face.color || !face.number) return 0;
  let shape = completedGroups.has(tile.id) ? 4.5 : 0;
  for (const other of hand) {
    if (other.id === tile.id) continue;
    const otherFace = effectiveTile(other, joker);
    if (!otherFace.color || !otherFace.number) continue;
    if (otherFace.color === face.color && otherFace.number === face.number) shape += 3.7;
    if (otherFace.color === face.color) {
      const gap = Math.abs(otherFace.number - face.number);
      if (gap === 1) shape += 2.2;
      else if (gap === 2) shape += 0.75;
    }
    if (otherFace.number === face.number && otherFace.color !== face.color) shape += 1.25;
  }
  // Hold low-point tiles slightly more readily when their combination value is equal.
  return shape - face.number * 0.12;
}

function isTileProcessableFor(state: GameState, player: BotPublicPlayer, tile: Tile): boolean {
  if (!player.opened) return false;
  const syntheticTurn = `bot-public-probe-${player.id}-${state.round}`;
  const probe: GameState = {
    ...state,
    turnPlayerId: player.id,
    phase: 'discard',
    turnId: syntheticTurn,
    turnDeadlineAt: null,
    hands: { ...state.hands, [player.id]: [tile] },
    meldLayUsage: [],
    takenDiscardUse: null,
  };
  return availableMeldProcessingTargets(probe, player.id, 0).length > 0;
}

function visibleMeldRisk(observation: BotObservation, tile: Tile, difficulty: BotDifficulty): number {
  const tileFace = effectiveTile(tile, observation.joker);
  let risk = 0;
  for (const player of observation.players) {
    if (player.id === observation.playerId || !player.opened) continue;
    if (isTileProcessableFor({
      status: 'playing', matchId: observation.matchId, settings: { rounds: 1, mode: observation.mode, folding: observation.folding, assisted: false, tableColor: 'wood', turnDurationSeconds: 45 },
      players: observation.players.map(candidate => ({ ...candidate, name: '', avatar: '', online: true })), hands: {}, stock: [], discard: [], indicator: null, joker: observation.joker,
      recognizedRealOkeyIds: [], throwsByPlayer: {}, turnPlayerId: null, phase: 'draw', melds: observation.melds, round: observation.round, message: '', turnStartedAt: null, turnDeadlineAt: null, turnId: null, roundScores: [], roundScoreStart: {}, matchBadges: [], serialOpeningHistory: [], pairOpeningHistory: [], meldLayUsage: [], processedMeldActions: [], realOkeyReclaimPenalties: [], takenDiscardUse: null, openingTurn: null, perCollectionUses: {},
    }, player, tile)) risk += observation.mode === 'pairs' && player.seat % 2 === observation.player.seat % 2 ? 0.8 : (difficulty === 'hard' ? 5 : 3.2);
    const recentTake = observation.memory.some(event => event.kind === 'take' && event.playerId === player.id && event.tile.color === tileFace.color && event.tile.number === tileFace.number);
    if (recentTake) risk += difficulty === 'hard' ? 1.8 : 1.0;
  }
  // Recent public throws are weak evidence only: the matching physical copy
  // may still be in another player's hand, so do not treat a discard as proof.
  const sameFaceRecentThrows = observation.recentThrows.filter(entry => entry.tiles.some(thrown => {
    const thrownFace = effectiveTile(thrown, observation.joker);
    return thrownFace.color === tileFace.color && thrownFace.number === tileFace.number;
  })).length;
  risk -= Math.min(sameFaceRecentThrows, 2) * 0.35;
  return risk;
}

export function chooseBotDiscard(observation: BotObservation, difficulty: BotDifficulty = 'medium', random: () => number = Math.random, options:{safeMode?:boolean}={}): Tile | null {
  if (!observation.hand.length) return null;
  const penalized=new Set(observation.penaltyDiscardTileIds);
  const safeHand=observation.hand.filter(tile=>!penalized.has(tile.id));
  // A safe discard is always preferred. If every tile would incur a penalty,
  // retain the ordinary strategic ranking and choose the least harmful one.
  const candidates=safeHand.length?safeHand:observation.hand;
  const complete = new Set(seriesGroups(observation.hand, observation.joker).flat());
  pairGroups(observation.hand, observation.joker).forEach(group => group.forEach(id => complete.add(id)));
  const evaluated = candidates.map(tile => ({
    tile,
    keep: handShapeValue(tile, observation.hand, observation.joker, complete)
      + (observation.ownPlayableTileIds.includes(tile.id) ? 7 : 0)
      + visibleMeldRisk(observation, tile, difficulty),
  })).sort((a, b) => a.keep - b.keep || b.tile.id - a.tile.id);
  const mistakeChance = observation.autoMode||options.safeMode ? 0 : difficulty === 'hard' ? 0.03 : 0.08;
  if (evaluated.length > 1 && nextRandom(random) < mistakeChance) {
    // A small, explicit imperfection: pick one of the next two least useful
    // candidates, never a hidden-information or rule-bypassing move.
    const offset = 1 + Math.floor(nextRandom(random) * Math.min(2, evaluated.length - 1));
    return evaluated[offset].tile;
  }
  return evaluated[0].tile;
}

export function botMeldRequestId(state: GameState, playerId: string): string {
  const sequence = (state.processedMeldActions || []).filter(action => action.turnId === state.turnId && action.playerId === playerId).length + 1;
  const matchTag = state.matchId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'match';
  const playerTag = playerId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16) || 'player';
  return `bot-${matchTag}-${state.round.toString(36)}-${playerTag}-${sequence.toString(36)}`;
}

function matchingPendingDiscard(state: GameState, playerId: string): number | null {
  const pending = state.takenDiscardUse;
  return pending?.playerId === playerId && pending.turnId === state.turnId && !pending.used ? pending.tileId : null;
}

function bestProcessingTarget(state: GameState, playerId: string, difficulty: BotDifficulty, onlyTileId?: number) {
  const hand = state.hands[playerId] || [];
  const complete = new Set(seriesGroups(hand, state.joker).flat());
  pairGroups(hand, state.joker).forEach(group => group.forEach(id => complete.add(id)));
  const targets = availableMeldProcessingTargets(state, playerId)
    .filter(target => (onlyTileId === undefined || target.tileId === onlyTileId) && hand.length > 1)
    .map(target => {
      const tile = hand.find(candidate => candidate.id === target.tileId)!;
      const utility = handShapeValue(tile, hand, state.joker, complete);
      const reclaimBonus = target.target === 'reclaim-okey' ? 2.5 : 0;
      return { target, score: utility - reclaimBonus };
    })
    .sort((a, b) => a.score - b.score || a.target.tileId - b.target.tileId || a.target.meldId.localeCompare(b.target.meldId));
  const best = targets[0];
  if (!best) return null;
  // A live picked-up discard must be used. Otherwise keep highly connected
  // tiles for a likely set and process isolated/low-value stones first.
  const autoMode = state.players.find(player => player.id === playerId)?.autoPlay === true;
  if (!autoMode && onlyTileId === undefined && best.score > (difficulty === 'hard' ? 5.5 : 4.2)) return null;
  return best.target;
}

function layableGroups(state: GameState, playerId: string, kind: 'series' | 'pairs', onlyTileId?: number): number[][] {
  const hand = state.hands[playerId] || [];
  const groups = kind === 'pairs' ? pairGroups(hand, state.joker) : seriesGroups(hand, state.joker);
  const eligible = onlyTileId === undefined ? groups : groups.filter(group => group.includes(onlyTileId));
  return selectGroupsLeavingDiscard(eligible, hand, group => kind === 'pairs'
    ? group.reduce((sum, id) => sum + faceValue(hand.find(tile => tile.id === id)!, state.joker), 0)
    : serialMeldPointValue(group.map(id => hand.find(tile => tile.id === id)!).filter(Boolean), state.joker) || 0,
  );
}

function applyMeldChoices(state: GameState, playerId: string, difficulty: BotDifficulty, actions: BotAction[], onlyTakenTileId?: number): GameState {
  let current = state;
  let player = current.players.find(candidate => candidate.id === playerId);
  if (!player) return current;

  if (!player.opened) {
    const observation = createBotObservation(current, playerId);
    const choice = observation ? openingChoice(observation, difficulty) : null;
    const requiredTileId = onlyTakenTileId;
    if (!choice || (requiredTileId !== undefined && !choice.groups.some(group => group.includes(requiredTileId)))) return current;
    current = markBotUsedRealOkeys(current, playerId, choice.groups.flat());
    current = choice.kind === 'series'
      ? openSeriesMelds(current, playerId, choice.groups)
      : openMelds(current, playerId, choice.groups, true);
    actions.push(choice.kind === 'series' ? 'open-series' : 'open-pairs');
    // Opening does not end the bot's turn. Re-read the server-updated opening
    // mode and continue laying any remaining eligible groups before discarding.
    player = current.players.find(candidate => candidate.id === playerId);
    if (!player?.opened) return current;
    // If the picked-up discard was used to open, its mandatory-use condition
    // is already satisfied; continue normal turn processing with the rest.
    onlyTakenTileId = undefined;
  }

  if (onlyTakenTileId === undefined) {
    const firstKind = player.pairMode ? 'pairs' : 'series';
    const groups = layableGroups(current, playerId, firstKind);
    if (groups.length) {
      current = markBotUsedRealOkeys(current, playerId, groups.flat());
      current = firstKind === 'series'
        ? layNewSeriesMelds(current, playerId, groups, current.turnId || undefined, botMeldRequestId(current, playerId))
        : layNewPairMelds(current, playerId, groups, current.turnId || undefined, botMeldRequestId(current, playerId));
      actions.push(firstKind === 'series' ? 'lay-new-series' : 'lay-new-pairs');
    }
    const canLayPairs = !player.pairMode && current.players.some(candidate => candidate.pairMode);
    if (canLayPairs && (current.hands[playerId] || []).length > 1) {
      const pairs = layableGroups(current, playerId, 'pairs');
      if (pairs.length) {
        current = markBotUsedRealOkeys(current, playerId, pairs.flat());
        current = layNewPairMelds(current, playerId, pairs, current.turnId || undefined, botMeldRequestId(current, playerId));
        actions.push('lay-new-pairs');
      }
    }
  } else {
    const kind = player.pairMode ? 'pairs' : 'series';
    const groups = layableGroups(current, playerId, kind, onlyTakenTileId);
    if (groups.length) {
      current = markBotUsedRealOkeys(current, playerId, groups.flat());
      current = kind === 'series'
        ? layNewSeriesMelds(current, playerId, groups, current.turnId || undefined, botMeldRequestId(current, playerId))
        : layNewPairMelds(current, playerId, groups, current.turnId || undefined, botMeldRequestId(current, playerId));
      actions.push(kind === 'series' ? 'lay-new-series' : 'lay-new-pairs');
      return current;
    }
    if (!player.pairMode && current.players.some(candidate => candidate.pairMode)) {
      const pairs = layableGroups(current, playerId, 'pairs', onlyTakenTileId);
      if (pairs.length) {
        current = markBotUsedRealOkeys(current, playerId, pairs.flat());
        current = layNewPairMelds(current, playerId, pairs, current.turnId || undefined, botMeldRequestId(current, playerId));
        actions.push('lay-new-pairs');
        return current;
      }
    }
  }

  const autoMode = current.players.find(candidate => candidate.id === playerId)?.autoPlay === true;
  const limit = onlyTakenTileId === undefined ? (autoMode || difficulty === 'hard' ? 12 : 1) : 1;
  for (let index = 0; index < limit && (current.hands[playerId] || []).length > 1; index++) {
    const target = bestProcessingTarget(current, playerId, difficulty, onlyTakenTileId);
    if (!target) break;
    if (target.target === 'reclaim-okey') {
      if (target.realOkeyTileId === undefined) break;
      current = reclaimRealOkey(current, playerId, target.meldId, target.realOkeyTileId, target.tileId, current.turnId || undefined, botMeldRequestId(current, playerId));
      actions.push('reclaim-okey');
    } else {
      current = markBotUsedRealOkeys(current, playerId, [target.tileId]);
      current = addToMeld(current, playerId, target.tileId, target.meldId, target.target, current.turnId || undefined, botMeldRequestId(current, playerId));
      actions.push('meld-lay');
    }
    if (onlyTakenTileId !== undefined) break;
  }
  return current;
}

function canUseDiscardNow(state: GameState, playerId: string, tileId: number, difficulty: BotDifficulty): boolean {
  try {
    const previewActions: BotAction[] = [];
    const preview = applyMeldChoices(state, playerId, difficulty, previewActions, tileId);
    return preview.takenDiscardUse?.playerId === playerId && preview.takenDiscardUse.tileId === tileId && preview.takenDiscardUse.turnId === state.turnId && preview.takenDiscardUse.used;
  } catch {
    return false;
  }
}

export function botThinkDelay(_observation: BotObservation, _difficulty: BotDifficulty, random: () => number = Math.random): number {
  // Bots should take a visible, variable amount of time before completing a
  // turn. Keep the delay within the requested 3–10 second window regardless
  // of hand size or difficulty so complex turns cannot drift toward timeout.
  return 3_000 + Math.floor(nextRandom(random) * 7_001);
}

/** Keeps an AI action ahead of the authoritative turn timeout without creating a new deadline. */
export function botThinkDelayBeforeDeadline(observation:BotObservation,difficulty:BotDifficulty,deadlineAt:number,now=Date.now(),random:()=>number=Math.random):number {
  if(!Number.isFinite(deadlineAt)||deadlineAt<=now)return 0;
  return Math.min(botThinkDelay(observation,difficulty,random),Math.max(0,deadlineAt-now-150));
}

export function playBotTurn(initial: GameState, playerId: string, difficulty: BotDifficulty = 'medium', random: () => number = Math.random): BotTurnResult {
  if (initial.status !== 'playing' || initial.turnPlayerId !== playerId || !initial.turnId) throw new Error('Bot sırası etkin değil');
  let state = initial;
  const actions: BotAction[] = [];
  const bot = state.players.find(candidate => candidate.id === playerId);
  if (!bot || (!bot.id.startsWith('bot-') && bot.online && !bot.autoPlay)) throw new Error('Bot kimliği doğrulanmadı');

  if (state.phase === 'draw') {
    const top = state.discard.at(-1);
    const topOwner = top && state.players.find(candidate => (state.throwsByPlayer[candidate.id] || []).at(-1)?.id === top.id);
    const previousSeat = (bot.seat + 3) % 4;
    if (top && topOwner?.seat === previousSeat) {
      try {
        const candidate = takeDiscard(state, playerId);
        if (canUseDiscardNow(candidate, playerId, top.id, difficulty)) {
          state = candidate;
          actions.push('take-discard');
        }
      } catch { /* The common stock draw remains the safe fallback. */ }
    }
    if (state.phase === 'draw') {
      state = drawStock(state, playerId);
      actions.push('draw-stock');
    }
    if (state.status !== 'playing') return { state, actions };
  }

  const pendingId = matchingPendingDiscard(state, playerId);
  state = applyMeldChoices(state, playerId, difficulty, actions, pendingId ?? undefined);
  if (pendingId !== null && !state.takenDiscardUse?.used) {
    state = returnTakenDiscard(state, playerId);
    state = drawStock(state, playerId);
    actions.push('draw-stock');
    if (state.status !== 'playing') return { state, actions };
    state = applyMeldChoices(state, playerId, difficulty, actions);
  }

  const hand = state.hands[playerId] || [];
  const observation = createBotObservation(state, playerId);
  const tile = observation ? chooseBotDiscard(observation, difficulty, random) : hand[0] || null;
  if (!tile) throw new Error('Bot elinde atılacak taş yok');
  state = discardTile(state, playerId, tile.id);
  actions.push('discard');
  return { state, actions, discardedTile: tile };
}
