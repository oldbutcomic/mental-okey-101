import 'dotenv/config';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { freshRoom, startRound, startNewMatch, validateTableSettings, drawStock, takeDiscard, returnTakenDiscard, discardTile, openMelds, openSeriesMelds, layNewSeriesMelds, layNewPairMelds, finishFromHand, recordInvalidOpenAttempt, recordSuccessfulOpeningAttempt, undoOpenMelds, addToMeld, reclaimRealOkey, publicGame, startTurnClock, clearTurnClock, turnClockExpired, autoPlayTimedOutTurn, recordRoundBadges, roundSummaryDurationMs, ROUND_SUMMARY_DURATION_MS, MATCH_SUMMARY_DURATION_MS, findRackMeldGroups, isRealOkey, isValidPair, updateRealOkeyRecognition, collectOpeningMeld, appendPersonalNotification, type GameState, type Player, type MeldLayTarget } from '../shared/game.js';
import { applyDevTestTiles, devTestPanelIsEnabled, getDevTestInventory, openPreparedDevPlayer, prepareDevOpeningHands, requireDevTestOwner, swapDevTestTiles, type DevOpeningPreparationKind } from './dev-test-panel.js';
import { botThinkDelay, botThinkDelayBeforeDeadline, chooseBotDiscard, createBotObservation, observeBotTransition, playBotTurn, type BotDifficulty, type BotMemory } from './bot-ai.js';
import { createTurnGuidancePreview, isTurnGuidanceCandidate, type TurnGuidanceRequest } from '../shared/turn-guidance.js';
import { AccountError, accountStore, type AccountProfile, type AuthSession } from './account-store.js';
import { buildRoundCoinCredits } from './mental-coin-rewards.js';
import { syncRoomPlayerCoinBalances } from './coin-room-state.js';
import { findPlayerInteractionItem, PLAYER_INTERACTION_COOLDOWN_MS } from '../shared/player-interactions.js';
import { releaseExpiredWaitingSeat, WaitingRoomSeatTimers, type WaitingSeatReservation } from './waiting-room-seats.js';
import { clientOriginIsAllowed, resolveAllowedClientOrigins } from './http-config.js';
import { createHttpRequestHandler } from './http-app.js';
import { registrationInviteFailure } from './invite-code.js';

