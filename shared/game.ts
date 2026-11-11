export type TileColor = 'red' | 'yellow' | 'blue' | 'black';
export type Tile = { id: number; color: TileColor | null; number: number | null; fakeJoker: boolean };
export type TableSettings = { rounds: 1|3|5|7|11; mode: 'solo'|'pairs'; folding: boolean; assisted: boolean; tableColor: 'wood'|'green'|'blue'|'burgundy'; turnDurationSeconds: 30|45|60|90 };
export type Player = { id:string; name:string; avatar:string; online:boolean; autoPlay?:boolean; seat:number; score:number; opened:boolean; pairMode:boolean; mentalCoins?:number };
export type MeldFace = {color:TileColor;number:number};
export type Meld = { id:string; ownerId:string; tileIds:number[]; tiles:Tile[]; kind:'run'|'group'|'pairs'; realOkeyAssignments?:Record<number,MeldFace> };
export type MeldLayTarget = 'auto'|'head'|'tail'|'group';
export type MeldProcessingTarget = {tileId:number;meldId:string;target:'head'|'tail'|'group'|'reclaim-okey';realOkeyTileId?:number};
export type MeldLayUsage = {turnId:string;playerId:string;meldId:string;side:'head'|'tail';count:number};
export type ProcessedMeldAction = {turnId:string;playerId:string;requestId:string;fingerprint:string};
export type TakenDiscardUse = {playerId:string;tileId:number;ownerId:string;turnId:string;used:boolean;usedBy?:'series-open'|'pairs-open'|'series-lay'|'pairs-lay'|'meld-lay'|'real-okey-reclaim'};
export type RealOkeyReclaimPenalty = {round:number;turnId:string;requestId:string;actorId:string;ownerId:string;meldId:string;realOkeyTileId:number;replacementTileId:number;points:101};
export type SerialOpening = { round:number; playerId:string; teamId:0|1|null; points:number; tileIds:number[] };
export type PairOpening = { round:number; playerId:string; teamId:0|1|null; pairCount:number; tileIds:number[] };
export type MatchBadge = { round:number; playerId:string; place:1|2|3|4 };
export type RoundScore = { round:number; playerId:string; points:number; total:number };
export type RoundPenalty = { round:number; playerId:string; points:number; reason:'timeout'|'workable-discard'|'real-okey-discard'|'undo-open'|'collect-meld'|'real-okey-reclaim'|'invalid-open' };
export type RoundFinishKind='normal'|'okey'|'pair'|'pair-okey'|'elden'|'stock';
export const ROUND_SUMMARY_DURATION_MS=15_000;
export const ELDEN_REVEAL_DURATION_MS=30_000;
export const MATCH_SUMMARY_DURATION_MS=60_000;
export function roundSummaryDurationMs(kind:RoundFinishKind|null|undefined):number{return kind==='elden'?ELDEN_REVEAL_DURATION_MS:ROUND_SUMMARY_DURATION_MS;}
export type PublicGameEvent={id:string;round:number;at:number;text:string;kind?:'penalty';playerId?:string;points?:number};
export type GameEventKind='draw-stock'|'draw-discard'|'discard'|'meld-lay'|'open-series'|'open-pairs'|'finish'|'penalty';
export type GameEvent={id:string;sequence:number;matchId:string;round:number;turnId:string|null;at:number;kind:GameEventKind;playerId:string;scope?:'public'|'player';points?:number;tileId?:number;meldId?:string;meldIds?:string[]};
export type PersonalNotification={id:string;round:number;at:number;text:string;important:boolean};
export type OpeningAttempt={matchId:string;round:number;turnId:string;playerId:string;requestId:string;fingerprint:string;result?:'invalid'|'success'};
export type MatchPlayerStats = { bestScore:number; seriesOpens:number; pairOpens:number; penaltyCount:number; penaltyPoints:number };
export type TeamScoreRow = { teamId:0|1; playerIds:string[]; roundPoints:number; previousTotal:number; total:number; roundRank:number; overallRank:number };
export type OpeningTurn = { playerId:string; turnId:string; meldIds:string[]; wrongPerSelections:number; perCollectionLocked:boolean };
export type UndoOpenSnapshot = { playerId:string; turnId:string|null; hand:Tile[]; melds:Meld[]; opened:boolean; pairMode:boolean; openingKind:'series'|'pairs'; serialOpeningHistory:SerialOpening[]; pairOpeningHistory:PairOpening[]; discardTakeUndo:GameState['discardTakeUndo']; takenDiscardUse:TakenDiscardUse|null; playerScores:Record<string,number>; realOkeyReclaimPenalties:RealOkeyReclaimPenalty[]; meldLayUsage:MeldLayUsage[]; perCollectionUsesAtOpen:number };
export type GameState = {
  status:'waiting'|'playing'|'round-end'|'match-end'; matchId:string; settings:TableSettings; players:Player[];
  hands:Record<string,Tile[]>; stock:Tile[]; discard:Tile[]; indicator:Tile|null; joker:{color:TileColor;number:number}|null;
  recognizedRealOkeyIds:number[];
  throwsByPlayer:Record<string,Tile[]>;
  turnPlayerId:string|null; roundStarterId?:string|null; phase:'draw'|'discard'; melds:Meld[]; round:number; message:string;
  turnStartedAt:number|null; turnDeadlineAt:number|null; turnId:string|null;
  roundAutoStartAt?:number|null;
  roundScores:RoundScore[];
  roundScoreStart:Record<string,number>;
  penaltyHistory?:RoundPenalty[];
  matchStats?:Record<string,MatchPlayerStats>;
  matchBadges:MatchBadge[];
  serialOpeningHistory:SerialOpening[];
  pairOpeningHistory:PairOpening[];
  meldLayUsage:MeldLayUsage[];
  processedMeldActions:ProcessedMeldAction[];
  realOkeyReclaimPenalties:RealOkeyReclaimPenalty[];
  takenDiscardUse:TakenDiscardUse|null;
  openingTurn:OpeningTurn|null;
  perCollectionUses:Record<string,number>;
  discardTakeUndo?:{playerId:string;tileId:number;ownerId:string;turnId:string|null;stockCount:number}|null;
  undoOpen?:UndoOpenSnapshot|null;
  processedOpeningAttempts?:OpeningAttempt[];
  roundFinishKind?:RoundFinishKind|null;
  roundFinisherId?:string|null;
  scoredRound?:number|null;
  revealedHands?:Record<string,Tile[]>|null;
  roundRevealUntilAt?:number|null;
  publicEvents?:PublicGameEvent[];
  gameEvents?:GameEvent[];
  gameEventSequence?:number;
  personalNotifications?:Record<string,PersonalNotification[]>;
};
export type RackPoint = {x:number;y:number};
export type RackTilePlacement = {tile:Tile;position:RackPoint};
export type RackGeometry = {width:number;height:number;tileWidth:number;tileHeight:number};
export type RackMeldAnalysis = {orderedTiles:Tile[];groups:number[][];seriesTotal:number;pairCount:number};
export const COLORS:TileColor[]=['red','yellow','blue','black'];
export const TURN_DURATIONS=[30,45,60,90] as const;
export const TABLE_ROUNDS=[3,5,7,11] as const;
let matchIdSequence=0;

