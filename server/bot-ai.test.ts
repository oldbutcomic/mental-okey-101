import assert from 'node:assert/strict';
import test from 'node:test';
import {
  autoPlayTimedOutTurn,
  createDeck,
  freshRoom,
  isPenaltyDiscardTile,
  recordRoundBadges,
  startRound,
  startNewMatch,
  startTurnClock,
  type GameState,
  type TableSettings,
  type Tile,
  type TileColor,
} from '../shared/game.js';
import { botMeldRequestId, botThinkDelay, botThinkDelayBeforeDeadline, createBotObservation, hasBotOpeningOpportunity, playBotTurn, chooseBotDiscard, type BotDifficulty } from './bot-ai.js';

const baseSettings: TableSettings = { rounds: 1, mode: 'solo', folding: false, assisted: true, tableColor: 'wood', turnDurationSeconds: 45 };
const tile = (id: number, color: TileColor, number: number, fakeJoker = false): Tile => ({ id, color, number, fakeJoker });

function botRoom(settings: TableSettings = baseSettings, seed?:number, autoSeat?:number): GameState {
  const room = freshRoom(settings);
  room.players = [0, 1, 2, 3].map(seat => ({ id: `bot-room-${seat}`, name: `Bot ${seat}`, avatar: '🤖', online: true, seat, score: 0, opened: false, pairMode: false,autoPlay:seat===autoSeat }));
  if(seed===undefined)return startTurnClock(startRound(room,()=>0),Date.now(),'bot-test-turn');
  // Seed the shared deck shuffle for repeatable before/after bot metrics.
  const random=seededRandom(seed),originalRandom=Math.random;
  Math.random=random;
  try{return startTurnClock(startRound(room,random),Date.now(),`bot-test-turn-${seed}`)}
  finally{Math.random=originalRandom}
}

function putBotHand(state: GameState, playerId: string, hand: Tile[], options: Partial<GameState> = {}): GameState {
  return startTurnClock({ ...state, ...options, hands: { ...state.hands, [playerId]: hand }, turnPlayerId: playerId, phase: 'discard' }, Date.now(), `bot-test-${playerId}-${Math.random()}`);
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 0x1_0000_0000; };
}

function emptyBotControlStats(){return{turns:0,penalties:0,penaltyReasons:{} as Record<string,number>,discardPenaltyEvents:0,discardPenaltyWithSafeAlternative:0,discardPenaltyWithoutSafeAlternative:0,missedOpenings:0,seriesOpen:0,pairOpen:0,processed:0,finishes:0,timeouts:0,openingTurnTotal:0,openingCount:0};}

test('bot işlem istek kimlikleri aynı uzun turda normal ve Oto Mod için 12 işlemde benzersiz ve 128 karakter sınırında kalır',()=>{
  for(const autoMode of [false,true]){
    const initial=botRoom(),playerId=`player-${'x'.repeat(160)}`;
    let state:GameState={...initial,matchId:'match-'+ 'm'.repeat(100),turnId:'turn-'+ 't'.repeat(200),players:initial.players.map((player,index)=>index===0?{...player,id:playerId,autoPlay:autoMode}:player)};
    const ids:string[]=[];
    for(let index=0;index<12;index++){
      const id=botMeldRequestId(state,playerId);
      assert.ok(id.length<=128,`request ID must be <=128 chars, got ${id.length}`);
      assert.ok(!ids.includes(id),`request ID ${id} was reused during the same turn`);
      ids.push(id);
      state={...state,processedMeldActions:[...(state.processedMeldActions||[]),{turnId:state.turnId!,playerId,requestId:id,fingerprint:`operation-${index}`} ]};
    }
    assert.equal(new Set(ids).size,12);
  }
});

function safeDiscardAlternativesAtTurnResult(state:GameState,playerId:string,discardedTile:Tile):Tile[]{
  const hand=[...(state.hands[playerId]||[]),discardedTile];
  const reconstructed={...state,hands:{...state.hands,[playerId]:hand}};
  const observation=createBotObservation(reconstructed,playerId);
  if(!observation)return [];
  const penaltyIds=new Set(observation.penaltyDiscardTileIds);
  return observation.hand.filter(candidate=>!penaltyIds.has(candidate.id));
}

test('bot ceza riski açık serileri, renk gruplarını ve gerçek okey geri alımını kapsar',()=>{
  const state=botRoom(),id=state.players[0].id,owner=state.players[1].id;
  const run=[tile(92101,'red',4),tile(92102,'red',5),tile(92103,'red',6)];
  const extended={...state,melds:[{id:'risk-run',ownerId:owner,tileIds:run.map(candidate=>candidate.id),tiles:run,kind:'run' as const,realOkeyAssignments:{}}]};
  assert.equal(isPenaltyDiscardTile(extended,tile(92104,'red',3)),true,'seri başına eklenebilir taş işlek sayılmalı');
  assert.equal(isPenaltyDiscardTile(extended,tile(92105,'red',7)),true,'seri sonuna eklenebilir taş işlek sayılmalı');
  const group=[tile(92111,'red',9),tile(92112,'blue',9),tile(92113,'black',9)];
  const colorGroup={...state,melds:[{id:'risk-group',ownerId:owner,tileIds:group.map(candidate=>candidate.id),tiles:group,kind:'group' as const,realOkeyAssignments:{}}]};
  assert.equal(isPenaltyDiscardTile(colorGroup,tile(92114,'yellow',9)),true,'renk grubunun eksik rengine eklenebilen taş işlek sayılmalı');
  const real=tile(92122,'yellow',8),naturalA=tile(92121,'red',5),naturalB=tile(92125,'red',7),pairState={...state,joker:{color:'yellow' as const,number:8},melds:[{id:'risk-reclaim',ownerId:owner,tileIds:[naturalA.id,real.id,naturalB.id],tiles:[naturalA,real,naturalB],kind:'run' as const,realOkeyAssignments:{[real.id]:{color:'red' as const,number:6}}}]};
  assert.equal(isPenaltyDiscardTile(pairState,tile(92123,'red',6)),true,'gerçek okeyin temsil ettiği doğal taş geri alma hedefiyse ceza riski sayılmalı');
  assert.equal(isPenaltyDiscardTile(pairState,tile(92124,'yellow',8,true)),false,'sahte okey gerçek okey yerine geçerek geri alınamamalı');
});