type Session={id:string;room:string};
const localClientOrigins=process.env.NODE_ENV==='production'?[]:Object.values(networkInterfaces()).flatMap(entries=>entries||[]).filter(entry=>!entry.internal&&entry.family==='IPv4').map(entry=>`http://${entry.address}:5173`);
const allowedClientOrigins=resolveAllowedClientOrigins(process.env,localClientOrigins);
const isClientOriginAllowed=(origin:string|undefined)=>clientOriginIsAllowed(origin,allowedClientOrigins);
const distDirectory=resolve(dirname(fileURLToPath(import.meta.url)),'../dist');
const httpServer=createServer(createHttpRequestHandler({distDirectory,healthCheck:()=>accountStore.healthCheck(),isClientOriginAllowed}));
const io=new Server(httpServer,{cors:{origin:(origin,callback)=>callback(null,isClientOriginAllowed(origin)),methods:['GET','POST']},allowRequest:(request,callback)=>callback(null,isClientOriginAllowed(request.headers.origin)),pingInterval:20000,pingTimeout:30000});
const rooms=new Map<string,GameState>();const sessions=new Map<string,Session>();const activeAccountSockets=new Map<string,string>();const matchRestartTimers=new Map<string,{matchId:string;timer:ReturnType<typeof setTimeout>}>();const turnTimers=new Map<string,{matchId:string;turnId:string;timer:ReturnType<typeof setTimeout>}>();let turnSequence=0;
const roundRestartTimers=new Map<string,{matchId:string;round:number;restartAt:number;timer:ReturnType<typeof setTimeout>}>();
const practiceBotTimers=new Map<string,{matchId:string;turnId:string;timer:ReturnType<typeof setTimeout>}>();
const offlineBotTimers=new Map<string,{matchId:string;turnId:string;playerId:string;timer:ReturnType<typeof setTimeout>}>();
const autoModeBotTimers=new Map<string,{matchId:string;turnId:string;playerId:string;timer:ReturnType<typeof setTimeout>}>();
const revealTimers=new Map<string,{matchId:string;round:number;revealUntilAt:number;timer:ReturnType<typeof setTimeout>}>();
const practiceBotMemory=new Map<string,Map<string,BotMemory>>();
const seatTokens=new Map<string,Map<string,string>>();
const waitingSeatTimers=new WaitingRoomSeatTimers();
const devOpeningPreparations=new Map<string,{matchId:string;round:number;kind:DevOpeningPreparationKind;openingGroups:Record<string,number[][]>}>();
const OPENING_TURN_BONUS_MS=15_000;
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function roomCode(){let code='';for(let i=0;i<6;i++)code+=alphabet[Math.floor(Math.random()*alphabet.length)];return code;}
function assertSocketPlayer(socketId:string,code:string,playerId:string){const session=sessions.get(playerId);const socket=io.sockets.sockets.get(socketId);if(!socket||socket.data.accountId!==playerId||!session||session.id!==socketId||session.room!==code)throw new Error('Oturum doğrulanamadı; hesaba ve masaya yeniden giriş yapın');}
function requireAccount(socket:any):AccountProfile{const account=socket.data.accountProfile as AccountProfile|undefined;if(!account||socket.data.accountId!==account.id)throw new AccountError('Önce hesabınıza giriş yapın.','session');return account;}
function accountFailure(error:unknown):string{return error instanceof Error?error.message:'Hesap işlemi tamamlanamadı.';}
function attachAccountSession(socket:any,session:AuthSession){
  const roomSession=[...sessions.entries()].find(([,value])=>value.id===socket.id);
  if(roomSession&&roomSession[0]!==session.account.id)throw new AccountError('Masadayken başka bir hesaba geçemezsiniz.','session');
  const previousId=activeAccountSockets.get(session.account.id);
  if(previousId&&previousId!==socket.id){const previous=io.sockets.sockets.get(previousId);if(previous?.connected){previous.emit('account:session-replaced');previous.disconnect(true);}}
  socket.data.accountId=session.account.id;socket.data.accountProfile=session.account;socket.data.sessionToken=session.sessionToken;delete socket.data.accountSessionInvalid;delete socket.data.accountServiceUnavailable;
  activeAccountSockets.set(session.account.id,socket.id);
}
function sendRoom(code:string){const room=rooms.get(code);if(!room)return;const serverNow=Date.now();for(const p of room.players){const socketId=sessions.get(p.id)?.room===code?sessions.get(p.id)?.id:undefined;if(socketId)io.to(socketId).emit('room:state',publicGame(room,p.id,serverNow));}}
function sendRealOkeyRecognition(code:string,state:GameState){for(const player of state.players){const socketId=sessions.get(player.id)?.room===code?sessions.get(player.id)?.id:undefined;if(socketId)io.to(socketId).emit('game:real-okey-recognized',{matchId:state.matchId,recognizedRealOkeyIds:publicGame(state,player.id).recognizedRealOkeyIds});}}
function publishCoinBalances(accounts:AccountProfile[]){
  const roomsToSend=syncRoomPlayerCoinBalances(rooms,accounts);
  for(const account of accounts){
    const socketId=activeAccountSockets.get(account.id),socket=socketId?io.sockets.sockets.get(socketId):undefined;
    if(socket?.connected&&socket.data.accountId===account.id){socket.data.accountProfile=account;socket.emit('account:coins-updated',{mentalCoins:account.mentalCoins});}
  }
  for(const code of roomsToSend)sendRoom(code);
}
function persistCompletedRoundRewards(state:GameState,attempt=0){
  const credits=buildRoundCoinCredits(state);if(!credits.length)return;
  void accountStore.applyCoinCredits(credits).then(result=>publishCoinBalances(result.accounts))
    .catch(error=>{
      if(attempt<3){setTimeout(()=>persistCompletedRoundRewards(state,attempt+1),1000*2**attempt);return;}
      console.error(`[mental-coins] ${state.matchId} ${state.round}. el ödülü yazılamadı`,error);
    });
}
function clearPracticeBotTimer(code:string){const pending=practiceBotTimers.get(code);if(pending)clearTimeout(pending.timer);practiceBotTimers.delete(code);}
function clearOfflineBotTimer(code:string){const pending=offlineBotTimers.get(code);if(pending)clearTimeout(pending.timer);offlineBotTimers.delete(code);}
function clearAutoModeBotTimer(code:string,playerId?:string){const pending=autoModeBotTimers.get(code);if(pending&&(!playerId||pending.playerId===playerId))clearTimeout(pending.timer);if(!playerId||pending?.playerId===playerId)autoModeBotTimers.delete(code);}
function createSeatToken(){return randomBytes(32).toString('base64url');}
function storeSeatToken(code:string,playerId:string){let tokens=seatTokens.get(code);if(!tokens){tokens=new Map();seatTokens.set(code,tokens);}const token=createSeatToken();tokens.set(playerId,token);return token;}
function practiceBotDifficulty(seat:number):BotDifficulty{return seat%2===0?'hard':'medium';}
function rememberPracticeBotTransition(code:string,previous:GameState,next:GameState){
  let memories=practiceBotMemory.get(code);if(!memories){memories=new Map();practiceBotMemory.set(code,memories);}
  // Keep a short, public-event memory for every seat so a human who enables
  // Auto Mode later does not hand the bot a stale view of recent discards.
  for(const player of next.players){
    memories.set(player.id,observeBotTransition(memories.get(player.id),previous,next));
  }
  if(next.status!=='playing'&&next.status!=='round-end'){practiceBotMemory.delete(code);}
}
function beginNextRound(state:GameState):GameState {
  const players=state.players.map(player=>({...player,opened:false,pairMode:false}));
  return startRound({...state,round:state.round+1,players});
}
function clearMatchRestartTimer(code:string){const scheduled=matchRestartTimers.get(code);if(scheduled)clearTimeout(scheduled.timer);matchRestartTimers.delete(code);}
function clearTurnTimer(code:string){const scheduled=turnTimers.get(code);if(scheduled)clearTimeout(scheduled.timer);turnTimers.delete(code);}
function clearRoundRestartTimer(code:string){const scheduled=roundRestartTimers.get(code);if(scheduled)clearTimeout(scheduled.timer);roundRestartTimers.delete(code);}
function clearRevealTimer(code:string){const scheduled=revealTimers.get(code);if(scheduled)clearTimeout(scheduled.timer);revealTimers.delete(code);}
function clearRoomTimers(code:string){waitingSeatTimers.cancelRoom(code);clearMatchRestartTimer(code);clearTurnTimer(code);clearRoundRestartTimer(code);clearRevealTimer(code);clearPracticeBotTimer(code);clearOfflineBotTimer(code);clearAutoModeBotTimer(code);}
function nextAvailableSeat(state:GameState){const occupied=new Set(state.players.map(player=>player.seat));for(let seat=0;seat<4;seat++)if(!occupied.has(seat))return seat;throw new Error('Masa dolu');}
function releaseWaitingSeatWhenExpired(reservation:WaitingSeatReservation){if(!releaseExpiredWaitingSeat(rooms,seatTokens,reservation))return;if(rooms.has(reservation.roomCode))sendRoom(reservation.roomCode);else{clearRoomTimers(reservation.roomCode);devOpeningPreparations.delete(reservation.roomCode);practiceBotMemory.delete(reservation.roomCode);}}
function preventDuplicateWaitingReservation(playerId:string,targetRoomCode?:string){const reservation=waitingSeatTimers.findByPlayerId(playerId);if(!reservation||reservation.roomCode===targetRoomCode)return;if(waitingSeatTimers.isExpired(reservation.roomCode,playerId)){waitingSeatTimers.cancel(reservation.roomCode,playerId);releaseWaitingSeatWhenExpired(reservation);return;}throw new Error('Bekleme masanızdaki koltuk 60 saniye korunuyor; aynı masaya dönün veya sürenin dolmasını bekleyin');}
function scheduleTurnTimeout(code:string,state:GameState,retryDelay?:number){
  const {matchId,turnId,turnDeadlineAt,turnPlayerId}=state;
  if(state.status!=='playing'||!turnId||turnDeadlineAt===null||!turnPlayerId){clearTurnTimer(code);return;}
  const existing=turnTimers.get(code);if(existing?.matchId===matchId&&existing.turnId===turnId)return;
  clearTurnTimer(code);
  const timer=setTimeout(()=>{
    const scheduled=turnTimers.get(code);if(!scheduled||scheduled.matchId!==matchId||scheduled.turnId!==turnId)return;
    turnTimers.delete(code);
    const current=rooms.get(code);if(!current||current.matchId!==matchId||current.status!=='playing'||current.turnId!==turnId||current.turnPlayerId!==turnPlayerId)return;
    if(Date.now()<current.turnDeadlineAt!){scheduleTurnTimeout(code,current);return;}
    performTimedOutTurn(code,turnId);
  },retryDelay??Math.max(0,turnDeadlineAt-Date.now()));
  turnTimers.set(code,{matchId,turnId,timer});
}
function startServerTurnClock(code:string,state:GameState):GameState{
  clearAutoModeBotTimer(code);
  clearTurnTimer(code);
  if(state.status!=='playing'||!state.turnPlayerId){const cleared=clearTurnClock(state);rooms.set(code,cleared);return cleared;}
  const startedAt=Date.now(),turnId=`${code}-${state.matchId}-${state.round}-${state.turnPlayerId}-${startedAt}-${++turnSequence}`;
  const next=startTurnClock(state,startedAt,turnId);rooms.set(code,next);scheduleTurnTimeout(code,next);
  const active=next.players.find(player=>player.id===next.turnPlayerId);
  if(active?.id.startsWith('bot-'))runPracticeBots(code,next.matchId);else if(active?.autoPlay)scheduleAutoModeBot(code,next);else if(active&&!active.online)scheduleOfflineBot(code,next);
  return next;
}
function saveGameTransition(code:string,previous:GameState,next:GameState):GameState{
  rememberPracticeBotTransition(code,previous,next);
  if(next.status==='round-end'&&next.round>=next.settings.rounds)next={...next,status:'match-end',roundAutoStartAt:null,message:'Maç tamamlandı'};
  if(next.status!=='playing'){clearTurnTimer(code);clearPracticeBotTimer(code);clearOfflineBotTimer(code);clearAutoModeBotTimer(code);if(next.status==='round-end'||next.status==='match-end')next=recordRoundBadges(next);next=clearTurnClock(next);rooms.set(code,next);if(previous.status==='playing'&&(next.status==='round-end'||next.status==='match-end'))persistCompletedRoundRewards(next);if(next.status==='round-end')return scheduleRoundRestart(code,next);if(next.status==='match-end')scheduleFinalMatchRestart(code,next);return rooms.get(code)!;}
  const newTurn=previous.status!=='playing'||previous.round!==next.round||previous.turnPlayerId!==next.turnPlayerId||!next.turnId||next.turnDeadlineAt===null;
  if(newTurn)return startServerTurnClock(code,next);
  if(previous.turnId===next.turnId&&previous.turnDeadlineAt!==next.turnDeadlineAt)clearTurnTimer(code);
  rooms.set(code,next);scheduleTurnTimeout(code,next);return next;
}
function scheduleRoundRestart(code:string,state:GameState):GameState{
  clearRoundRestartTimer(code);
  clearMatchRestartTimer(code);
  clearRevealTimer(code);
  const matchId=state.matchId,round=state.round,duration=roundSummaryDurationMs(state.roundFinishKind)+(state.roundFinishKind==='elden'?ROUND_SUMMARY_DURATION_MS:0),restartAt=Date.now()+duration;
  const scheduledState={...state,roundAutoStartAt:restartAt};
  rooms.set(code,scheduledState);
  if(state.roundFinishKind==='elden'&&state.revealedHands&&typeof state.roundRevealUntilAt==='number'){
    const revealUntilAt=state.roundRevealUntilAt;
    const revealTimer=setTimeout(()=>{
      const scheduled=revealTimers.get(code);if(!scheduled||scheduled.matchId!==matchId||scheduled.round!==round||scheduled.revealUntilAt!==revealUntilAt)return;
      revealTimers.delete(code);
      const current=rooms.get(code);if(!current||current.matchId!==matchId||current.status!=='round-end'||current.round!==round||current.roundRevealUntilAt!==revealUntilAt)return;
      rooms.set(code,{...current,revealedHands:null,roundRevealUntilAt:null});sendRoom(code);
    },Math.max(0,revealUntilAt-Date.now()));
    revealTimers.set(code,{matchId,round,revealUntilAt,timer:revealTimer});
  }
  const timer=setTimeout(()=>{
    const scheduled=roundRestartTimers.get(code);if(!scheduled||scheduled.matchId!==matchId||scheduled.round!==round||scheduled.restartAt!==restartAt)return;
    roundRestartTimers.delete(code);
    const current=rooms.get(code);if(!current||current.matchId!==matchId||current.status!=='round-end'||current.round!==round||current.roundAutoStartAt!==restartAt)return;
    const next=startServerTurnClock(code,beginNextRound(current));
    sendRoom(code);
    if(next.players.some(player=>player.id.startsWith('bot-')))runPracticeBots(code,next.matchId);
  },duration);
  roundRestartTimers.set(code,{matchId,round,restartAt,timer});
  return scheduledState;
}
function scheduleFinalMatchRestart(code:string,state:GameState){
  clearRoundRestartTimer(code);
  clearMatchRestartTimer(code);
  clearRevealTimer(code);
  const matchId=state.matchId,round=state.round,restartAt=Date.now()+MATCH_SUMMARY_DURATION_MS;
  rooms.set(code,{...state,roundAutoStartAt:restartAt});
  if(state.roundFinishKind==='elden'&&state.revealedHands&&typeof state.roundRevealUntilAt==='number'){
    const revealUntilAt=state.roundRevealUntilAt;
    const revealTimer=setTimeout(()=>{
      const scheduled=revealTimers.get(code);if(!scheduled||scheduled.matchId!==matchId||scheduled.round!==round||scheduled.revealUntilAt!==revealUntilAt)return;
      revealTimers.delete(code);
      const current=rooms.get(code);if(!current||current.matchId!==matchId||current.round!==round||current.status!=='match-end'||current.roundRevealUntilAt!==revealUntilAt)return;
      rooms.set(code,{...current,revealedHands:null,roundRevealUntilAt:null});sendRoom(code);
    },Math.max(0,revealUntilAt-Date.now()));
    revealTimers.set(code,{matchId,round,revealUntilAt,timer:revealTimer});
  }
  const timer=setTimeout(()=>{
    const scheduled=matchRestartTimers.get(code);if(!scheduled||scheduled.matchId!==matchId)return;
    matchRestartTimers.delete(code);
    const current=rooms.get(code);if(!current||current.matchId!==matchId||current.status!=='match-end'||current.round!==round||current.roundAutoStartAt!==restartAt)return;
    io.to(code).emit('room:closed',{code,matchId,message:'Maç tamamlandı; masa kapatıldı'});
    for(const player of current.players){const session=sessions.get(player.id);if(session?.room===code){io.sockets.sockets.get(session.id)?.leave(code);sessions.delete(player.id);}}
    rooms.delete(code);seatTokens.delete(code);devOpeningPreparations.delete(code);practiceBotMemory.delete(code);clearRoomTimers(code);
  },MATCH_SUMMARY_DURATION_MS);
  matchRestartTimers.set(code,{matchId,timer});
}
function performTimedOutTurn(code:string,expectedTurnId:string):boolean{
  const current=rooms.get(code);if(!current||!turnClockExpired(current,expectedTurnId,Date.now()))return false;
  clearTurnTimer(code);
  const next=autoPlayTimedOutTurn(current,expectedTurnId,Date.now());
  if(!next){const retryState={...current,message:'Süre doldu; otomatik hamle yeniden deneniyor'};rooms.set(code,retryState);scheduleTurnTimeout(code,retryState,1000);sendRoom(code);return false;}
  const saved=saveGameTransition(code,current,next);
  sendRoom(code);if(saved.status==='playing'&&saved.players.some(player=>player.id.startsWith('bot-')))runPracticeBots(code,saved.matchId);return true;
}
function recoverFailedBotTurn(code:string,matchId:string,turnId:string,playerId:string,error:unknown,kind:'practice'|'offline'|'auto'){
  console.error(`[${kind}-bot] ${playerId} hamlesi başarısız; güvenli hamle deneniyor`,error);
  const current=rooms.get(code);
  if(!current||current.matchId!==matchId||current.status!=='playing'||current.turnId!==turnId||current.turnPlayerId!==playerId)return;
  if(turnClockExpired(current,turnId,Date.now())){performTimedOutTurn(code,turnId);return;}
  try{
    let next=current;
    if(next.phase==='draw')next=drawStock(next,playerId);
    if(next.status!=='playing'){
      const saved=saveGameTransition(code,current,next);sendRoom(code);
      if(saved.status==='playing'&&saved.players.some(player=>player.id.startsWith('bot-')))runPracticeBots(code,saved.matchId);
      return;
    }
    const pending=next.takenDiscardUse;
    if(pending?.playerId===playerId&&pending.turnId===turnId&&!pending.used){
      next=returnTakenDiscard(next,playerId);
      next=drawStock(next,playerId);
    }
    if(next.status==='playing'){
       const hand=next.hands[playerId]||[];
       if(!hand.length)throw new Error('Güvenli hamlede elde taş bulunamadı');
       const observation=createBotObservation(next,playerId,practiceBotMemory.get(code)?.get(playerId));
       const tile=observation?chooseBotDiscard(observation,practiceBotDifficulty(next.players.find(player=>player.id===playerId)?.seat??0),()=>0.99,{safeMode:true}):hand[0];
       if(!tile)throw new Error('Güvenli hamlede atılacak taş bulunamadı');
      next=discardTile(next,playerId,tile.id);
    }
    const saved=saveGameTransition(code,current,next);sendRoom(code);
    if(saved.status==='playing'&&saved.players.some(player=>player.id.startsWith('bot-')))runPracticeBots(code,saved.matchId);
  }catch(fallbackError){
    console.error(`[${kind}-bot] ${playerId} güvenli hamlesi de başarısız`,fallbackError);
  }
}
function assertMatchId(state:GameState,matchId:string){if(typeof matchId!=='string'||matchId!==state.matchId)throw new Error('Bu işlem önceki maçtan geldi; masa durumunu yenileyin');}
function runPracticeBots(code:string,matchId:string){
  const state=rooms.get(code);
  if(!state||state.matchId!==matchId||state.status!=='playing'||!state.turnPlayerId||!state.turnId){clearPracticeBotTimer(code);return;}
  const bot=state.players.find(player=>player.id===state.turnPlayerId);
  if(!bot?.id.startsWith('bot-')){clearPracticeBotTimer(code);return;}
  const existing=practiceBotTimers.get(code);
  if(existing?.matchId===matchId&&existing.turnId===state.turnId)return;
  clearPracticeBotTimer(code);
  const observation=createBotObservation(state,bot.id,practiceBotMemory.get(code)?.get(bot.id));
  const delay=observation?botThinkDelay(observation,practiceBotDifficulty(bot.seat)):650;
  const turnId=state.turnId;
  const timer=setTimeout(()=>{
    const scheduled=practiceBotTimers.get(code);
    if(!scheduled||scheduled.matchId!==matchId||scheduled.turnId!==turnId)return;
    practiceBotTimers.delete(code);
    const current=rooms.get(code);
    if(!current||current.matchId!==matchId||current.status!=='playing'||current.turnId!==turnId||current.turnPlayerId!==bot.id)return;
    try{
      const result=playBotTurn(current,bot.id,practiceBotDifficulty(bot.seat));
      const next=saveGameTransition(code,current,result.state);
      sendRoom(code);
      if(next.status==='playing'&&next.players.some(player=>player.id.startsWith('bot-')))runPracticeBots(code,next.matchId);
    }catch(error){
      recoverFailedBotTurn(code,matchId,turnId,bot.id,error,'practice');
    }
  },delay);
  practiceBotTimers.set(code,{matchId,turnId,timer});
}
function scheduleOfflineBot(code:string,state:GameState){
  if(state.status!=='playing'||!state.turnPlayerId||!state.turnId)return;
  const player=state.players.find(candidate=>candidate.id===state.turnPlayerId);
  if(player?.autoPlay){scheduleAutoModeBot(code,state);return;}
  if(!player||player.online||player.id.startsWith('bot-')||sessions.get(player.id)?.room===code){clearOfflineBotTimer(code);return;}
  const existing=offlineBotTimers.get(code);if(existing?.matchId===state.matchId&&existing.turnId===state.turnId&&existing.playerId===player.id)return;
  clearOfflineBotTimer(code);
  const observation=createBotObservation(state,player.id,practiceBotMemory.get(code)?.get(player.id));
  const delay=observation?botThinkDelayBeforeDeadline(observation,practiceBotDifficulty(player.seat),state.turnDeadlineAt??Date.now()):450;
  const {matchId,turnId,playerId}= {matchId:state.matchId,turnId:state.turnId,playerId:player.id};
  const timer=setTimeout(()=>{
    const scheduled=offlineBotTimers.get(code);if(!scheduled||scheduled.matchId!==matchId||scheduled.turnId!==turnId||scheduled.playerId!==playerId)return;
    offlineBotTimers.delete(code);
    const current=rooms.get(code),currentPlayer=current?.players.find(candidate=>candidate.id===playerId);
    if(!current||current.matchId!==matchId||current.status!=='playing'||current.turnId!==turnId||current.turnPlayerId!==playerId||!currentPlayer||currentPlayer.online||sessions.get(playerId)?.room===code)return;
    if(turnClockExpired(current,turnId,Date.now())){performTimedOutTurn(code,turnId);return;}
    try{
      const result=playBotTurn(current,playerId,practiceBotDifficulty(player.seat));
      const next=saveGameTransition(code,current,result.state);sendRoom(code);
      if(next.status==='playing'&&next.turnPlayerId?.startsWith('bot-'))runPracticeBots(code,next.matchId);
    }catch(error){
      recoverFailedBotTurn(code,matchId,turnId,playerId,error,'offline');
    }
  },delay);
  offlineBotTimers.set(code,{matchId,turnId,playerId,timer});
}
function scheduleAutoModeBot(code:string,state:GameState){
  if(state.status!=='playing'||!state.turnPlayerId||!state.turnId)return;
  const player=state.players.find(candidate=>candidate.id===state.turnPlayerId);
  if(!player||!player.autoPlay||player.id.startsWith('bot-')){clearAutoModeBotTimer(code);return;}
  const existing=autoModeBotTimers.get(code);if(existing?.matchId===state.matchId&&existing.turnId===state.turnId&&existing.playerId===player.id)return;
  clearAutoModeBotTimer(code);
  const observation=createBotObservation(state,player.id,practiceBotMemory.get(code)?.get(player.id));
  const delay=observation?botThinkDelayBeforeDeadline(observation,practiceBotDifficulty(player.seat),state.turnDeadlineAt??Date.now()):450;
  const {matchId,turnId,playerId}= {matchId:state.matchId,turnId:state.turnId,playerId:player.id};
  const timer=setTimeout(()=>{
    const scheduled=autoModeBotTimers.get(code);if(!scheduled||scheduled.matchId!==matchId||scheduled.turnId!==turnId||scheduled.playerId!==playerId)return;
    autoModeBotTimers.delete(code);
    const current=rooms.get(code),currentPlayer=current?.players.find(candidate=>candidate.id===playerId);
    if(!current||current.matchId!==matchId||current.status!=='playing'||current.turnId!==turnId||current.turnPlayerId!==playerId||!currentPlayer?.autoPlay)return;
    if(turnClockExpired(current,turnId,Date.now())){performTimedOutTurn(code,turnId);return;}
    try{
      const result=playBotTurn(current,playerId,practiceBotDifficulty(player.seat));
      const next=saveGameTransition(code,current,result.state);sendRoom(code);
      if(next.status==='playing'&&next.turnPlayerId?.startsWith('bot-'))runPracticeBots(code,next.matchId);
    }catch(error){
      recoverFailedBotTurn(code,matchId,turnId,playerId,error,'auto');
    }
  },delay);
  autoModeBotTimers.set(code,{matchId,turnId,playerId,timer});
}
function fail(socket:any,error:unknown){socket.emit('room:error',error instanceof Error?error.message:'İşlem başarısız oldu');}
io.use((socket,next)=>{
  const token=socket.handshake.auth?.sessionToken;
  if(typeof token!=='string'||!token){next();return;}
  void (async()=>{
    try{
      const account=await accountStore.findBySessionToken(token);
      if(!account){socket.data.accountSessionInvalid=true;next();return;}
      const renewedToken=createSeatToken();
      const rotated=await accountStore.rotateSession(account.id,token,renewedToken);
      if(!rotated){socket.data.accountSessionInvalid=true;next();return;}
      socket.data.accountId=account.id;socket.data.accountProfile=account;socket.data.sessionToken=renewedToken;socket.data.sessionTokenRotated=true;
      next();
    }catch{socket.data.accountServiceUnavailable=true;next();}
  })();
});
io.on('connection',socket=>{
  if(socket.data.accountId){
    const previousId=activeAccountSockets.get(socket.data.accountId);
    activeAccountSockets.set(socket.data.accountId,socket.id);
    if(previousId&&previousId!==socket.id){const previous=io.sockets.sockets.get(previousId);if(previous?.connected){previous.emit('account:session-replaced');previous.disconnect(true);}}
    if(socket.data.sessionTokenRotated)socket.emit('account:session-token',{sessionToken:socket.data.sessionToken});
  }
  socket.on('account:me',async(_payload:unknown,reply?:(result:any)=>void)=>{
    if(typeof reply!=='function')return;
    if(socket.data.accountServiceUnavailable){reply({ok:false,retryable:true,error:'Hesap veritabanına ulaşılamıyor.'});return;}
    if(socket.data.accountSessionInvalid){reply({ok:false,invalidSession:true,error:'Oturum sona ermiş. Lütfen tekrar giriş yapın.'});return;}
    let account=socket.data.accountProfile as AccountProfile|undefined;
    if(!account){reply({ok:false,unauthenticated:true});return;}
    try{const daily=await accountStore.claimDailyReward(account.id);account=daily.account;socket.data.accountProfile=account;publishCoinBalances([account]);}
    catch(error){console.error('[mental-coins] günlük ödül kontrolü başarısız',error);}
    reply({ok:true,account});
  });
  socket.on('account:register',async(payload:{username?:string;pin?:string;inviteCode?:string},reply?:(result:any)=>void)=>{
    if(typeof reply!=='function')return;
    try{
      if([...sessions.values()].some(session=>session.id===socket.id))throw new AccountError('Masadayken hesap değiştiremezsiniz.','session');
      const inviteFailure=registrationInviteFailure(payload?.inviteCode);
      if(inviteFailure==='closed')throw new AccountError('Yeni hesap oluşturma şu anda kapalı.','unavailable');
      if(inviteFailure==='invalid')throw new AccountError('Davet kodu geçersiz.','invalid');
      const session=await accountStore.register(typeof payload?.username==='string'?payload.username:'',typeof payload?.pin==='string'?payload.pin:'');
      attachAccountSession(socket,session);reply({ok:true,...session});
    }catch(error){reply({ok:false,error:accountFailure(error)});}
  });
  socket.on('account:login',async(payload:{username?:string;pin?:string},reply?:(result:any)=>void)=>{
    if(typeof reply!=='function')return;
    try{
      if([...sessions.values()].some(session=>session.id===socket.id))throw new AccountError('Masadayken hesap değiştiremezsiniz.','session');
      const session=await accountStore.login(typeof payload?.username==='string'?payload.username:'',typeof payload?.pin==='string'?payload.pin:'',socket.handshake.address||'unknown');
      let authenticated={...session};
      try{authenticated={...session,account:(await accountStore.claimDailyReward(session.account.id)).account};}
      catch(error){console.error('[mental-coins] günlük ödül girişte verilemedi',error);}
      attachAccountSession(socket,authenticated);publishCoinBalances([authenticated.account]);reply({ok:true,...authenticated});
    }catch(error){reply({ok:false,error:accountFailure(error)});}
  });
  socket.on('account:update-avatar',async(payload:{avatar?:string},reply?:(result:any)=>void)=>{
    if(typeof reply!=='function')return;
    try{const account=requireAccount(socket);const updated=await accountStore.updateAvatar(account.id,typeof payload?.avatar==='string'?payload.avatar:'');socket.data.accountProfile=updated;const session=sessions.get(account.id);const state=session?rooms.get(session.room):undefined;if(state){state.players=state.players.map(player=>player.id===account.id?{...player,avatar:updated.avatar}:player);sendRoom(session!.room);}reply({ok:true,account:updated});}
    catch(error){reply({ok:false,error:accountFailure(error)});}
  });
  socket.on('account:logout',async(_payload:unknown,reply?:(result:any)=>void)=>{
    if(typeof reply!=='function')return;
    try{const account=requireAccount(socket);if(sessions.has(account.id))throw new AccountError('Masadan ayrılmadan oturumu kapatamazsınız.','session');const token=socket.data.sessionToken;if(typeof token==='string')await accountStore.logout(account.id,token);if(activeAccountSockets.get(account.id)===socket.id)activeAccountSockets.delete(account.id);delete socket.data.accountId;delete socket.data.accountProfile;delete socket.data.sessionToken;reply({ok:true});}
    catch(error){reply({ok:false,error:accountFailure(error)});}
  });
  socket.on('connection:ping',(payloadOrReply?:unknown,maybeReply?:((response:{serverTime:number;serverProcessingMs:number})=>void))=>{
    const receivedAt=performance.now();
    const reply=typeof payloadOrReply==='function'?payloadOrReply:maybeReply;
    if(typeof reply==='function')reply({serverTime:Date.now(),serverProcessingMs:Math.max(0,performance.now()-receivedAt)});
  });
  socket.on('interaction:state',async(payload:{code?:string;matchId?:string;targetPlayerId?:string},reply?:(result:any)=>void)=>{
    if(typeof reply!=='function')return;
    try{
      const account=requireAccount(socket),code=typeof payload?.code==='string'?payload.code.toUpperCase():'';
      const state=rooms.get(code);if(!state)throw new Error('Masa bulunamadı');
      assertSocketPlayer(socket.id,code,account.id);assertMatchId(state,payload.matchId);
      const target=state.players.find(player=>player.id===payload.targetPlayerId);
      if(!target||target.id===account.id)throw new Error('Bu oyuncu artık masada değil');
      if(state.status!=='playing')throw new Error('İkram ve şakalar yalnızca el devam ederken gönderilebilir');
      const [latestAccount,cooldownUntil]=await Promise.all([accountStore.getAccount(account.id),accountStore.getInteractionCooldown(account.id)]);
      if(!latestAccount)throw new Error('Hesap bulunamadı');
      socket.data.accountProfile=latestAccount;
      reply({ok:true,mentalCoins:latestAccount.mentalCoins,cooldownUntil,serverNow:Date.now()});
    }catch(error){reply({ok:false,error:accountFailure(error)});}
  });
  socket.on('interaction:send',async(payload:{code?:string;matchId?:string;targetPlayerId?:string;itemId?:string;requestId?:string},reply?:(result:any)=>void)=>{
    if(typeof reply!=='function')return;
    try{
      const account=requireAccount(socket),code=typeof payload?.code==='string'?payload.code.toUpperCase():'';
      const state=rooms.get(code);if(!state)throw new Error('Masa bulunamadı');
      assertSocketPlayer(socket.id,code,account.id);assertMatchId(state,payload.matchId);
      if(state.status!=='playing')throw new Error('İkram ve şakalar yalnızca el devam ederken gönderilebilir');
      const target=state.players.find(player=>player.id===payload.targetPlayerId);
      if(!target||target.id===account.id)throw new Error('Hedef oyuncu artık bu masada değil');
      const item=findPlayerInteractionItem(payload.itemId);
      if(!item)throw new Error('Bu ikram veya şaka kataloğunda bulunmuyor');
      const requestId=typeof payload.requestId==='string'?payload.requestId:'';
      if(!/^[a-zA-Z0-9_-]{12,100}$/.test(requestId))throw new Error('İşlem kimliği geçersiz');
      const result=await accountStore.purchaseInteraction({
        accountId:account.id,targetPlayerId:target.id,itemId:item.id,amount:item.price,
        idempotencyKey:`interaction:${account.id}:${requestId}`,type:item.kind==='gift'?'gift_purchase':'joke_purchase',
        description:`${item.name} · ${target.name}`,gameId:state.matchId,cooldownMs:PLAYER_INTERACTION_COOLDOWN_MS,
      });
      socket.data.accountProfile=result.account;
      if(result.status==='purchased'){
        publishCoinBalances([result.account]);
        io.to(code).emit('interaction:received',{roomCode:code,matchId:state.matchId,senderPlayerId:account.id,senderName:state.players.find(player=>player.id===account.id)?.name||account.username,targetPlayerId:target.id,targetName:target.name,itemId:item.id,kind:item.kind,name:item.name,icon:item.icon,receivedText:item.receivedText,at:Date.now()});
      }
      reply({ok:result.status==='purchased'||result.status==='duplicate',status:result.status,mentalCoins:result.account.mentalCoins,cooldownUntil:result.cooldownUntil,serverNow:Date.now(),error:result.status==='cooldown'?'İkram veya şaka göndermek için bekleme süresi devam ediyor':result.status==='insufficient'?'Bu işlem için yeterli Mental Coin yok':undefined});
    }catch(error){reply({ok:false,error:accountFailure(error)});}
  });
  const getDevTestRoom=(payload:{code:string;playerId:string;matchId:string})=>{
    if(!devTestPanelIsEnabled())throw new Error('Test paneli bu sunucuda kapalı');
    const state=rooms.get(payload.code);if(!state)throw new Error('Masa bulunamadı');
    assertSocketPlayer(socket.id,payload.code,payload.playerId);
    assertMatchId(state,payload.matchId);
    requireDevTestOwner(state,payload.playerId);
    return state;
  };
  socket.on('dev-test:inventory',(payload:{code:string;playerId:string;matchId:string},reply?:((result:any)=>void))=>{
    if(typeof reply!=='function')return;
    try{const state=getDevTestRoom(payload);reply({ok:true,inventory:getDevTestInventory(state,payload.playerId)});}
    catch(error){reply({ok:false,error:error instanceof Error?error.message:'Test stoğu okunamadı'});}
  });
  socket.on('dev-test:prepare-openings',(payload:{code:string;playerId:string;matchId:string;kind:DevOpeningPreparationKind},reply?:((result:any)=>void))=>{
    if(typeof reply!=='function')return;
    try{
      const state=getDevTestRoom(payload);
      if(state.turnId&&turnClockExpired(state,state.turnId,Date.now())){performTimedOutTurn(payload.code,state.turnId);throw new Error('Tur süresi dolduğu için test eli hazırlanmadı');}
      const result=prepareDevOpeningHands(state,payload.playerId,payload.kind);
      devOpeningPreparations.set(payload.code,{matchId:state.matchId,round:state.round,kind:payload.kind,openingGroups:result.openingGroups});
      rooms.set(payload.code,result.state);
      sendRoom(payload.code);
      reply({ok:true,message:result.state.message,players:result.players,inventory:getDevTestInventory(result.state,payload.playerId)});
    }catch(error){reply({ok:false,error:error instanceof Error?error.message:'Test eli hazırlanamadı'});}
  });
  socket.on('dev-test:open-player',(payload:{code:string;playerId:string;matchId:string;targetPlayerId:string;kind:DevOpeningPreparationKind},reply?:((result:any)=>void))=>{
    if(typeof reply!=='function')return;
    try{
      let state=getDevTestRoom(payload);
      if(state.turnId&&turnClockExpired(state,state.turnId,Date.now())){performTimedOutTurn(payload.code,state.turnId);throw new Error('Tur süresi dolduğu için test açılışı yapılmadı');}
      const target=state.players.find(player=>player.id===payload.targetPlayerId);
      if(!target)throw new Error('Açılış için seçilen oyuncu masada değil');
      let preparation=devOpeningPreparations.get(payload.code);
      if(preparation&&(preparation.matchId!==state.matchId||preparation.round!==state.round)){devOpeningPreparations.delete(payload.code);preparation=undefined;}
      if(!preparation){
        if(state.settings.folding){
          const firstUnopened=[...state.players].sort((a,b)=>a.seat-b.seat).find(player=>!player.opened);
          if(firstUnopened&&firstUnopened.id!==target.id)throw new Error('Katlamalı testte eşikler artar; önce en düşük koltuk numaralı açılmamış oyuncuyu seçin.');
        }
        const prepared=prepareDevOpeningHands(state,payload.playerId,payload.kind);
        state=prepared.state;
        preparation={matchId:state.matchId,round:state.round,kind:payload.kind,openingGroups:prepared.openingGroups};
        devOpeningPreparations.set(payload.code,preparation);
        rooms.set(payload.code,state);
        sendRoom(payload.code);
      }
      if(preparation.kind!==payload.kind)throw new Error(`Bu el ${preparation.kind==='series'?'seri':'çift'} testi için hazırlandı; farklı tür için yeni el başlatın`);
      if(state.settings.folding){
        const firstUnopened=[...state.players].sort((a,b)=>a.seat-b.seat).find(player=>!player.opened);
        if(firstUnopened&&firstUnopened.id!==target.id)throw new Error('Katlamalı testte sıradaki oyuncu açılmalı; koltukları sırayla seçin.');
      }
      const groups=preparation.openingGroups[target.id];
      if(!groups)throw new Error('Seçilen oyuncu için sunucuda hazırlanmış geçerli per bulunamadı');
      const next=openPreparedDevPlayer(state,payload.playerId,target.id,payload.kind,groups);
      rooms.set(payload.code,next);
      sendRoom(payload.code);
      reply({ok:true,message:next.message,inventory:getDevTestInventory(next,payload.playerId)});
    }catch(error){reply({ok:false,error:error instanceof Error?error.message:'Oyuncu açılamadı'});}
  });
  socket.on('dev-test:apply',(payload:{code:string;playerId:string;matchId:string;selections:unknown;clearHand:boolean},reply?:((result:any)=>void))=>{
    if(typeof reply!=='function')return;
    try{const state=getDevTestRoom(payload);if(state.turnId&&turnClockExpired(state,state.turnId,Date.now())){performTimedOutTurn(payload.code,state.turnId);throw new Error('Tur süresi dolduğu için test işlemi uygulanmadı');}const next=applyDevTestTiles(state,payload.playerId,payload.selections,payload.clearHand);rooms.set(payload.code,next);sendRoom(payload.code);reply({ok:true,message:next.message,inventory:getDevTestInventory(next,payload.playerId)});}
    catch(error){reply({ok:false,error:error instanceof Error?error.message:'Test taşı eklenemedi'});}
  });
  socket.on('dev-test:swap',(payload:{code:string;playerId:string;matchId:string;source:unknown;ownTileId:unknown},reply?:((result:any)=>void))=>{
    if(typeof reply!=='function')return;
    try{
      const state=getDevTestRoom(payload);
      if(state.turnId&&turnClockExpired(state,state.turnId,Date.now())){performTimedOutTurn(payload.code,state.turnId);throw new Error('Tur süresi dolduğu için test takası uygulanmadı');}
      const result=swapDevTestTiles(state,payload.playerId,payload.source,payload.ownTileId);
      rooms.set(payload.code,result.state);
      io.to(payload.code).emit('dev-test:swap-applied',{matchId:state.matchId,transfers:result.transfers});
      sendRoom(payload.code);
      reply({ok:true,message:`${result.sourceTile.realOkey?'Gerçek okey':result.sourceTile.fakeJoker?'Sahte okey':`${result.sourceTile.color} ${result.sourceTile.number}`} ile ${result.offeredTile.realOkey?'gerçek okey':result.offeredTile.fakeJoker?'sahte okey':`${result.offeredTile.color} ${result.offeredTile.number}`} takas edildi`,inventory:getDevTestInventory(result.state,payload.playerId)});
    }catch(error){reply({ok:false,error:error instanceof Error?error.message:'Test takası yapılamadı'});}
  });
  socket.on('room:create',(payload:{settings:unknown},reply:(v:any)=>void)=>{
    try{const account=requireAccount(socket);preventDuplicateWaitingReservation(account.id);const settings=validateTableSettings(payload.settings);const priorSession=sessions.get(account.id);if(priorSession){if(priorSession.id===socket.id)throw new Error('Hesabınız zaten bir masada');if(io.sockets.sockets.get(priorSession.id)?.connected)throw new Error('Bu hesap başka bir masada kullanılıyor');sessions.delete(account.id);}const code=roomCode();const state=freshRoom(settings);const player:Player={id:account.id,name:account.username,avatar:account.avatar,online:true,seat:0,score:0,opened:false,pairMode:false,mentalCoins:account.mentalCoins};state.players=[player];state.message='Masa açıldı, arkadaşlarını davet et';rooms.set(code,state);const seatToken=storeSeatToken(code,player.id);sessions.set(player.id,{id:socket.id,room:code});socket.join(code);reply({ok:true,code,playerId:player.id,matchId:state.matchId,seatToken});sendRoom(code);}catch(e){reply({ok:false,error:e instanceof Error?e.message:'Masa açılamadı'});}
  });
  socket.on('room:leave',(payload:{code:string;playerId?:string},reply?:((result:any)=>void))=>{
    try{
      const account=requireAccount(socket),playerId=account.id,code=typeof payload?.code==='string'?payload.code.toUpperCase():'';
      const state=rooms.get(code);if(!state)throw new Error('Masa bulunamadı');
      assertSocketPlayer(socket.id,code,playerId);
      if(state.status!=='waiting')throw new Error('Oyun başladıktan sonra koltuk bırakılamaz; bağlantınız koparsa koltuğunuz korunur');
      if(!state.players.some(player=>player.id===playerId))throw new Error('Bu masada koltuğunuz yok');
      waitingSeatTimers.cancel(code,playerId);
      const players=state.players.filter(player=>player.id!==playerId);
      seatTokens.get(code)?.delete(playerId);
      sessions.delete(playerId);
      socket.leave(code);
      if(players.length===0){rooms.delete(code);seatTokens.delete(code);devOpeningPreparations.delete(code);practiceBotMemory.delete(code);clearRoomTimers(code);}
      else{rooms.set(code,{...state,players});sendRoom(code);}
      reply?.({ok:true});
    }catch(error){
      const result={ok:false,error:error instanceof Error?error.message:'Masadan ayrılamadınız'};
      if(reply)reply(result);else fail(socket,error);
    }
  });
  socket.on('room:join',(payload:{code:string;playerId?:string;name?:string;avatar?:string;seatToken?:string},reply:(v:any)=>void)=>{
    try{
      const account=requireAccount(socket),playerId=account.id,code=typeof payload?.code==='string'?payload.code.toUpperCase():'';
      const state=rooms.get(code);if(!state)throw new Error('Bu masa koduyla açık masa bulunamadı');
      preventDuplicateWaitingReservation(playerId,code);
      const priorSession=sessions.get(playerId);
      if(priorSession&&priorSession.room!==code){
        if(io.sockets.sockets.get(priorSession.id)?.connected)throw new Error('Bu hesap başka bir masada kullanılıyor');
        sessions.delete(playerId);
      }
      if(state.status!=='waiting'&&!state.players.some(player=>player.id===playerId))throw new Error('Oyun başlamış, masaya katılamazsınız');
      const claimed=sessions.get(playerId);
      if(claimed&&claimed.id!==socket.id){
        if(io.sockets.sockets.get(claimed.id)?.connected)throw new Error('Bu hesap başka bir bağlantıda masada');
        sessions.delete(playerId);
      }
      let player=state.players.find(candidate=>candidate.id===playerId);
      let seatToken:string;
      if(player){
        const expected=seatTokens.get(code)?.get(player.id);
        if(state.status==='waiting'&&!player.online&&waitingSeatTimers.isExpired(code,player.id)){
          waitingSeatTimers.cancel(code,player.id);
          if(expected)releaseWaitingSeatWhenExpired({roomCode:code,playerId:player.id,seatToken:expected});
          throw new Error('Koltuk süresi doldu veya koltuk doğrulanamadı. Eski koltuk geri alınamadı.');
        }
        if(!expected||typeof payload.seatToken!=='string'||payload.seatToken!==expected)throw new Error('Koltuk süresi doldu veya koltuk doğrulanamadı. Eski koltuk geri alınamadı.');
        const active=sessions.get(player.id);
        if(player.online&&active&&active.id!==socket.id&&io.sockets.sockets.get(active.id)?.connected)throw new Error('Bu oyuncu başka bir bağlantıda çevrimiçi');
        if(active&&active.id!==socket.id)sessions.delete(player.id);
        if(state.status==='waiting')waitingSeatTimers.cancel(code,player.id);
        clearOfflineBotTimer(code);
        player={...player,name:account.username,avatar:account.avatar,online:true,mentalCoins:account.mentalCoins};
        state.players=state.players.map(candidate=>candidate.id===player!.id?player!:candidate);
        seatToken=expected;
      }else{
        if(payload.seatToken!==undefined)throw new Error('Koltuk süresi doldu veya koltuk doğrulanamadı. Eski koltuk geri alınamadı.');
        if(state.players.length>=4)throw new Error('Masa dolu');
        player={id:playerId,name:account.username,avatar:account.avatar,online:true,seat:nextAvailableSeat(state),score:0,opened:false,pairMode:false,mentalCoins:account.mentalCoins};
        state.players=[...state.players,player];
        seatToken=storeSeatToken(code,player.id);
      }
      sessions.set(player.id,{id:socket.id,room:code});
      socket.join(code);
      reply({ok:true,code,playerId,matchId:state.matchId,settings:state.settings,seatToken});
      sendRoom(code);
      if(state.status==='playing'&&state.turnPlayerId!==player.id){
        const active=state.players.find(candidate=>candidate.id===state.turnPlayerId);
        if(active&&!active.online)scheduleOfflineBot(code,state);
      }
    }catch(e){reply({ok:false,error:e instanceof Error?e.message:'Masaya katılamadı'});}
  });
  socket.on('game:start',(payload:{code:string;playerId:string;matchId:string})=>{try{const state=rooms.get(payload.code);if(!state)throw new Error('Masa bulunamadı');assertSocketPlayer(socket.id,payload.code,payload.playerId);assertMatchId(state,payload.matchId);if(state.players[0]?.id!==payload.playerId)throw new Error('Sadece masa sahibi başlatabilir');if(state.status!=='waiting'||state.players.length!==4)throw new Error('Oyun yalnızca dört oyuncu bekleme masasındayken başlatılabilir');waitingSeatTimers.cancelRoom(payload.code);startServerTurnClock(payload.code,startRound(state));sendRoom(payload.code);}catch(e){fail(socket,e);}});
  socket.on('game:practice',(payload:{code:string;playerId:string;matchId:string})=>{try{let state=rooms.get(payload.code);if(!state)throw new Error('Masa bulunamadı');assertSocketPlayer(socket.id,payload.code,payload.playerId);assertMatchId(state,payload.matchId);if(state.players[0]?.id!==payload.playerId||state.status!=='waiting'||state.players.length<1||state.players.length>=4)throw new Error('Botlu deneme yalnızca 1–3 gerçek oyunculu bekleme masasında başlatılabilir');waitingSeatTimers.cancelRoom(payload.code);const occupiedSeats=new Set(state.players.map(player=>player.seat));const botProfiles:[string,string][]=[['',''],['ibo','🤖'],['Atlas','🦊'],['Luna','🐼']];const bots:Player[]=[];for(let seat=0;seat<4;seat++){if(occupiedSeats.has(seat))continue;const [name,avatar]=botProfiles[seat];bots.push({id:`bot-${payload.code}-${seat}`,name,avatar,online:true,seat,score:0,opened:false,pairMode:false});}state.players=[...state.players,...bots].sort((a,b)=>a.seat-b.seat);state.message='Deneme turu başladı · sırada siz varsınız';state=startRound(state);state.message='Deneme turu başladı · ilk taşı atın';state=startServerTurnClock(payload.code,state);sendRoom(payload.code);}catch(e){fail(socket,e);}});
  socket.on('game:next-round',(payload:{code:string;playerId:string;matchId:string})=>{try{const state=rooms.get(payload.code);if(!state)throw new Error('Masa bulunamadı');assertSocketPlayer(socket.id,payload.code,payload.playerId);assertMatchId(state,payload.matchId);if(state.players[0]?.id!==payload.playerId)throw new Error('Sonraki eli masa sahibi başlatabilir');if(state.status!=='round-end'||state.round>=state.settings.rounds)throw new Error('Maç tamamlandı; yeni maç için masa kurulumunu açın');if(state.roundFinishKind==='elden'&&typeof state.roundRevealUntilAt==='number'&&Date.now()<state.roundRevealUntilAt)throw new Error('Elden bitiş gösterimi tamamlanmadan yeni el başlatılamaz');clearRoundRestartTimer(payload.code);clearRevealTimer(payload.code);startServerTurnClock(payload.code,beginNextRound(state));sendRoom(payload.code)}catch(e){fail(socket,e)}});
  socket.on('game:new-match',(payload:{code:string;playerId:string;matchId:string;settings:unknown},reply?:(result:any)=>void)=>{try{
    const state=rooms.get(payload.code);if(!state)throw new Error('Masa bulunamadı');assertSocketPlayer(socket.id,payload.code,payload.playerId);assertMatchId(state,payload.matchId);
    if(state.players[0]?.id!==payload.playerId)throw new Error('Yeni maçı yalnızca masa sahibi başlatabilir');
    if(state.status!=='match-end')throw new Error('Yeni oyun yalnızca maç tamamlandıktan sonra başlatılabilir');if(state.roundFinishKind==='elden'&&typeof state.roundRevealUntilAt==='number'&&Date.now()<state.roundRevealUntilAt)throw new Error('Elden bitiş gösterimi tamamlanmadan yeni maç başlatılamaz');
    if(state.players.length!==4||new Set(state.players.map(player=>player.seat)).size!==4)throw new Error('Yeni maç için dört oyunculu masa düzeni gerekli');
    if(!state.players.some(player=>player.id===payload.playerId&&player.online))throw new Error('Masa sahibi bu masada çevrimiçi değil');
     const settings=validateTableSettings(payload.settings);clearMatchRestartTimer(payload.code);clearRoundRestartTimer(payload.code);clearRevealTimer(payload.code);clearTurnTimer(payload.code);clearAutoModeBotTimer(payload.code);let next=startNewMatch(state,settings);next=startServerTurnClock(payload.code,next);
    if(reply)reply({ok:true,matchId:next.matchId});sendRoom(payload.code);
  }catch(error){if(reply)reply({ok:false,error:error instanceof Error?error.message:'Yeni oyun başlatılamadı'});else fail(socket,error);}});
  socket.on('game:pause-final-restart',(payload:{code:string;playerId:string;matchId:string},reply?:(result:any)=>void)=>{try{
    const state=rooms.get(payload.code);if(!state)throw new Error('Masa bulunamadı');assertSocketPlayer(socket.id,payload.code,payload.playerId);assertMatchId(state,payload.matchId);
    if(state.players[0]?.id!==payload.playerId)throw new Error('Yeni maç ayarlarını yalnızca masa sahibi açabilir');if(state.status!=='match-end')throw new Error('Maç tamamlanmadan yeni maç ayarları açılamaz');
    clearMatchRestartTimer(payload.code);rooms.set(payload.code,{...state,roundAutoStartAt:null});io.to(payload.code).emit('game:final-restart-paused',{matchId:state.matchId});if(reply)reply({ok:true});
  }catch(error){if(reply)reply({ok:false,error:error instanceof Error?error.message:'Maç zamanlayıcısı durdurulamadı'});else fail(socket,error);}});
  socket.on('game:recognize-real-okey',(payload:{code:string;playerId:string;matchId:string;operation:'toggle'|'auto-sort';tileId?:number;mode?:'series'|'pairs';groups?:number[][]})=>{try{
    const state=rooms.get(payload.code);if(!state)throw new Error('Masa bulunamadı');assertSocketPlayer(socket.id,payload.code,payload.playerId);assertMatchId(state,payload.matchId);
    if(!state.players.some(player=>player.id===payload.playerId&&player.online))throw new Error('Bu oyuncu masada değil');
    let next:GameState;
    if(payload.operation==='toggle'){
      if(payload.tileId===undefined)throw new Error('İşaretlenecek gerçek okey taşını seçin');
      next=updateRealOkeyRecognition(state,payload.playerId,[payload.tileId],'toggle');
    }else if(payload.operation==='auto-sort'){
      if((payload.mode!=='series'&&payload.mode!=='pairs')||!Array.isArray(payload.groups)||payload.groups.length>22)throw new Error('Dizme türü veya gruplar geçersiz');
      const hand=state.hands[payload.playerId]||[],handById=new Map(hand.map(tile=>[tile.id,tile])),usedIds=new Set<number>(),realOkeyIds:number[]=[];
      for(const tileIds of payload.groups){
        if(!Array.isArray(tileIds)||tileIds.length<(payload.mode==='series'?3:2)||(payload.mode==='pairs'&&tileIds.length!==2)||new Set(tileIds).size!==tileIds.length||tileIds.some(tileId=>!Number.isSafeInteger(tileId)||usedIds.has(tileId)))throw new Error('Otomatik dizme grupları geçersiz');
        const tiles=tileIds.map(tileId=>handById.get(tileId));if(tiles.some(tile=>!tile))throw new Error('Otomatik dizme taşı artık elinizde değil');
        const selected=tiles as NonNullable<typeof tiles[number]>[];
        if(payload.mode==='series'){
          const detected=findRackMeldGroups(selected,state.joker);if(detected.length!==1||detected[0].length!==selected.length)throw new Error('Otomatik dizme seri grubu geçersiz');
        }else if(selected.length!==2||!isValidPair(selected,state.joker))throw new Error('Otomatik dizme çift grubu geçersiz');
        for(const tileId of tileIds){usedIds.add(tileId);const tile=handById.get(tileId)!;if(isRealOkey(tile,state.joker))realOkeyIds.push(tileId);}
      }
      if(!realOkeyIds.length)return;
      next=updateRealOkeyRecognition(state,payload.playerId,realOkeyIds,'mark');
    }else throw new Error('Gerçek okey işlemi geçersiz');
    if(next===state)return;rooms.set(payload.code,next);sendRealOkeyRecognition(payload.code,next);
  }catch(e){fail(socket,e)}});
  socket.on('game:guidance-preview',(payload:TurnGuidanceRequest,reply?:((result:unknown)=>void))=>{
    if(typeof reply!=='function')return;
    try{
      if(!payload||typeof payload.code!=='string'||typeof payload.playerId!=='string'||typeof payload.matchId!=='string'||typeof payload.turnId!=='string'||typeof payload.requestKey!=='string'||payload.requestKey.length===0||payload.requestKey.length>2048)throw new Error('Yönlendirme kontrol isteği geçersiz');
      const state=rooms.get(payload.code);if(!state)throw new Error('Masa bulunamadı');
      assertSocketPlayer(socket.id,payload.code,payload.playerId);assertMatchId(state,payload.matchId);
      if(!state.players.some(player=>player.id===payload.playerId&&player.online))throw new Error('Bu oyuncu masada değil');
      if(!isTurnGuidanceCandidate(payload.candidate))throw new Error('Yönlendirme adayları geçersiz');
      // A stale preview is read-only and returns only non-actionable flags. It never advances a turn.
      if(payload.turnId!==state.turnId){
        const stale=createTurnGuidancePreview(state,payload.playerId,payload.requestKey,{seriesGroups:[],pairGroups:[],elden:null},Date.now());
        reply({...stale,active:false,canDrawStock:false,canTakeDiscard:false,canDiscard:false,canOpenSeries:false,canOpenPairs:false,canFinishFromHand:false,canLaySeries:false,canLayPairs:false,canProcessMeld:false});
        return;
      }
      reply(createTurnGuidancePreview(state,payload.playerId,payload.requestKey,payload.candidate,Date.now()));
    }catch(error){reply({ok:false,requestKey:typeof payload?.requestKey==='string'?payload.requestKey:'',error:error instanceof Error?error.message:'Yönlendirme doğrulanamadı'});}
  });
  socket.on('game:auto-mode',(payload:{code:string;playerId:string;matchId:string;enabled:boolean},reply:(result:{ok:boolean;enabled?:boolean;error?:string})=>void)=>{
    try{
      const state=rooms.get(payload.code);if(!state)throw new Error('Masa bulunamadı');
      assertSocketPlayer(socket.id,payload.code,payload.playerId);assertMatchId(state,payload.matchId);
      if(typeof payload.enabled!=='boolean')throw new Error('Oto mod seçimi geçersiz');
      const player=state.players.find(candidate=>candidate.id===payload.playerId);
      if(!player||!player.online||player.id.startsWith('bot-'))throw new Error('Oto mod yalnızca bağlı gerçek oyuncular tarafından kullanılabilir');
      if(state.status!=='playing'&&state.status!=='round-end'&&state.status!=='match-end')throw new Error('Oto mod oyun başladıktan sonra kullanılabilir');
      const updated={...player,autoPlay:payload.enabled};
      const next={...state,players:state.players.map(candidate=>candidate.id===player.id?updated:candidate)};
      rooms.set(payload.code,next);
      if(payload.enabled){if(next.status==='playing'&&next.turnPlayerId===player.id)scheduleAutoModeBot(payload.code,next);}
      else clearAutoModeBotTimer(payload.code,player.id);
      sendRoom(payload.code);reply({ok:true,enabled:payload.enabled});
    }catch(error){reply({ok:false,error:error instanceof Error?error.message:'Oto mod değiştirilemedi'});}
  });
  socket.on('game:action',(payload:{code:string;playerId:string;matchId:string;turnId?:string;requestId?:string;action:'draw'|'take-discard'|'return-discard'|'discard'|'open'|'elden'|'undo-open'|'collect-opening-meld'|'lay'|'reclaim-okey'|'lay-new-series'|'lay-new-pairs';tileId?:number;groups?:number[][];pairMode?:boolean;meldId?:string;target?:MeldLayTarget;realOkeyTileId?:number;replacementTileId?:number;finalTileId?:number})=>{
    try{
      let state=rooms.get(payload.code);
      if(!state)throw new Error('Masa bulunamadı');
      assertSocketPlayer(socket.id,payload.code,payload.playerId);
      assertMatchId(state,payload.matchId);
      if(!state.players.some(player=>player.id===payload.playerId&&player.online))throw new Error('Bu oyuncu masada değil');
      if(state.players.some(player=>player.id===payload.playerId&&player.autoPlay))throw new Error('Oto mod açık; manuel hamle için önce oto moddan çıkın');
      if(typeof payload.turnId!=='string'||!payload.turnId||payload.turnId!==state.turnId)throw new Error('Hamle önceki turdan geldi; masa durumunu yenileyin');
      const needsRequestId=['open','elden','lay','reclaim-okey','lay-new-series','lay-new-pairs','collect-opening-meld'].includes(payload.action);
      if(needsRequestId&&(typeof payload.requestId!=='string'||payload.requestId.trim().length===0||payload.requestId.length>128))throw new Error('İşlem isteği kimliği geçersiz');
      if(state.turnId&&turnClockExpired(state,state.turnId,Date.now())){performTimedOutTurn(payload.code,state.turnId);throw new Error('Süreniz doldu; otomatik hamle yapıldı');}
      const previous=state;
      if(payload.action==='open'){
        if(state.turnPlayerId!==payload.playerId||state.phase!=='discard')throw new Error('Açılış için sıranızda olmalı ve taş çekmiş olmalısınız');
        const openingPlayerHadOpened=state.players.find(player=>player.id===payload.playerId)?.opened??false;
        const fingerprint=JSON.stringify(['open',!!payload.pairMode,payload.groups]);
        const prior=(state.processedOpeningAttempts||[]).find(attempt=>attempt.matchId===state.matchId&&attempt.round===state.round&&attempt.turnId===payload.turnId&&attempt.playerId===payload.playerId&&attempt.requestId===payload.requestId);
        if(prior){if(prior.fingerprint!==fingerprint)throw new Error('Bu açılış istek kimliği başka bir işlemde kullanıldı');if(prior.result==='success')return;throw new Error('Bu açılış isteği daha önce işlendi; ceza ikinci kez uygulanmadı');}
        try{
          if(!Array.isArray(payload.groups)||!payload.groups.length)throw new Error('Açılacak geçerli perleri seçin');
          state=payload.pairMode?openMelds(state,payload.playerId,payload.groups,true):openSeriesMelds(state,payload.playerId,payload.groups);
          state=recordSuccessfulOpeningAttempt(state,payload.playerId,payload.requestId!,fingerprint,payload.turnId);
          if(!openingPlayerHadOpened&&state.turnId===payload.turnId&&state.turnPlayerId===payload.playerId&&state.turnDeadlineAt!==null)state={...state,turnDeadlineAt:state.turnDeadlineAt+OPENING_TURN_BONUS_MS};
        }catch(openError){
          const detail=(openError instanceof Error?openError.message:'Açılış doğrulanamadı').replace(/\s*Ceza uygulanmadı\.?/gi,'').trim();
          state=recordInvalidOpenAttempt(state,payload.playerId,payload.requestId!,fingerprint,detail,payload.turnId,Date.now());
          rooms.set(payload.code,state);
          sendRoom(payload.code);
          const openingType=payload.pairMode?'Çift açılışı':'Seri açılışı';
          fail(socket,new Error(`${openingType} geçersiz. 101 ceza puanı uygulandı. ${detail}`));
          return;
        }
      }else if(payload.action==='draw')state=drawStock(state,payload.playerId);
      else if(payload.action==='take-discard')state=takeDiscard(state,payload.playerId);
      else if(payload.action==='return-discard')state=returnTakenDiscard(state,payload.playerId);
      else if(payload.action==='discard'){if(payload.tileId===undefined)throw new Error('Atılacak taşı seçin');state=discardTile(state,payload.playerId,payload.tileId);}
      else if(payload.action==='elden'){if(!Array.isArray(payload.groups)||payload.finalTileId===undefined)throw new Error('Elden bitiş grupları ve son taş seçilmelidir');state=finishFromHand(state,payload.playerId,payload.groups,payload.finalTileId,!!payload.pairMode,payload.requestId!,Date.now());}
      else if(payload.action==='lay'){if(payload.tileId===undefined||!payload.meldId)throw new Error('Taş ve per seçin');const target=payload.target??'auto';if(target!=='auto'&&target!=='head'&&target!=='tail'&&target!=='group')throw new Error('İşleme yönü geçersiz');state=addToMeld(state,payload.playerId,payload.tileId,payload.meldId,target,payload.turnId,payload.requestId);}
      else if(payload.action==='reclaim-okey'){if(!payload.meldId||!Number.isSafeInteger(payload.realOkeyTileId)||!Number.isSafeInteger(payload.replacementTileId))throw new Error('Per, gerçek okey ve yerine verilecek taş seçilmelidir');state=reclaimRealOkey(state,payload.playerId,payload.meldId,payload.realOkeyTileId!,payload.replacementTileId!,payload.turnId,payload.requestId);}
      else if(payload.action==='lay-new-series'){if(!payload.groups?.length)throw new Error('Yeni seri gruplarını seçin');state=layNewSeriesMelds(state,payload.playerId,payload.groups,payload.turnId,payload.requestId);}
      else if(payload.action==='lay-new-pairs'){if(!payload.groups?.length)throw new Error('Yeni çift gruplarını seçin');state=layNewPairMelds(state,payload.playerId,payload.groups,payload.turnId,payload.requestId);}
      else if(payload.action==='undo-open')state=undoOpenMelds(state,payload.playerId);
      else if(payload.action==='collect-opening-meld'){if(!payload.meldId)throw new Error('Toplanacak peri seçin');state=collectOpeningMeld(state,payload.playerId,payload.meldId,payload.turnId,payload.requestId);}
      saveGameTransition(payload.code,previous,state);
      const saved=rooms.get(payload.code)!;
      sendRoom(payload.code);
      if(saved.players.some(player=>player.id.startsWith('bot-'))&&saved.players.some(player=>player.online&&player.id.startsWith('bot-')))runPracticeBots(payload.code,saved.matchId);
    }catch(error){fail(socket,error);}
  });
  socket.on('room:chat',(payload:{code:string;playerId:string;text:string})=>{try{assertSocketPlayer(socket.id,payload.code,payload.playerId)}catch{return}const state=rooms.get(payload.code);const player=state?.players.find(p=>p.id===payload.playerId);if(!player||!payload.text.trim())return;io.to(payload.code).emit('room:chat',{id:player.id,name:player.name,text:payload.text.trim().slice(0,140),at:Date.now()});});
  socket.on('disconnect',()=>{
    const accountId=socket.data.accountId;
    if(accountId&&activeAccountSockets.get(accountId)===socket.id)activeAccountSockets.delete(accountId);
    for(const [id,session] of [...sessions]){
      if(session.id!==socket.id)continue;
      const code=session.room,state=rooms.get(code);
      sessions.delete(id);
      if(!state)continue;
      state.players=state.players.map(player=>player.id===id?{...player,online:false}:player);
      const disconnected=state.players.find(player=>player.id===id);
      if(state.status==='waiting'&&disconnected){
        const seatToken=seatTokens.get(code)?.get(id);
        if(seatToken)waitingSeatTimers.schedule({roomCode:code,playerId:id,seatToken},releaseWaitingSeatWhenExpired);
      }
      sendRoom(code);
      if(state.turnPlayerId===id&&state.status==='playing'){
        if(disconnected?.autoPlay)scheduleAutoModeBot(code,state);
        else scheduleOfflineBot(code,state);
      }
    }
  });
});
const port=Number(process.env.PORT||3001);
void (async()=>{await accountStore.initialize();httpServer.listen(port,'0.0.0.0',()=>console.log(`Mental Okey server listening on ${port}`));})().catch(()=>{console.error('Mental Okey server startup failed: persistent account database is unavailable or not configured.');process.exitCode=1;});