export function createMatchId():string {
  const uuid=globalThis.crypto?.randomUUID?.();
  if(uuid)return `match-${uuid}`;
  matchIdSequence++;
  return `match-${Date.now().toString(36)}-${matchIdSequence.toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function validateTableSettings(input:unknown):TableSettings {
  if(!input||typeof input!=='object')throw new Error('Masa ayarları geçersiz');
  const value=input as Record<string,unknown>;
  if(!TABLE_ROUNDS.some(round=>round===value.rounds))throw new Error('El sayısı 3, 5, 7 veya 11 olmalı');
  if(value.mode!=='solo'&&value.mode!=='pairs')throw new Error('Oyun modu geçersiz');
  if(typeof value.folding!=='boolean'||typeof value.assisted!=='boolean')throw new Error('Masa seçenekleri geçersiz');
  if(value.tableColor!=='wood'&&value.tableColor!=='green'&&value.tableColor!=='blue'&&value.tableColor!=='burgundy')throw new Error('Masa rengi geçersiz');
  if(!TURN_DURATIONS.some(seconds=>seconds===value.turnDurationSeconds))throw new Error('Tur süresi 30, 45, 60 veya 90 saniye olmalı');
  return {rounds:value.rounds as TableSettings['rounds'],mode:value.mode,folding:value.folding,assisted:value.assisted,tableColor:value.tableColor,turnDurationSeconds:value.turnDurationSeconds as TableSettings['turnDurationSeconds']};
}

export function freshRoom(settings:TableSettings,matchId=createMatchId()):GameState {
  return {status:'waiting',matchId,settings,players:[],hands:{},stock:[],discard:[],throwsByPlayer:{},indicator:null,joker:null,recognizedRealOkeyIds:[],turnPlayerId:null,roundStarterId:null,phase:'draw',melds:[],round:1,message:'Oyuncular bekleniyor',turnStartedAt:null,turnDeadlineAt:null,turnId:null,roundAutoStartAt:null,roundScores:[],roundScoreStart:{},penaltyHistory:[],matchStats:{},matchBadges:[],serialOpeningHistory:[],pairOpeningHistory:[],meldLayUsage:[],processedMeldActions:[],realOkeyReclaimPenalties:[],takenDiscardUse:null,openingTurn:null,perCollectionUses:{},discardTakeUndo:null,undoOpen:null,processedOpeningAttempts:[],roundFinishKind:null,roundFinisherId:null,scoredRound:null,revealedHands:null,roundRevealUntilAt:null,publicEvents:[],gameEvents:[],gameEventSequence:0,personalNotifications:{}};
}

function appendPublicEvent(s:GameState,text:string,at=Date.now(),details:Pick<PublicGameEvent,'kind'|'playerId'|'points'>={}):GameState {
  const publicEvents=[...(s.publicEvents||[]),{id:`${s.matchId}:${s.round}:${at}:${(s.publicEvents||[]).length}`,round:s.round,at,text,...details}].slice(-200);
  return {...s,publicEvents};
}
function appendGameEvent(s:GameState,event:Omit<GameEvent,'id'|'sequence'|'matchId'|'round'|'turnId'|'at'>,at=Date.now()):GameState {
  const sequence=(s.gameEventSequence??0)+1;
  const entry:GameEvent={...event,id:`${s.matchId}:fx:${sequence}`,sequence,matchId:s.matchId,round:s.round,turnId:s.turnId??null,at};
  return {...s,gameEventSequence:sequence,gameEvents:[...(s.gameEvents||[]),entry].slice(-100)};
}
function publicGameEvents(s:GameState,viewerId:string):GameEvent[]{
  return (s.gameEvents||[]).filter(event=>event.scope!=='player'||event.playerId===viewerId).map(event=>{
    if((event.kind==='draw-stock'||event.kind==='draw-discard')&&event.playerId!==viewerId){const {tileId:_hiddenTileId,...safeEvent}=event;return safeEvent}
    return event;
  });
}
export function appendPersonalNotification(s:GameState,playerId:string,text:string,important=true,at=Date.now()):GameState {
  const previous=s.personalNotifications?.[playerId]||[];
  const item:PersonalNotification={id:`${s.matchId}:${s.round}:${playerId}:${at}:${previous.length}`,round:s.round,at,text,important};
  return {...s,personalNotifications:{...(s.personalNotifications||{}),[playerId]:[...previous,item].slice(-100)}};
}
function remainingHandPoints(hand:Tile[],joker:GameState['joker']):number {
  return hand.reduce((sum,tile)=>{const face=effectiveTile(tile,joker);return sum+(face.wild?101:(face.number||0));},0);
}
/** The single scoring authority for all completed hands. Penalties already in score stay independent. */
export function settleRound(s:GameState,kind:RoundFinishKind,finisherId:string|null,hands:Record<string,Tile[]>=s.hands,now=Date.now()):GameState {
  if(s.scoredRound===s.round)return s;
  const rules:Record<Exclude<RoundFinishKind,'stock'>,{winner:number;unopened:number;normal:number;pairs:number}>={
    normal:{winner:-101,unopened:202,normal:1,pairs:2},
    okey:{winner:-202,unopened:404,normal:2,pairs:4},
    pair:{winner:-202,unopened:404,normal:2,pairs:4},
    'pair-okey':{winner:-404,unopened:808,normal:4,pairs:8},
    elden:{winner:-202,unopened:404,normal:2,pairs:4},
  };
  const rule=kind==='stock'?null:rules[kind];
  const winner=s.players.find(player=>player.id===finisherId);
  if(kind!=='stock'&&(!winner||!rule))throw new Error('El sonucu veya bitiren oyuncu geçersiz');
  const players=s.players.map(player=>{
    if(player.id===finisherId&&rule)return {...player,score:player.score+rule.winner};
    const partnerExempt=!!winner&&s.settings.mode==='pairs'&&winner.seat%2===player.seat%2;
    if(finisherId&&partnerExempt)return player;
    const hand=hands[player.id]||[];
    const points=player.opened
      ? remainingHandPoints(hand,s.joker)*(kind==='stock'?(player.pairMode?2:1):player.pairMode?rule!.pairs:rule!.normal)
      : kind==='stock'?202:rule!.unopened;
    return {...player,score:player.score+points};
  });
  let next:GameState={...s,hands,players,status:'round-end',roundFinishKind:kind,roundFinisherId:finisherId,scoredRound:s.round,turnPlayerId:null,phase:'draw',turnStartedAt:null,turnDeadlineAt:null,turnId:null,discardTakeUndo:null,takenDiscardUse:null,openingTurn:null,undoOpen:null};
  if(kind==='stock')next=appendPublicEvent(next,'Deste bitti; el puanları hesaplandı',now);
  else if(winner){const title=kind==='elden'?'elden bitti':kind==='pair-okey'?'çiftten okeyle bitti':kind==='pair'?'çiftten bitti':kind==='okey'?'okeyle bitti':'eli bitirdi';next=appendPublicEvent(next,`${winner.name} ${title}`,now);}
  if(s.settings.mode==='pairs'){
    next=recordRoundScores(next);
    const teams=calculateTeamScoreboard(players,[...(next.roundScores||[])],s.round);
    const result=teams.map(team=>`Takım ${team.teamId+1}: ${team.roundPoints} puan`).join(' · ');
    next=appendPublicEvent(next,`Takım sonucu: ${result}`,now);
  }
  next=appendGameEvent(next,{kind:'finish',playerId:finisherId||'system'},now);
  return next;
}

export function recordInvalidOpenAttempt(s:GameState,playerId:string,requestId:string,fingerprint:string,reason:string,turnId=s.turnId||'',now=Date.now()):GameState {
  if(!turnId||s.turnId!==turnId||s.turnPlayerId!==playerId||s.status!=='playing'||s.phase!=='discard')throw new Error('Geçersiz açma cezası yalnızca güncel oyuncu turunda uygulanabilir');
  const attempts=s.processedOpeningAttempts||[];
  const existing=attempts.find(attempt=>attempt.matchId===s.matchId&&attempt.round===s.round&&attempt.turnId===turnId&&attempt.playerId===playerId&&attempt.requestId===requestId);
  if(existing){if(existing.fingerprint!==fingerprint)throw new Error('Bu açılış istek kimliği başka bir işlemde kullanıldı');return s;}
  const player=s.players.find(candidate=>candidate.id===playerId);if(!player)throw new Error('Oyuncu bulunamadı');
  let next:GameState={...s,players:s.players.map(candidate=>candidate.id===playerId?{...candidate,score:candidate.score+101}:candidate),penaltyHistory:[...(s.penaltyHistory||[]),{round:s.round,playerId,points:101,reason:'invalid-open'}],processedOpeningAttempts:[...attempts,{matchId:s.matchId,round:s.round,turnId,playerId,requestId,fingerprint,result:'invalid'}],message:`${player.name} geçersiz açılış denedi`};
  next=appendPersonalNotification(next,playerId,`Geçersiz açma denemesi nedeniyle 101 ceza puanı aldınız. ${reason}`,true,now);
  return appendGameEvent(next,{kind:'penalty',playerId,scope:'player',points:101},now);
}

export function recordSuccessfulOpeningAttempt(s:GameState,playerId:string,requestId:string,fingerprint:string,turnId=s.turnId||''):GameState {
  if(!requestId||requestId.length>128||!turnId||s.turnId!==turnId||s.turnPlayerId!==playerId)throw new Error('Açılış isteği güncel oyuncu turuyla eşleşmiyor');
  const attempts=s.processedOpeningAttempts||[];
  const existing=attempts.find(attempt=>attempt.matchId===s.matchId&&attempt.round===s.round&&attempt.turnId===turnId&&attempt.playerId===playerId&&attempt.requestId===requestId);
  if(existing){if(existing.fingerprint!==fingerprint)throw new Error('Bu açılış istek kimliği başka bir işlemde kullanıldı');return s;}
  return {...s,processedOpeningAttempts:[...attempts,{matchId:s.matchId,round:s.round,turnId,playerId,requestId,fingerprint,result:'success'}]};
}

export function startNewMatch(previous:GameState,settings:TableSettings):GameState {
  if(previous.status!=='match-end')throw new Error('Yeni maç yalnızca maç tamamlandıktan sonra başlatılabilir');
  if(previous.players.length!==4)throw new Error('Yeni maç için masada dört oyuncu bulunmalı');
  const next=freshRoom(settings);
  next.players=previous.players.map(player=>({...player,score:0,opened:false,pairMode:false,autoPlay:false}));
  const started=startRound(next);
  return {...started,message:'Yeni maç başladı · ilk el başladı'};
}
export function recordRoundBadges(s:GameState):GameState {
  if((s.status!=='round-end'&&s.status!=='match-end')||s.round<1||s.round>s.settings.rounds||s.players.length!==4||s.matchBadges.some(badge=>badge.round===s.round))return s;
  const scored=recordRoundScores(s);
  const roundPoints=new Map(scored.roundScores.filter(entry=>entry.round===s.round).map(entry=>[entry.playerId,entry.points]));
  const ranked=[...scored.players].sort((a,b)=>(roundPoints.get(a.id)??0)-(roundPoints.get(b.id)??0)||a.seat-b.seat);
  let place=0,previousPoints:number|null=null;
  const awards:MatchBadge[]=ranked.map((player,index)=>{const points=roundPoints.get(player.id)??0;if(previousPoints===null||points!==previousPoints)place=index+1;previousPoints=points;return{round:s.round,playerId:player.id,place:place as MatchBadge['place']};});
  return {...scored,matchBadges:[...scored.matchBadges,...awards]};
}
export function recordRoundScores(s:GameState):GameState {
  if((s.status!=='round-end'&&s.status!=='match-end')||s.round<1||s.round>s.settings.rounds||s.roundScores.some(entry=>entry.round===s.round))return s;
  const entries:RoundScore[]=s.players.map(player=>{const total=player.score;return{round:s.round,playerId:player.id,points:total-(s.roundScoreStart[player.id]??total),total}});
  const matchStats={...(s.matchStats||{})};
  for(const player of s.players){
    const points=entries.find(entry=>entry.playerId===player.id)?.points||0;
    const penalties=(s.penaltyHistory||[]).filter(entry=>entry.round===s.round&&entry.playerId===player.id);
    const previous=matchStats[player.id]||{bestScore:0,seriesOpens:0,pairOpens:0,penaltyCount:0,penaltyPoints:0};
    matchStats[player.id]={
      bestScore:Math.max(previous.bestScore,points),
      seriesOpens:previous.seriesOpens+(s.serialOpeningHistory||[]).filter(entry=>entry.round===s.round&&entry.playerId===player.id).length,
      pairOpens:previous.pairOpens+(s.pairOpeningHistory||[]).filter(entry=>entry.round===s.round&&entry.playerId===player.id).length,
      penaltyCount:previous.penaltyCount+penalties.length,
      penaltyPoints:previous.penaltyPoints+penalties.reduce((total,entry)=>total+entry.points,0),
    };
  }
  return {...s,roundScores:[...s.roundScores,...entries],matchStats};
}
export function calculateTeamScoreboard(players:Player[],roundScores:RoundScore[],round:number):TeamScoreRow[] {
  const teams=([0,1] as const).map(teamId=>{
    const members=players.filter(player=>player.seat%2===teamId);
    const total=members.reduce((sum,player)=>sum+player.score,0);
    const roundPoints=members.reduce((sum,player)=>sum+(roundScores.find(entry=>entry.round===round&&entry.playerId===player.id)?.points||0),0);
    return{teamId,playerIds:members.map(player=>player.id),roundPoints,previousTotal:total-roundPoints,total,roundRank:0,overallRank:0};
  }).filter(team=>team.playerIds.length>0);
  const byRound=[...teams].sort((a,b)=>a.roundPoints-b.roundPoints||a.teamId-b.teamId),roundRanks=new Map<number,number>();
  byRound.forEach((team,index)=>roundRanks.set(team.teamId,index&&team.roundPoints===byRound[index-1].roundPoints?roundRanks.get(byRound[index-1].teamId)!:index+1));
  const byTotal=[...teams].sort((a,b)=>a.total-b.total||a.teamId-b.teamId),overallRanks=new Map<number,number>();
  byTotal.forEach((team,index)=>overallRanks.set(team.teamId,index&&team.total===byTotal[index-1].total?overallRanks.get(byTotal[index-1].teamId)!:index+1));
  return byTotal.map(team=>({...team,roundRank:roundRanks.get(team.teamId)||1,overallRank:overallRanks.get(team.teamId)||1}));
}
export function rankPlayersByTotal(players:Player[]):Player[] {
  return [...players].sort((a,b)=>a.score-b.score||a.seat-b.seat);
}
export function playerTotalRank(players:Player[],playerId:string):number {
  const player=players.find(candidate=>candidate.id===playerId);if(!player)return 0;
  return 1+players.filter(candidate=>candidate.score<player.score).length;
}
export function resetMatchBadgeHistory(s:GameState):GameState{return {...s,matchBadges:[]};}
export function createDeck():Tile[] {
  const deck:Tile[]=[];let id=1;
  for(const color of COLORS)for(let number=1;number<=13;number++)for(let copy=0;copy<2;copy++)deck.push({id:id++,color,number,fakeJoker:false});
  deck.push({id:id++,color:null,number:null,fakeJoker:true},{id:id,color:null,number:null,fakeJoker:true});
  return deck;
}
export function shuffled<T>(input:T[],random=Math.random):T[]{const a=[...input];for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a;}
export function takeIndicator(deck:Tile[]):Tile {
  const index=deck.findIndex(tile=>!tile.fakeJoker&&tile.color!==null&&tile.number!==null);
  if(index<0)throw new Error('Gösterge taşı bulunamadı');
  return deck.splice(index,1)[0];
}
export function jokerFromIndicator(indicator:Tile):{color:TileColor;number:number} {
  if(indicator.fakeJoker||!indicator.color||!indicator.number)throw new Error('Gösterge taşı geçersiz; yeniden dağıtın');
  return {color:indicator.color,number:indicator.number===13?1:indicator.number+1};
}
export function startRound(state:GameState,randomStarter=Math.random):GameState {
  if(state.players.length!==4)throw new Error('Oyun için dört oyuncu gerekli');
  const deck=shuffled(createDeck()),indicator=takeIndicator(deck),joker=jokerFromIndicator(indicator);
  const players=[...state.players].sort((a,b)=>a.seat-b.seat);
  const eligibleStarters=state.roundStarterId&&players.some(player=>player.id===state.roundStarterId)
    ?players.filter(player=>player.id!==state.roundStarterId)
    :players;
  const randomValue=randomStarter();
  const randomIndex=Number.isFinite(randomValue)?Math.min(eligibleStarters.length-1,Math.max(0,Math.floor(randomValue*eligibleStarters.length))):0;
  const starter=eligibleStarters[randomIndex];
  const starterIndex=players.findIndex(player=>player.id===starter.id);
  const dealOrder=players.slice(starterIndex).concat(players.slice(0,starterIndex));
  const hands:Record<string,Tile[]>={};state.players.forEach(p=>hands[p.id]=[]);
  // The randomly selected starter receives 22 tiles; the remaining seats receive 21.
  for(const player of dealOrder)for(let i=0;i<(player.id===starter.id?22:21);i++)hands[player.id].push(deck.pop()!);
  let next:GameState={...state,status:'playing',hands,stock:deck,discard:[],throwsByPlayer:Object.fromEntries(state.players.map(p=>[p.id,[]])),indicator,joker,recognizedRealOkeyIds:[],turnPlayerId:starter.id,roundStarterId:starter.id,phase:'discard',melds:[],roundAutoStartAt:null,message:'İlk oyuncu taş atarak başlıyor',turnStartedAt:null,turnDeadlineAt:null,turnId:null,roundScoreStart:Object.fromEntries(state.players.map(player=>[player.id,player.score])),serialOpeningHistory:[],pairOpeningHistory:[],meldLayUsage:[],processedMeldActions:[],realOkeyReclaimPenalties:[],takenDiscardUse:null,openingTurn:null,perCollectionUses:{},discardTakeUndo:null,undoOpen:null,roundFinishKind:null,roundFinisherId:null,scoredRound:null,revealedHands:null,roundRevealUntilAt:null,personalNotifications:{}};
  for(const player of state.players)next=appendPersonalNotification(next,player.id,`${state.round}. el başladı.`,false);
  return next;
}
export function startTurnClock(s:GameState,startedAt:number,turnId:string):GameState {
  if(s.status!=='playing'||!s.turnPlayerId)return {...s,turnStartedAt:null,turnDeadlineAt:null,turnId:null};
  const durationSeconds=TURN_DURATIONS.includes(s.settings.turnDurationSeconds)?s.settings.turnDurationSeconds:45;
  const openingTurn=s.openingTurn?.turnId===turnId?s.openingTurn:null;
  return {...s,turnStartedAt:startedAt,turnDeadlineAt:startedAt+durationSeconds*1000,turnId,openingTurn,meldLayUsage:[],processedMeldActions:[]};
}
export function clearTurnClock(s:GameState):GameState{return {...s,turnStartedAt:null,turnDeadlineAt:null,turnId:null};}
export function turnClockExpired(s:GameState,turnId:string,now:number):boolean {
  return s.status==='playing'&&!!s.turnPlayerId&&s.turnId===turnId&&typeof s.turnDeadlineAt==='number'&&now>=s.turnDeadlineAt;
}
export function playerCanAct(s:GameState,id:string){return s.status==='playing'&&s.turnPlayerId===id;}
export function drawStock(s:GameState,id:string):GameState {
  if(!playerCanAct(s,id)||s.phase!=='draw')throw new Error('Şu anda taş çekemezsiniz');
  if(!s.stock.length) return settleRound({...s,message:'Taş kalmadı; el sona erdi'},'stock',null,s.hands);
  const stock=[...s.stock],tile=stock.pop()!;
  const next={...s,stock,hands:{...s.hands,[id]:[...s.hands[id],tile]},phase:'discard' as const,message:'Taş çekildi',discardTakeUndo:null,undoOpen:null};
  return appendGameEvent(next,{kind:'draw-stock',playerId:id,scope:'public',tileId:tile.id});
}
export function takeDiscard(s:GameState,id:string):GameState {
  if(!playerCanAct(s,id)||s.phase!=='draw')throw new Error('Şu anda atılan taşı alamazsınız');
  if(!s.discard.length)throw new Error('Alınabilecek atılmış taş yok');
  const discard=[...s.discard],tile=discard.pop()!;
  if(isRealOkey(tile,s.joker))throw new Error('Centilmenlik kuralı gereği atılan okey taşını alamazsın');
  if(tileCanBeAddedToAnyOpenMeld(s,tile))throw new Error('Centilmenlik gereği atılan taşı alamazsın');
  const owner=s.players.find(player=>s.throwsByPlayer[player.id]?.at(-1)?.id===tile.id);
  if(!owner)throw new Error('Atılan taşın sahibi bulunamadı; taş alınamadı');
  const throwsByPlayer=owner?{...s.throwsByPlayer,[owner.id]:s.throwsByPlayer[owner.id].slice(0,-1)}:s.throwsByPlayer;
  const undo={playerId:id,tileId:tile.id,ownerId:owner.id,turnId:s.turnId,stockCount:s.stock.length};
  const next={...s,discard,throwsByPlayer,hands:{...s.hands,[id]:[...s.hands[id],tile]},phase:'discard' as const,message:'Yerdeki son taş alındı',discardTakeUndo:undo,takenDiscardUse:s.turnId?{playerId:id,tileId:tile.id,ownerId:owner.id,turnId:s.turnId,used:false}:null,undoOpen:null};
  return appendGameEvent(next,{kind:'draw-discard',playerId:id,scope:'public',tileId:tile.id});
}
export function returnTakenDiscard(s:GameState,id:string):GameState {
  if(!playerCanAct(s,id)||s.phase!=='discard')throw new Error('Alınan taş yalnızca aynı turda, taş atılmadan geri bırakılabilir');
  const undo=s.discardTakeUndo;
  if(!undo||!undo.turnId||undo.playerId!==id||undo.turnId!==s.turnId)throw new Error('Geri bırakılabilecek bir yerden alınan taş yok');
  if(s.takenDiscardUse?.playerId===id&&s.takenDiscardUse.turnId===s.turnId&&s.takenDiscardUse.used)throw new Error('Yerden alınan taş zaten açılışta veya işlemede kullanıldı; geri bırakılamaz');
  if(s.stock.length!==undo.stockCount)throw new Error('Taş çekildiği için alınan taş geri bırakılamaz');
  const hand=[...(s.hands[id]||[])],tileIndex=hand.findIndex(tile=>tile.id===undo.tileId);
  if(tileIndex<0)throw new Error('Alınan taş artık elinizde değil');
  const tile=hand[tileIndex],owner=s.players.find(player=>player.id===undo.ownerId);
  if(!owner)throw new Error('Taşı atan oyuncu masada bulunamadı');
  const ownerThrows=s.throwsByPlayer[owner.id]||[];
  if(ownerThrows.some(candidate=>candidate.id===tile.id)||s.discard.some(candidate=>candidate.id===tile.id))throw new Error('Alınan taşın atık alanı değişti; geri bırakma iptal edildi');
  hand.splice(tileIndex,1);
  return {...s,hands:{...s.hands,[id]:hand},discard:[...s.discard,tile],throwsByPlayer:{...s.throwsByPlayer,[owner.id]:[...ownerThrows,tile]},phase:'draw',message:'Yerden alınan taş geri bırakıldı',discardTakeUndo:null,takenDiscardUse:null,undoOpen:null};
}
export function discardTile(s:GameState,id:string,tileId:number,cause:'manual'|'timeout'='manual'):GameState {
  if(!playerCanAct(s,id)||s.phase!=='discard')throw new Error('Önce taş çekmelisiniz');
  const taken=s.takenDiscardUse;
  if(taken?.playerId===id&&taken.turnId===s.turnId&&!taken.used)throw new Error('Soldan aldığınız taşı aynı turda el açarak veya işleyerek kullanmalısınız; kullanamıyorsanız GERİ BIRAKın');
  const hand=[...(s.hands[id]||[])],index=hand.findIndex(t=>t.id===tileId);if(index<0)throw new Error('Bu taş ıstakanızda yok');
  const [tile]=hand.splice(index,1);const hands={...s.hands,[id]:hand};const discard=[...s.discard,tile];const throwsByPlayer={...s.throwsByPlayer,[id]:[...(s.throwsByPlayer[id]||[]),tile]};
  const player=s.players.find(candidate=>candidate.id===id)!;
  let next:GameState={...s,hands,discard,throwsByPlayer,discardTakeUndo:null,takenDiscardUse:null,openingTurn:null,undoOpen:null};
  const realOkey=isRealOkey(tile,s.joker),workable=!realOkey&&isPenaltyDiscardTile(s,tile);
  if(realOkey)next=appendPublicEvent(next,`${player.name} okey attı`,Date.now(),{kind:'penalty',playerId:id,points:101});
  else if(workable)next=appendPublicEvent(next,`${player.name} işlek taş attı`,Date.now(),{kind:'penalty',playerId:id,points:101});
  if(realOkey||workable){
    const reason:RoundPenalty['reason']=cause==='timeout'?'timeout':realOkey?'real-okey-discard':'workable-discard';
    const detail=realOkey?'gerçek okey':'işlek taş';
    const notification=cause==='timeout'
      ?`Süre dolduğu için ${detail} attınız; 101 ceza puanı aldınız.`
      :`${realOkey?'Gerçek okey':'İşlek taş'} attığınız için 101 ceza puanı aldınız.`;
    next={...next,players:next.players.map(candidate=>candidate.id===id?{...candidate,score:candidate.score+101}:candidate),penaltyHistory:[...(next.penaltyHistory||[]),{round:next.round,playerId:id,points:101,reason}]};
    next=appendPersonalNotification(next,id,notification,true);
  }
  next=appendGameEvent(next,{kind:realOkey||workable?'penalty':'discard',playerId:id,scope:'public',tileId:tile.id,...(realOkey||workable?{points:101}:{})});
  if(hand.length===0){
    const okey=isRealOkey(tile,s.joker),kind:RoundFinishKind=player.pairMode?(okey?'pair-okey':'pair'):(okey?'okey':'normal');
    next={...next,message:`${player.name} eli bitirdi`};
    return settleRound(next,kind,id,hands);
  }
  if(!s.stock.length)return settleRound({...next,message:'Taş kalmadı; el sona erdi'},'stock',null,hands);
  const current=s.players.findIndex(p=>p.id===id);const nextPlayer=s.players[(current+1)%4];
  return {...next,turnPlayerId:nextPlayer.id,phase:'draw',message:`${nextPlayer.name} oynuyor`};
}
function tileCanBeAddedToAnyOpenMeld(s:GameState,tile:Tile):boolean {
  if(!s.melds.length)return false;
  // The next player starts with fresh per-end allowances, so a discard is
  // considered playable independently of the discarder’s current-turn usage.
  const nextTurnState=s.meldLayUsage.length?{...s,meldLayUsage:[]}:s;
  return s.melds.some(meld=>!!resolveMeldExtension(nextTurnState,meld,tile,'auto')||!!reclaimableRealOkey(nextTurnState,meld,tile));
}
/** Uses the same authoritative test as discardTile and timeout scoring without changing penalty rules. */
export function isPenaltyDiscardTile(s:GameState,tile:Tile):boolean {
  return isRealOkey(tile,s.joker)||tileCanBeAddedToAnyOpenMeld(s,tile);
}
export function autoPlayTimedOutTurn(s:GameState,turnId:string,now:number,random=Math.random):GameState|null {
  if(!turnClockExpired(s,turnId,now)||!s.turnPlayerId)return null;
  const playerId=s.turnPlayerId,player=s.players.find(candidate=>candidate.id===playerId);
  if(!player)return null;
  let ready=s;
  const taken=pendingTakenDiscard(s,playerId);
  if(taken){
    const takenTile=(ready.hands[playerId]||[]).find(tile=>tile.id===taken.tileId);
    if(player.opened&&takenTile){
      // A lay consumes the drawn tile and still needs a separate discard; a
      // reclaim swaps tiles and is valid even when only one tile remains.
      if((ready.hands[playerId]||[]).length>1){
        const extension=ready.melds.map(meld=>({meld,result:resolveMeldExtension(ready,meld,takenTile,'auto')})).find(entry=>entry.result);
        if(extension?.result)ready=addToMeld(ready,playerId,takenTile.id,extension.meld.id,extension.result.side==='group'?'group':extension.result.side,turnId,`timeout-lay-${turnId}-${takenTile.id}`);
      }
      if(ready===s){
        const reclaim=ready.melds.map(meld=>({meld,result:reclaimableRealOkey(ready,meld,takenTile)})).find(entry=>entry.result);
        if(reclaim?.result)ready=reclaimRealOkey(ready,playerId,reclaim.meld.id,reclaim.result.realOkey.id,takenTile.id,turnId,`timeout-reclaim-${turnId}-${takenTile.id}`);
      }
    }
    if(ready===s){
      ready=returnTakenDiscard(ready,playerId);
      ready=drawStock(ready,playerId);
      if(ready.status!=='playing')return clearTurnClock(ready);
    }
  }else if(s.phase==='draw'){
    ready=drawStock(s,playerId);
    if(ready.status!=='playing')return clearTurnClock(ready);
  }
  const hand=ready.hands[playerId]||[];
  if(!hand.length)return null;
  const sample=random();
  const randomValue=Number.isFinite(sample)?Math.min(0.999999999,Math.max(0,sample)):0;
  const tile=hand[Math.floor(randomValue*hand.length)];
  const isPenalty=isPenaltyDiscardTile(ready,tile);
  const next=discardTile(ready,playerId,tile.id,'timeout');
  return clearTurnClock({...next,message:isPenalty?`${player.name} süresi dolduğu için otomatik hamle yaptı`:`${player.name} süresi dolduğu için otomatik taş attı`});
}
export function isRealOkey(tile:Tile,joker:GameState['joker']):boolean {
  return !tile.fakeJoker&&!!joker&&tile.color===joker.color&&tile.number===joker.number;
}
export function effectiveTile(t:Tile,joker:GameState['joker']):{color:TileColor|null;number:number|null;wild:boolean} {
  if(t.fakeJoker)return joker?{color:joker.color,number:joker.number,wild:false}:{color:null,number:null,wild:false};
  if(isRealOkey(t,joker))return {color:t.color,number:t.number,wild:true};
  return {color:t.color,number:t.number,wild:false};
}
export function updateRealOkeyRecognition(s:GameState,playerId:string,tileIds:number[],operation:'toggle'|'mark'):GameState {
  if(s.status!=='playing'||!s.players.some(player=>player.id===playerId))throw new Error('Gerçek okey yalnızca oyun sırasında tanınabilir');
  if(!Array.isArray(tileIds)||tileIds.length<1||tileIds.length>22||tileIds.some(id=>!Number.isSafeInteger(id))||new Set(tileIds).size!==tileIds.length)throw new Error('Gerçek okey taşları geçersiz');
  if(operation==='toggle'&&tileIds.length!==1)throw new Error('Tek bir gerçek okeyi işaretleyin');
  const hand=s.hands[playerId]||[];
  for(const tileId of tileIds){const tile=hand.find(candidate=>candidate.id===tileId);if(!tile||!isRealOkey(tile,s.joker))throw new Error('İşaretlenecek taş elinizdeki gerçek okey olmalı');}
  const recognized=new Set(s.recognizedRealOkeyIds||[]);
  if(operation==='toggle'){const tileId=tileIds[0];if(recognized.has(tileId))recognized.delete(tileId);else recognized.add(tileId);}
  else tileIds.forEach(tileId=>recognized.add(tileId));
  const nextIds=[...recognized].sort((a,b)=>a-b);
  if(nextIds.length===s.recognizedRealOkeyIds.length&&nextIds.every((tileId,index)=>tileId===s.recognizedRealOkeyIds[index]))return s;
  return {...s,recognizedRealOkeyIds:nextIds};
}
/** A real okey can stand in for the matching copy; a fake okey only uses its represented face. */
export function isValidPair(tiles:Tile[],joker:GameState['joker']):boolean {
  if(tiles.length!==2)return false;
  const [first,second]=tiles;
  if(first.fakeJoker&&second.fakeJoker)return true;
  const firstFace=effectiveTile(first,joker),secondFace=effectiveTile(second,joker);
  if(firstFace.wild&&secondFace.wild)return true;
  if(firstFace.wild)return secondFace.color!==null&&secondFace.number!==null;
  if(secondFace.wild)return firstFace.color!==null&&firstFace.number!==null;
  return firstFace.color!==null&&firstFace.number!==null&&firstFace.color===secondFace.color&&firstFace.number===secondFace.number;
}
/** Find a deterministic maximum set of disjoint pairs; wildcards cover highest-valued singles first. */
export function findRackPairGroups(tiles:Tile[],joker:GameState['joker']):number[][] {
  const buckets=new Map<string,Tile[]>(),wilds:Tile[]=[],indexById=new Map(tiles.map((tile,index)=>[tile.id,index]));
  for(const tile of tiles){
    const face=effectiveTile(tile,joker);
    if(face.wild){wilds.push(tile);continue;}
    const key=face.color!==null&&face.number!==null?`${face.color}-${face.number}`:tile.fakeJoker?'fake-joker':`unmatched-${tile.id}`;
    const bucket=buckets.get(key)||[];bucket.push(tile);buckets.set(key,bucket);
  }
  const groups:number[][]=[],unmatched:Tile[]=[];
  for(const bucket of buckets.values()){
    for(let index=0;index+1<bucket.length;index+=2){
      const pair=[bucket[index],bucket[index+1]];
      if(isValidPair(pair,joker))groups.push(pair.map(tile=>tile.id));
      else unmatched.push(bucket[index],bucket[index+1]);
    }
    if(bucket.length%2)unmatched.push(bucket[bucket.length-1]);
  }
  // After natural pairs are fixed, pair real okeys with the highest-value
  // unmatched natural tiles first. Pair count stays maximal while hand points
  // left outside pairs are minimized.
  unmatched.sort((a,b)=>{
    const aNumber=effectiveTile(a,joker).number??0,bNumber=effectiveTile(b,joker).number??0;
    return bNumber-aNumber||(indexById.get(a.id)??0)-(indexById.get(b.id)??0);
  });
  let wildIndex=0;
  for(const tile of unmatched){
    if(wildIndex>=wilds.length)break;
    const pair=[tile,wilds[wildIndex++]];
    if(isValidPair(pair,joker))groups.push(pair.map(member=>member.id));
  }
  while(wildIndex+1<wilds.length){groups.push([wilds[wildIndex].id,wilds[wildIndex+1].id]);wildIndex+=2;}
  return groups.sort((a,b)=>Math.min(...a.map(id=>indexById.get(id)??Infinity))-Math.min(...b.map(id=>indexById.get(id)??Infinity)));
}
function validNaturalMeld(tiles:Tile[],joker:GameState['joker']):boolean {
  if(tiles.length<3)return false;const eff=tiles.map(t=>effectiveTile(t,joker));const wild=eff.filter(t=>t.wild).length,natural=eff.filter(t=>!t.wild);
  // Same-number groups can use any left-to-right colour order, but colours must be unique.
  const nums=new Set(natural.map(t=>t.number));if(nums.size<=1){const present=new Set(natural.map(t=>t.color));if(present.size===natural.length&&tiles.length<=4&&present.size+wild===tiles.length)return true;}
  // Runs respect the physical left-to-right order. Wild tiles fill their position in sequence.
  const runColor=natural[0]?.color;if(runColor&&natural.every(t=>t.color===runColor)&&tiles.length<=13){for(let start=1;start<=14-tiles.length;start++){if(tiles.every((_,index)=>eff[index].wild||(eff[index].color===runColor&&eff[index].number===start+index)))return true;}}
  return false;
}
/** Return the points represented by a valid serial/group meld, including the face a real okey substitutes. */
export function serialMeldPointValue(tiles:Tile[],joker:GameState['joker']):number|null {
  if(!validNaturalMeld(tiles,joker))return null;
  const faces=tiles.map(tile=>effectiveTile(tile,joker)),natural=faces.filter(face=>!face.wild);
  if(!natural.length)return null;
  if(new Set(natural.map(face=>face.number)).size<=1){
    const number=natural[0].number;
    return number===null?null:tiles.length*number;
  }
  const color=natural[0].color;
  if(!color)return null;
  for(let start=1;start<=14-tiles.length;start++){
    if(tiles.every((_,index)=>faces[index].wild||(faces[index].color===color&&faces[index].number===start+index))){
      return faces.reduce((sum,face,index)=>sum+(face.wild?start+index:(face.number||0)),0);
    }
  }
  return null;
}
export function findRackMeldGroups(tiles:Tile[],joker:GameState['joker'],blockedBefore:number[]=[]):number[][] {
  // `tiles` must be one shelf's physical left-to-right order (the rack row is flexed in that same X order).
  // Never sort these by face value: a break in the player's layout must break the detected run too.
  const blocked=new Set(blockedBefore);
  const groups:number[][]=[];
  for(let index=0;index<tiles.length;){
    let best:Tile[]=[];
    for(let end=Math.min(tiles.length,index+13);end>=index+3;end--){const candidate=tiles.slice(index,end);if(candidate.slice(1).some(tile=>blocked.has(tile.id)))continue;if(validNaturalMeld(candidate,joker)){best=candidate;break}}
    if(best.length){groups.push(best.map(tile=>tile.id));index+=best.length;continue}
    const first=tiles[index],second=tiles[index+1];
    const samePair=!!first&&!!second&&!blocked.has(second.id)&&isValidPair([first,second],joker);
    if(samePair){groups.push([first.id,second.id]);index+=2}else index++;
  }
  return groups;
}
export function analyzeRackMelds(tiles:Tile[],joker:GameState['joker'],blockedBefore:number[]=[] ) {
  const blocked=new Set(blockedBefore);
  let seriesTotal=0, pairCount=0, index=0;
  while(index<tiles.length){
    let best:Tile[]=[];
    for(let end=index+3;end<=tiles.length;end++){
      const candidate=tiles.slice(index,end);
      if(candidate.slice(1).some(tile=>blocked.has(tile.id)))continue;
      if(validNaturalMeld(candidate,joker))best=candidate;
    }
    if(best.length){seriesTotal+=best.reduce((sum,t)=>sum+(effectiveTile(t,joker).number||0),0);index+=best.length;continue;}
    const first=tiles[index],second=tiles[index+1];
    if(first&&second&&!blocked.has(second.id)&&isValidPair([first,second],joker)){pairCount++;index+=2;continue;}
    index++;
  }
  return {seriesTotal,pairCount};
}

/**
 * Detect melds from the player's physical 2D rack layout. Coordinates in each
 * placement are normalized to the rack; geometry converts them to pixels.
 * Separate rows and visible gaps are hard boundaries between candidate groups.
 */
export function analyzePositionedRackMelds(
  placements:RackTilePlacement[],
  geometry:RackGeometry,
  joker:GameState['joker'],
):RackMeldAnalysis {
  type Positioned={tile:Tile;x:number;y:number;sourceOrder:number};
  type Row={tiles:Positioned[];centerY:number};
  const width=Math.max(1,geometry.width),height=Math.max(1,geometry.height);
  const tileWidth=Math.max(1,geometry.tileWidth),tileHeight=Math.max(1,geometry.tileHeight);
  const rowTolerance=tileHeight*0.55;
  // A small finger-width gap is allowed; a deliberate group gap starts a new cluster.
  const maxNeighborDistance=tileWidth+Math.min(10,tileWidth*.2);
  // Overlapped tiles remain freely placeable but cannot visually form a pair/per.
  const minNeighborDistance=tileWidth*0.55;
  const positioned:Positioned[]=placements.map((entry,sourceOrder)=>({
    tile:entry.tile,
    x:entry.position.x*width,
    y:entry.position.y*height,
    sourceOrder,
  }));
  const rows:Row[]=[];
  const median=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2};
  positioned.sort((a,b)=>a.y-b.y||a.x-b.x||a.sourceOrder-b.sourceOrder);
  for(const item of positioned){
    let nearest:Row|undefined,nearestDistance=Infinity;
    for(const row of rows){const distance=Math.abs(item.y-row.centerY);if(distance<=rowTolerance&&distance<nearestDistance){nearest=row;nearestDistance=distance}}
    if(nearest){nearest.tiles.push(item);nearest.centerY=median(nearest.tiles.map(tile=>tile.y))}
    else rows.push({tiles:[item],centerY:item.y});
  }
  rows.sort((a,b)=>a.centerY-b.centerY);
  const orderedTiles:Tile[]=[],groups:number[][]=[];
  const addCandidateCluster=(cluster:Positioned[])=>{
    if(!cluster.length)return;
    groups.push(...findRackMeldGroups(cluster.map(item=>item.tile),joker));
  };
  for(const row of rows){
    row.tiles.sort((a,b)=>a.x-b.x||a.sourceOrder-b.sourceOrder);
    orderedTiles.push(...row.tiles.map(item=>item.tile));
    let cluster:Positioned[]=[];
    for(const item of row.tiles){
      const previous=cluster.at(-1);
      if(previous){
        const dx=item.x-previous.x,dy=Math.abs(item.y-previous.y);
        if(dx>maxNeighborDistance||dx<minNeighborDistance||dy>rowTolerance){
          addCandidateCluster(cluster);
          cluster=[];
        }
      }
      cluster.push(item);
    }
    addCandidateCluster(cluster);
  }
  const tileById=new Map(placements.map(entry=>[entry.tile.id,entry.tile]));
  let seriesTotal=0,pairCount=0;
  for(const group of groups){
    if(group.length===2){pairCount++;continue}
    const tiles=group.map(id=>tileById.get(id)).filter((tile):tile is Tile=>!!tile);
    seriesTotal+=serialMeldPointValue(tiles,joker)||0;
  }
  return {orderedTiles,groups,seriesTotal,pairCount};
}

function serialOpeningTeamId(s:GameState,playerId:string):0|1|null {
  if(s.settings.mode!=='pairs')return null;
  const seat=s.players.find(player=>player.id===playerId)?.seat;
  return seat===0||seat===2?0:seat===1||seat===3?1:null;
}
export function serialOpeningThreshold(s:GameState,playerId:string):number {
  if(!s.settings.folding)return 101;
  const teamId=serialOpeningTeamId(s,playerId);
  const previous=[...(s.serialOpeningHistory||[])].reverse().find(opening=>
    opening.round===s.round&&(s.settings.mode==='solo'||opening.teamId!==teamId),
  );
  return previous?previous.points+1:101;
}
function pairOpeningTeamId(s:GameState,playerId:string):0|1|null {
  if(s.settings.mode!=='pairs')return null;
  const seat=s.players.find(player=>player.id===playerId)?.seat;
  return seat===0||seat===2?0:seat===1||seat===3?1:null;
}
export function pairOpeningThreshold(s:GameState,playerId:string):number {
  if(!s.settings.folding)return 5;
  const teamId=pairOpeningTeamId(s,playerId);
  const previous=[...(s.pairOpeningHistory||[])].reverse().find(opening=>
    opening.round===s.round&&(s.settings.mode==='solo'||opening.teamId!==teamId),
  );
  return previous?previous.pairCount+1:5;
}
function realOkeyAssignmentsForMeld(tiles:Tile[],kind:Meld['kind'],joker:GameState['joker'],previous:Record<number,MeldFace>={}):Record<number,MeldFace>|null {
  const real=tiles.filter(tile=>isRealOkey(tile,joker));
  if(!real.length)return {};
  if(kind==='pairs'){
    if(tiles.length!==2)return null;
    if(real.length===2){
      const first=previous[real[0].id],second=previous[real[1].id];
      return first&&second&&first.color===second.color&&first.number===second.number?{...previous}:{};
    }
    const okey=real[0],other=tiles.find(tile=>tile.id!==okey.id)!;
    const face=effectiveTile(other,joker);
    if(!face.color||!face.number)return null;
    const saved=previous[okey.id];
    if(saved&&(saved.color!==face.color||saved.number!==face.number))return null;
    return {...previous,[okey.id]:{color:face.color,number:face.number}};
  }
  if(kind==='run'){
    if(tiles.length<3||tiles.length>13)return null;
    for(const color of COLORS){
      for(let start=1;start<=14-tiles.length;start++){
        const assignments={...previous};let matches=true;
        for(let index=0;index<tiles.length;index++){
          const tile=tiles[index],expected={color,number:start+index};
          if(isRealOkey(tile,joker)){
            const saved=assignments[tile.id];
            if(saved&&(saved.color!==expected.color||saved.number!==expected.number)){matches=false;break;}
            assignments[tile.id]=expected;
          }else{
            const face=effectiveTile(tile,joker);
            if(face.color!==expected.color||face.number!==expected.number){matches=false;break;}
          }
        }
        if(matches)return assignments;
      }
    }
    return null;
  }
  if(tiles.length<3||tiles.length>4)return null;
  const fixed=tiles.filter(tile=>!isRealOkey(tile,joker)).map(tile=>effectiveTile(tile,joker));
  if(!fixed.length)return null;
  const number=fixed[0].number;
  if(number===null||fixed.some(face=>face.number!==number||face.color===null))return null;
  const assignments={...previous},colors=new Set<TileColor>(fixed.map(face=>face.color as TileColor));
  for(const tile of real){
    const saved=assignments[tile.id];
    if(!saved)continue;
    if(saved.number!==number||colors.has(saved.color))return null;
    colors.add(saved.color);
  }
  for(const tile of real){
    if(assignments[tile.id])continue;
    const color=COLORS.find(candidate=>!colors.has(candidate));
    if(!color)return null;
    assignments[tile.id]={color,number};colors.add(color);
  }
  return assignments;
}
function meldFacesAreValid(tiles:Tile[],kind:Meld['kind'],joker:GameState['joker'],assignments:Record<number,MeldFace>):boolean {
  if(kind==='pairs'){
    if(tiles.length!==2||!isValidPair(tiles,joker))return false;
    const real=tiles.filter(tile=>isRealOkey(tile,joker));
    if(real.length===2){const first=assignments[real[0].id],second=assignments[real[1].id];return !first&&!second||!!first&&!!second&&first.color===second.color&&first.number===second.number;}
    if(real.length===1){const replacement=assignments[real[0].id],other=effectiveTile(tiles.find(tile=>tile.id!==real[0].id)!,joker);return !!replacement&&replacement.color===other.color&&replacement.number===other.number;}
    const faces=tiles.map(tile=>effectiveTile(tile,joker));return !!faces[0].color&&faces[0].color===faces[1].color&&faces[0].number===faces[1].number;
  }
  if(kind==='run'){
    if(tiles.length<3||tiles.length>13)return false;
    const faces=tiles.map(tile=>isRealOkey(tile,joker)?assignments[tile.id]||null:effectiveTile(tile,joker));
    const first=faces[0];
    return !!first?.color&&!!first.number&&faces.every((face,index)=>!!face&&face.color===first.color&&face.number===first.number!+index&&face.number<=13);
  }
  if(tiles.length<3||tiles.length>4)return false;
  const faces=tiles.map(tile=>isRealOkey(tile,joker)?assignments[tile.id]||null:effectiveTile(tile,joker));
  const first=faces[0];
  return !!first?.color&&!!first.number&&faces.every(face=>!!face&&face.number===first.number)&&new Set(faces.map(face=>face!.color)).size===faces.length;
}
function pendingTakenDiscard(s:GameState,playerId:string):TakenDiscardUse|null {
  const taken=s.takenDiscardUse;
  return taken&&taken.playerId===playerId&&taken.turnId===s.turnId&&!taken.used?taken:null;
}
function assertTakenDiscardUsedBy(s:GameState,playerId:string,usedTileIds:Iterable<number>,operation:TakenDiscardUse['usedBy']):TakenDiscardUse|null {
  const pending=pendingTakenDiscard(s,playerId);
  if(!pending)return s.takenDiscardUse;
  if(!new Set(usedTileIds).has(pending.tileId))throw new Error('Soldan aldığınız taşı aynı turda açılışta veya işlemede kullanmalısınız; kullanamıyorsanız GERİ BIRAKın');
  return {...pending,used:true,usedBy:operation};
}
function actionReplay(s:GameState,playerId:string,requestId:string|undefined,fingerprint:string):'new'|'replay' {
  if(!requestId)return 'new';
  if(!s.turnId||requestId.length<1||requestId.length>128)throw new Error('İşleme istek kimliği geçersiz');
  const previous=s.processedMeldActions.find(entry=>entry.turnId===s.turnId&&entry.playerId===playerId&&entry.requestId===requestId);
  if(!previous)return 'new';
  if(previous.fingerprint!==fingerprint)throw new Error('Bu istek kimliği başka bir işlemde kullanıldı');
  return 'replay';
}
function saveActionReplay(s:GameState,playerId:string,requestId:string|undefined,fingerprint:string):GameState {
  if(!requestId||!s.turnId)return s;
  return {...s,processedMeldActions:[...(s.processedMeldActions||[]),{turnId:s.turnId,playerId,requestId,fingerprint}]};
}
function openingTurnFor(s:GameState,id:string,meldIds:string[]):OpeningTurn|null {
  if(!s.turnId)return null;
  const previous=s.openingTurn?.playerId===id&&s.openingTurn.turnId===s.turnId?s.openingTurn:null;
  return {playerId:id,turnId:s.turnId,meldIds:[...new Set([...meldIds,...(previous?.meldIds||[])])],wrongPerSelections:previous?.wrongPerSelections||0,perCollectionLocked:previous?.perCollectionLocked||false};
}
function undoOpenSnapshot(s:GameState,id:string,hand:Tile[],player:Player,openingKind:'series'|'pairs'):UndoOpenSnapshot {
  return {playerId:id,turnId:s.turnId,hand,melds:s.melds,opened:player.opened,pairMode:player.pairMode,openingKind,serialOpeningHistory:s.serialOpeningHistory||[],pairOpeningHistory:s.pairOpeningHistory||[],discardTakeUndo:s.discardTakeUndo??null,takenDiscardUse:s.takenDiscardUse??null,playerScores:Object.fromEntries(s.players.map(candidate=>[candidate.id,candidate.score])),realOkeyReclaimPenalties:[...(s.realOkeyReclaimPenalties||[])],meldLayUsage:[...(s.meldLayUsage||[])],perCollectionUsesAtOpen:s.perCollectionUses[id]||0};
}
export function openSeriesMelds(s:GameState,id:string,groups:number[][]):GameState {
  if(!playerCanAct(s,id)||s.phase!=='discard')throw new Error('Önce sıranıza gelmeli ve taş çekmelisiniz');
  if(!Array.isArray(groups)||groups.length===0)throw new Error('Açılacak seri gruplarını seçin');
  const player=s.players.find(p=>p.id===id)!;
  if(player.opened)throw new Error('İlk açılışınızı zaten yaptınız; yeni seriler için SERİ İŞLE kullanın');
  if(player.pairMode)throw new Error('Çift açan oyuncu seri per indiremez');
  const hand=[...(s.hands[id]||[])],usedIds=new Set<number>();
  const tiles=groups.map(group=>{
    if(!Array.isArray(group)||group.length<3)throw new Error('Seri açılışı için her grup en az üç taş olmalı');
    const groupTiles=group.map(tileId=>{
      if(!Number.isSafeInteger(tileId))throw new Error('Açılış gruplarındaki taş kimliği geçersiz');
      if(usedIds.has(tileId))throw new Error('Aynı taş birden fazla açılış grubunda kullanılamaz');
      const tile=hand.find(candidate=>candidate.id===tileId);
      if(!tile)throw new Error('Seçilen taş elinizde yok');
      usedIds.add(tileId);
      return tile;
    });
    if(!validNaturalMeld(groupTiles,s.joker))throw new Error('Seçilen perlerden biri geçersiz');
    return groupTiles;
  });
  const takenDiscardUse=assertTakenDiscardUsedBy(s,id,usedIds,'series-open');
  if(usedIds.size>=hand.length)throw new Error('Taş atabilmek için ıstakada en az bir taş bırakmalısınız');
  const points=tiles.reduce((total,group)=>total+(serialMeldPointValue(group,s.joker)||0),0);
  const threshold=serialOpeningThreshold(s,id);
  if(points<threshold)throw new Error(`Açılış başarısız! Gerekli puan: ${threshold} — Mevcut puan: ${points}. Ceza uygulanmadı.`);
  const teamId=serialOpeningTeamId(s,id),history=s.serialOpeningHistory||[];
  const opening={round:s.round,playerId:id,teamId,points,tileIds:[...usedIds]};
  const openingNumber=history.length+1;
  const melds:Meld[]=groups.map((group,index)=>{const kind=classify(tiles[index],s.joker),assignments=realOkeyAssignmentsForMeld(tiles[index],kind,s.joker);if(!assignments)throw new Error('Gerçek okeyin per içindeki temsil taşı belirlenemedi');return{id:`${id}-${Date.now()}-${openingNumber}-${index}`,ownerId:id,tileIds:[...group],tiles:tiles[index],kind,realOkeyAssignments:assignments}});
  let next:GameState={
    ...s,
    hands:{...s.hands,[id]:hand.filter(tile=>!usedIds.has(tile.id))},
    melds:[...s.melds,...melds],
    players:s.players.map(candidate=>candidate.id===id?{...candidate,opened:true}:candidate),
    serialOpeningHistory:[...history,opening],
    takenDiscardUse,
    message:`${player.name} seri açtı (${points} puan)`,
    discardTakeUndo:null,
    openingTurn:openingTurnFor(s,id,melds.map(meld=>meld.id)),
    undoOpen:undoOpenSnapshot(s,id,hand,player,'series'),
  };
  next=appendGameEvent(next,{kind:'open-series',playerId:id,meldIds:melds.map(meld=>meld.id)});
  return appendPersonalNotification(next,id,`Seri açtınız: ${points} puan.`,false);
}
export function openMelds(s:GameState,id:string,groups:number[][],pairMode=false):GameState {
  if(!pairMode)return openSeriesMelds(s,id,groups);
  if(!playerCanAct(s,id)||s.phase!=='discard')throw new Error('Önce sıranıza gelmeli ve taş çekmelisiniz');
  if(!Array.isArray(groups)||groups.length===0)throw new Error('Açılacak geçerli çift gruplarını seçin');
  const player=s.players.find(p=>p.id===id)!;
  if(player.opened)throw new Error('İlk açılışınızı zaten yaptınız; yeni çiftler için ÇİFT İŞLE kullanın');
  const hand=[...(s.hands[id]||[])],usedIds=new Set<number>();
  const tiles=groups.map(group=>{
    if(!Array.isArray(group)||group.length!==2)throw new Error('Çift açılışındaki her grup tam iki taştan oluşmalı');
    const pair=group.map(tileId=>{
      if(!Number.isSafeInteger(tileId))throw new Error('Çift açılışındaki taş kimliği geçersiz');
      if(usedIds.has(tileId))throw new Error('Aynı taş kimliği birden fazla çiftte kullanılamaz');
      const tile=hand.find(candidate=>candidate.id===tileId);
      if(!tile)throw new Error('Seçilen taş elinizde yok');
      usedIds.add(tileId);
      return tile;
    });
    if(!isValidPair(pair,s.joker))throw new Error('Seçilen gruplardan biri geçerli bir çift değil');
    return pair;
  });
  const takenDiscardUse=assertTakenDiscardUsedBy(s,id,usedIds,'pairs-open');
  if(usedIds.size>=hand.length)throw new Error('Taş atabilmek için ıstakada en az bir taş bırakmalısınız');
  const threshold=pairOpeningThreshold(s,id);
  if(groups.length<threshold)throw new Error(`Çift açılışı başarısız! Gerekli çift: ${threshold} — Mevcut çift: ${groups.length}. Ceza uygulanmadı.`);
  const remaining=hand.filter(tile=>!usedIds.has(tile.id));
  const history=s.pairOpeningHistory||[],teamId=pairOpeningTeamId(s,id),opening:PairOpening={round:s.round,playerId:id,teamId,pairCount:groups.length,tileIds:[...usedIds]};
  const openingNumber=history.length+1;
  const melds:Meld[]=groups.map((group,index)=>{const assignments=realOkeyAssignmentsForMeld(tiles[index],'pairs',s.joker);if(!assignments)throw new Error('Gerçek okeyin çift içindeki temsil taşı belirlenemedi');return{id:`${id}-${Date.now()}-pairs-${openingNumber}-${index}`,ownerId:id,tileIds:[...group],tiles:tiles[index],kind:'pairs',realOkeyAssignments:assignments}});
  const next:GameState={...s,hands:{...s.hands,[id]:remaining},melds:[...s.melds,...melds],players:s.players.map(candidate=>candidate.id===id?{...candidate,opened:true,pairMode:true}:candidate),pairOpeningHistory:[...history,opening],takenDiscardUse,message:`${player.name} çift açtı (${groups.length} çift)`,discardTakeUndo:null,openingTurn:openingTurnFor(s,id,melds.map(meld=>meld.id)),undoOpen:undoOpenSnapshot(s,id,hand,player,'pairs')};
  const withEvent=appendGameEvent(next,{kind:'open-pairs',playerId:id,meldIds:melds.map(meld=>meld.id)});
  return appendPersonalNotification(withEvent,id,`Çift açtınız: ${groups.length}/${threshold} çift.`,false);
}
export function finishFromHand(s:GameState,id:string,groups:number[][],finalTileId:number,pairMode:boolean,requestId:string,now=Date.now()):GameState {
  if(!requestId||requestId.length>128)throw new Error('Elden bitiş istek kimliği geçersiz');
  const fingerprint=JSON.stringify(['elden',groups,finalTileId,pairMode]);
  const processed=(s.processedOpeningAttempts||[]).find(entry=>entry.matchId===s.matchId&&entry.round===s.round&&entry.playerId===id&&entry.requestId===requestId);
  if(processed){if(processed.fingerprint!==fingerprint)throw new Error('Bu istek kimliği başka bir açılış işleminde kullanıldı');return s;}
  if(!playerCanAct(s,id)||s.phase!=='discard')throw new Error('Elden bitiş için sıranızda olmalı ve taş çekmiş olmalısınız');
  if(!Array.isArray(groups)||groups.length===0)throw new Error('Elden bitiş için geçerli perler seçin');
  const player=s.players.find(candidate=>candidate.id===id);if(!player)throw new Error('Oyuncu bulunamadı');
  if(player.opened)throw new Error('Elden bitiş yalnızca daha önce açılmamış oyuncu tarafından yapılabilir');
  if(pairMode&&player.pairMode)throw new Error('Çift açmış oyuncu elden bitiş yapamaz');
  const hand=[...(s.hands[id]||[])],finalTile=hand.find(tile=>tile.id===finalTileId);
  if(!finalTile)throw new Error('Bitiş için seçilen son taş elinizde bulunmalı');
  const usedIds=new Set<number>();
  const groupedTiles=groups.map(group=>{
    if(!Array.isArray(group)||(pairMode?group.length!==2:group.length<3))throw new Error(pairMode?'Elden çift açılışındaki her grup iki taştan oluşmalı':'Elden seri açılışındaki her grup en az üç taştan oluşmalı');
    const tiles=group.map(tileId=>{
      if(!Number.isSafeInteger(tileId)||tileId===finalTileId||usedIds.has(tileId))throw new Error('Elden bitiş gruplarında taş kimliği geçersiz veya tekrar kullanılmış');
      const tile=hand.find(candidate=>candidate.id===tileId);if(!tile)throw new Error('Elden bitiş için seçilen taş elinizde değil');
      usedIds.add(tileId);return tile;
    });
    if(pairMode?!isValidPair(tiles,s.joker):!validNaturalMeld(tiles,s.joker))throw new Error(pairMode?'Elden bitişte geçersiz çift var':'Elden bitişte geçersiz seri/per var');
    return tiles;
  });
  if(usedIds.size!==hand.length-1||hand.some(tile=>tile.id!==finalTileId&&!usedIds.has(tile.id)))throw new Error('Elden bitiş için son taş dışında elinizdeki bütün taşlar geçerli gruplarda kullanılmalı');
  const takenDiscardUse=assertTakenDiscardUsedBy(s,id,usedIds,pairMode?'pairs-open':'series-open');
  if(pairMode){const threshold=pairOpeningThreshold(s,id);if(groups.length<threshold)throw new Error(`Elden çift bitişi için gerekli çift sayısı: ${threshold} — Mevcut çift: ${groups.length}`);}
  else{const points=groupedTiles.reduce((sum,tiles)=>sum+(serialMeldPointValue(tiles,s.joker)||0),0),threshold=serialOpeningThreshold(s,id);if(points<threshold)throw new Error(`Elden açılışı için gerekli puan: ${threshold} — Mevcut puan: ${points}`);}
  const melds:Meld[]=groups.map((group,index)=>{
    const kind=pairMode?'pairs':classify(groupedTiles[index],s.joker),assignments=realOkeyAssignmentsForMeld(groupedTiles[index],kind,s.joker);
    if(!assignments)throw new Error('Elden bitişte gerçek okeyin temsil taşı belirlenemedi');
    return{id:`${id}-${s.matchId}-${s.round}-${s.turnId}-elden-${index}`,ownerId:id,tileIds:[...group],tiles:groupedTiles[index],kind,realOkeyAssignments:assignments};
  });
  const throwsByPlayer={...s.throwsByPlayer,[id]:[...(s.throwsByPlayer[id]||[]),finalTile]};
  const usedPoints=groupedTiles.reduce((sum,tiles)=>sum+(serialMeldPointValue(tiles,s.joker)||0),0);
  let next:GameState={...s,
    hands:{...s.hands,[id]:[]},
    discard:[...s.discard,finalTile],throwsByPlayer,
    melds:[...s.melds,...melds],
    players:s.players.map(candidate=>candidate.id===id?{...candidate,opened:true,pairMode}:candidate),
    serialOpeningHistory:pairMode?s.serialOpeningHistory:[...s.serialOpeningHistory,{round:s.round,playerId:id,teamId:serialOpeningTeamId(s,id),points:usedPoints,tileIds:[...usedIds]}],
    pairOpeningHistory:pairMode?[...s.pairOpeningHistory,{round:s.round,playerId:id,teamId:pairOpeningTeamId(s,id),pairCount:groups.length,tileIds:[...usedIds]}]:s.pairOpeningHistory,
    takenDiscardUse,openingTurn:null,undoOpen:null,discardTakeUndo:null,
    processedOpeningAttempts:[...(s.processedOpeningAttempts||[]),{matchId:s.matchId,round:s.round,turnId:s.turnId||'',playerId:id,requestId,fingerprint}],
    revealedHands:Object.fromEntries(s.players.map(candidate=>[candidate.id,candidate.id===id?[]:[...(s.hands[candidate.id]||[])]])),
    roundRevealUntilAt:now+ELDEN_REVEAL_DURATION_MS,
    message:`${player.name} ELDEN BİTTİ`,
  };
  next=settleRound(next,'elden',id,next.hands,now);
  return {...next,roundRevealUntilAt:now+ELDEN_REVEAL_DURATION_MS,roundFinishKind:'elden',roundFinisherId:id,message:`${player.name} ELDEN BİTTİ`};
}
function layNewMeldGroups(s:GameState,id:string,groups:number[][],asPairs:boolean,turnId:string|undefined,requestId:string|undefined):GameState {
  if(!Array.isArray(groups)||groups.length===0)throw new Error(asPairs?'İndirilecek geçerli çift grubu bulunamadı':'İndirilecek geçerli seri grubu bulunamadı');
  const action=asPairs?'lay-new-pairs':'lay-new-series',fingerprint=JSON.stringify([action,groups]);
  const replay=checkedMeldRequest(s,id,turnId,requestId,fingerprint);
  if(replay==='replay')return s;
  if(!playerCanAct(s,id)||s.phase!=='discard')throw new Error('Yeni per indirmek için sıranızda olmalı ve taş çekmiş olmalısınız');
  const player=s.players.find(candidate=>candidate.id===id);
  if(!player?.opened)throw new Error('Yeni per indirmek için önce el açmalısınız');
  if(asPairs){
    if(!player.pairMode&&!s.players.some(candidate=>candidate.pairMode))throw new Error('Çift indirebilmek için masada önce bir oyuncu çift açmış olmalı');
  }else if(player.pairMode)throw new Error('Çift açan oyuncu seri per indiremez');
  if(!Array.isArray(groups)||groups.length===0)throw new Error(asPairs?'İndirilecek geçerli çift grubu bulunamadı':'İndirilecek geçerli seri grubu bulunamadı');
  const hand=[...(s.hands[id]||[])],usedIds=new Set<number>();
  const tiles=groups.map(group=>{
    if(!Array.isArray(group)||(asPairs?group.length!==2:group.length<3))throw new Error(asPairs?'İndirilecek her çift tam iki taştan oluşmalı':'İndirilecek her seri en az üç taştan oluşmalı');
    const members=group.map(tileId=>{
      if(!Number.isSafeInteger(tileId))throw new Error('İndirilecek perde taş kimliği geçersiz');
      if(usedIds.has(tileId))throw new Error('Aynı taş kimliği birden fazla grupta kullanılamaz');
      const tile=hand.find(candidate=>candidate.id===tileId);
      if(!tile)throw new Error('Seçilen taş elinizde yok');
      usedIds.add(tileId);
      return tile;
    });
    if(asPairs?!isValidPair(members,s.joker):!validNaturalMeld(members,s.joker))throw new Error(asPairs?'Seçilen gruplardan biri geçerli bir çift değil':'Seçilen perlerden biri geçersiz');
    return members;
  });
  const takenDiscardUse=assertTakenDiscardUsedBy(s,id,usedIds,asPairs?'pairs-lay':'series-lay');
  if(usedIds.size>=hand.length)throw new Error('Taş atabilmek için ıstakada en az bir taş bırakmalısınız');
  const melds:Meld[]=groups.map((group,index)=>{
    const kind=asPairs?'pairs':classify(tiles[index],s.joker),assignments=realOkeyAssignmentsForMeld(tiles[index],kind,s.joker);
    if(!assignments)throw new Error('Gerçek okeyin gruptaki temsil taşı belirlenemedi');
    return{id:`${id}-${s.matchId}-${s.round}-${s.turnId||'turn'}-${s.melds.length+index}`,ownerId:id,tileIds:[...group],tiles:tiles[index],kind,realOkeyAssignments:assignments};
  });
  const next={...s,hands:{...s.hands,[id]:hand.filter(tile=>!usedIds.has(tile.id))},melds:[...s.melds,...melds],takenDiscardUse,discardTakeUndo:null,openingTurn:openingTurnFor(s,id,melds.map(meld=>meld.id)),message:asPairs?`${player.name} çift indirdi (${groups.length} grup)`:`${player.name} seri indirdi (${groups.length} grup)`};
  const points=asPairs?0:tiles.reduce((total,group)=>total+(serialMeldPointValue(group,s.joker)||0),0);
  const notification=asPairs?`Çift indirdiniz: ${groups.length} çift.`:`Seri indirdiniz: ${points} puan.`;
  const withEvent=appendGameEvent(next,{kind:'meld-lay',playerId:id,meldIds:melds.map(meld=>meld.id)});
  return saveActionReplay(appendPersonalNotification(withEvent,id,notification,false),id,requestId,fingerprint);
}
export function layNewSeriesMelds(s:GameState,id:string,groups:number[][],turnId?:string,requestId?:string):GameState {
  return layNewMeldGroups(s,id,groups,false,turnId,requestId);
}
export function layNewPairMelds(s:GameState,id:string,groups:number[][],turnId?:string,requestId?:string):GameState {
  return layNewMeldGroups(s,id,groups,true,turnId,requestId);
}
export function undoOpenMelds(s:GameState,id:string):GameState {
  if(!playerCanAct(s,id)||s.phase!=='discard')throw new Error('Açılış yalnızca aynı sırada geri alınabilir');
  const snapshot=s.undoOpen;if(!snapshot||snapshot.playerId!==id||snapshot.turnId!==s.turnId)throw new Error('Geri alınabilecek bir açılış yok');
  const penalty=101,currentUses=s.perCollectionUses[id]||0;
  const collectedPerPenalty=101*(Math.max(0,currentUses-1)-Math.max(0,snapshot.perCollectionUsesAtOpen-1));
  const openingTurn=s.openingTurn?.playerId===id&&s.openingTurn.turnId===s.turnId?s.openingTurn:{playerId:id,turnId:s.turnId!,meldIds:[],wrongPerSelections:0,perCollectionLocked:false};
  let next:GameState={
    ...s,
    hands:{...s.hands,[id]:[...snapshot.hand]},
    melds:[...snapshot.melds],
    meldLayUsage:[...snapshot.meldLayUsage],
    realOkeyReclaimPenalties:[...snapshot.realOkeyReclaimPenalties],
    discardTakeUndo:snapshot.discardTakeUndo??null,
    takenDiscardUse:snapshot.takenDiscardUse??null,
    serialOpeningHistory:[...(snapshot.serialOpeningHistory||[])],
    pairOpeningHistory:[...(snapshot.pairOpeningHistory||[])],
    players:s.players.map(player=>({...player,opened:player.id===id?snapshot.opened:player.opened,pairMode:player.id===id?snapshot.pairMode:player.pairMode,score:(snapshot.playerScores[player.id]??player.score)+(player.id===id?penalty+collectedPerPenalty:0)})),
    penaltyHistory:[...(s.penaltyHistory||[]),{round:s.round,playerId:id,points:penalty,reason:'undo-open'}],
    message:`${snapshot.openingKind==='series'?'Seri':'Çift'} açılışı geri alındı`,
    openingTurn:{...openingTurn,meldIds:[]},
    undoOpen:null,
  };
  next=appendPersonalNotification(next,id,'Açılışınızı geri aldınız; 101 ceza puanı uygulandı.',true);
  return appendGameEvent(next,{kind:'penalty',playerId:id,scope:'player',points:101});
}

export function collectOpeningMeld(s:GameState,id:string,meldId:string,turnId:string|undefined,requestId:string|undefined):GameState {
  const fingerprint=JSON.stringify(['collect-opening-meld',meldId]);
  const replay=checkedMeldRequest(s,id,turnId,requestId,fingerprint);
  if(replay==='replay')return s;
  if(!playerCanAct(s,id)||s.phase!=='discard')throw new Error('Per toplamak için açılış yaptığınız turda olmalısınız');
  const opening=s.openingTurn;
  if(!opening||opening.playerId!==id||opening.turnId!==s.turnId)throw new Error('Per toplama hakkı yalnızca açılış yaptığınız turda kullanılabilir');
  if(opening.perCollectionLocked)throw new Error('Yanlış per seçimi nedeniyle per toplama hakkınızı kaybettiniz');
  const meld=s.melds.find(candidate=>candidate.id===meldId);
  if(!meld)throw new Error('Seçilen per artık masada değil');
  if(meld.ownerId!==id){
    const wrongPerSelections=opening.wrongPerSelections+1;
    const perCollectionLocked=wrongPerSelections>=2;
    const next={...s,openingTurn:{...opening,wrongPerSelections,perCollectionLocked},message:perCollectionLocked?'Kendi perinizi seçmediniz. Başka oyuncuların perlerine tıklayarak hakkınızı kaybettiniz.':'Kendi perinizi seçmediniz!'};
    return saveActionReplay(next,id,requestId,fingerprint);
  }
  if(!opening.meldIds.includes(meldId))throw new Error('Bu per açılışınız sırasında indirilmedi');
  if(meld.tileIds.length!==meld.tiles.length||meld.tileIds.some((tileId,index)=>meld.tiles[index]?.id!==tileId)||new Set(meld.tileIds).size!==meld.tileIds.length)throw new Error('Per taşlarının sunucu kaydı tutarsız; işlem iptal edildi');
  const hand=[...(s.hands[id]||[])],handIds=new Set(hand.map(tile=>tile.id));
  if(meld.tiles.some(tile=>handIds.has(tile.id)))throw new Error('Per taşlarından biri zaten ıstakanızda; işlem iptal edildi');
  const elsewhere=[...s.stock,...s.discard,...Object.values(s.hands).flat(),...Object.values(s.throwsByPlayer).flat(),...s.melds.filter(candidate=>candidate.id!==meldId).flatMap(candidate=>candidate.tiles)];
  const elsewhereIds=new Set(elsewhere.map(tile=>tile.id));
  if(meld.tiles.some(tile=>elsewhereIds.has(tile.id)))throw new Error('Per taşlarından biri başka bir alanda kayıtlı; işlem iptal edildi');
  const usedCount=s.perCollectionUses[id]||0,penalty=usedCount===0?0:101;
  const player=s.players.find(candidate=>candidate.id===id);
  if(!player)throw new Error('Oyuncu bulunamadı');
  let next:GameState={...s,hands:{...s.hands,[id]:[...hand,...meld.tiles]},melds:s.melds.filter(candidate=>candidate.id!==meldId),openingTurn:{...opening,meldIds:opening.meldIds.filter(openingMeldId=>openingMeldId!==meldId)},perCollectionUses:{...s.perCollectionUses,[id]:usedCount+1},players:s.players.map(candidate=>candidate.id===id?{...candidate,score:candidate.score+penalty}:candidate),penaltyHistory:penalty?[...(s.penaltyHistory||[]),{round:s.round,playerId:id,points:penalty,reason:'collect-meld'}]:s.penaltyHistory,message:`${player.name} kendi perini geri aldı`};
  if(penalty){next=appendPersonalNotification(next,id,'Per toplama işlemi için 101 ceza puanı uygulandı.',true);next=appendGameEvent(next,{kind:'penalty',playerId:id,scope:'player',points:101});}
  return saveActionReplay(next,id,requestId,fingerprint);
}
function classify(tiles:Tile[],joker:GameState['joker']):'run'|'group'{const natural=tiles.map(t=>effectiveTile(t,joker)).filter(t=>!t.wild);return new Set(natural.map(t=>t.number)).size<=1?'group':'run';}

type MeldExtension={tiles:Tile[];assignments:Record<number,MeldFace>;side:'head'|'tail'|'group'};
function usedMeldEndCount(s:GameState,playerId:string,meldId:string,side:'head'|'tail'):number {
  return s.meldLayUsage.find(entry=>entry.turnId===s.turnId&&entry.playerId===playerId&&entry.meldId===meldId&&entry.side===side)?.count||0;
}
function resolveMeldExtension(s:GameState,meld:Meld,tile:Tile,target:MeldLayTarget):MeldExtension|null {
  if(meld.kind==='pairs')return null;
  const prior=realOkeyAssignmentsForMeld(meld.tiles,meld.kind,s.joker,meld.realOkeyAssignments);
  if(!prior)return null;
  const candidates:('head'|'tail'|'group')[]=meld.kind==='run'?(target==='head'?['head']:target==='tail'?['tail']:target==='auto'?['tail','head']:[]):(target==='auto'||target==='group'?['group']:[]);
  for(const side of candidates){
    if(side!=='group'&&usedMeldEndCount(s,s.turnPlayerId||'',meld.id,side)>=2)continue;
    const tiles=side==='head'?[tile,...meld.tiles]:[...meld.tiles,tile];
    const assignments=realOkeyAssignmentsForMeld(tiles,meld.kind,s.joker,prior);
    if(assignments&&meldFacesAreValid(tiles,meld.kind,s.joker,assignments))return{tiles,assignments,side};
  }
  return null;
}
function reclaimableRealOkey(s:GameState,meld:Meld,replacement:Tile,realOkeyTileId?:number):{realOkey:Tile;assignments:Record<number,MeldFace>}|null {
  if(replacement.fakeJoker||isRealOkey(replacement,s.joker))return null;
  const realOkey=meld.tiles.find(tile=>tile.id===realOkeyTileId&&isRealOkey(tile,s.joker))||(realOkeyTileId===undefined?meld.tiles.find(tile=>isRealOkey(tile,s.joker)):undefined);
  if(!realOkey)return null;
  const assignments=realOkeyAssignmentsForMeld(meld.tiles,meld.kind,s.joker,meld.realOkeyAssignments);
  const replacementFace=effectiveTile(replacement,s.joker);
  if(!replacementFace.color||!replacementFace.number)return null;
  let represented:MeldFace|undefined=assignments?.[realOkey.id];
  const realOkeys=meld.tiles.filter(tile=>isRealOkey(tile,s.joker));
  if(!represented&&meld.kind==='pairs'&&realOkeys.length===2&&assignments&&Object.keys(assignments).length===0)represented={color:replacementFace.color,number:replacementFace.number};
  if(!assignments||!represented||represented.color!==replacementFace.color||represented.number!==replacementFace.number)return null;
  const nextAssignments={...assignments};
  if(meld.kind==='pairs'&&realOkeys.length===2&&!nextAssignments[realOkeys.find(tile=>tile.id!==realOkey.id)!.id])nextAssignments[realOkeys.find(tile=>tile.id!==realOkey.id)!.id]={color:replacementFace.color!,number:replacementFace.number!};
  delete nextAssignments[realOkey.id];
  const tiles=meld.tiles.map(tile=>tile.id===realOkey.id?replacement:tile);
  if(!meldFacesAreValid(tiles,meld.kind,s.joker,nextAssignments))return null;
  return{realOkey,assignments};
}
export function availableMeldProcessingTargets(s:GameState,playerId:string,now=Date.now()):MeldProcessingTarget[] {
  const player=s.players.find(candidate=>candidate.id===playerId),hand=s.hands[playerId]||[];
  if(s.status!=='playing'||!player?.opened||!playerCanAct(s,playerId)||s.phase!=='discard'||(s.turnDeadlineAt!==null&&now>=s.turnDeadlineAt))return [];
  const pending=pendingTakenDiscard(s,playerId),targets:MeldProcessingTarget[]=[];
  for(const tile of hand){
    if(pending&&pending.tileId!==tile.id)continue;
    for(const meld of s.melds){
      for(const realOkey of meld.tiles.filter(candidate=>isRealOkey(candidate,s.joker))){
        if(reclaimableRealOkey(s,meld,tile,realOkey.id))targets.push({tileId:tile.id,meldId:meld.id,target:'reclaim-okey',realOkeyTileId:realOkey.id});
      }
      if(meld.kind==='pairs'||hand.length<=1)continue;
      const candidates:('head'|'tail'|'group')[]=meld.kind==='run'?['head','tail']:['group'];
      for(const target of candidates)if(resolveMeldExtension(s,meld,tile,target))targets.push({tileId:tile.id,meldId:meld.id,target});
    }
  }
  return targets;
}
function checkedMeldRequest(s:GameState,playerId:string,turnId:string|undefined,requestId:string|undefined,fingerprint:string):'new'|'replay' {
  if(turnId!==undefined&&turnId!==s.turnId)throw new Error('Hamle önceki turdan geldi; taş işleme isteği reddedildi');
  return actionReplay(s,playerId,requestId,fingerprint);
}
export function addToMeld(s:GameState,id:string,tileId:number,meldId:string,target:MeldLayTarget='auto',turnId?:string,requestId?:string):GameState {
  const fingerprint=JSON.stringify(['lay',tileId,meldId,target]);
  const replay=checkedMeldRequest(s,id,turnId,requestId,fingerprint);
  if(replay==='replay')return s;
  if(!playerCanAct(s,id)||s.phase!=='discard')throw new Error('Önce taş çekmelisiniz');
  const player=s.players.find(p=>p.id===id)!;if(!player.opened)throw new Error('Taş işlemek için önce el açmalısınız');
  const meld=s.melds.find(m=>m.id===meldId);if(!meld||meld.kind==='pairs')throw new Error('Bu pere taş işlenemez');
  const hand=[...s.hands[id]],tile=hand.find(t=>t.id===tileId);if(!tile)throw new Error('Bu taş ıstakanızda yok');
  if(pendingTakenDiscard(s,id)?.tileId!==undefined&&pendingTakenDiscard(s,id)?.tileId!==tileId)throw new Error('Soldan aldığınız taşı bu işlemde kullanmalısınız veya GERİ BIRAKın');
  const extension=resolveMeldExtension(s,meld,tile,target);if(!extension)throw new Error(target==='head'?'Serinin başına bu taş eklenemez veya bu turdaki baş limiti doldu':target==='tail'?'Serinin sonuna bu taş eklenemez veya bu turdaki son limiti doldu':'Bu taş seçilen pere geçerli biçimde işlenemez');
  if(hand.length<=1)throw new Error('Son taşı atabilmek için ıstakada bir taş tutmalısınız');
  const takenDiscardUse=assertTakenDiscardUsedBy(s,id,[tileId],'meld-lay');
  const melds=s.melds.map(m=>m.id===meldId?{...m,tileIds:extension.side==='head'?[tileId,...m.tileIds]:[...m.tileIds,tileId],tiles:extension.tiles,realOkeyAssignments:extension.assignments}:m);
  const meldLayUsage=extension.side==='group'?s.meldLayUsage:[...s.meldLayUsage.filter(entry=>!(entry.turnId===s.turnId&&entry.playerId===id&&entry.meldId===meldId&&entry.side===extension.side)),{turnId:s.turnId||'',playerId:id,meldId,side:extension.side,count:usedMeldEndCount(s,id,meldId,extension.side)+1}];
  const next={...s,hands:{...s.hands,[id]:hand.filter(t=>t.id!==tileId)},melds,meldLayUsage,takenDiscardUse,message:`${player.name} taşa işledi`,discardTakeUndo:null};
  const withEvent=appendGameEvent(next,{kind:'meld-lay',playerId:id,meldId,meldIds:[meldId],tileId});
  return saveActionReplay(withEvent,id,requestId,fingerprint);
}

export function reclaimRealOkey(s:GameState,id:string,meldId:string,realOkeyTileId:number,replacementTileId:number,turnId?:string,requestId?:string):GameState {
  const fingerprint=JSON.stringify(['reclaim-real-okey',meldId,realOkeyTileId,replacementTileId]);
  const replay=checkedMeldRequest(s,id,turnId,requestId,fingerprint);
  if(replay==='replay')return s;
  if(!playerCanAct(s,id)||s.phase!=='discard')throw new Error('Önce sıranıza gelip taş çekmelisiniz');
  const player=s.players.find(candidate=>candidate.id===id);if(!player?.opened)throw new Error('Gerçek okeyi geri almak için önce el açmalısınız');
  const meld=s.melds.find(candidate=>candidate.id===meldId);if(!meld)throw new Error('Açılmış per bulunamadı');
  const meldIndex=meld.tiles.findIndex(tile=>tile.id===realOkeyTileId),jokerTile=meld.tiles[meldIndex];
  if(!jokerTile||!isRealOkey(jokerTile,s.joker)||meld.tileIds[meldIndex]!==realOkeyTileId)throw new Error('Seçilen grupta geri alınabilecek gerçek okey yok; sahte okey geri alınamaz');
  const hand=[...(s.hands[id]||[])],replacement=hand.find(tile=>tile.id===replacementTileId);
  if(!replacement)throw new Error('Yerine verilecek taş elinizde yok');
  if(replacement.fakeJoker||isRealOkey(replacement,s.joker))throw new Error('Gerçek okey yalnızca eşleşen normal taşla geri alınabilir');
  const replacementFace=effectiveTile(replacement,s.joker);if(!replacementFace.color||!replacementFace.number)throw new Error('Yerine verilecek doğal taşın renk ve sayısı geçersiz');
  if(pendingTakenDiscard(s,id)?.tileId!==undefined&&pendingTakenDiscard(s,id)?.tileId!==replacementTileId)throw new Error('Soldan aldığınız taşı okeyi geri alma işleminde kullanmalısınız veya GERİ BIRAKın');
  const currentAssignments=realOkeyAssignmentsForMeld(meld.tiles,meld.kind,s.joker,meld.realOkeyAssignments);
  const realOkeys=meld.tiles.filter(tile=>isRealOkey(tile,s.joker));
  let represented:MeldFace|undefined=currentAssignments?.[realOkeyTileId];
  const unassignedOkeyPair=meld.kind==='pairs'&&realOkeys.length===2&&!!currentAssignments&&Object.keys(currentAssignments).length===0;
  if(!represented&&unassignedOkeyPair)represented={color:replacementFace.color,number:replacementFace.number};
  if(!represented)throw new Error('Gerçek okeyin bu grupta temsil ettiği doğal taş kayıtlı değil; okey geri alınamaz');
  if(represented.color!==replacementFace.color||represented.number!==replacementFace.number)throw new Error('Verilen taş gerçek okeyin temsil ettiği renk ve sayı ile eşleşmiyor');
  const nextTiles=meld.tiles.map(tile=>tile.id===realOkeyTileId?replacement:tile),nextAssignments={...currentAssignments};
  if(unassignedOkeyPair){const remainingOkey=realOkeys.find(tile=>tile.id!==realOkeyTileId)!;nextAssignments[remainingOkey.id]={color:replacementFace.color!,number:replacementFace.number!};}
  delete nextAssignments[realOkeyTileId];
  if(!meldFacesAreValid(nextTiles,meld.kind,s.joker,nextAssignments))throw new Error('Taş değişikliğinden sonra açık grup geçerli kalmıyor');
  const owner=s.players.find(candidate=>candidate.id===meld.ownerId);if(!owner)throw new Error('Açılmış perin sahibi bulunamadı');
  const takenDiscardUse=assertTakenDiscardUsedBy(s,id,[replacementTileId],'real-okey-reclaim');
  const next:GameState={
    ...s,
    hands:{...s.hands,[id]:[...hand.filter(tile=>tile.id!==replacementTileId),jokerTile]},
    melds:s.melds.map(candidate=>candidate.id===meldId?{...candidate,tileIds:candidate.tileIds.map(tileId=>tileId===realOkeyTileId?replacementTileId:tileId),tiles:nextTiles,realOkeyAssignments:nextAssignments}:candidate),
    players:s.players.map(candidate=>candidate.id===owner.id?{...candidate,score:candidate.score+101}:candidate),
    penaltyHistory:[...(s.penaltyHistory||[]),{round:s.round,playerId:owner.id,points:101,reason:'real-okey-reclaim'}],
    realOkeyReclaimPenalties:[...s.realOkeyReclaimPenalties,{round:s.round,turnId:s.turnId||'',requestId:requestId||`manual-${s.turnId||'no-turn'}-${id}-${meldId}-${realOkeyTileId}-${replacementTileId}`,actorId:id,ownerId:owner.id,meldId,realOkeyTileId,replacementTileId,points:101 as const}],
    takenDiscardUse,
    discardTakeUndo:null,
    message:`${player.name} gerçek okeyi geri aldı`,
  };
  let withEvent=appendPersonalNotification(next,owner.id,'Gerçek okeyiniz temsil taşıyla değiştirildi; 101 ceza puanı uygulandı.',true);
  withEvent=appendGameEvent(withEvent,{kind:'penalty',playerId:owner.id,scope:'player',points:101});
  withEvent=appendGameEvent(withEvent,{kind:'meld-lay',playerId:id,meldId,meldIds:[meldId],tileId:replacementTileId});
  return saveActionReplay(withEvent,id,requestId,fingerprint);
}

export function suggestOpenGroups(hand:Tile[],selectedIds:number[],joker:GameState['joker']):number[][] {
  const chosen=hand.filter(t=>selectedIds.includes(t.id));const candidates:{tiles:Tile[];value:number}[]=[];
  for(const size of [3,4]){
    const walk=(start:number,group:Tile[])=>{if(group.length===size){if(validNaturalMeld(group,joker))candidates.push({tiles:[...group],value:group.reduce((n,t)=>n+(effectiveTile(t,joker).number||0),0)});return;}
      for(let i=start;i<chosen.length;i++)walk(i+1,[...group,chosen[i]]);};walk(0,[]);
  }
  candidates.sort((a,b)=>b.value-a.value||b.tiles.length-a.tiles.length);const used=new Set<number>(),groups:number[][]=[];let total=0;
  for(const c of candidates){if(c.tiles.some(t=>used.has(t.id)))continue;groups.push(c.tiles.map(t=>t.id));c.tiles.forEach(t=>used.add(t.id));total+=c.value;if(total>=101)break;}
  return total>=101?groups:[];
}
export function suggestFivePairs(hand:Tile[],selectedIds:number[],joker:GameState['joker']):number[][] {
  const selected=new Set(selectedIds),chosen=hand.filter(tile=>selected.has(tile.id)),pairs=findRackPairGroups(chosen,joker);
  return pairs.length>=5?pairs.slice(0,5):[];
}

export function publicGame(s:GameState,viewerId:string,serverNow=Date.now()){
  const discardUndo=s.discardTakeUndo;
  const canReturnTakenDiscard=!!discardUndo&&!!discardUndo.turnId&&discardUndo.playerId===viewerId&&discardUndo.turnId===s.turnId&&s.turnPlayerId===viewerId&&s.phase==='discard'&&s.stock.length===discardUndo.stockCount&&(s.hands[viewerId]||[]).some(tile=>tile.id===discardUndo.tileId);
  const openingTurnActive=s.status==='playing'&&s.turnPlayerId===viewerId&&s.phase==='discard'&&!!s.turnId&&(s.turnDeadlineAt===null||s.turnDeadlineAt>serverNow);
  const canUndoOpen=!!openingTurnActive&&s.undoOpen?.playerId===viewerId&&s.undoOpen.turnId===s.turnId;
  const canCollectMeld=!!canUndoOpen&&s.openingTurn?.playerId===viewerId&&s.openingTurn.turnId===s.turnId&&!s.openingTurn.perCollectionLocked;
  const publiclyVisibleTileIds=new Set<number>([
    ...(s.melds||[]).flatMap(meld=>meld.tileIds),
    ...(s.discard||[]).map(tile=>tile.id),
    ...Object.values(s.throwsByPlayer||{}).flat().map(tile=>tile.id),
  ]);
  const recognizedRealOkeyIds=(s.recognizedRealOkeyIds||[]).filter(tileId=>(s.hands[viewerId]||[]).some(tile=>tile.id===tileId)||publiclyVisibleTileIds.has(tileId));
  const revealActive=!!s.revealedHands&&typeof s.roundRevealUntilAt==='number'&&serverNow<s.roundRevealUntilAt;
  const roundPenaltyTotals:Record<string,number>={};
  for(const player of s.players)roundPenaltyTotals[player.id]=0;
  for(const penalty of s.penaltyHistory||[])if(penalty.round===s.round)roundPenaltyTotals[penalty.playerId]=(roundPenaltyTotals[penalty.playerId]||0)+penalty.points;
  return {
    status:s.status,matchId:s.matchId,settings:s.settings,players:s.players.map(p=>({...p,tilesLeft:s.hands[p.id]?.length||0})),hand:s.hands[viewerId]||[],stockCount:s.stock.length,discard:s.discard,throwsByPlayer:s.throwsByPlayer,indicator:s.indicator,joker:s.joker,recognizedRealOkeyIds,
    turnPlayerId:s.turnPlayerId,phase:s.phase,turnStartedAt:s.turnStartedAt,turnDeadlineAt:s.turnDeadlineAt,turnId:s.turnId,serverNow,melds:s.melds,meldProcessingTargets:availableMeldProcessingTargets(s,viewerId,serverNow),round:s.round,roundAutoStartAt:s.roundAutoStartAt??null,
    roundScores:[...s.roundScores],roundPenaltyTotals,penaltyHistory:(s.penaltyHistory||[]).filter(entry=>entry.playerId===viewerId),matchStats:s.matchStats?.[viewerId]?{[viewerId]:s.matchStats[viewerId]}:{},matchBadges:s.matchBadges,message:s.message,
    serialOpeningThreshold:serialOpeningThreshold(s,viewerId),pairOpeningThreshold:pairOpeningThreshold(s,viewerId),canUndoOpen,canCollectMeld,canReturnTakenDiscard,
    roundFinishKind:s.roundFinishKind??null,roundFinisherId:s.roundFinisherId??null,roundRevealUntilAt:revealActive?s.roundRevealUntilAt:null,revealedHands:revealActive?s.revealedHands:null,
    publicEvents:[...(s.publicEvents||[])],gameEvents:publicGameEvents(s,viewerId),personalNotifications:[...(s.personalNotifications?.[viewerId]||[])],
  };
}