test('bot seri açarken gerçek sunucu eşiğini kullanır ve 101 üstü eli açar', () => {
  const state = botRoom(), id = state.players[0].id;
  const hand = [
    tile(90001,'red',10),tile(90002,'red',11),tile(90003,'red',12),
    tile(90004,'blue',10),tile(90005,'blue',11),tile(90006,'blue',12),
    tile(90007,'yellow',9),tile(90008,'yellow',10),tile(90009,'yellow',11),tile(90010,'yellow',12),
    tile(90011,'black',1),tile(90012,'black',3),
  ];
  const ready = putBotHand(state,id,hand);
  const result = playBotTurn(ready,id,'hard',()=>0.99);
  assert.ok(result.actions.includes('open-series'));
  assert.equal(result.state.players.find(player => player.id === id)?.opened,true);
  assert.ok(result.state.melds.length >= 2);
  assert.ok(result.state.status==='playing'||result.state.status==='round-end');
});

test('bot gerçek okeyi seri açarken, yeni per indirirken ve masaya işlerken otomatik tanır', () => {
  const joker={color:'yellow' as const,number:8};
  const openedRoom=botRoom(), opener=openedRoom.players[0].id, openingOkey=tile(90509,'yellow',8);
  const openingHand=[
    tile(90501,'red',10),tile(90502,'red',11),tile(90503,'red',12),
    tile(90504,'blue',10),tile(90505,'blue',11),tile(90506,'blue',12),
    tile(90507,'red',13),tile(90508,'blue',13),openingOkey,tile(90510,'black',2),
  ];
  const opened=playBotTurn(putBotHand(openedRoom,opener,openingHand,{joker}),opener,'hard',()=>0.99);
  assert.ok(opened.actions.includes('open-series'));
  assert.ok(opened.state.melds.some(meld=>meld.tiles.some(candidate=>candidate.id===openingOkey.id)));
  assert.ok(opened.state.recognizedRealOkeyIds.includes(openingOkey.id));

  const layRoom=botRoom(), layer=layRoom.players[0].id, layOkey=tile(90603,'yellow',8);
  const laid=playBotTurn(putBotHand(layRoom,layer,[tile(90601,'red',13),tile(90602,'blue',13),layOkey,tile(90604,'black',2)],{
    joker,players:layRoom.players.map(player=>player.id===layer?{...player,opened:true}:player),
  }),layer,'hard',()=>0.99);
  assert.ok(laid.actions.includes('lay-new-series'));
  assert.ok(laid.state.recognizedRealOkeyIds.includes(layOkey.id));

  const processRoom=botRoom(), processor=processRoom.players[0].id, owner=processRoom.players[1].id, processOkey=tile(90704,'yellow',8);
  const run=[tile(90701,'red',10),tile(90702,'red',11),tile(90703,'red',12)];
  const processReady=putBotHand(processRoom,processor,[processOkey,tile(90705,'black',2)],{
    joker,players:processRoom.players.map(player=>player.id===processor?{...player,opened:true}:player),
    melds:[{id:'bot-recognition-run',ownerId:owner,tileIds:run.map(candidate=>candidate.id),tiles:run,kind:'run',realOkeyAssignments:{}}],
  });
  const pendingProcess={...processReady,takenDiscardUse:{playerId:processor,tileId:processOkey.id,ownerId:owner,turnId:processReady.turnId!,used:false}};
  const processed=playBotTurn(pendingProcess,processor,'hard',()=>0.99);
  assert.ok(processed.actions.includes('meld-lay'));
  assert.ok(processed.state.melds[0].tiles.some(candidate=>candidate.id===processOkey.id));
  assert.ok(processed.state.recognizedRealOkeyIds.includes(processOkey.id));
});

test('bot çift açılışını eşik üzerinden yapar; açılmış oyuncu yeni çift indirebilir', () => {
  const state = botRoom(), id = state.players[0].id;
  const hand = [1,2,3,4,5].flatMap((number,index) => [tile(91000+index*2,'red',number),tile(91001+index*2,'red',number)]).concat(tile(91020,'blue',13),tile(91021,'black',2));
  const result = playBotTurn(putBotHand(state,id,hand),id,'hard',()=>0.99);
  assert.ok(result.actions.includes('open-pairs'));
  assert.equal(result.state.players.find(player => player.id === id)?.pairMode,true);

  const nextTurn = startTurnClock({ ...result.state, status:'playing', turnPlayerId:id, phase:'discard', turnId:null }, Date.now()+1000, 'bot-pair-lay');
  const withNewPair = { ...nextTurn, players:nextTurn.players.map(player => player.id===id?{...player,opened:true,pairMode:true}:player), hands:{...nextTurn.hands,[id]:[tile(91030,'yellow',3),tile(91031,'yellow',3),tile(91032,'black',12)]} };
  const laid = playBotTurn(withNewPair,id,'medium',()=>0.99);
  assert.ok(laid.actions.includes('lay-new-pairs'));
  assert.equal(laid.state.melds.at(-1)?.kind,'pairs');
});

test('normal bot aynı turda seri ve çift indirirken işlem kimliklerini çakıştırmaz',()=>{
  const state=botRoom(),id=state.players[0].id,pairOwner=state.players[1].id;
  const hand=[tile(91070,'red',1),tile(91071,'red',2),tile(91072,'red',3),tile(91073,'blue',7),tile(91074,'blue',7),tile(91075,'black',2),tile(91078,'yellow',11)];
  const existingPair=[tile(91076,'yellow',4),tile(91077,'yellow',4)];
  const prepared=putBotHand(state,id,hand,{
    joker:{color:'yellow',number:13},
    players:state.players.map(player=>player.id===id?{...player,opened:true}:player.id===pairOwner?{...player,opened:true,pairMode:true}:player),
    melds:[{id:'normal-bot-pair-open',ownerId:pairOwner,tileIds:existingPair.map(candidate=>candidate.id),tiles:existingPair,kind:'pairs',realOkeyAssignments:{}}],
  });
  const ready={...prepared,turnId:`turn-${'t'.repeat(200)}`};
  const result=playBotTurn(ready,id,'hard',()=>0.99);
  assert.ok(result.actions.includes('lay-new-series'));
  assert.ok(result.actions.includes('lay-new-pairs'));
  const operationIds=result.state.processedMeldActions.filter(action=>action.turnId===result.state.turnId&&action.playerId===id).map(action=>action.requestId);
  assert.equal(operationIds.length,2);
  assert.equal(new Set(operationIds).size,2,'the second operation must not reuse the first fingerprint key');
  assert.ok(operationIds.every(requestId=>requestId.length<=128));
});

test('bot seri açtığı turda kalan uygun çiftini de indirir, çiftini atmaz',()=>{
  const state=botRoom(baseSettings,20261291),id=state.players[0].id,partner=state.players[1].id;
  const run=[...Array.from({length:13},(_,index)=>tile(91040+index,'red',index+1)),tile(91053,'blue',10),tile(91054,'blue',11),tile(91055,'blue',12)];
  const pair=[tile(91056,'black',7),tile(91057,'black',7)];
  const leftovers=[tile(91058,'yellow',13),tile(91059,'black',3)];
  const tablePair=[tile(91060,'yellow',2),tile(91061,'yellow',2)];
  const ready=putBotHand(state,id,[...run,...pair,...leftovers],{
    players:state.players.map(player=>player.id===partner?{...player,opened:true,pairMode:true}:player),
    melds:[{id:'already-open-pair',ownerId:partner,tileIds:tablePair.map(candidate=>candidate.id),tiles:tablePair,kind:'pairs',realOkeyAssignments:{}}],
  });
  const result=playBotTurn(ready,id,'hard',()=>.99);
  assert.ok(result.actions.includes('open-series'));
  assert.ok(result.actions.includes('lay-new-pairs'),'a pair opener is already on the table, so the bot may lay its pair after opening');
  assert.ok(result.state.melds.some(meld=>meld.ownerId===id&&meld.kind==='pairs'&&meld.tileIds.includes(pair[0].id)&&meld.tileIds.includes(pair[1].id)));
  assert.ok(!result.state.hands[id].some(candidate=>pair.some(member=>member.id===candidate.id)));
  const operationIds=result.state.processedMeldActions.filter(action=>action.turnId===result.state.turnId&&action.playerId===id).map(action=>action.requestId);
  assert.ok(operationIds.length>=1,'the bot should record its new-meld operation');
  assert.equal(new Set(operationIds).size,operationIds.length,'normal bot operations in one turn must have distinct request IDs');
});

test('bot mevcut açık seriye taş işler ve gerçek okeyi kurala uygun geri alır', () => {
  const state = botRoom(), id = state.players[0].id, owner = state.players[1].id;
  const run = [tile(92001,'blue',4),tile(92002,'blue',5),tile(92003,'blue',6)];
  const hand = [tile(92004,'blue',7),tile(92005,'black',13)];
  const prepared = putBotHand(state,id,hand,{
    joker:{color:'yellow',number:8},
    players:state.players.map(player => player.id===id?{...player,opened:true}:player),
    melds:[{id:'bot-run',ownerId:owner,tileIds:run.map(candidate=>candidate.id),tiles:run,kind:'run',realOkeyAssignments:{}}],
  });
  const laid = playBotTurn(prepared,id,'hard',()=>0.99);
  assert.ok(laid.actions.includes('meld-lay'));
  assert.deepEqual(laid.state.melds[0].tiles.map(candidate=>candidate.number),[4,5,6,7]);

  const pairRoom = botRoom(), botId = pairRoom.players[0].id, pairOwner = pairRoom.players[1].id;
  const real = tile(92102,'yellow',8), natural = tile(92101,'red',6);
  const reclaimHand = [tile(92103,'red',6),tile(92104,'black',13)];
  const reclaimState = putBotHand(pairRoom,botId,reclaimHand,{
    joker:{color:'yellow',number:8}, players:pairRoom.players.map(player=>player.id===botId?{...player,opened:true}:player),
    melds:[{id:'bot-okey-pair',ownerId:pairOwner,tileIds:[natural.id,real.id],tiles:[natural,real],kind:'pairs',realOkeyAssignments:{[real.id]:{color:'red',number:6}}}],
  });
  assert.ok(reclaimState.melds.length && reclaimState.players.find(player=>player.id===botId)?.opened);
  const reclaimed = playBotTurn(reclaimState,botId,'hard',()=>0.99);
  assert.ok(reclaimed.actions.includes('reclaim-okey'));
  assert.ok(reclaimed.state.hands[botId].some(candidate=>candidate.id===real.id));
  assert.equal(reclaimed.state.players.find(player=>player.id===pairOwner)?.score,101);
});

test('oto mod, stratejik olarak elde tutacağı işlenebilir taşı da masaya işler',()=>{
  const state=botRoom(),id='auto-human-seat-0',owner=state.players[1].id;
  const run=[tile(92201,'red',1),tile(92202,'red',2),tile(92203,'red',3)];
  const autoPlayer={...state.players[0],id,opened:true,autoPlay:true};
  const prepared=putBotHand(state,id,[tile(92204,'red',4),tile(92205,'red',4),tile(92206,'red',5),tile(92207,'black',2)],{
    joker:{color:'yellow',number:13},
    players:state.players.map((player,index)=>index===0?autoPlayer:player),
    hands:{...state.hands,[id]:[]},
    melds:[{id:'auto-process-run',ownerId:owner,tileIds:run.map(candidate=>candidate.id),tiles:run,kind:'run',realOkeyAssignments:{}}],
  });
  const ready={...prepared,turnId:`turn-${'t'.repeat(200)}`};
  const result=playBotTurn(ready,id,'medium',()=>0.99);
  assert.ok(result.actions.includes('meld-lay'),'oto mod mevcut geçerli işleme hedefini stratejik eşik nedeniyle pas geçmemeli');
  assert.equal(result.actions.filter(action=>action==='meld-lay').length,2,'Oto Mod aynı turda ardışık geçerli işlem hedeflerini güvenle tamamlayabilmeli');
  assert.ok(result.state.melds[0].tiles.some(candidate=>candidate.id===92204));
  assert.ok(result.state.melds[0].tiles.some(candidate=>candidate.id===92206),'ilk işleme sonrası açılan yeni uç aynı turda yeniden değerlendirilir');
  assert.equal(result.state.hands[id].some(candidate=>candidate.id===92204),false);
  const operationIds=result.state.processedMeldActions.filter(action=>action.turnId===result.state.turnId&&action.playerId===id).map(action=>action.requestId);
  assert.equal(operationIds.length,2,'Oto Mod should record both processing actions');
  assert.equal(new Set(operationIds).size,operationIds.length,'Oto Mod operations in one turn must have distinct request IDs');
  assert.equal(new Set([...result.state.hands[id].map(candidate=>candidate.id),...result.state.melds.flatMap(meld=>meld.tileIds)]).size,result.state.hands[id].length+result.state.melds.reduce((sum,meld)=>sum+meld.tileIds.length,0),'işleme zinciri taş kimliklerini çoğaltmamalı');

  const pairState=botRoom(),pairId='auto-pair-human-seat-0',pairOwner=pairState.players[1].id;
  const pairRun=[tile(92211,'blue',4),tile(92212,'blue',5),tile(92213,'blue',6)];
  const pairReady=putBotHand(pairState,pairId,[tile(92214,'blue',3),tile(92215,'red',1),tile(92216,'black',2)],{
    joker:{color:'yellow',number:13},
    players:pairState.players.map((player,index)=>index===0?{...player,id:pairId,opened:true,pairMode:true,autoPlay:true}:player),
    hands:{...pairState.hands,[pairId]:[]},
    melds:[{id:'auto-pair-process-run',ownerId:pairOwner,tileIds:pairRun.map(candidate=>candidate.id),tiles:pairRun,kind:'run',realOkeyAssignments:{}}],
  });
  const pairResult=playBotTurn(pairReady,pairId,'medium',()=>0.99);
  assert.ok(pairResult.actions.includes('meld-lay'),'çift açıp oto modda olan oyuncu da masadaki seriyle işleme yapabilmeli');
  assert.ok(pairResult.state.melds[0].tiles.some(candidate=>candidate.id===92214));
});

test('bot güvenli taş varsa işlek taşı veya gerçek okeyi atmaz; oto mod hatalı seçim yapmaz',()=>{
  const state=botRoom(),id=state.players[0].id,owner=state.players[1].id;
  const run=[tile(92301,'red',1),tile(92302,'red',2),tile(92303,'red',3)];
  const playable=tile(92304,'red',4),safe=tile(92305,'yellow',12),real=tile(92306,'black',13);
  const ready=putBotHand(state,id,[playable,safe,real],{
    joker:{color:'black',number:13},players:state.players.map(player=>player.id===id?{...player,opened:true,autoPlay:true}:player),
    melds:[{id:'safe-discard-run',ownerId:owner,tileIds:run.map(candidate=>candidate.id),tiles:run,kind:'run',realOkeyAssignments:{}}],
  });
  const observation=createBotObservation(ready,id)!;
  assert.equal(isPenaltyDiscardTile(ready,playable),true);
  assert.equal(isPenaltyDiscardTile(ready,real),true);
  assert.deepEqual(new Set(observation.penaltyDiscardTileIds),new Set([playable.id,real.id]));
  for(let seed=0;seed<100;seed++)assert.equal(chooseBotDiscard(observation,'medium',seededRandom(seed))?.id,safe.id,'Oto Mod işlek taş ve okeyden kaçınmalı');
  const ordinary={...observation,autoMode:false};
  for(let seed=0;seed<100;seed++)assert.notEqual(chooseBotDiscard(ordinary,'medium',seededRandom(seed))?.id,playable.id,'normal botun hata varyasyonu da ceza doğuran taşı seçmemeli');
  for(let seed=0;seed<100;seed++)assert.equal(chooseBotDiscard(ordinary,'medium',seededRandom(seed),{safeMode:true})?.id,safe.id,'hata kurtarma modu güvenli taş filtresini korumalı');
});

test('açılış araması 22 taşlık elde geçerli alternatif grupları zamanında değerlendirir',()=>{
  const state=botRoom(),id=state.players[0].id;
  const hand=Array.from({length:11},(_,index)=>[tile(92320+index*2,'red',index+1),tile(92321+index*2,'red',index+1)]).flat();
  const ready=putBotHand(state,id,hand,{joker:{color:'yellow',number:13}});
  const observation=createBotObservation(ready,id)!;
  const started=performance.now();
  const opportunity=hasBotOpeningOpportunity(observation);
  const elapsed=performance.now()-started;
  assert.equal(opportunity,true,'alternatif seri kombinasyonları barajı ve en az bir atılabilir taşı birlikte karşılamalı');
  assert.ok(elapsed<2500,`22 taşlık açılış araması ${elapsed.toFixed(1)} ms sürdü`);
  const opened=playBotTurn(ready,id,'hard',()=>0.99);
  assert.ok(opened.actions.includes('open-series'));
  assert.ok(opened.actions.includes('discard'),'açılıştan sonra son kalan taş normal hamleyle atılmalı');
});

test('oto mod bot gecikmesi sunucu deadline üretmeden kalan süreye sığdırılır',()=>{
  const state=botRoom(),id=state.players[0].id,observation=createBotObservation(state,id)!;
  assert.equal(botThinkDelayBeforeDeadline(observation,'hard',60_000,59_900,()=>0.99),0,'150 ms güvenlik payı kalmadıysa bot hemen çalışmalı');
  assert.equal(botThinkDelayBeforeDeadline(observation,'hard',61_000,59_000,()=>0.99),1_850,'düşünme süresi deadline öncesi güvenlik payıyla kısaltılmalı');
  assert.equal(botThinkDelayBeforeDeadline(observation,'hard',80_000,59_000,()=>0),3_000,'yeterli süre varsa normal 3 saniye alt sınırı korunmalı');
});

test('yeni maçta oto mod bayrağı kapalı başlar ve oyuncu kimliği/koltuğu korunur',()=>{
  const previous=botRoom({...baseSettings,rounds:1});
  const ended={...previous,status:'match-end' as const,players:previous.players.map((player,index)=>({...player,autoPlay:index===0,score:index*10,mentalCoins:1000+index}))};
  const next=startNewMatch(ended,{...baseSettings,rounds:3});
  assert.equal(next.status,'playing');
  for(let index=0;index<4;index++){
    assert.equal(next.players[index].id,ended.players[index].id);
    assert.equal(next.players[index].seat,ended.players[index].seat);
    assert.equal(next.players[index].autoPlay,false);
    assert.equal(next.players[index].score,0);
    assert.equal(next.players[index].mentalCoins,ended.players[index].mentalCoins);
  }
});

test('bot sahte okeyi joker yapmaz ve açılmamış eli tamamlanmadan rastgele eksik açılış yapmaz', () => {
  const state = botRoom(), id = state.players[0].id;
  const fake = tile(93001,null as never,null as never,true);
  const hand = [fake,tile(93002,'blue',7),tile(93003,'blue',8),tile(93004,'blue',10),tile(93005,'black',1)];
  const ready = putBotHand(state,id,hand,{joker:{color:'blue',number:9}});
  const result = playBotTurn(ready,id,'medium',()=>0.99);
  assert.equal(result.state.players.find(player=>player.id===id)?.opened,false);
  assert.ok(!result.actions.includes('open-series'));
  assert.ok(result.discardedTile);
});

test('bot rakiplerin açık grupları ve yakın geçmişini atış kararında dikkate alır', () => {
  const state = botRoom(), id = state.players[0].id, enemy = state.players[1].id;
  const run = [tile(94001,'red',4),tile(94002,'red',5),tile(94003,'red',6),tile(94004,'red',7)];
  const hand = [tile(94005,'red',8),tile(94006,'yellow',13)];
  const prepared = putBotHand(state,id,hand,{
    players:state.players.map(player=>player.id===enemy?{...player,opened:true}:player),
    melds:[{id:'enemy-run',ownerId:enemy,tileIds:run.map(candidate=>candidate.id),tiles:run,kind:'run',realOkeyAssignments:{}}],
  });
  const observation = createBotObservation(prepared,id)!;
  assert.equal('hands' in observation,false);
  assert.equal('stock' in observation,false);
  assert.equal(chooseBotDiscard(observation,'hard',()=>0.99)!.id,hand[1].id);
  assert.equal(observation.players.some(player=>Object.hasOwn(player as object,'hand')),false);
  const hiddenChanged={...prepared,hands:{...prepared.hands,[enemy]:prepared.hands[enemy].map(candidate=>({...candidate,number:candidate.number===13?1:13}))},stock:prepared.stock.map(candidate=>({...candidate,number:candidate.number===13?1:13}))};
  assert.deepEqual(createBotObservation(hiddenChanged,id),observation,'rakip elindeki veya stoktaki yüzler bot gözlemine girmemeli');
});

test('bot geçersiz sıra/hamle çağrısını reddeder',()=>{
  const state=botRoom();
  assert.throws(()=>playBotTurn(state,state.players[0].id.replace('bot-room','human'),'hard'),/Bot sırası etkin değil|Bot kimliği doğrulanmadı/);
});

test('bağlantısı kesilen insan oyuncu botça kontrol edilebilir; çevrimiçi insan botça oynatılamaz',()=>{
  const initial=botRoom(),originalId=initial.players[0].id,humanId='offline-human-seat-0';
  const base=putBotHand(initial,originalId,[tile(999991,'red',1),tile(999992,'blue',13)]);
  const hand=base.hands[originalId],throws=base.throwsByPlayer[originalId]||[];
  const offline:GameState={
    ...base,
    players:base.players.map(player=>player.id===originalId?{...player,id:humanId,online:false}:player),
    hands:{...base.hands,[humanId]:hand},
    throwsByPlayer:{...base.throwsByPlayer,[humanId]:throws},
    turnPlayerId:humanId,
    turnId:'offline-human-turn',
  };
  delete offline.hands[originalId];delete offline.throwsByPlayer[originalId];
  const result=playBotTurn(offline,humanId,'medium',seededRandom(449));
  assert.ok(result.actions.includes('discard'));
  assert.equal(result.state.turnPlayerId,'bot-room-1');
  assert.equal(result.state.hands[humanId].length,hand.length-1);
  assert.throws(()=>playBotTurn({...offline,players:offline.players.map(player=>player.id===humanId?{...player,online:true}:player)},humanId,'medium',seededRandom(449)),/Bot kimliği doğrulanmadı/);
});

test('oyuncu aldığı atığı kullanamıyorsa bot geri bırakıp stoktan çeker; timeout cezası ortak game kuralındadır', () => {
  const state = botRoom(), id = state.players[0].id, previous = state.players[3].id;
  const taken = tile(95001,'red',13), throwerOther = tile(95002,'black',1);
  const prepared = startTurnClock({
    ...state, turnPlayerId:id, phase:'draw', turnId:null, discard:[taken], throwsByPlayer:{...state.throwsByPlayer,[previous]:[taken]},
    hands:{...state.hands,[id]:[throwerOther], [previous]:[tile(95003,'yellow',2)]},
  },Date.now(),'bot-return-discard');
  const result = playBotTurn(prepared,id,'hard',()=>0.99);
  assert.ok(result.actions.includes('draw-stock'));
  assert.equal(result.state.hands[id].some(candidate=>candidate.id===taken.id),false);
  assert.ok(result.state.throwsByPlayer[previous].some(candidate=>candidate.id===taken.id));

  const timeout = startTurnClock({ ...prepared, phase:'discard', hands:{...prepared.hands,[id]:[tile(95004,'yellow',8),tile(95005,'black',1)]}, joker:{color:'yellow',number:8} },1_000,'bot-timeout');
  const timed = autoPlayTimedOutTurn(timeout,'bot-timeout',46_000,()=>0)!;
  assert.equal(timed.players.find(player=>player.id===id)?.score,101);
});

function assertPhysicalDeck(state: GameState) {
  const physical = [...(state.indicator?[state.indicator]:[]),...state.stock,...Object.values(state.hands).flat(),...state.discard,...state.melds.flatMap(meld=>meld.tiles)];
  assert.equal(physical.length,106,'fiziksel taş sayısı korunmalı');
  assert.equal(new Set(physical.map(candidate=>candidate.id)).size,106,'her fiziksel taş tek bir alanda olmalı');
}

function simulateRound(settings: TableSettings, seed: number, autoSeat?:number) {
  const random = seededRandom(seed);
  const start = botRoom(settings,seed,autoSeat);
  let state = start;
  let ticks = 0;
  const stats = { turns:0, seriesOpen:0, pairOpen:0, newSeries:0, newPairs:0, process:0, reclaim:0, reclaimPenaltyEvents:0, stockDraw:0, discardTake:0, finishes:0, timeouts:0, penalties:0, penaltyReasons:{} as Record<string,number>,penaltyCases:[] as Record<string,unknown>[], workablePenalties:0, realOkeyPenalties:0, missedOpenings:0, openingTurnTotal:0, openingCount:0, estimatedThinkMs:0, invalidActions:0 };
  const byControl={normal:emptyBotControlStats(),auto:emptyBotControlStats()};
  const turnsByPlayer=new Map<string,number>();
  while (state.status === 'playing' && ticks++ < 500) {
    assertPhysicalDeck(state);
    const playerId = state.turnPlayerId!;
    const bot = state.players.find(player=>player.id===playerId)!;
    const control=byControl[bot.autoPlay?'auto':'normal'];
    control.turns++;
    const difficulty: BotDifficulty=bot.seat%2===0?'hard':'medium';
    turnsByPlayer.set(playerId,(turnsByPlayer.get(playerId)||0)+1);
    const observation=createBotObservation(state,playerId)!;
    const openingWasPossible=!bot.opened&&hasBotOpeningOpportunity(observation);
    const priorPenalties=state.penaltyHistory?.length||0;
    stats.estimatedThinkMs+=botThinkDelay(observation,difficulty,seededRandom(seed+ticks));
    let result;
    try{result=playBotTurn(state,playerId,difficulty,random);}catch(error){stats.invalidActions++;throw error;}
    stats.turns++;
    const openedThisTurn=result.actions.some(action=>action==='open-series'||action==='open-pairs');
    if(openingWasPossible&&!openedThisTurn){stats.missedOpenings++;control.missedOpenings++;}
    if(openedThisTurn){const openingTurn=turnsByPlayer.get(playerId)||0;stats.openingTurnTotal+=openingTurn;stats.openingCount++;control.openingTurnTotal+=openingTurn;control.openingCount++;}
    for(const penalty of (result.state.penaltyHistory||[]).slice(priorPenalties)){
      // Count the penalty event even when its recipient is another player
      // (real-okey-reclaim charges the meld owner for the current bot's action).
      stats.penalties++;stats.penaltyReasons[penalty.reason]=(stats.penaltyReasons[penalty.reason]||0)+1;control.penalties++;control.penaltyReasons[penalty.reason]=(control.penaltyReasons[penalty.reason]||0)+1;
      if(penalty.reason==='workable-discard')stats.workablePenalties++;
      if(penalty.reason==='real-okey-discard')stats.realOkeyPenalties++;
      if(penalty.reason==='timeout'){stats.timeouts++;control.timeouts++;}
      if((penalty.reason==='workable-discard'||penalty.reason==='real-okey-discard')&&result.discardedTile){
        control.discardPenaltyEvents++;
        const safeAlternatives=safeDiscardAlternativesAtTurnResult(result.state,playerId,result.discardedTile);
        if(safeAlternatives.length>0)control.discardPenaltyWithSafeAlternative++;else control.discardPenaltyWithoutSafeAlternative++;
        stats.penaltyCases.push({seed,mode:settings.mode,folding:settings.folding,round:result.state.round,turn:stats.turns,seat:bot.seat,control:bot.autoPlay?'auto':'normal',causedBy:playerId,penalizedPlayerId:penalty.playerId,reason:penalty.reason,discarded:`${result.discardedTile.color}${result.discardedTile.number}${result.discardedTile.fakeJoker?' fake':''}`,safeAlternativeApplicable:true,safeAlternativeCount:safeAlternatives.length,safeAlternatives:safeAlternatives.map(candidate=>`${candidate.color}${candidate.number}${candidate.fakeJoker?' fake':''}`)});
      }else if(penalty.reason==='real-okey-reclaim')stats.penaltyCases.push({
        seed,mode:settings.mode,folding:settings.folding,round:result.state.round,turn:stats.turns,seat:bot.seat,
        control:bot.autoPlay?'auto':'normal',causedBy:playerId,penalizedPlayerId:penalty.playerId,reason:penalty.reason,discarded:null,safeAlternativeApplicable:false,safeAlternativeCount:null,
      });
    }
    for(const action of result.actions){
      if(action==='open-series'){stats.seriesOpen++;control.seriesOpen++;}
      if(action==='open-pairs'){stats.pairOpen++;control.pairOpen++;}
      if(action==='lay-new-series'){stats.newSeries++;control.processed++;}
      if(action==='lay-new-pairs'){stats.newPairs++;control.processed++;}
      if(action==='meld-lay'){stats.process++;control.processed++;}
      if(action==='reclaim-okey')stats.reclaim++;
      if(action==='reclaim-okey')stats.reclaimPenaltyEvents++;
      if(action==='draw-stock')stats.stockDraw++;
      if(action==='take-discard')stats.discardTake++;
    }
    if(result.state.status==='round-end'||result.state.status==='match-end'){
      if(result.state.message.includes('eli bitirdi')){stats.finishes++;control.finishes++;}
      state=result.state;
      break;
    }
    state=startTurnClock(result.state,Date.now()+stats.turns*1000,`sim-${seed}-${stats.turns}`);
  }
  assert.ok(ticks < 500,'dört bot en fazla 500 hamlede eli tamamlamalı');
  assert.equal(state.status,'round-end');
  assertPhysicalDeck(state);
  return {...stats,byControl};
}

test('dört bot normal, katlamalı, eşli ve katlamalı eşli masalarda otomatik maç simülasyonlarını tamamlar', { timeout: 45000 }, () => {
  const results: { mode:string; folding:boolean; games:number; turns:number; seriesOpen:number; pairOpen:number; processed:number; reclaimed:number; reclaimPenaltyEvents:number; stockDraws:number; discardTakes:number; finishes:number; invalidActions:number; timeouts:number; penaltiesPer100Turns:number; penaltyReasons:Record<string,number>;penaltyCases:Record<string,unknown>[]; workablePenalties:number; realOkeyPenalties:number; missedOpenings:number; averageOpeningTurn:number|null; estimatedThinkSeconds:number;byControl:{normal:ReturnType<typeof emptyBotControlStats>;auto:ReturnType<typeof emptyBotControlStats>} }[] = [];
  for(const [index,mode] of (['solo','pairs'] as const).entries()) for(const folding of [false,true]) {
    const settings={...baseSettings,mode,folding};
    const aggregate={mode,folding,games:5,turns:0,seriesOpen:0,pairOpen:0,processed:0,reclaimed:0,reclaimPenaltyEvents:0,stockDraws:0,discardTakes:0,finishes:0,invalidActions:0,timeouts:0,penalties:0,penaltyReasons:{} as Record<string,number>,penaltyCases:[] as Record<string,unknown>[],workablePenalties:0,realOkeyPenalties:0,missedOpenings:0,openingTurnTotal:0,openingCount:0,estimatedThinkSeconds:0,byControl:{normal:emptyBotControlStats(),auto:emptyBotControlStats()}};
    for(let game=0;game<aggregate.games;game++){
      const stats=simulateRound(settings,20261108+index*100+(folding?50:0)+game);
      aggregate.turns+=stats.turns;aggregate.seriesOpen+=stats.seriesOpen;aggregate.pairOpen+=stats.pairOpen;
      aggregate.processed+=stats.newSeries+stats.newPairs+stats.process;aggregate.reclaimed+=stats.reclaim;
      aggregate.reclaimPenaltyEvents+=stats.reclaimPenaltyEvents;aggregate.stockDraws+=stats.stockDraw;aggregate.discardTakes+=stats.discardTake;
      aggregate.penalties+=stats.penalties;aggregate.penaltyCases.push(...stats.penaltyCases);for(const [reason,count] of Object.entries(stats.penaltyReasons))aggregate.penaltyReasons[reason]=(aggregate.penaltyReasons[reason]||0)+count;aggregate.workablePenalties+=stats.workablePenalties;aggregate.realOkeyPenalties+=stats.realOkeyPenalties;aggregate.missedOpenings+=stats.missedOpenings;aggregate.openingTurnTotal+=stats.openingTurnTotal;aggregate.openingCount+=stats.openingCount;
      for(const kind of ['normal','auto'] as const){const from=stats.byControl[kind],to=aggregate.byControl[kind];to.turns+=from.turns;to.penalties+=from.penalties;to.discardPenaltyEvents+=from.discardPenaltyEvents;to.discardPenaltyWithSafeAlternative+=from.discardPenaltyWithSafeAlternative;to.discardPenaltyWithoutSafeAlternative+=from.discardPenaltyWithoutSafeAlternative;to.missedOpenings+=from.missedOpenings;to.seriesOpen+=from.seriesOpen;to.pairOpen+=from.pairOpen;to.processed+=from.processed;to.finishes+=from.finishes;to.timeouts+=from.timeouts;to.openingTurnTotal+=from.openingTurnTotal;to.openingCount+=from.openingCount;for(const [reason,count] of Object.entries(from.penaltyReasons))to.penaltyReasons[reason]=(to.penaltyReasons[reason]||0)+count;}
      aggregate.finishes+=stats.finishes;aggregate.invalidActions+=stats.invalidActions;aggregate.timeouts+=stats.timeouts;aggregate.estimatedThinkSeconds+=stats.estimatedThinkMs/1000;
    }
    results.push({...aggregate,penaltiesPer100Turns:aggregate.turns?aggregate.penalties/aggregate.turns*100:0,averageOpeningTurn:aggregate.openingCount?aggregate.openingTurnTotal/aggregate.openingCount:null});
  }
  assert.equal(results.length,4);
  for(const result of results){
    assert.ok(result.games===5&&result.turns>0);
    assert.ok(result.seriesOpen+result.pairOpen>0,'simülasyon açılış üretmeli');
  }
  console.log('[bot-simulation]',JSON.stringify(results));
});

test('normal bot ve Oto Mod ceza olaylarında güvenli atış alternatifi ölçümü aynı 20 sabit dağıtımda ayrı raporlanır',{timeout:45_000},()=>{
  const total={normal:{...emptyBotControlStats(),penaltyCases:[] as Record<string,unknown>[]},auto:{...emptyBotControlStats(),penaltyCases:[] as Record<string,unknown>[]}};
  for(const [index,mode] of (['solo','pairs'] as const).entries())for(const folding of [false,true])for(let game=0;game<5;game++){
    const settings={...baseSettings,mode,folding};
    const round=simulateRound(settings,20261201+index*100+(folding?50:0)+game,0);
    for(const kind of ['normal','auto'] as const){
      const from=round.byControl[kind],to=total[kind];
      to.turns+=from.turns;to.penalties+=from.penalties;to.discardPenaltyEvents+=from.discardPenaltyEvents;to.discardPenaltyWithSafeAlternative+=from.discardPenaltyWithSafeAlternative;to.discardPenaltyWithoutSafeAlternative+=from.discardPenaltyWithoutSafeAlternative;to.missedOpenings+=from.missedOpenings;to.seriesOpen+=from.seriesOpen;to.pairOpen+=from.pairOpen;to.processed+=from.processed;to.finishes+=from.finishes;to.timeouts+=from.timeouts;to.openingTurnTotal+=from.openingTurnTotal;to.openingCount+=from.openingCount;for(const [reason,count] of Object.entries(from.penaltyReasons))to.penaltyReasons[reason]=(to.penaltyReasons[reason]||0)+count;
      total[kind].penaltyCases.push(...round.penaltyCases.filter(event=>event.control===kind));
    }
  }
  for(const kind of ['normal','auto'] as const){
    const result=total[kind];
    assert.equal(result.discardPenaltyWithSafeAlternative,0,`${kind}: güvenli alternatif varken ceza doğuran atış seçilmemeli`);
    assert.equal(result.missedOpenings,0,`${kind}: mevcut ölçüm kümesinde açılabilir el kaçırılmamalı`);
  }
  const allPenaltyCases=[...total.normal.penaltyCases,...total.auto.penaltyCases];
  const receivedByControl={auto:allPenaltyCases.filter(event=>event.penalizedPlayerId==='bot-room-0').length,normal:allPenaltyCases.filter(event=>event.penalizedPlayerId!=='bot-room-0').length};
  console.log('[bot-control-simulation]',JSON.stringify({causedBy:Object.fromEntries(Object.entries(total).map(([kind,value])=>[kind,{...value,penaltiesPer100Turns:value.turns?value.penalties/value.turns*100:0,averageOpeningTurn:value.openingCount?value.openingTurnTotal/value.openingCount:null}])),receivedByControl,totalPenaltyEvents:allPenaltyCases.length}));
});

test('dört bot üç ellik tam maçı skor ve rozet kayıtlarıyla tamamlar', { timeout: 30000 }, () => {
  const settings={...baseSettings,rounds:3 as const};
  for(let game=0;game<3;game++){
    let state=botRoom(settings), totalTurns=0;
    for(let round=1;round<=settings.rounds;round++){
      let ticks=0;
      while(state.status==='playing'&&ticks++<500){
        const player=state.players.find(candidate=>candidate.id===state.turnPlayerId)!;
        const result=playBotTurn(state,player.id,player.seat%2===0?'hard':'medium',seededRandom(game*100_000+round*1000+ticks));
        totalTurns++;
        if(result.state.status!=='playing'){
          const completed={...result.state,status:round===settings.rounds?'match-end' as const:'round-end' as const};
          state=recordRoundBadges(completed);
          break;
        }
        state=startTurnClock(result.state,Date.now()+totalTurns*1000,`match-${game}-${round}-${ticks}`);
      }
      assert.ok(ticks<500,'her el sınırlı sayıda turda bitmeli');
      if(round<settings.rounds){
        state=startTurnClock(startRound({...state,round:round+1,players:state.players.map(player=>({...player,opened:false,pairMode:false}))}),Date.now()+totalTurns*1000,`match-next-${game}-${round}`);
      }
    }
    assert.equal(state.status,'match-end');
    assert.equal(state.roundScores.length,settings.rounds*4);
    assert.equal(state.matchBadges.length,settings.rounds*4);
    for(const player of state.players)assert.equal(state.matchBadges.filter(badge=>badge.playerId===player.id).length,settings.rounds);
    assert.ok(totalTurns>3);
  }
});

test('zorluk seviyelerinin hata oranı yüzde 10 altında, düşünme süreleri kontrollü ve değişken',()=>{
  const state=botRoom(), id=state.players[0].id;
  const ready=putBotHand(state,id,[tile(96001,'red',1),tile(96002,'yellow',7),tile(96003,'blue',13)]);
  const observation=createBotObservation(ready,id)!;
  const hardSafe = chooseBotDiscard(observation,'hard',()=>0.99);
  const expected=chooseBotDiscard(observation,'medium',()=>0.99)!.id;
  const hardExpected=chooseBotDiscard(observation,'hard',()=>0.99)!.id;
  const mediumRandom=seededRandom(77),hardRandom=seededRandom(88);
  let mediumMistakes=0,hardMistakes=0;
  for(let i=0;i<1_000;i++){
    if(chooseBotDiscard(observation,'medium',mediumRandom)!.id!==expected)mediumMistakes++;
    if(chooseBotDiscard(observation,'hard',hardRandom)!.id!==hardExpected)hardMistakes++;
  }
  assert.ok(mediumMistakes>0&&mediumMistakes<=100,`medium hata oranı ${mediumMistakes}/1000 olmalı ve %10'u aşmamalı`);
  assert.ok(hardMistakes>0&&hardMistakes<=100,`hard hata oranı ${hardMistakes}/1000 olmalı ve %10'u aşmamalı`);
  assert.ok(hardSafe);
  assert.ok(Array.from({length:100},(_,i)=>botThinkDelay(observation,'hard',()=>i/100)).every(ms=>ms>=3000&&ms<=10000));
  assert.ok(Array.from({length:100},(_,i)=>botThinkDelay(observation,'medium',()=>i/100)).every(ms=>ms>=3000&&ms<=10000));
});
