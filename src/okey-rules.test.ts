import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDeck,
  ELDEN_REVEAL_DURATION_MS,
  MATCH_SUMMARY_DURATION_MS,
  ROUND_SUMMARY_DURATION_MS,
  addToMeld,
  availableMeldProcessingTargets,
  calculateTeamScoreboard,
  collectOpeningMeld,
  layNewPairMelds,
  layNewSeriesMelds,
  startNewMatch,
  validateTableSettings,
  discardTile,
  finishFromHand,
  autoPlayTimedOutTurn,
  drawStock,
  effectiveTile,
  findRackMeldGroups,
  findRackPairGroups,
  freshRoom,
  isValidPair,
  isRealOkey,
  jokerFromIndicator,
  openMelds,
  openSeriesMelds,
  pairOpeningThreshold,
  reclaimRealOkey,
  publicGame,
  recordInvalidOpenAttempt,
  recordSuccessfulOpeningAttempt,
  rankPlayersByTotal,
  returnTakenDiscard,
  recordRoundBadges,
  recordRoundScores,
  resetMatchBadgeHistory,
  roundSummaryDurationMs,
  startRound,
  startTurnClock,
  serialMeldPointValue,
  serialOpeningThreshold,
  settleRound,
  suggestFivePairs,
  takeDiscard,
  takeIndicator,
  turnClockExpired,
  updateRealOkeyRecognition,
  undoOpenMelds,
  type Tile,
  type TileColor,
  type GameState,
  type Meld,
} from '../shared/game';
import { visibleMatchBadgeRows } from './player-badge-layout';
import { findRackAutoSortGroups } from '../shared/rack-layout';

const tile=(id:number,color:TileColor,number:number):Tile=>({id,color,number,fakeJoker:false});

const playingRoom=()=>{
  const state=freshRoom({rounds:1,mode:'solo',folding:false,assisted:true,tableColor:'wood',turnDurationSeconds:45});
  state.players=[0,1,2,3].map(seat=>({id:`p${seat}`,name:`Oyuncu ${seat}`,avatar:'O',online:true,seat,score:0,opened:false,pairMode:false}));
  return startRound(state,()=>0);
};

test('soldaki son atık taşı alma, buton ve sürükleme için aynı sunucu hamlesini kullanıp fiziksel taşları korur',()=>{
  const state=playingRoom();state.joker={color:'black',number:13};
  const takenIndex=state.hands.p3.findIndex(candidate=>candidate.color!=='black'||candidate.number!==13||candidate.fakeJoker);
  const [taken]=state.hands.p3.splice(takenIndex,1);
  state.phase='draw';state.turnId='drag-take-turn';state.discard=[taken];state.throwsByPlayer.p3=[taken];
  const collect=(value:GameState)=>[...(value.indicator?[value.indicator]:[]),...value.stock,...Object.values(value.hands).flat(),...value.discard,...value.melds.flatMap(meld=>meld.tiles)];
  const before=collect(state),next=takeDiscard(state,'p0'),after=collect(next);
  assert.equal(before.length,106);
  assert.equal(new Set(before.map(candidate=>candidate.id)).size,106);
  assert.equal(after.length,106);
  assert.equal(new Set(after.map(candidate=>candidate.id)).size,106);
  assert.equal(next.hands.p0.at(-1)?.id,taken.id);
  assert.equal(next.hands.p3.some(candidate=>candidate.id===taken.id),false);
  assert.equal(next.throwsByPlayer.p3.length,0);
  assert.equal(next.discard.length,0);
  assert.equal(next.phase,'discard');
});

const serialHand=(total:100|101|102,baseId:number)=>{
  const specs:Tile[][]=total===100?[
    [tile(baseId,'red',10),tile(baseId+1,'red',11),tile(baseId+2,'red',12)],
    [tile(baseId+3,'blue',10),tile(baseId+4,'blue',11),tile(baseId+5,'blue',12)],
    [tile(baseId+6,'yellow',7),tile(baseId+7,'yellow',8),tile(baseId+8,'yellow',9),tile(baseId+9,'yellow',10)],
  ]:total===101?[
    [tile(baseId,'red',10),tile(baseId+1,'red',11),tile(baseId+2,'red',12)],
    [tile(baseId+3,'blue',7),tile(baseId+4,'blue',8),tile(baseId+5,'blue',9),tile(baseId+6,'blue',10)],
    [tile(baseId+7,'yellow',7),tile(baseId+8,'yellow',8),tile(baseId+9,'yellow',9),tile(baseId+10,'yellow',10)],
  ]:[
    [tile(baseId,'red',7),tile(baseId+1,'red',8),tile(baseId+2,'red',9),tile(baseId+3,'red',10)],
    [tile(baseId+4,'blue',7),tile(baseId+5,'blue',8),tile(baseId+6,'blue',9),tile(baseId+7,'blue',10)],
    [tile(baseId+8,'yellow',7),tile(baseId+9,'yellow',8),tile(baseId+10,'yellow',9),tile(baseId+11,'yellow',10)],
  ];
  return {groups:specs,hand:[...specs.flat(),tile(baseId+40,'black',1),tile(baseId+41,'black',2)]};
};

const useSerialHand=(state:ReturnType<typeof playingRoom>,playerId:string,total:100|101|102,baseId:number)=>{
  const selection=serialHand(total,baseId);
  state.hands[playerId]=selection.hand;
  return selection;
};

const usePairHand=(state:ReturnType<typeof playingRoom>,playerId:string,count:number,baseId:number)=>{
  const colors:TileColor[]=['red','blue','black','yellow'];
  const pairs=Array.from({length:count},(_,index)=>[tile(baseId+index*2,colors[index%colors.length],index+1),tile(baseId+index*2+1,colors[index%colors.length],index+1)]);
  state.hands[playerId]=[...pairs.flat(),tile(baseId+count*2,'black',13)];
  return pairs;
};

const openedRunState=(hand:Tile[]=[],turnId='process-turn')=>{
  const state=playingRoom();
  state.joker={color:'yellow',number:8};
  state.players=state.players.map(player=>player.id==='p0'?{...player,opened:true}:player);
  const run=[tile(94001,'red',4),tile(94002,'red',5),tile(94003,'red',6),tile(94004,'red',7)];
  state.melds=[{id:'run-p1',ownerId:'p1',tileIds:run.map(member=>member.id),tiles:run,kind:'run',realOkeyAssignments:{}}];
  state.hands.p0=hand;
  return startTurnClock(state,1_000,turnId);
};
const openedPairState=(hand:Tile[]=[],turnId='pair-process-turn')=>{
  const state=playingRoom();
  state.joker={color:'yellow',number:8};
  state.players=state.players.map(player=>player.id==='p0'?{...player,opened:true}:player);
  const pair=[tile(94101,'red',6),tile(94102,'yellow',8)];
  state.melds=[{id:'pair-p1',ownerId:'p1',tileIds:pair.map(member=>member.id),tiles:pair,kind:'pairs',realOkeyAssignments:{94102:{color:'red',number:6}}}];
  state.hands.p0=hand;
  return startTurnClock(state,1_000,turnId);
};
const withTakenDiscard=(state:GameState,discardTile:Tile,turnId='taken-turn')=>{
  const timed=startTurnClock({...state,phase:'draw',discard:[discardTile],throwsByPlayer:{...state.throwsByPlayer,p3:[discardTile]}},1_000,turnId);
  return takeDiscard(timed,'p0');
};
const assertCourtesyRejectsWithoutMutation=(state:GameState,discarded:Tile,turnId:string)=>{
  const timed=startTurnClock({...state,phase:'draw',discard:[discarded],throwsByPlayer:{...state.throwsByPlayer,p3:[discarded]}},1_000,turnId);
  const handIds=timed.hands.p0.map(candidate=>candidate.id),meldIds=timed.melds.map(meld=>[meld.id,[...meld.tileIds]]),scores=timed.players.map(player=>[player.id,player.score]);
  const stockCount=timed.stock.length;
  assert.equal(handIds.includes(discarded.id),false,'soldaki atık taş alan oyuncunun elinde olmamalı');
  assert.throws(()=>takeDiscard(timed,'p0'),/Centilmenlik gereği atılan taşı alamazsın/);
  assert.deepEqual(timed.hands.p0.map(candidate=>candidate.id),handIds,'reddedilen alma oyuncunun elini değiştirmemeli');
  assert.deepEqual(timed.melds.map(meld=>[meld.id,[...meld.tileIds]]),meldIds,'reddedilen alma açık perleri değiştirmemeli');
  assert.deepEqual(timed.players.map(player=>[player.id,player.score]),scores,'reddedilen alma puanları değiştirmemeli');
  assert.equal(timed.stock.length,stockCount,'reddedilen alma stoktan taş eksiltmemeli');
  assert.equal(timed.discard.at(-1)?.id,discarded.id,'reddedilen taş atık alanında kalmalı');
  assert.equal(timed.throwsByPlayer.p3.at(-1)?.id,discarded.id,'taş atan oyuncunun atık kaydı korunmalı');
  assert.equal(timed.phase,'draw');
  assert.equal(timed.turnPlayerId,'p0');
  assert.equal(timed.turnId,turnId);
  assert.equal(timed.takenDiscardUse,null);
  assert.equal(timed.discardTakeUndo??null,null);
  return timed;
};

test('seri açılışında 100 puan reddedilir, 101 puan kabul edilir ve tur saati korunur',()=>{
  const rejected=playingRoom(),below=useSerialHand(rejected,'p0',100,10000);
  assert.throws(()=>openSeriesMelds(rejected,'p0',below.groups.map(group=>group.map(candidate=>candidate.id))),/Gerekli puan: 101 — Mevcut puan: 100\. Ceza uygulanmadı/);
  assert.equal(rejected.players.find(player=>player.id==='p0')?.score,0,'başarısız açılış ceza vermemeli');

  const timed=startTurnClock(playingRoom(),10_000,'open-stable-turn'),valid=useSerialHand(timed,'p0',101,10100);
  const next=openSeriesMelds(timed,'p0',valid.groups.map(group=>group.map(candidate=>candidate.id)));
  assert.equal(next.serialOpeningHistory[0].points,101);
  assert.equal(next.players.find(player=>player.id==='p0')?.opened,true);
  assert.equal(next.phase,'discard');
  assert.equal(next.turnPlayerId,'p0');
  assert.equal(next.turnId,'open-stable-turn');
  assert.equal(next.turnDeadlineAt,timed.turnDeadlineAt);
  assert.equal(next.hands.p0.length,2);
});

test('gerçek okey seri puanında temsil ettiği basamağı, sahte okey ise yalnız kendi yüzünü kullanır',()=>{
  const joker={color:'yellow' as const,number:8},realOkey=tile(10201,'yellow',8);
  assert.equal(serialMeldPointValue([tile(10202,'red',5),tile(10203,'red',6),realOkey],joker),18);
  const fakeOkey:Tile={id:10204,color:null,number:null,fakeJoker:true};
  assert.equal(serialMeldPointValue([tile(10205,'blue',4),fakeOkey,tile(10206,'blue',6)],joker),null);
  assert.equal(serialMeldPointValue([tile(10207,'yellow',7),fakeOkey,tile(10208,'yellow',9)],joker),24);
});

test('gerçek okeyin temsil ettiği sıra değeriyle tam 101 seri açılışı kabul edilir',()=>{
  const state=playingRoom(),joker={color:'black' as const,number:8};
  state.joker=joker;
  const groups:Tile[][]=[
    [tile(10210,'red',5),tile(10211,'red',6),tile(10212,'black',8)],
    [tile(10213,'blue',10),tile(10214,'blue',11),tile(10215,'blue',12)],
    [tile(10216,'yellow',8),tile(10217,'yellow',9),tile(10218,'yellow',10),tile(10219,'yellow',11),tile(10220,'yellow',12)],
  ];
  state.hands.p0=[...groups.flat(),tile(10221,'red',2)];
  const opened=openSeriesMelds(state,'p0',groups.map(group=>group.map(candidate=>candidate.id)));
  assert.equal(opened.serialOpeningHistory[0].points,101);
});

test('seri açılışında tekrar kullanılan taş kimliği reddedilir',()=>{
  const state=playingRoom(),serials=useSerialHand(state,'p0',101,10300),overlapping=[
    serials.groups[0],
    [serials.groups[0][0],tile(10320,'yellow',10),tile(10321,'black',10)],
  ];
  state.hands.p0=[...state.hands.p0,tile(10322,'black',3)];
  assert.throws(()=>openSeriesMelds(state,'p0',overlapping.map(group=>group.map(candidate=>candidate.id))),/birden fazla açılış grubunda/);
});

test('katlamalı solo seri eşiği her kabul edilmiş açılıştan sonra bir artar',()=>{
  const state=playingRoom();state.settings={...state.settings,folding:true};
  const first=useSerialHand(state,'p0',101,10400),opened=openSeriesMelds(state,'p0',first.groups.map(group=>group.map(candidate=>candidate.id)));
  assert.equal(serialOpeningThreshold({...opened,turnPlayerId:'p1'},'p1'),102);
  const nextRoom={...opened,turnPlayerId:'p1' as const,phase:'discard' as const,hands:{...opened.hands}};
  const below=useSerialHand(nextRoom,'p1',101,10500);
  assert.throws(()=>openSeriesMelds(nextRoom,'p1',below.groups.map(group=>group.map(candidate=>candidate.id))),/Gerekli puan: 102 — Mevcut puan: 101/);
  const accepted=useSerialHand(nextRoom,'p1',102,10600);
  const second=openSeriesMelds(nextRoom,'p1',accepted.groups.map(group=>group.map(candidate=>candidate.id)));
  assert.equal(second.serialOpeningHistory.at(-1)?.points,102);
});

test('katlamalı eşlide takım arkadaşı eşiği yükseltmez, rakip takımın açışı yükseltir',()=>{
  const state=playingRoom();state.settings={...state.settings,mode:'pairs',folding:true};
  const teamZeroFirst=useSerialHand(state,'p0',101,10700),first=openSeriesMelds(state,'p0',teamZeroFirst.groups.map(group=>group.map(candidate=>candidate.id)));
  const teammateState={...first,turnPlayerId:'p2' as const,phase:'discard' as const,hands:{...first.hands}};
  assert.equal(serialOpeningThreshold(teammateState,'p2'),101);
  const teammateHand=useSerialHand(teammateState,'p2',101,10800);
  const teammateOpened=openSeriesMelds(teammateState,'p2',teammateHand.groups.map(group=>group.map(candidate=>candidate.id)));
  const opponentState={...teammateOpened,turnPlayerId:'p1' as const,phase:'discard' as const,hands:{...teammateOpened.hands}};
  assert.equal(serialOpeningThreshold(opponentState,'p1'),102);
  const opponentBelow=useSerialHand(opponentState,'p1',101,10900);
  assert.throws(()=>openSeriesMelds(opponentState,'p1',opponentBelow.groups.map(group=>group.map(candidate=>candidate.id))),/Gerekli puan: 102 — Mevcut puan: 101/);
});

test('seri açan oyuncu sonraki turda 101 eşiği olmadan yeni seri per indirebilir',()=>{
  const state=playingRoom(),firstHand=useSerialHand(state,'p0',101,11000),first=openSeriesMelds(state,'p0',firstHand.groups.map(group=>group.map(candidate=>candidate.id)));
  const later=startTurnClock({...first,turnPlayerId:'p0',phase:'discard' as const,hands:{...first.hands}},10_000,'series-lay-turn');
  const hand=[tile(11101,'black',4),tile(11102,'black',5),tile(11103,'black',6),tile(11104,'yellow',1)];
  later.hands.p0=hand;
  const second=layNewSeriesMelds(later,'p0',[[11101,11102,11103]],later.turnId||undefined,'series-lay-request');
  assert.equal(second.serialOpeningHistory.length,1,'sonraki indirme katlamalı açılış geçmişini yükseltmemeli');
  assert.equal(second.melds.length,4);
  assert.deepEqual(second.hands.p0,[hand[3]]);
  assert.equal(second.players.find(player=>player.id==='p0')?.opened,true);
  assert.throws(()=>openSeriesMelds(later,'p0',[[11101,11102,11103]]),/zaten yaptınız/,'ilk açılış endpointi tekrar eşik atlatmamalı');
});

test('seri açılışı taş atma aşamasında kalır ve açılıştan sonra taş atılabilir',()=>{
  const state=playingRoom(),selection=useSerialHand(state,'p0',101,11200),opened=openSeriesMelds(state,'p0',selection.groups.map(group=>group.map(candidate=>candidate.id)));
  const remaining=opened.hands.p0[0],finishedTurn=discardTile(opened,'p0',remaining.id);
  assert.equal(finishedTurn.discard.at(-1)?.id,remaining.id);
  assert.equal(finishedTurn.turnPlayerId,'p1');
  assert.equal(finishedTurn.phase,'draw');
});

test('yerden alınan taş seri açılışında kullanılabilir ve ortadan ikinci taş çekilmez',()=>{
  const state=playingRoom(),selection=serialHand(101,11300),fromDiscard=selection.groups[0][0];
  state.phase='draw';
  state.hands.p0=selection.hand.filter(candidate=>candidate.id!==fromDiscard.id);
  state.discard=[fromDiscard];
  state.throwsByPlayer.p3=[fromDiscard];
  const stockCount=state.stock.length,afterTake=takeDiscard(state,'p0');
  const opened=openSeriesMelds(afterTake,'p0',selection.groups.map(group=>group.map(candidate=>candidate.id)));
  assert.equal(opened.stock.length,stockCount);
  assert.ok(opened.melds.some(meld=>meld.tileIds.includes(fromDiscard.id)));
  assert.equal(opened.phase,'discard');
  assert.equal(opened.discardTakeUndo,null,'açılış başka bir işlem olduğu için geri bırakma hakkı bitmeli');
  assert.throws(()=>returnTakenDiscard(opened,'p0'),/Geri bırakılabilecek/);
});

test('yerden alınan taş geri bırakılınca yalnız o taşın eli ve önceki oyuncunun atık alanı geri yüklenir',()=>{
  const state=playingRoom(),taken=tile(11350,'red',4),originalHand=[tile(11351,'blue',6),tile(11352,'yellow',9)];
  state.phase='draw';state.turnId='return-discard-turn';state.hands.p0=[...originalHand];state.discard=[taken];state.throwsByPlayer.p3=[taken];
  const afterTake=takeDiscard(state,'p0');
  assert.equal(publicGame(afterTake,'p0').canReturnTakenDiscard,true);
  assert.equal(publicGame(afterTake,'p1').canReturnTakenDiscard,false);
  const returned=returnTakenDiscard(afterTake,'p0');
  assert.deepEqual(returned.hands.p0,originalHand,'eldeki diğer taşlar sırası bozulmadan kalmalı');
  assert.equal(returned.discard.at(-1)?.id,taken.id);
  assert.equal(returned.throwsByPlayer.p3.at(-1)?.id,taken.id);
  assert.equal(returned.phase,'draw');
  assert.equal(returned.turnPlayerId,'p0');
  assert.equal(returned.turnId,afterTake.turnId);
  assert.equal(returned.stock.length,state.stock.length);
  assert.equal(publicGame(returned,'p0').canReturnTakenDiscard,false);
  assert.throws(()=>returnTakenDiscard(returned,'p0'),/aynı turda/);
  const takenAgain=takeDiscard(returned,'p0');
  assert.equal(takenAgain.hands.p0.at(-1)?.id,taken.id,'geri bırakılan taş sonraki denemede yeniden alınabilmeli');
  assert.equal(takenAgain.stock.length,state.stock.length);
});

test('yerden alınan taşı geri bırakma aynı turla sınırlıdır ve işlem sonrası iptal olur',()=>{
  const state=playingRoom(),taken=tile(11360,'black',5),other=tile(11361,'blue',2),spare=tile(11362,'yellow',3);
  state.phase='draw';state.turnId='return-discard-turn';state.hands.p0=[other,spare];state.discard=[taken];state.throwsByPlayer.p3=[taken];
  const afterTake=takeDiscard(state,'p0');
  assert.throws(()=>discardTile(afterTake,'p0',other.id),/Soldan aldığınız taşı aynı turda/,'alınan taş kullanılmadan tur tamamlanmamalı');

  const changedStock={...afterTake,stock:afterTake.stock.slice(1)};
  assert.throws(()=>returnTakenDiscard(changedStock,'p0'),/Taş çekildiği için/);
  assert.throws(()=>drawStock(afterTake,'p0'),/Şu anda taş çekemezsiniz/,'yerden taş aldıktan sonra aynı turda stoktan ek taş çekilememeli');
});

test('seri açılışını geri almak 101 cezayı bir kez ekler ve açılış geçmişini geri yükler',()=>{
  const state=playingRoom(),selection=useSerialHand(state,'p0',101,11400),opened=openSeriesMelds(state,'p0',selection.groups.map(group=>group.map(candidate=>candidate.id)));
  const undone=undoOpenMelds(opened,'p0');
  assert.equal(undone.players.find(player=>player.id==='p0')?.score,101);
  assert.equal(undone.players.find(player=>player.id==='p0')?.opened,false);
  assert.equal(undone.serialOpeningHistory.length,0);
  assert.equal(undone.hands.p0.length,selection.hand.length);
  assert.throws(()=>undoOpenMelds(undone,'p0'),/Geri alınabilecek bir açılış yok/);
});

test('açılış turunda yeni per indirme ve işleme sonrası GERİ AL tüm taşları geri yükler',()=>{
  const state=startTurnClock(playingRoom(),10_000,'opening-full-turn'),selection=useSerialHand(state,'p0',101,11450);
  state.joker={color:'yellow',number:8};
  const added=[tile(11700,'red',1),tile(11701,'red',2),tile(11702,'red',3),tile(11703,'red',13)];
  const originalHand=[...selection.hand,...added];state.hands.p0=originalHand;
  const opened=openSeriesMelds(state,'p0',selection.groups.map(group=>group.map(candidate=>candidate.id)));
  const laid=layNewSeriesMelds(opened,'p0',[[11700,11701,11702]],opened.turnId!,'opening-extra-meld');
  const extended=addToMeld(laid,'p0',11703,laid.melds[0].id,'tail',laid.turnId!,'opening-existing-meld-extension');
  assert.equal(publicGame(laid,'p0',10_001).canUndoOpen,true,'yeni per indirmek açılış geri alma seçeneğini kapatmamalı');
  assert.equal(publicGame(extended,'p0',10_001).canUndoOpen,true,'masadaki per işlemek açılış geri alma seçeneğini kapatmamalı');
  const undone=undoOpenMelds(extended,'p0');
  assert.deepEqual(undone.hands.p0,originalHand);
  assert.equal(undone.melds.length,0);
  assert.equal(undone.players.find(player=>player.id==='p0')?.score,101);
  assert.equal(undone.serialOpeningHistory.length,0);
});

test('PER TOPLA tüm grubu geri alır, ilk kullanım ücretsizdir ve sonraki ücret açılış geri alındığında korunur',()=>{
  const state=startTurnClock(playingRoom(),10_000,'opening-collect-turn'),selection=useSerialHand(state,'p0',101,11500);
  state.joker={color:'yellow',number:8};
  const opened=openSeriesMelds(state,'p0',selection.groups.map(group=>group.map(candidate=>candidate.id)));
  assert.equal(publicGame(opened,'p0',10_001).canCollectMeld,true,'açılış turunda PER TOPLA etkin olmalı');
  const first=collectOpeningMeld(opened,'p0',opened.melds[0].id,opened.turnId!,'collect-first');
  assert.equal(first.hands.p0.length,selection.hand.length-11+3,'seçilen grubun bütün taşları ıstakaya dönmeli');
  assert.equal(first.players.find(player=>player.id==='p0')?.score,0,'eldeki ilk per toplama ücretsiz olmalı');
  assert.equal(publicGame(first,'p0',10_001).canUndoOpen,true,'PER TOPLA açılış turundaki geri alma seçeneğini kapatmamalı');
  const second=collectOpeningMeld(first,'p0',first.melds[0].id,first.turnId!,'collect-second');
  assert.equal(second.players.find(player=>player.id==='p0')?.score,101,'aynı elde sonraki toplama 101 ceza vermeli');
  const undone=undoOpenMelds(second,'p0');
  assert.deepEqual(undone.hands.p0,selection.hand);
  assert.equal(undone.melds.length,0);
  assert.equal(undone.perCollectionUses.p0,2,'geri alma ücretsiz per toplama hakkını yenilememeli');
  assert.equal(undone.players.find(player=>player.id==='p0')?.score,202,'per toplama ve açılış geri alma cezaları birbirinden bağımsız kalmalı');
});

test('PER TOPLA başka oyuncunun perinde ilk uyarıyı verir, ikinci yanlış seçimde hakkı kilitler',()=>{
  const state=startTurnClock(playingRoom(),10_000,'opening-wrong-collect-turn'),selection=useSerialHand(state,'p0',101,11600);
  const opened=openSeriesMelds(state,'p0',selection.groups.map(group=>group.map(candidate=>candidate.id)));
  const opponentTiles=[tile(11690,'blue',1),tile(11691,'blue',2),tile(11692,'blue',3)];
  const withOpponentMeld={...opened,melds:[...opened.melds,{id:'opponent-run',ownerId:'p1',tileIds:opponentTiles.map(member=>member.id),tiles:opponentTiles,kind:'run' as const}]};
  const first=collectOpeningMeld(withOpponentMeld,'p0','opponent-run',opened.turnId!,'wrong-collect-one');
  assert.equal(first.message,'Kendi perinizi seçmediniz!');
  assert.equal(first.openingTurn?.wrongPerSelections,1);
  assert.equal(first.hands.p0.length,opened.hands.p0.length,'ilk yanlış seçim taşları hareket ettirmemeli');
  const second=collectOpeningMeld(first,'p0','opponent-run',opened.turnId!,'wrong-collect-two');
  assert.equal(second.message,'Kendi perinizi seçmediniz. Başka oyuncuların perlerine tıklayarak hakkınızı kaybettiniz.');
  assert.equal(second.openingTurn?.perCollectionLocked,true);
  assert.equal(publicGame(second,'p0').canCollectMeld,false);
  assert.equal(second.hands.p0.length,opened.hands.p0.length,'yanlış seçimler taşları hareket ettirmemeli');
});

test('yeni el başladığında seri açılış eşiği geçmişi sıfırlanır',()=>{
  const state=playingRoom();
  state.serialOpeningHistory=[{round:state.round,playerId:'p0',teamId:null,points:120,tileIds:[1,2,3]}];
  const next=startRound(state);
  assert.deepEqual(next.serialOpeningHistory,[]);
});

test('sarı 7 göstergeyse gerçek okey sarı 8 olur',()=>{
  assert.deepEqual(jokerFromIndicator(tile(1,'yellow',7)),{color:'yellow',number:8});
});

test('kırmızı 13 göstergesi gerçek okeyi kırmızı 1 yapar',()=>{
  assert.deepEqual(jokerFromIndicator(tile(1,'red',13)),{color:'red',number:1});
});

test('göstergeye karşılık gelen iki taş da gerçek okey olarak tanınır',()=>{
  const joker={color:'yellow' as const,number:8};
  const realOkeys=createDeck().filter(candidate=>isRealOkey(candidate,joker));
  assert.equal(realOkeys.length,2);
  assert.ok(realOkeys.every(candidate=>effectiveTile(candidate,joker).wild));
});

test('iki sahte okey gerçek okeyin yüz değerini taşır ama joker sayılmaz',()=>{
  const joker={color:'yellow' as const,number:8};
  const fakeOkeys=createDeck().filter(candidate=>candidate.fakeJoker);
  assert.equal(fakeOkeys.length,2);
  for(const fake of fakeOkeys){
    assert.equal(isRealOkey(fake,joker),false);
    assert.deepEqual(effectiveTile(fake,joker),{color:'yellow',number:8,wild:false});
  }
});

test('ortadan çekilen gerçek okey işaretsiz kalır; çift tık sunucu durumunu değiştirip bütün oyunculara yayınlar',()=>{
  const state=playingRoom(),joker=state.joker!;
  const realOkey=tile(9001,joker.color,joker.number);
  state.phase='draw';state.stock=[realOkey];
  const drawn=drawStock(state,'p0');
  assert.deepEqual(drawn.recognizedRealOkeyIds,[],'ortadan çekmek okeyi kendiliğinden işaretlememeli');
  const marked=updateRealOkeyRecognition(drawn,'p0',[realOkey.id],'toggle');
  assert.deepEqual(marked.recognizedRealOkeyIds,[realOkey.id]);
  assert.deepEqual(marked.hands.p0.find(candidate=>candidate.id===realOkey.id),realOkey,'işaretleme taşın verisini değiştirmemeli');
  assert.deepEqual(effectiveTile(marked.hands.p0.find(candidate=>candidate.id===realOkey.id)!,joker),{color:joker.color,number:joker.number,wild:true});
  assert.deepEqual(publicGame(marked,'p0').recognizedRealOkeyIds,[realOkey.id]);
  assert.deepEqual(publicGame(marked,'p1').recognizedRealOkeyIds,[],'başka oyuncunun kapalı elindeki gerçek okey tanınma bilgisi gizli kalmalı');
  assert.throws(()=>updateRealOkeyRecognition(drawn,'p1',[realOkey.id],'toggle'),/elinizdeki gerçek okey/);
  const unmarked=updateRealOkeyRecognition(marked,'p0',[realOkey.id],'toggle');
  assert.deepEqual(unmarked.recognizedRealOkeyIds,[]);
});

test('otomatik dizme gerçek okeyi geçerli grupta kullanınca sunucu işareti tekrar etmeden ekler',()=>{
  const state=playingRoom(),joker={color:'yellow' as const,number:5};
  const hand=[tile(9101,'red',13),tile(9102,'blue',13),tile(9103,'yellow',5),tile(9104,'black',2)];
  state.joker=joker;state.hands.p0=hand;
  const groups=findRackAutoSortGroups(hand,joker,'series'),usedOkeys=hand.filter(candidate=>groups.flat().includes(candidate.id)&&isRealOkey(candidate,joker)).map(candidate=>candidate.id);
  assert.deepEqual(usedOkeys,[9103]);
  const marked=updateRealOkeyRecognition(state,'p0',usedOkeys,'mark');
  assert.deepEqual(marked.recognizedRealOkeyIds,[9103]);
  assert.equal(updateRealOkeyRecognition(marked,'p0',usedOkeys,'mark'),marked,'otomatik dizme tanıma işaretini toggle edip kapatmamalı');
});

test('çifti diz gerçek okeyi geçerli çiftte kullanınca sunucu işaretler',()=>{
  const state=playingRoom(),joker={color:'yellow' as const,number:5};
  const hand=[tile(9151,'red',13),tile(9152,'yellow',5)];
  state.joker=joker;state.hands.p0=hand;
  const groups=findRackAutoSortGroups(hand,joker,'pairs');
  assert.deepEqual(groups,[[9151,9152]]);
  const marked=updateRealOkeyRecognition(state,'p0',[9152],'mark');
  assert.deepEqual(marked.recognizedRealOkeyIds,[9152]);
});

test('sahte okey işaretlenemez ve yeni el önceki tanınma işaretlerini temizler',()=>{
  const state=playingRoom(),joker=state.joker!;
  const fakeOkey:Tile={id:9201,color:null,number:null,fakeJoker:true};
  state.hands.p0.push(fakeOkey);
  assert.throws(()=>updateRealOkeyRecognition(state,'p0',[fakeOkey.id],'toggle'),/gerçek okey olmalı/);
  const realOkey=tile(9202,joker.color,joker.number);state.hands.p0.push(realOkey);
  const marked=updateRealOkeyRecognition(state,'p0',[realOkey.id],'mark');
  assert.deepEqual(startRound(marked).recognizedRealOkeyIds,[]);
});

test('gerçek okey aynı renkli seride joker olarak kullanılabilir',()=>{
  const joker={color:'red' as const,number:8};
  const hand=[tile(1,'red',6),tile(2,'red',7),tile(3,'red',8),tile(4,'red',9)];
  assert.deepEqual(findRackMeldGroups(hand,joker),[[1,2,3,4]]);
});

test('gerçek okey eksik eş taşın yerine geçerek raf ve otomatik çift grubuna girer',()=>{
  const joker={color:'yellow' as const,number:8},naturalA=tile(101,'red',8),naturalB=tile(102,'red',8),realOkey=tile(103,'yellow',8);
  assert.equal(isValidPair([naturalA,realOkey],joker),true);
  assert.deepEqual(findRackMeldGroups([naturalA,realOkey],joker),[[101,103]]);
  assert.deepEqual(findRackPairGroups([naturalA,naturalB,realOkey],joker),[[101,102]],'aynı yüzdeki iki doğal taş zaten bir geçerli çift oluşturur');
  assert.deepEqual(findRackPairGroups([naturalA,realOkey],joker),[[101,103]],'otomatik çift dizme eksik eş için gerçek okeyi kullanmalı');
  assert.equal(findRackPairGroups([naturalA,realOkey],joker).flat().includes(103),true);
});

test('gerçek okeyli beş çift açılışı sunucu kural doğrulamasından geçer',()=>{
  const state=playingRoom(),joker={color:'yellow' as const,number:8};
  const pairs:Tile[][]=[
    [tile(8101,'red',3),tile(8102,'red',3)],
    [tile(8103,'red',8),tile(8104,'yellow',8)],
    [tile(8105,'blue',9),tile(8106,'blue',9)],
    [tile(8107,'black',6),tile(8108,'black',6)],
    [tile(8109,'yellow',11),tile(8110,'yellow',11)],
  ];
  state.joker=joker;
  state.hands.p0=[...pairs.flat(),tile(8111,'blue',2)];
  const next=openMelds(state,'p0',pairs.map(pair=>pair.map(candidate=>candidate.id)),true);
  assert.equal(next.melds.length,5);
  assert.equal(next.melds[1].kind,'pairs');
  assert.deepEqual(next.melds[1].tileIds,[8103,8104]);
  assert.equal(next.players.find(player=>player.id==='p0')?.opened,true);
  assert.equal(next.pairOpeningHistory[0].pairCount,5);
  const undone=undoOpenMelds(next,'p0');
  assert.equal(undone.players.find(player=>player.id==='p0')?.score,101,'çift açılışını geri alma 101 ceza eklemeli');
  assert.equal(undone.pairOpeningHistory.length,0,'geri alınan çift açılışı eşik geçmişinde kalmamalı');
  assert.throws(()=>undoOpenMelds(undone,'p0'),/Geri alınabilecek bir açılış yok/,'aynı geri alma ikinci kez ceza yazamamalı');
});

test('sahte okey joker gibi kullanılarak beş çift açamaz',()=>{
  const state=playingRoom(),joker={color:'yellow' as const,number:8},fake:Tile={id:8201,color:null,number:null,fakeJoker:true};
  const pairs:Tile[][]=[
    [fake,tile(8202,'blue',5)],
    [tile(8203,'red',3),tile(8204,'red',3)],
    [tile(8205,'blue',9),tile(8206,'blue',9)],
    [tile(8207,'black',6),tile(8208,'black',6)],
    [tile(8209,'yellow',11),tile(8210,'yellow',11)],
  ];
  state.joker=joker;state.hands.p0=[...pairs.flat(),tile(8211,'red',2)];
  assert.throws(()=>openMelds(state,'p0',pairs.map(pair=>pair.map(candidate=>candidate.id)),true),/geçerli bir çift/);
});

test('normal çift açılışında dört çift reddedilir, beş çift kabul edilir ve seri geçmişi ayrı kalır',()=>{
  const rejected=playingRoom(),four=usePairHand(rejected,'p0',4,8400);
  assert.throws(()=>openMelds(rejected,'p0',four.map(pair=>pair.map(candidate=>candidate.id)),true),/Gerekli çift: 5 — Mevcut çift: 4\. Ceza uygulanmadı/);
  assert.equal(rejected.players.find(player=>player.id==='p0')?.score,0);
  const accepted=playingRoom(),five=usePairHand(accepted,'p0',5,8500);
  accepted.settings={...accepted.settings,folding:true};
  accepted.hands.p0.push(tile(8511,'yellow',12));
  accepted.serialOpeningHistory=[{round:accepted.round,playerId:'p1',teamId:null,points:150,tileIds:[1,2,3]}];
  assert.equal(pairOpeningThreshold(accepted,'p0'),5,'seri açılış geçmişi çift eşiğini etkilememeli');
  const opened=openMelds(accepted,'p0',five.map(pair=>pair.map(candidate=>candidate.id)),true);
  assert.equal(opened.pairOpeningHistory.length,1);
  assert.equal(opened.pairOpeningHistory[0].pairCount,5);
  assert.equal(opened.serialOpeningHistory[0].points,150,'çift açılışı seri geçmişini değiştirmemeli');
  assert.equal(serialOpeningThreshold(opened,'p1'),151,'çift açılışı seri eşiğini değiştirmemeli');
  assert.equal(opened.phase,'discard');
  assert.equal(opened.turnPlayerId,'p0');
  assert.equal(publicGame(opened,'p1').pairOpeningThreshold,6);
  const discarded=discardTile(opened,'p0',opened.hands.p0[0].id);
  assert.equal(discarded.turnPlayerId,'p1','çift açılışından sonra oyuncu taş atıp turu tamamlayabilmeli');
});

test('aynı taş kimliği iki farklı çiftte kullanılamaz',()=>{
  const state=playingRoom(),pairs=usePairHand(state,'p0',5,8600),ids=pairs.map(pair=>pair.map(candidate=>candidate.id));
  ids[1][0]=ids[0][0];
  assert.throws(()=>openMelds(state,'p0',ids,true),/birden fazla çiftte kullanılamaz/);
});

test('katlamalı solo çift eşiği önceki geçerli açılışın çift sayısının bir fazlasıdır',()=>{
  const state=playingRoom();state.settings={...state.settings,folding:true};
  const first=usePairHand(state,'p0',5,8700),opened=openMelds(state,'p0',first.map(pair=>pair.map(candidate=>candidate.id)),true);
  const next={...opened,turnPlayerId:'p1',phase:'discard' as const};
  assert.equal(pairOpeningThreshold(next,'p1'),6);
  const five=usePairHand(next,'p1',5,8800);
  assert.throws(()=>openMelds(next,'p1',five.map(pair=>pair.map(candidate=>candidate.id)),true),/Gerekli çift: 6 — Mevcut çift: 5/);
  const six=usePairHand(next,'p1',6,8900),second=openMelds(next,'p1',six.map(pair=>pair.map(candidate=>candidate.id)),true);
  assert.equal(second.pairOpeningHistory.at(-1)?.pairCount,6);
  assert.equal(pairOpeningThreshold({...second,turnPlayerId:'p2'},'p2'),7);
});

test('katlamalı eşlide takım arkadaşı çift eşiğini yükseltmez, rakip takım yükseltir',()=>{
  const state=playingRoom();state.settings={...state.settings,mode:'pairs',folding:true};
  const first=usePairHand(state,'p0',5,9000),opened=openMelds(state,'p0',first.map(pair=>pair.map(candidate=>candidate.id)),true);
  const teammate={...opened,turnPlayerId:'p2',phase:'discard' as const};
  assert.equal(pairOpeningThreshold(teammate,'p2'),5);
  const teammatePairs=usePairHand(teammate,'p2',5,9100),teammateOpened=openMelds(teammate,'p2',teammatePairs.map(pair=>pair.map(candidate=>candidate.id)),true);
  const opponent={...teammateOpened,turnPlayerId:'p1',phase:'discard' as const};
  assert.equal(pairOpeningThreshold(opponent,'p1'),6);
  const five=usePairHand(opponent,'p1',5,9200);
  assert.throws(()=>openMelds(opponent,'p1',five.map(pair=>pair.map(candidate=>candidate.id)),true),/Gerekli çift: 6 — Mevcut çift: 5/);
  const six=usePairHand(opponent,'p1',6,9300),rivalOpened=openMelds(opponent,'p1',six.map(pair=>pair.map(candidate=>candidate.id)),true);
  assert.equal(rivalOpened.pairOpeningHistory.at(-1)?.teamId,1);
});

test('çift açmış oyuncu sonraki turda yeni çiftleri eşiksiz indirebilir; açılış geçmişi değişmez',()=>{
  const state=playingRoom(),first=usePairHand(state,'p0',5,9400),opened=openMelds(state,'p0',first.map(pair=>pair.map(candidate=>candidate.id)),true);
  const later=startTurnClock({...opened,turnPlayerId:'p0',phase:'discard' as const},10_000,'pairs-lay-turn');
  const secondPairs=usePairHand(later,'p0',1,9500);
  later.hands.p0=[...secondPairs.flat(),tile(9502,'black',2)];
  const second=layNewPairMelds(later,'p0',secondPairs.map(pair=>pair.map(candidate=>candidate.id)),later.turnId||undefined,'pairs-lay-request');
  assert.equal(second.pairOpeningHistory.length,1);
  assert.equal(second.melds.length,6);
  assert.equal(second.hands.p0.length,1,'taş atmak için bir taş elde kalmalı');
});

test('seri açan oyuncu masada çift açan yokken çift indiremez ve oyun durumu değişmez',()=>{
  const state=playingRoom();
  state.players=state.players.map(player=>player.id==='p0'?{...player,opened:true}:player);
  const timed=startTurnClock(state,10_000,'series-pairs-locked');
  const pair=[tile(95101,'red',6),tile(95102,'red',6)],leftover=tile(95103,'blue',2);
  timed.hands.p0=[...pair,leftover];
  assert.throws(()=>layNewPairMelds(timed,'p0',[[95101,95102]],timed.turnId||undefined,'pair-locked-request'),/masada önce bir oyuncu çift açmış olmalı/);
  assert.equal(timed.hands.p0.length,3);
  assert.equal(timed.melds.length,0);
});

test('seri açan oyuncu çift indirebilir; takım arkadaşı veya rakibin çift açmış olması yeterli',()=>{
  for(const pairOpenerSeat of [2,1]){
    const state=playingRoom();state.settings={...state.settings,mode:'pairs'};
    state.players=state.players.map(player=>player.id==='p0'?{...player,opened:true}:player.id===`p${pairOpenerSeat}`?{...player,opened:true,pairMode:true}:player);
    const timed=startTurnClock(state,11_000,`series-pairs-open-${pairOpenerSeat}`);
    const pair=[tile(95201+pairOpenerSeat*10,'blue',7),tile(95202+pairOpenerSeat*10,'blue',7)],leftover=tile(95203+pairOpenerSeat*10,'black',2);
    timed.hands.p0=[...pair,leftover];
    const next=layNewPairMelds(timed,'p0',[[pair[0].id,pair[1].id]],timed.turnId||undefined,`pair-enabled-${pairOpenerSeat}`);
    assert.equal(next.melds[0].kind,'pairs');
    assert.equal(next.players.find(player=>player.id==='p0')?.pairMode,false,'çift indirmek seri açılış türünü değiştirmemeli');
    assert.equal(next.hands.p0.length,1);
  }
});

test('çift açan oyuncu yeni seri indiremez ama masadaki geçerli seriye taş işleyebilir',()=>{
  const state=playingRoom();state.players=state.players.map(player=>player.id==='p0'?{...player,opened:true,pairMode:true}:player);
  const timed=startTurnClock(state,12_000,'pairs-series-locked');
  const pair=[tile(95301,'yellow',9),tile(95302,'yellow',9)],leftover=tile(95303,'blue',1);
  timed.hands.p0=[...pair,leftover];
  const pairs=layNewPairMelds(timed,'p0',[[95301,95302]],timed.turnId||undefined,'pairs-lay-valid');
  assert.equal(pairs.melds[0].kind,'pairs');
  const run=[tile(95311,'red',4),tile(95312,'red',5),tile(95313,'red',6)];
  timed.hands.p0=[...run,leftover];
  assert.throws(()=>layNewSeriesMelds(timed,'p0',[[95311,95312,95313]],timed.turnId||undefined,'pairs-series-invalid'),/Çift açan oyuncu seri per indiremez/);
  const tableRun=[tile(95321,'red',6),tile(95322,'red',7),tile(95323,'red',8)];
  timed.melds=[{id:'series-on-table',ownerId:'p1',tileIds:tableRun.map(tile=>tile.id),tiles:tableRun,kind:'run',realOkeyAssignments:{}}];
  timed.hands.p0=[tile(95324,'red',5),leftover];
  assert.deepEqual(availableMeldProcessingTargets(timed,'p0',12_000),[{tileId:95324,meldId:'series-on-table',target:'head'}]);
  const processed=addToMeld(timed,'p0',95324,'series-on-table','head',timed.turnId||undefined,'pairs-can-process-series');
  assert.deepEqual(processed.melds[0].tiles.map(member=>member.number),[5,6,7,8]);
  assert.deepEqual(processed.hands.p0,[leftover]);
  assert.equal(processed.players.find(player=>player.id==='p0')?.pairMode,true,'işleme açılış türünü değiştirmemeli');
});

test('yeni seri indirme geçersiz per ve tekrar taş kimliğini reddeder; yinelenen aynı istek çift işlem yapmaz',()=>{
  const state=playingRoom();state.players=state.players.map(player=>player.id==='p0'?{...player,opened:true}:player);
  const timed=startTurnClock(state,13_000,'series-lay-validation');
  timed.hands.p0=[tile(95401,'red',3),tile(95402,'red',5),tile(95403,'blue',7),tile(95404,'black',2)];
  assert.throws(()=>layNewSeriesMelds(timed,'p0',[[95401,95402,95403]],timed.turnId||undefined,'invalid-meld-request'),/geçersiz/);
  timed.hands.p0=[tile(95405,'red',2),tile(95406,'red',3),tile(95407,'red',4),tile(95408,'red',5),tile(95409,'black',2)];
  assert.throws(()=>layNewSeriesMelds(timed,'p0',[[95405,95406,95407],[95406,95407,95408]],timed.turnId||undefined,'duplicate-id-request'),/birden fazla grupta/);
  assert.equal(timed.melds.length,0);
  assert.equal(timed.hands.p0.length,5);
  timed.hands.p0=[tile(95411,'blue',3),tile(95412,'blue',4),tile(95413,'blue',5),tile(95414,'black',2)];
  const next=layNewSeriesMelds(timed,'p0',[[95411,95412,95413]],timed.turnId||undefined,'same-series-lay');
  assert.equal(layNewSeriesMelds(next,'p0',[[95411,95412,95413]],next.turnId||undefined,'same-series-lay'),next,'tekrar gelen işlem yeni grup açmamalı');
  assert.equal(next.melds.length,1);
});

test('yerden alınan taş çift açılışında kullanılabilir ve çift açılışı stoktan taş çekmez',()=>{
  const state=playingRoom(),pairs=usePairHand(state,'p0',5,9600),taken=pairs.flat().find(candidate=>!isRealOkey(candidate,state.joker))!;
  state.phase='draw';state.hands.p0=state.hands.p0.filter(candidate=>candidate.id!==taken.id);state.discard=[taken];state.throwsByPlayer.p3=[taken];
  const stockCount=state.stock.length,afterTake=takeDiscard(state,'p0');
  const opened=openMelds(afterTake,'p0',pairs.map(pair=>pair.map(candidate=>candidate.id)),true);
  assert.equal(opened.stock.length,stockCount);
  assert.ok(opened.melds.some(meld=>meld.tileIds.includes(taken.id)));
  assert.equal(opened.phase,'discard');
});

test('yeni elde seri ve çift açılış geçmişleri birlikte sıfırlanır',()=>{
  const state=playingRoom();
  state.serialOpeningHistory=[{round:state.round,playerId:'p0',teamId:null,points:120,tileIds:[1,2,3]}];
  state.pairOpeningHistory=[{round:state.round,playerId:'p1',teamId:null,pairCount:6,tileIds:[4,5]}];
  const next=startRound(state);
  assert.deepEqual(next.serialOpeningHistory,[]);
  assert.deepEqual(next.pairOpeningHistory,[]);
});

test('beş çift önerisi gerçek okeyi temsil edecek eş taşı bularak kullanır',()=>{
  const joker={color:'black' as const,number:6};
  const hand:Tile[]=[
    tile(8301,'red',3),tile(8302,'red',3),tile(8303,'yellow',10),tile(8304,'black',6),
    tile(8305,'blue',9),tile(8306,'blue',9),tile(8307,'black',12),tile(8308,'black',12),
    tile(8309,'yellow',2),tile(8310,'yellow',2),tile(8311,'red',1),
  ];
  const groups=suggestFivePairs(hand.slice(0,10),hand.slice(0,10).map(candidate=>candidate.id),joker);
  assert.equal(groups.length,5);
  assert.ok(groups.some(group=>group.includes(8303)&&group.includes(8304)));
});

test('gerçek okey aynı sayı grubundaki eksik rengi tamamlayabilir',()=>{
  const joker={color:'red' as const,number:8};
  const hand=[tile(1,'red',8),tile(2,'blue',11),tile(3,'black',11)];
  assert.deepEqual(findRackMeldGroups(hand,joker),[[1,2,3]]);
});

test('normal gösterge taşı joker değildir; yalnızca sonraki sayı joker olur',()=>{
  const indicator=tile(1,'yellow',7);
  const joker=jokerFromIndicator(indicator);
  assert.equal(isRealOkey(indicator,joker),false);
  assert.equal(effectiveTile(indicator,joker).wild,false);
  assert.equal(effectiveTile(tile(2,'yellow',8),joker).wild,true);
});

test('gösterge seçimi iki sahte okeyi destede tutar',()=>{
  const deck=createDeck();
  const indicator=takeIndicator(deck);
  assert.equal(indicator.fakeJoker,false);
  assert.equal(deck.length,105);
  assert.equal(deck.filter(candidate=>candidate.fakeJoker).length,2);
});

test('dağıtım sonunda 106 taşın tamamı korunur',()=>{
  const state=freshRoom({rounds:1,mode:'solo',folding:false,assisted:true,tableColor:'wood',turnDurationSeconds:45});
  state.players=[0,1,2,3].map(seat=>({id:`p${seat}`,name:`Oyuncu ${seat}`,avatar:'O',online:true,seat,score:0,opened:false,pairMode:false}));
  const round=startRound(state);
  const distributed=[...Object.values(round.hands).flat(),...round.stock,round.indicator!];
  assert.equal(round.status,'playing');
  assert.equal(distributed.length,106);
  assert.equal(distributed.filter(candidate=>candidate.fakeJoker).length,2);
  assert.equal(round.stock.length,20);
});

test('her elde başlangıç oyuncusu rastgele seçilir, ardışık ellerde tekrar etmez ve 22 taşı alır',()=>{
  const state=freshRoom({rounds:3,mode:'solo',folding:false,assisted:true,tableColor:'wood',turnDurationSeconds:45});
  state.players=[0,1,2,3].map(seat=>({id:`starter-${seat}`,name:`Oyuncu ${seat}`,avatar:'O',online:true,seat,score:0,opened:false,pairMode:false}));
  const possibleStarters=[0,0.34,0.67,0.99].map(value=>startRound(state,()=>value).turnPlayerId);
  assert.deepEqual(new Set(possibleStarters),new Set(state.players.map(player=>player.id)),'dört koltuk da başlangıç oyuncusu olabilmeli');

  let previous=startRound(state,()=>0);
  assert.equal(previous.turnPlayerId,'starter-0');
  for(let round=2;round<=11;round++){
    const next=startRound({...previous,round},()=>0);
    assert.notEqual(next.turnPlayerId,previous.turnPlayerId,`${round}. el önceki başlangıç oyuncusunu tekrarlamamalı`);
    assert.equal(next.roundStarterId,next.turnPlayerId);
    assert.equal(next.hands[next.turnPlayerId!].length,22,'başlayan oyuncuya 22 taş verilmeli');
    assert.ok(next.players.filter(player=>player.id!==next.turnPlayerId).every(player=>next.hands[player.id].length===21));
    previous=next;
  }
});

test('geçerli taş atma tek seçili taşı elden çıkarıp sonraki oyuncuya geçer',()=>{
  const state=playingRoom(),[chosen,...otherTiles]=state.hands.p0;
  const next=discardTile(state,'p0',chosen.id);
  assert.deepEqual(next.hands.p0.map(candidate=>candidate.id),otherTiles.map(candidate=>candidate.id));
  assert.equal(next.discard.at(-1)?.id,chosen.id);
  assert.equal(next.throwsByPlayer.p0.at(-1)?.id,chosen.id);
  assert.equal(next.turnPlayerId,'p1');
  assert.equal(next.phase,'draw');
});

test('elle masadaki açık pere işlek taş atmak 101 ceza verir ve bildirim yalnız atan oyuncuya gider',()=>{
  const state=playingRoom();
  state.joker={color:'yellow',number:8};
  state.players=state.players.map(player=>player.id==='p1'?{...player,opened:true}:player);
  const run=[tile(98701,'red',4),tile(98702,'red',5),tile(98703,'red',6),tile(98704,'red',7)];
  state.melds=[{id:'manual-discard-run',ownerId:'p1',tileIds:run.map(member=>member.id),tiles:run,kind:'run',realOkeyAssignments:{}}];
  const playable=tile(98705,'red',3),other=tile(98706,'black',1);
  state.hands.p0=[playable,other];

  const next=discardTile(state,'p0',playable.id);
  assert.equal(next.players.find(player=>player.id==='p0')?.score,101);
  assert.deepEqual(next.penaltyHistory?.filter(entry=>entry.playerId==='p0').map(entry=>[entry.points,entry.reason]),[[101,'workable-discard']]);
  assert.ok(next.publicEvents?.at(-1)?.text.includes('işlek taş attı'));
  assert.ok(publicGame(next,'p0').personalNotifications.some(entry=>entry.text.includes('İşlek taş')&&entry.text.includes('101')));
  assert.equal(publicGame(next,'p1').penaltyHistory.some(entry=>entry.playerId==='p0'),false);
  assert.equal(publicGame(next,'p1').personalNotifications.some(entry=>entry.text.includes('İşlek taş')&&entry.text.includes('101')),false);
});

test('elle gerçek okey atmak da tek sefer 101 ceza verir; işlek olmayan normal taş cezasızdır',()=>{
  const okeyState=playingRoom();
  okeyState.joker={color:'yellow',number:8};
  const realOkey=tile(98711,'yellow',8),spare=tile(98712,'black',1);
  okeyState.hands.p0=[realOkey,spare];
  const afterOkey=discardTile(okeyState,'p0',realOkey.id);
  assert.equal(afterOkey.players.find(player=>player.id==='p0')?.score,101);
  assert.equal(afterOkey.penaltyHistory?.filter(entry=>entry.playerId==='p0').length,1);
  assert.equal(afterOkey.penaltyHistory?.find(entry=>entry.playerId==='p0')?.reason,'real-okey-discard');

  const ordinaryState=playingRoom();
  ordinaryState.joker={color:'yellow',number:8};
  ordinaryState.players=ordinaryState.players.map(player=>player.id==='p1'?{...player,opened:true}:player);
  const run=[tile(98721,'red',4),tile(98722,'red',5),tile(98723,'red',6)];
  ordinaryState.melds=[{id:'manual-discard-run-no-match',ownerId:'p1',tileIds:run.map(member=>member.id),tiles:run,kind:'run',realOkeyAssignments:{}}];
  const ordinary=tile(98724,'blue',11),leftover=tile(98725,'black',1);
  ordinaryState.hands.p0=[ordinary,leftover];
  const afterOrdinary=discardTile(ordinaryState,'p0',ordinary.id);
  assert.equal(afterOrdinary.players.find(player=>player.id==='p0')?.score,0);
  assert.deepEqual(afterOrdinary.penaltyHistory,[]);
});

test('perin parçası atıldığında sadece seçilen üye elden çıkar',()=>{
  const state=playingRoom(),[chosen,...rest]=state.hands.p0,groupMembers=rest.slice(0,2).map(candidate=>candidate.id);
  const next=discardTile(state,'p0',chosen.id);
  assert.equal(next.hands.p0.some(candidate=>candidate.id===chosen.id),false);
  for(const id of groupMembers)assert.equal(next.hands.p0.some(candidate=>candidate.id===id),true);
});

test('sıra oyuncuda değilken veya taş çekme aşamasındayken atma reddedilir',()=>{
  const state=playingRoom(),otherTile=state.hands.p1[0];
  assert.throws(()=>discardTile(state,'p1',otherTile.id),/Önce taş çekmelisiniz/);
  const drawPhase={...state,phase:'draw' as const},ownTile=state.hands.p0[0];
  assert.throws(()=>discardTile(drawPhase,'p0',ownTile.id),/Önce taş çekmelisiniz/);
  assert.equal(state.hands.p1.length,21);
  assert.equal(state.hands.p0.length,22);
  assert.equal(state.discard.length,0);
});

test('aynı taş için ikinci atma girişimi reddedilir ve taş kaybı olmaz',()=>{
  const state=playingRoom(),[chosen,another]=state.hands.p0,first=discardTile(state,'p0',chosen.id);
  assert.throws(()=>discardTile(first,'p0',another.id),/Önce taş çekmelisiniz/);
  assert.equal(first.hands.p0.some(candidate=>candidate.id===another.id),true);
  assert.equal(first.discard.length,1);
});

test('tur saati masa ayarındaki 30/45/60/90 saniyeyi kullanır',()=>{
  for(const seconds of [30,45,60,90] as const){
    const room=freshRoom({rounds:1,mode:'solo',folding:false,assisted:true,tableColor:'wood',turnDurationSeconds:seconds});
    room.players=[0,1,2,3].map(seat=>({id:`p${seat}`,name:`Oyuncu ${seat}`,avatar:'O',online:true,seat,score:0,opened:false,pairMode:false}));
    const state=startTurnClock(startRound(room),1_000,'turn-a');
    assert.equal(state.turnStartedAt,1_000);
    assert.equal(state.turnDeadlineAt,1_000+seconds*1000);
    assert.equal(state.turnId,'turn-a');
  }
});

test('aynı sunucu tur saati dört oyuncuya ve yeniden bağlanan oyuncuya aynen yayınlanabilir',()=>{
  const state=startTurnClock(playingRoom(),10_000,'turn-shared');
  const views=state.players.map(player=>publicGame(state,player.id,10_250));
  assert.ok(views.every(view=>view.turnStartedAt===10_000&&view.turnDeadlineAt===55_000&&view.turnId==='turn-shared'&&view.serverNow===10_250));
  const reconnected=publicGame(state,'p2',20_000);
  assert.equal(reconnected.turnId,'turn-shared');
  assert.equal(reconnected.turnDeadlineAt,55_000);
});

test('taş çekmek aynı tur kimliğini ve bitiş zamanını korur',()=>{
  const started=startTurnClock({...playingRoom(),phase:'draw'},5_000,'turn-stable');
  const drawn=drawStock(started,'p0');
  assert.equal(drawn.turnId,'turn-stable');
  assert.equal(drawn.turnStartedAt,5_000);
  assert.equal(drawn.turnDeadlineAt,50_000);
});

test('süresi dolmamış veya eski tur kimliğine ait otomatik hamle reddedilir',()=>{
  const state=startTurnClock(playingRoom(),10_000,'turn-current');
  assert.equal(turnClockExpired(state,'turn-current',54_999),false);
  assert.equal(autoPlayTimedOutTurn(state,'turn-current',54_999,()=>0),null);
  assert.equal(autoPlayTimedOutTurn(state,'turn-old',60_000,()=>0),null);
});

test('taş çekmemiş oyuncunun timeout hamlesi bir taş çekip rastgele bir taş atar',()=>{
  const state=startTurnClock({...playingRoom(),phase:'draw'},1_000,'turn-draw');
  const stockBefore=state.stock.length,handBefore=state.hands.p0.length;
  const next=autoPlayTimedOutTurn(state,'turn-draw',46_000,()=>0)!;
  assert.equal(next.stock.length,stockBefore-1);
  assert.equal(next.hands.p0.length,handBefore);
  assert.equal(next.discard.length,1);
  assert.equal(next.throwsByPlayer.p0.length,1);
  assert.equal(next.turnPlayerId,'p1');
  assert.equal(next.phase,'draw');
});

test('önceden taş çekmiş oyuncunun timeout hamlesi yalnızca bir taş atar',()=>{
  const drawn=drawStock({...playingRoom(),phase:'draw'},'p0');
  const state=startTurnClock(drawn,1_000,'turn-discard');
  const stockBefore=state.stock.length,handBefore=state.hands.p0.length;
  const next=autoPlayTimedOutTurn(state,'turn-discard',46_000,()=>0)!;
  assert.equal(next.stock.length,stockBefore);
  assert.equal(next.hands.p0.length,handBefore-1);
  assert.equal(next.discard.length,1);
  assert.equal(next.turnPlayerId,'p1');
});

test('timeoutta rastgele seçilen per taşı atılır ve eldeki diğer per taşları kalır',()=>{
  const state=playingRoom();
  const run=[tile(7001,'red',4),tile(7002,'red',5),tile(7003,'red',6)];
  state.hands.p0=[...run,tile(7004,'blue',2)];
  const timed=startTurnClock({...state,phase:'discard'},1_000,'turn-breaks-run');
  const next=autoPlayTimedOutTurn(timed,'turn-breaks-run',46_000,()=>0)!;
  assert.equal(next.discard.at(-1)?.id,7001);
  assert.deepEqual(next.hands.p0.map(candidate=>candidate.id),[7002,7003,7004]);
});

test('timeoutta mevcut pere işlenebilen taş rastgele atılır ve 101 ceza yalnızca bir kez eklenir',()=>{
  const state=playingRoom();
  const tableRun=[tile(7101,'red',4),tile(7102,'red',5),tile(7103,'red',6)];
  state.players=state.players.map(player=>player.id==='p0'?{...player,opened:true}:player);
  state.melds=[{id:'run-1',ownerId:'p1',tileIds:tableRun.map(candidate=>candidate.id),tiles:tableRun,kind:'run'}];
  state.hands.p0=[tile(7104,'red',7),tile(7105,'blue',2)];
  const timed=startTurnClock({...state,phase:'discard'},1_000,'turn-penalty');
  const next=autoPlayTimedOutTurn(timed,'turn-penalty',46_000,()=>0)!;
  assert.equal(next.discard.at(-1)?.id,7104);
  assert.equal(next.players.find(player=>player.id==='p0')?.score,101);
  assert.equal(next.turnId,null);
  assert.equal(autoPlayTimedOutTurn(next,'turn-penalty',100_000,()=>0),null);
});

test('timeoutta atılan gerçek okey için sunucu tarafı 101 ceza eklenir',()=>{
  const state=playingRoom(),joker=state.joker!;
  state.hands.p0=[tile(7201,joker.color,joker.number),tile(7202,'blue',2)];
  const timed=startTurnClock({...state,phase:'discard'},1_000,'turn-real-joker');
  const next=autoPlayTimedOutTurn(timed,'turn-real-joker',46_000,()=>0)!;
  assert.equal(next.discard.at(-1)?.id,7201);
  assert.equal(next.players.find(player=>player.id==='p0')?.score,101);
});

test('kesinleşen el skorları oyuncu kimliğine göre dört derece rozeti üretir',()=>{
  const state=playingRoom();
  state.players=state.players.map(player=>({...player,score:(player.seat+1)*1_000}));
  state.roundScoreStart=Object.fromEntries(state.players.map(player=>[player.id,player.score]));
  state.hands.p0=[tile(7301,'red',3)];
  const ended=discardTile({...state,phase:'discard'},'p0',7301);
  assert.equal(ended.status,'round-end');
  assert.equal(publicGame(ended,'p1').revealedHands,null,'normal taş atarak bitiş elden bitiş gösterimini açmamalı');
  const recorded=recordRoundBadges(ended);
  assert.deepEqual(recorded.matchBadges,[
    {round:1,playerId:'p0',place:1},
    {round:1,playerId:'p1',place:2},
    {round:1,playerId:'p2',place:2},
    {round:1,playerId:'p3',place:2},
  ]);
  assert.deepEqual(recorded.roundScores.map(entry=>entry.points),[-101,202,202,202]);
  assert.deepEqual(publicGame(recorded,'p2').matchBadges,recorded.matchBadges);
  assert.deepEqual(publicGame(recorded,'p2').roundScores,recorded.roundScores);
});

test('toplam puan ve tur puanı ayrı saklanır; rozet sıralaması yalnızca ilgili turun puanını kullanır',()=>{
  const state=playingRoom();state.settings={...state.settings,rounds:3};state.status='round-end';state.round=2;
  const totals=[1000,500,200,100],points=[40,10,30,20];
  state.players=state.players.map((player,index)=>({...player,score:totals[index]}));
  state.roundScoreStart=Object.fromEntries(state.players.map((player,index)=>[player.id,totals[index]-points[index]]));
  const scored=recordRoundScores(state);
  assert.deepEqual(scored.roundScores.filter(entry=>entry.round===2).map(entry=>({playerId:entry.playerId,points:entry.points,total:entry.total})),[
    {playerId:'p0',points:40,total:1000},{playerId:'p1',points:10,total:500},{playerId:'p2',points:30,total:200},{playerId:'p3',points:20,total:100},
  ]);
  assert.deepEqual(rankPlayersByTotal(scored.players).map(player=>player.id),['p3','p2','p1','p0']);
  const awarded=recordRoundBadges(scored);
  assert.deepEqual(awarded.matchBadges,[
    {round:2,playerId:'p1',place:1},{round:2,playerId:'p3',place:2},{round:2,playerId:'p2',place:3},{round:2,playerId:'p0',place:4},
  ]);
  assert.equal(recordRoundScores(awarded),awarded,'aynı turun puanları ikinci kez eklenmemeli');
  assert.equal(recordRoundBadges(awarded),awarded,'aynı tur rozetleri ikinci kez eklenmemeli');
});

test('eşli skor tablosu tur ve genel takım puanlarını 0-2 ve 1-3 eşleşmesiyle ayrı sıralar',()=>{
  const state=playingRoom();
  state.players=state.players.map((player,index)=>({...player,score:[100,300,110,250][index]}));
  const roundScores=[45,30,80,20].map((points,index)=>({round:1,playerId:`p${index}`,points,total:state.players[index].score}));
  const teams=calculateTeamScoreboard(state.players,roundScores,1);
  assert.deepEqual(teams,[
    {teamId:0,playerIds:['p0','p2'],roundPoints:125,previousTotal:85,total:210,roundRank:2,overallRank:1},
    {teamId:1,playerIds:['p1','p3'],roundPoints:50,previousTotal:500,total:550,roundRank:1,overallRank:2},
  ]);
});

test('oyun devam ederken veya el tamamlanmadan rozet eklenmez',()=>{
  const playing=playingRoom();
  assert.equal(recordRoundBadges(playing),playing);
  const waiting={...playing,status:'waiting' as const};
  assert.equal(recordRoundBadges(waiting),waiting);
});

test('3, 7 ve 11 ellik maçlarda tur puanı ve rozet geçmişi yalnızca kesinleşen el sayısına kadar büyür',()=>{
  for(const rounds of [3,7,11] as const){
    let state=freshRoom({rounds,mode:'solo',folding:false,assisted:true,tableColor:'wood',turnDurationSeconds:45});
    state.players=[0,1,2,3].map(seat=>({id:`p${seat}`,name:`Oyuncu ${seat}`,avatar:'O',online:true,seat,score:0,opened:false,pairMode:false}));
    for(let round=1;round<=rounds;round++){
      const roundScoreStart=Object.fromEntries(state.players.map(player=>[player.id,player.score]));
      const ended={...state,status:'round-end' as const,round,roundScoreStart,players:state.players.map((player,index)=>({...player,score:player.score+100+index}))};
      const recorded=recordRoundBadges(ended);
      assert.equal(recorded.matchBadges.length,round*4);
      assert.equal(recorded.roundScores.length,round*4);
      for(const player of state.players)assert.equal(recorded.matchBadges.filter(badge=>badge.playerId===player.id).length,round);
      assert.deepEqual([...new Set(recorded.matchBadges.map(badge=>badge.round))],Array.from({length:round},(_,index)=>index+1));
      assert.equal(recordRoundBadges(recorded),recorded,'aynı el ikinci kez işlenmemeli');
      state={...state,players:recorded.players,matchBadges:recorded.matchBadges,roundScores:recorded.roundScores};
    }
    const beyondLimit=recordRoundBadges({...state,status:'round-end',round:rounds+1});
    assert.equal(beyondLimit.matchBadges.length,rounds*4);
    assert.equal(beyondLimit.matchBadges.some(badge=>badge.round===rounds+1),false);
  }
});

test('yeni maç başlarken eski rozet geçmişi temizlenir',()=>{
  const state=playingRoom();
  state.matchBadges=[{round:1,playerId:'p0',place:1},{round:1,playerId:'p1',place:2},{round:1,playerId:'p2',place:3},{round:1,playerId:'p3',place:4}];
  assert.deepEqual(resetMatchBadgeHistory(state).matchBadges,[]);
});

test('masa kurulum ayarları yalnızca desteklenen el, mod ve süre seçeneklerini kabul eder',()=>{
  for(const rounds of [3,5,7,11] as const)for(const mode of ['solo','pairs'] as const)for(const folding of [false,true])for(const turnDurationSeconds of [30,45,60,90] as const){
    const settings=validateTableSettings({rounds,mode,folding,assisted:true,tableColor:'wood',turnDurationSeconds});
    assert.deepEqual(settings,{rounds,mode,folding,assisted:true,tableColor:'wood',turnDurationSeconds});
  }
  for(const invalid of [
    {rounds:1,mode:'solo',folding:false,assisted:true,tableColor:'wood',turnDurationSeconds:45},
    {rounds:5,mode:'unknown',folding:false,assisted:true,tableColor:'wood',turnDurationSeconds:45},
    {rounds:5,mode:'pairs',folding:false,assisted:true,tableColor:'wood',turnDurationSeconds:20},
  ])assert.throws(()=>validateTableSettings(invalid));
});

test('yeni maç yeni kimlik ve temiz oyun durumuyla koltukları koruyarak başlar',()=>{
  const previous=playingRoom();
  previous.status='match-end';
  previous.round=previous.settings.rounds;
  previous.players=previous.players.map(player=>({...player,score:200+player.seat,opened:true,pairMode:player.seat%2===0}));
  previous.matchBadges=[{round:previous.round,playerId:'p0',place:1}];
  previous.serialOpeningHistory=[{round:previous.round,playerId:'p0',teamId:null,points:101,tileIds:[1,2,3]}];
  previous.pairOpeningHistory=[{round:previous.round,playerId:'p1',teamId:null,pairCount:5,tileIds:[4,5]}];
  const next=startNewMatch(previous,{rounds:5,mode:'pairs',folding:true,assisted:false,tableColor:'burgundy',turnDurationSeconds:30});
  assert.notEqual(next.matchId,previous.matchId);
  assert.equal(next.status,'playing');
  assert.equal(next.round,1);
  assert.equal(next.settings.rounds,5);
  assert.equal(next.settings.mode,'pairs');
  assert.equal(next.settings.folding,true);
  assert.equal(next.settings.turnDurationSeconds,30);
  assert.deepEqual(next.players.map(({id,seat,score,opened,pairMode})=>({id,seat,score,opened,pairMode})),previous.players.map(({id,seat})=>({id,seat,score:0,opened:false,pairMode:false})));
  assert.deepEqual(next.matchBadges,[]);
  assert.deepEqual(next.roundScores,[]);
  assert.deepEqual(next.serialOpeningHistory,[]);
  assert.deepEqual(next.pairOpeningHistory,[]);
  assert.equal(next.melds.length,0);
  assert.equal(next.discard.length,0);
  assert.equal(next.throwsByPlayer.p0.length,0);
  assert.equal(next.recognizedRealOkeyIds.length,0);
  assert.deepEqual(next.players.map(player=>player.score),[0,0,0,0]);
  assert.ok(next.turnPlayerId);
  assert.equal(next.roundStarterId,next.turnPlayerId);
  assert.equal(next.hands[next.turnPlayerId].length,22);
  assert.ok(next.players.filter(player=>player.id!==next.turnPlayerId).every(player=>next.hands[player.id].length===21));
  assert.equal(next.stock.length,20);
  assert.throws(()=>startNewMatch({...previous,status:'round-end'},next.settings));
});

test('oyuncu kartındaki rozetler maç sonu elini hariç tutup iki dengeli sıraya bölünür',()=>{
  const badges=Array.from({length:11},(_,index)=>({round:index+1,playerId:'p0',place:(index%4+1) as 1|2|3|4}));
  for(const [rounds,rowSize] of [[3,1],[5,2],[7,3],[11,5]] as const){
    const rows=visibleMatchBadgeRows(badges,rounds);
    assert.deepEqual(rows.map(row=>row.length),[rowSize,rowSize]);
    assert.deepEqual(rows.flat().map(badge=>badge.round),Array.from({length:rounds-1},(_,index)=>index+1));
  }
});

test('seri başına birinci ve ikinci taş sırayla eklenir; üçüncü taş reddedilir',()=>{
  const hand=[tile(95001,'red',3),tile(95002,'red',2),tile(95003,'red',1),tile(95004,'black',1),tile(95005,'black',2),tile(95006,'black',3)];
  const state=openedRunState(hand,'head-limit');
  const first=addToMeld(state,'p0',95001,'run-p1','head','head-limit','head-one');
  assert.deepEqual(first.melds[0].tiles.map(member=>member.number),[3,4,5,6,7]);
  const second=addToMeld(first,'p0',95002,'run-p1','head','head-limit','head-two');
  assert.deepEqual(second.melds[0].tiles.map(member=>member.number),[2,3,4,5,6,7]);
  assert.equal(second.meldLayUsage.find(entry=>entry.side==='head')?.count,2);
  assert.throws(()=>addToMeld(second,'p0',95003,'run-p1','head','head-limit','head-three'),/baş limiti doldu/);
  assert.equal(second.hands.p0.some(member=>member.id===95003),true);
});

test('işleme hedefleri sunucu kurallarına göre yalnızca geçerli seri uçları için yayınlanır',()=>{
  const state=openedRunState([tile(95091,'red',3),tile(95092,'red',8),tile(95093,'blue',5)],'targets-run');
  const targets=availableMeldProcessingTargets(state,'p0',10_000).map(({tileId,meldId,target})=>({tileId,meldId,target}));
  assert.deepEqual(targets,[
    {tileId:95091,meldId:'run-p1',target:'head'},
    {tileId:95092,meldId:'run-p1',target:'tail'},
  ]);
  assert.deepEqual(publicGame(state,'p0',10_000).meldProcessingTargets,targets);
  assert.deepEqual(publicGame(state,'p1',10_000).meldProcessingTargets,[]);
  assert.deepEqual(availableMeldProcessingTargets({...state,phase:'draw'},'p0',10_000),[]);
});

test('renk grubunda yalnızca eksik renge uyan taş için grup hedefi yayınlanır',()=>{
  const state=openedRunState([tile(95094,'yellow',7),tile(95095,'red',7)],'targets-colors');
  const group=[tile(95096,'red',7),tile(95097,'blue',7),tile(95098,'black',7)];
  state.melds=[{id:'color-group',ownerId:'p1',kind:'group',tiles:group,tileIds:group.map(member=>member.id),realOkeyAssignments:{}}];
  assert.deepEqual(availableMeldProcessingTargets(state,'p0',10_000),[
    {tileId:95094,meldId:'color-group',target:'group'},
  ]);
});

test('gerçek okeyli çiftte yalnızca temsil edilen doğal taş için geri alma hedefi yayınlanır',()=>{
  const state=openedPairState([tile(95099,'red',6),tile(95100,'blue',6),{id:95101,color:null,number:null,fakeJoker:true}],'targets-pair');
  assert.deepEqual(availableMeldProcessingTargets(state,'p0',10_000),[
    {tileId:95099,meldId:'pair-p1',target:'reclaim-okey',realOkeyTileId:94102},
  ]);
});

test('seri sonuna aynı turda iki taş eklenebilir ve üçüncü reddedilir',()=>{
  const state=openedRunState([tile(95101,'red',8),tile(95102,'red',9),tile(95103,'red',10),tile(95104,'black',1),tile(95105,'black',2),tile(95106,'black',3)],'tail-limit');
  const first=addToMeld(state,'p0',95101,'run-p1','tail','tail-limit','tail-one');
  const second=addToMeld(first,'p0',95102,'run-p1','tail','tail-limit','tail-two');
  assert.deepEqual(second.melds[0].tiles.map(member=>member.number),[4,5,6,7,8,9]);
  assert.throws(()=>addToMeld(second,'p0',95103,'run-p1','tail','tail-limit','tail-three'),/son limiti doldu/);
});

test('seri baş ve son limitleri birbirinden bağımsız takip edilir',()=>{
  const state=openedRunState([tile(95201,'red',3),tile(95202,'red',8),tile(95203,'black',1),tile(95204,'black',2)],'both-ends');
  const head=addToMeld(state,'p0',95201,'run-p1','head','both-ends','both-head');
  const tail=addToMeld(head,'p0',95202,'run-p1','tail','both-ends','both-tail');
  assert.equal(tail.meldLayUsage.find(entry=>entry.side==='head')?.count,1);
  assert.equal(tail.meldLayUsage.find(entry=>entry.side==='tail')?.count,1);
});

test('yeni turda işleme limitleri sıfırlanır ve önceki oyuncunun sayacı diğer oyuncuyu etkilemez',()=>{
  const state=openedRunState([tile(95301,'red',3),tile(95302,'red',2),tile(95303,'red',1),tile(95304,'black',1),tile(95305,'black',2)],'turn-p0');
  const two=addToMeld(addToMeld(state,'p0',95301,'run-p1','head','turn-p0','p0-head-1'),'p0',95302,'run-p1','head','turn-p0','p0-head-2');
  const nextTurn=startTurnClock({...two,turnPlayerId:'p1',phase:'discard',players:two.players.map(player=>player.id==='p1'?{...player,opened:true}:player),hands:{...two.hands,p1:[tile(95311,'red',1),tile(95312,'red',2),tile(95313,'black',1)]}},2_000,'turn-p1');
  assert.deepEqual(nextTurn.meldLayUsage,[]);
  const other=addToMeld(nextTurn,'p1',95311,'run-p1','head','turn-p1','p1-head-1');
  assert.equal(other.meldLayUsage.find(entry=>entry.playerId==='p1'&&entry.side==='head')?.count,1);
});

test('1-2-3 serisinin başına 13 ekleyerek 13→1 geçişi yapılamaz',()=>{
  const state=openedRunState([tile(95401,'blue',13),tile(95402,'black',1),tile(95403,'black',2)],'no-wrap');
  state.melds=[{id:'blue-low-run',ownerId:'p1',kind:'run',tiles:[tile(95411,'blue',1),tile(95412,'blue',2),tile(95413,'blue',3)],tileIds:[95411,95412,95413],realOkeyAssignments:{}}];
  assert.throws(()=>addToMeld(state,'p0',95401,'blue-low-run','head','no-wrap','no-wrap-attempt'),/başına bu taş eklenemez/);
  assert.equal(state.hands.p0.some(member=>member.id===95401),true);
});

test('aynı sayı grubuna eksik renk eklenir; tekrar renk ve beşinci taş reddedilir',()=>{
  const state=openedRunState([tile(95501,'yellow',9),tile(95502,'red',9),tile(95503,'black',9),tile(95504,'blue',9),tile(95505,'yellow',9)],'color-group');
  state.melds=[{id:'number-group',ownerId:'p1',kind:'group',tiles:[tile(95511,'red',9),tile(95512,'blue',9),tile(95513,'black',9)],tileIds:[95511,95512,95513],realOkeyAssignments:{}}];
  const added=addToMeld(state,'p0',95501,'number-group','group','color-group','missing-yellow');
  assert.deepEqual(new Set(added.melds[0].tiles.map(member=>member.color)),new Set(['red','blue','black','yellow']));
  assert.throws(()=>addToMeld(added,'p0',95502,'number-group','group','color-group','duplicate-red'),/geçerli biçimde işlenemez/);
  assert.throws(()=>addToMeld(added,'p0',95503,'number-group','group','color-group','fifth-color'),/geçerli biçimde işlenemez/);
});

test('aynı renkli tekrar taş aynı sayı grubuna eklenemez',()=>{
  const state=openedRunState([tile(95601,'red',5),tile(95602,'black',1),tile(95603,'black',2)],'duplicate-color');
  state.melds=[{id:'red-blue-black',ownerId:'p1',kind:'group',tiles:[tile(95611,'red',9),tile(95612,'blue',9),tile(95613,'black',9)],tileIds:[95611,95612,95613],realOkeyAssignments:{}}];
  assert.throws(()=>addToMeld(state,'p0',95601,'red-blue-black','group','duplicate-color','duplicate-color-attempt'));
});

test('gerçek okeyli seri açılırken temsil ettiği doğal yüz Meld verisinde sabitlenir',()=>{
  const state=playingRoom();state.joker={color:'yellow',number:8};
  const real=tile(95703,'yellow',8),groups=[
    [tile(95701,'red',5),real,tile(95702,'red',7)],
    [tile(95704,'blue',5),tile(95705,'blue',6),tile(95706,'blue',7),tile(95707,'blue',8)],
    [tile(95708,'black',9),tile(95709,'black',10),tile(95710,'black',11),tile(95711,'black',12)],
    [tile(95712,'red',9),tile(95713,'red',10),tile(95714,'red',11),tile(95715,'red',12)],
  ];
  state.hands.p0=[...groups.flat(),tile(95716,'black',1)];
  const opened=openSeriesMelds(state,'p0',groups.map(group=>group.map(member=>member.id)));
  assert.deepEqual(opened.melds[0].realOkeyAssignments?.[real.id],{color:'red',number:6});
});

test('gerçek okeyin yanlış temsil yüzüyle geri alınması reddedilir ve durum değişmez',()=>{
  const state=openedRunState([tile(95801,'red',9),tile(95802,'black',1)],'wrong-face');
  const real=tile(95811,'yellow',8),tiles=[tile(95810,'red',5),real,tile(95812,'red',7)];
  state.melds=[{id:'joker-run',ownerId:'p1',kind:'run',tiles,tileIds:tiles.map(member=>member.id),realOkeyAssignments:{[real.id]:{color:'red',number:6}}}];
  const before=JSON.stringify(state);
  assert.throws(()=>reclaimRealOkey(state,'p0','joker-run',real.id,95801,'wrong-face','wrong-face-request'),/eşleşmiyor/);
  assert.equal(JSON.stringify(state),before);
});

test('gerçek okey doğru taşla geri alınır, yerine doğal taş geçer ve joker oyuncunun eline döner',()=>{
  const state=openedRunState([tile(95901,'red',6),tile(95902,'black',1)],'reclaim-run');
  const real=tile(95911,'yellow',8),run=[tile(95910,'red',5),real,tile(95912,'red',7)];
  state.melds=[{id:'joker-run',ownerId:'p1',kind:'run',tiles:run,tileIds:run.map(member=>member.id),realOkeyAssignments:{[real.id]:{color:'red',number:6}}}];
  const next=reclaimRealOkey(state,'p0','joker-run',real.id,95901,'reclaim-run','reclaim-okey-once');
  assert.equal(next.hands.p0.some(member=>member.id===real.id),true);
  assert.deepEqual(next.melds[0].tileIds,[95910,95901,95912]);
  assert.deepEqual(next.melds[0].realOkeyAssignments,{});
  assert.deepEqual(next.melds[0].tiles.map(member=>member.number),[5,6,7]);
});

test('gerçek okey geri alma cezası yalnızca açılmış grubun sahibine bir kez eklenir',()=>{
  const state=openedRunState([tile(96001,'red',6),tile(96002,'black',1)],'reclaim-penalty');
  const real=tile(96011,'yellow',8),run=[tile(96010,'red',5),real,tile(96012,'red',7)];
  state.melds=[{id:'joker-run',ownerId:'p1',kind:'run',tiles:run,tileIds:run.map(member=>member.id),realOkeyAssignments:{[real.id]:{color:'red',number:6}}}];
  const next=reclaimRealOkey(state,'p0','joker-run',real.id,96001,'reclaim-penalty','reclaim-penalty-once');
  assert.equal(next.players.find(player=>player.id==='p1')?.score,101);
  assert.equal(next.players.find(player=>player.id==='p0')?.score,0);
  assert.equal(next.realOkeyReclaimPenalties.length,1);
  assert.equal(next.realOkeyReclaimPenalties[0].points,101);
  const duplicate=reclaimRealOkey(next,'p0','joker-run',real.id,96001,'reclaim-penalty','reclaim-penalty-once');
  assert.equal(duplicate, next);
  assert.equal(duplicate.players.find(player=>player.id==='p1')?.score,101);
});

test('gerçek okey geri alındıktan sonra alan oyuncu okeyi elinde tutabilir',()=>{
  const state=openedRunState([tile(96101,'red',6),tile(96102,'black',1),tile(96103,'black',2)],'keep-reclaimed');
  const real=tile(96111,'yellow',8),run=[tile(96110,'red',5),real,tile(96112,'red',7)];
  state.melds=[{id:'joker-run',ownerId:'p1',kind:'run',tiles:run,tileIds:run.map(member=>member.id),realOkeyAssignments:{[real.id]:{color:'red',number:6}}}];
  const next=reclaimRealOkey(state,'p0','joker-run',real.id,96101,'keep-reclaimed','keep-reclaimed-okey');
  assert.equal(next.hands.p0.find(member=>member.id===real.id)?.id,real.id);
  assert.equal(next.hands.p0.length,3);
});

test('sahte okey gerçek okey gibi geri alınamaz',()=>{
  const state=openedRunState([tile(96201,'red',6),tile(96202,'black',1)],'fake-not-reclaimable');
  const fake:Tile={id:96211,color:null,number:null,fakeJoker:true},tiles=[tile(96210,'red',5),fake,tile(96212,'red',7)];
  state.melds=[{id:'fake-run',ownerId:'p1',kind:'run',tiles,tileIds:tiles.map(member=>member.id),realOkeyAssignments:{}}];
  assert.throws(()=>reclaimRealOkey(state,'p0','fake-run',fake.id,96201,'fake-not-reclaimable','fake-attempt'),/gerçek okey yok; sahte okey geri alınamaz/);
});

test('normal çiftlere üçüncü taş eklenemez',()=>{
  const state=openedPairState([tile(96301,'red',6),tile(96302,'black',1),tile(96303,'black',2)],'pair-no-third');
  assert.throws(()=>addToMeld(state,'p0',96301,'pair-p1','auto','pair-no-third','pair-third-attempt'),/Bu pere taş işlenemez/);
});

test('gerçek okeyli çiftte temsil edilen doğal taş okeyin yerini alır ve çift iki taşlı kalır',()=>{
  const state=openedPairState([tile(96401,'red',6),tile(96402,'black',1)],'pair-reclaim');
  const next=reclaimRealOkey(state,'p0','pair-p1',94102,96401,'pair-reclaim','pair-reclaim-once');
  assert.equal(next.melds[0].tiles.length,2);
  assert.deepEqual(next.melds[0].tiles.map(member=>[member.color,member.number]),[['red',6],['red',6]]);
  assert.equal(next.hands.p0.some(member=>member.id===94102),true);
  assert.equal(next.players.find(player=>player.id==='p1')?.score,101);
});

test('iki gerçek okeyli çiftte geri alma taşı temsil yüzünü belirler ve kalan jokerin atamasını saklar',()=>{
  const natural=tile(96411,'blue',9),jokerOne=tile(96412,'yellow',8),jokerTwo=tile(96413,'yellow',8);
  const state=openedPairState([natural,tile(96414,'black',1)],'double-joker-pair-reclaim');
  state.melds=[{id:'pair-p1',ownerId:'p1',kind:'pairs',tiles:[jokerOne,jokerTwo],tileIds:[jokerOne.id,jokerTwo.id],realOkeyAssignments:{}}];
  const next=reclaimRealOkey(state,'p0','pair-p1',jokerOne.id,natural.id,'double-joker-pair-reclaim','double-joker-pair');
  assert.ok(next.hands.p0.some(member=>member.id===jokerOne.id));
  assert.deepEqual(next.melds[0].tileIds,[natural.id,jokerTwo.id]);
  assert.deepEqual(next.melds[0].realOkeyAssignments?.[jokerTwo.id],{color:'blue',number:9});
});

test('taş çekme aşamasında ve başka oyuncunun sırasında işleme yapılamaz',()=>{
  const state=openedRunState([tile(96501,'red',3),tile(96502,'black',1)],'wrong-phase');
  assert.throws(()=>addToMeld({...state,phase:'draw'},'p0',96501,'run-p1','head','wrong-phase','phase-error'),/Önce taş çekmelisiniz/);
  assert.throws(()=>addToMeld({...state,turnPlayerId:'p1'},'p0',96501,'run-p1','head','wrong-phase','wrong-actor'),/Önce taş çekmelisiniz/);
});

test('alınan atık taş kullanılmadan seri açılışı yapılamaz ve ret durumu değişmez',()=>{
  const state=playingRoom(),selection=serialHand(101,96600),discarded=tile(96750,'blue',4);
  state.hands.p0=selection.hand.filter(member=>member.id!==selection.groups[0][0].id);
  const taken=withTakenDiscard(state,discarded,'must-use-opening');
  const before=JSON.stringify(taken);
  assert.throws(()=>openSeriesMelds(taken,'p0',selection.groups.slice(1).map(group=>group.map(member=>member.id))),/Soldan aldığınız taşı aynı turda açılışta/);
  assert.equal(JSON.stringify(taken),before);
});

test('soldan alınan taş seri açılış grubunda kullanılırsa açılış tamamlanır',()=>{
  const state=playingRoom();
  const indicator=state.indicator;
  assert.ok(indicator);
  state.indicator={...indicator,color:'blue',number:4};
  state.joker={color:'blue',number:5};
  const discarded=tile(96800,'red',12);
  const groups=[
    [tile(96801,'red',10),tile(96802,'red',11),discarded],
    [tile(96803,'blue',10),tile(96804,'blue',11),tile(96805,'blue',12),tile(96806,'blue',13)],
    [tile(96807,'black',9),tile(96808,'black',10),tile(96809,'black',11),tile(96810,'black',12)],
    [tile(96811,'yellow',9),tile(96812,'yellow',10),tile(96813,'yellow',11),tile(96814,'yellow',12)],
  ];
  state.hands.p0=[...groups.flat().filter(member=>member.id!==discarded.id),tile(96815,'black',1)];
  const taken=withTakenDiscard(state,discarded,'must-use-serial');
  const next=openSeriesMelds(taken,'p0',groups.map(group=>group.map(member=>member.id)));
  assert.equal(next.takenDiscardUse?.used,true);
  assert.equal(next.hands.p0.some(member=>member.id===discarded.id),false);
  assert.equal(next.melds.some(meld=>meld.tileIds.includes(discarded.id)),true);
});

test('soldan alınan taş çift açılışta kullanılırsa açılış tamamlanır',()=>{
  const state=playingRoom(),discarded=tile(96900,'red',1);
  state.joker={color:'black',number:13};
  const pairs=[[discarded,tile(96901,'red',1)],[tile(96902,'blue',2),tile(96903,'blue',2)],[tile(96904,'black',3),tile(96905,'black',3)],[tile(96906,'yellow',4),tile(96907,'yellow',4)],[tile(96908,'red',5),tile(96909,'red',5)]];
  state.hands.p0=[...pairs.flat().filter(member=>member.id!==discarded.id),tile(96910,'black',13)];
  const taken=withTakenDiscard(state,discarded,'must-use-pair');
  const next=openMelds(taken,'p0',pairs.map(pair=>pair.map(member=>member.id)),true);
  assert.equal(next.takenDiscardUse?.used,true);
  assert.equal(next.melds.some(meld=>meld.tileIds.includes(discarded.id)),true);
});

test('önceden seri açmış oyuncu soldan aldığı taşı eşiksiz yeni seri indirmesinde kullanabilir',()=>{
  const state=playingRoom(),selection=serialHand(101,96930),discarded=selection.groups[0][0];
  state.players=state.players.map(player=>player.id==='p0'?{...player,opened:true}:player);
  state.hands.p0=selection.hand.filter(member=>member.id!==discarded.id);
  const taken=withTakenDiscard(state,discarded,'opened-taken-series');
  const next=layNewSeriesMelds(taken,'p0',selection.groups.map(group=>group.map(member=>member.id)),taken.turnId||undefined,'opened-taken-series-lay');
  assert.equal(next.takenDiscardUse?.used,true);
  assert.equal(next.melds.some(meld=>meld.tileIds.includes(discarded.id)),true);
});

test('önceden seri açmış oyuncu, masada çift açılışı varken soldan aldığı taşı çift indirmesinde kullanabilir',()=>{
  const state=playingRoom(),pairs=usePairHand(state,'p0',5,96960),discarded=pairs[0][0];
  state.players=state.players.map(player=>player.id==='p0'?{...player,opened:true}:player.id==='p2'?{...player,opened:true,pairMode:true}:player);
  state.hands.p0=state.hands.p0.filter(member=>member.id!==discarded.id);
  const taken=withTakenDiscard(state,discarded,'opened-taken-pairs');
  const next=layNewPairMelds(taken,'p0',pairs.map(pair=>pair.map(member=>member.id)),taken.turnId||undefined,'opened-taken-pairs-lay');
  assert.equal(next.takenDiscardUse?.used,true);
  assert.equal(next.melds.some(meld=>meld.tileIds.includes(discarded.id)),true);
});

test('masadaki seriye eklenebilen işlek taş soldan alınamaz ve oyun durumu değişmez',()=>{
  const discarded=tile(97001,'red',3),state=openedRunState([tile(97002,'black',1),tile(97003,'black',2)],'must-use-lay');
  const timed=assertCourtesyRejectsWithoutMutation(state,discarded,'must-use-lay');
  assert.deepEqual(timed.melds[0].tiles.map(member=>member.number),[4,5,6,7]);
});

test('soldan alınan taş kullanılmadan başka taşı işleme veya tur tamamlama reddedilir',()=>{
  const state=openedRunState([tile(97101,'red',3),tile(97102,'black',1),tile(97103,'black',2)],'must-use-before-other');
  const taken=withTakenDiscard({...state,phase:'draw'},tile(97110,'blue',13),'must-use-before-other');
  assert.throws(()=>addToMeld(taken,'p0',97101,'run-p1','head','must-use-before-other','other-tile-first'),/Soldan aldığınız taşı bu işlemde kullanmalısınız/);
  assert.throws(()=>discardTile(taken,'p0',97101),/Soldan aldığınız taşı aynı turda/);
});

test('GERİ BIRAK alınan taşı atan oyuncunun alanına döndürür ve stoktan yeniden çekmeye izin verir',()=>{
  const state=playingRoom(),discarded=tile(97201,'blue',4),taken=withTakenDiscard(state,discarded,'return-discard-test');
  const returned=returnTakenDiscard(taken,'p0');
  assert.equal(returned.phase,'draw');
  assert.equal(returned.takenDiscardUse,null);
  assert.equal(returned.hands.p0.some(member=>member.id===discarded.id),false);
  assert.equal(returned.throwsByPlayer.p3.at(-1)?.id,discarded.id);
  const drawn=drawStock(returned,'p0');
  assert.equal(drawn.phase,'discard');
});

test('açılış geri alındığında alınan taş zorunluluğu ve GERİ BIRAK hakkı geri yüklenir',()=>{
  const state=playingRoom(),discarded=tile(97300,'red',12),groups=[
    [tile(97301,'red',10),tile(97302,'red',11),discarded],
    [tile(97303,'blue',10),tile(97304,'blue',11),tile(97305,'blue',12),tile(97306,'blue',13)],
    [tile(97307,'black',9),tile(97308,'black',10),tile(97309,'black',11),tile(97310,'black',12)],
    [tile(97311,'yellow',9),tile(97312,'yellow',10),tile(97313,'yellow',11),tile(97314,'yellow',12)],
  ];
  state.joker={color:'black',number:13};
  state.hands.p0=[...groups.flat().filter(member=>member.id!==discarded.id),tile(97315,'black',1)];
  const taken=withTakenDiscard(state,discarded,'undo-taken-open'),opened=openSeriesMelds(taken,'p0',groups.map(group=>group.map(member=>member.id)));
  const undone=undoOpenMelds(opened,'p0');
  assert.equal(undone.takenDiscardUse?.used,false);
  assert.equal(undone.discardTakeUndo?.tileId,discarded.id);
  assert.equal(returnTakenDiscard(undone,'p0').phase,'draw');
});

test('işleme isteği tekrar gönderilince aynı state döner; aynı kimlikle farklı hamle reddedilir',()=>{
  const state=openedRunState([tile(97401,'red',3),tile(97402,'red',8),tile(97403,'black',1),tile(97404,'black',2)],'replay-lay');
  const next=addToMeld(state,'p0',97401,'run-p1','head','replay-lay','same-lay-request');
  assert.equal(addToMeld(next,'p0',97401,'run-p1','head','replay-lay','same-lay-request'),next);
  assert.throws(()=>addToMeld(next,'p0',97402,'run-p1','tail','replay-lay','same-lay-request'),/başka bir işlemde kullanıldı/);
});

test('başarılı seri işlemi oyuncunun aynı turdaki baş ve son hakkını yalnızca ilgili uca yazar',()=>{
  const state=openedRunState([tile(97501,'red',3),tile(97502,'red',8),tile(97503,'black',1),tile(97504,'black',2)],'turn-count-sides');
  const next=addToMeld(addToMeld(state,'p0',97501,'run-p1','head','turn-count-sides','count-head'),'p0',97502,'run-p1','tail','turn-count-sides','count-tail');
  assert.deepEqual(next.meldLayUsage.map(entry=>[entry.playerId,entry.meldId,entry.side,entry.count]),[['p0','run-p1','head',1],['p0','run-p1','tail',1]]);
});

test('gerçek okey içeren grupta sabitlenmiş renk dolu kabul edilir; yalnızca eksik renk eklenir',()=>{
  const state=openedRunState([tile(97601,'yellow',9),tile(97602,'red',1),tile(97603,'blue',1)],'joker-group-color');
  const real=tile(97611,'yellow',8),group=[tile(97610,'red',9),tile(97612,'blue',9),real];
  state.melds=[{id:'joker-color-group',ownerId:'p1',kind:'group',tiles:group,tileIds:group.map(member=>member.id),realOkeyAssignments:{[real.id]:{color:'black',number:9}}}];
  const next=addToMeld(state,'p0',97601,'joker-color-group','group','joker-group-color','add-yellow');
  assert.deepEqual(new Set(next.melds[0].tiles.map(member=>member.color)),new Set(['red','blue','yellow','yellow']));
  assert.throws(()=>addToMeld(next,'p0',97602,'joker-color-group','group','joker-group-color','add-black-fifth'),/geçerli biçimde işlenemez/);
});

test('zaman aşımındaki işlek taşı tanıma seri başı, seri sonu ve renk grubu işleme olanağını kapsar',()=>{
  const cases:[Tile,string,Meld][]=[
    [tile(97701,'red',3),'run-head',{id:'run-p1',ownerId:'p1',kind:'run',tiles:[tile(97711,'red',4),tile(97712,'red',5),tile(97713,'red',6)],tileIds:[97711,97712,97713],realOkeyAssignments:{}}],
    [tile(97702,'red',7),'run-tail',{id:'run-p1',ownerId:'p1',kind:'run',tiles:[tile(97711,'red',4),tile(97712,'red',5),tile(97713,'red',6)],tileIds:[97711,97712,97713],realOkeyAssignments:{}}],
    [tile(97703,'yellow',9),'group',{id:'group-p1',ownerId:'p1',kind:'group',tiles:[tile(97721,'red',9),tile(97722,'blue',9),tile(97723,'black',9)],tileIds:[97721,97722,97723],realOkeyAssignments:{}}],
  ];
  for(const [candidate,label,meld] of cases){
    const state=openedRunState([candidate,tile(candidate.id+100,'black',1)],`timeout-${label}`);
    state.melds=[meld];
    const timed=startTurnClock(state,1_000,`timeout-${label}`),next=autoPlayTimedOutTurn(timed,`timeout-${label}`,46_000,()=>0)!;
    assert.equal(next.players.find(player=>player.id==='p0')?.score,101,`${label} taşının işlekliği ceza hesabında tanınmalı`);
  }
});

test('timeout işlek taş cezası sürer ve çift açmış oyuncu masadaki işlek atığı alamaz',()=>{
  const hand=[tile(97731,'red',3),tile(97732,'black',1)];
  const state=openedRunState(hand,'timeout-pair-processor');
  state.players=state.players.map(player=>player.id==='p0'?{...player,pairMode:true}:player);
  const timed=startTurnClock(state,1_000,'timeout-pair-processor');
  assert.deepEqual(availableMeldProcessingTargets(timed,'p0',45_999).map(target=>[target.tileId,target.meldId,target.target]),[[97731,'run-p1','head']]);
  const penalty=autoPlayTimedOutTurn(timed,'timeout-pair-processor',46_000,()=>0)!;
  assert.equal(penalty.players.find(player=>player.id==='p0')?.score,101,'işlenebilir taş çift açmış oyuncu için de işlek sayılmalı');
  assert.equal(penalty.discard.at(-1)?.id,97731,'timeout ceza senaryosu işlek taşı gerçekten atmalı');
  assert.equal(penalty.penaltyHistory?.at(-1)?.reason,'timeout');

  const takenBase=openedRunState([tile(97734,'black',1),tile(97735,'blue',2)],'timeout-pair-process-taken');
  takenBase.players=takenBase.players.map(player=>player.id==='p0'?{...player,pairMode:true}:player);
  const discarded=tile(97733,'red',3);
  assertCourtesyRejectsWithoutMutation(takenBase,discarded,'timeout-pair-process-taken');
});

test('zaman aşımı gerçek okeyi olan bir çifti değiştirebilecek doğal taşı işlek sayar',()=>{
  const natural=tile(97801,'red',6),state=openedPairState([natural,tile(97802,'black',1)],'timeout-pair-reclaim');
  const next=autoPlayTimedOutTurn(state,'timeout-pair-reclaim',46_000,()=>0)!;
  assert.equal(next.players.find(player=>player.id==='p0')?.score,101);
});

test('reddedilen işlek atık timeout sırasında atıkta kalır ve otomatik tur güvenle tamamlanır',()=>{
  const discarded=tile(97903,'red',3),state=openedRunState([tile(97901,'black',1),tile(97902,'black',2)],'timeout-use-taken');
  const timed=assertCourtesyRejectsWithoutMutation(state,discarded,'timeout-use-taken');
  const next=autoPlayTimedOutTurn(timed,'timeout-use-taken',46_000,()=>0)!;
  assert.equal(next.throwsByPlayer.p3.at(-1)?.id,discarded.id,'yasaklı taş önceki oyuncunun atık kaydında kalmalı');
  assert.equal(next.discard.some(member=>member.id===discarded.id),true,'yasaklı taş masadaki atık alanında kalmalı');
  assert.equal(next.hands.p0.some(member=>member.id===discarded.id),false,'yasaklı taş oyuncunun eline geçmemeli');
  assert.deepEqual(next.melds[0].tiles.map(member=>member.number),[4,5,6,7],'timeout yasaklı taşı seriye işlememeli');
  assert.equal(next.takenDiscardUse,null);
  assert.equal(next.hands.p0.length,2,'stoktan çekme ve otomatik atma eli tutarlı bırakmalı');
  assert.equal(next.turnPlayerId,'p1','otomatik tur sonraki oyuncuya geçmeli');
  assert.equal(next.phase,'draw');
  assert.equal(next.turnId,null,'tamamlanan timeout eski tur saatini taşımamalı');
});

test('zaman aşımında kullanılmayan soldan taş geri bırakılır, stoktan çekilir ve elde tutulmaz',()=>{
  const state=openedRunState([tile(98001,'black',1),tile(98002,'black',2)],'timeout-return-taken');
  const discarded=tile(98003,'yellow',1),taken=withTakenDiscard(state,discarded,'timeout-return-taken');
  const next=autoPlayTimedOutTurn(taken,'timeout-return-taken',46_000,()=>0)!;
  assert.equal(next.throwsByPlayer.p3.some(member=>member.id===discarded.id),true);
  assert.equal(next.hands.p0.some(member=>member.id===discarded.id),false);
  assert.equal(next.stock.length,taken.stock.length-1);
  assert.equal(next.takenDiscardUse,null);
});

test('yeni elde işleme limitleri, tekrar istek kaydı ve okey geri alma ceza geçmişi sıfırlanır',()=>{
  const state=playingRoom();state.status='match-end';state.round=state.settings.rounds;
  state.players=state.players.map(player=>({...player,opened:true}));
  state.meldLayUsage=[{turnId:'old',playerId:'p0',meldId:'old-meld',side:'head',count:1}];
  state.processedMeldActions=[{turnId:'old',playerId:'p0',requestId:'old-request',fingerprint:'lay'}];
  state.realOkeyReclaimPenalties=[{round:1,turnId:'old',requestId:'old-reclaim',actorId:'p0',ownerId:'p1',meldId:'old-meld',realOkeyTileId:1,replacementTileId:2,points:101}];
  const next=startNewMatch(state,{...state.settings,rounds:3});
  assert.deepEqual(next.meldLayUsage,[]);
  assert.deepEqual(next.processedMeldActions,[]);
  assert.deepEqual(next.realOkeyReclaimPenalties,[]);
  assert.equal(next.takenDiscardUse,null);
});

test('geçersiz işleme hiçbir el, per, puan veya limit verisini değiştirmez',()=>{
  const state=openedRunState([tile(98101,'blue',3),tile(98102,'black',1)],'invalid-atomic');
  const before=JSON.stringify(state);
  assert.throws(()=>addToMeld(state,'p0',98101,'run-p1','head','invalid-atomic','invalid-atomic-request'));
  assert.equal(JSON.stringify(state),before);
});

test('geçersiz açılış 101 ceza yazar, eli değiştirmez, takım puanına yansır ve aynı requestId ikinci kez cezalandırmaz',()=>{
  const state=startTurnClock(playingRoom(),10_000,'invalid-open-turn');
  state.settings={...state.settings,mode:'pairs'};
  const beforeHand=state.hands.p0.map(candidate=>candidate.id),fingerprint=JSON.stringify(['open',false,[[1,2,3]]]);
  const penalized=recordInvalidOpenAttempt(state,'p0','invalid-open-request',fingerprint,'Seçilen per geçersiz','invalid-open-turn',10_100);
  assert.equal(penalized.players.find(player=>player.id==='p0')?.score,101);
  assert.equal(penalized.players.find(player=>player.id==='p0')?.opened,false);
  assert.deepEqual(penalized.hands.p0.map(candidate=>candidate.id),beforeHand);
  assert.equal(penalized.penaltyHistory?.at(-1)?.reason,'invalid-open');
  assert.equal(calculateTeamScoreboard(penalized.players,[],1).find(team=>team.teamId===0)?.total,101);
  assert.equal(recordInvalidOpenAttempt(penalized,'p0','invalid-open-request',fingerprint,'Seçilen per geçersiz','invalid-open-turn',10_200),penalized);
  assert.equal(penalized.players.find(player=>player.id==='p0')?.score,101);
  assert.equal(publicGame(penalized,'p0').personalNotifications.at(-1)?.text.includes('101'),true);
  assert.equal(publicGame(penalized,'p1').personalNotifications.some(item=>item.text.includes('Seçilen per')),false);
  assert.equal(publicGame(penalized,'p1').penaltyHistory.some(entry=>entry.playerId==='p0'),false);
  const secondMistake=recordInvalidOpenAttempt(penalized,'p0','different-invalid-open',JSON.stringify(['open',false,[[4,5,6]]]),'Başka geçersiz per','invalid-open-turn',10_300);
  assert.equal(secondMistake.players.find(player=>player.id==='p0')?.score,202,'yeni ve bağımsız bir hatalı deneme yeni ceza oluşturabilir');
});

test('başarılı açılış isteği aynı requestId ile tekrarlandığında kayıt ve oyun işlemi çoğalmaz',()=>{
  const state=startTurnClock(playingRoom(),10_000,'success-open-turn'),fingerprint=JSON.stringify(['open',false,[[1,2,3]]]);
  const saved=recordSuccessfulOpeningAttempt(state,'p0','open-once',fingerprint,'success-open-turn');
  assert.equal(saved.processedOpeningAttempts?.length,1);
  assert.equal(recordSuccessfulOpeningAttempt(saved,'p0','open-once',fingerprint,'success-open-turn'),saved);
  assert.throws(()=>recordSuccessfulOpeningAttempt(saved,'p0','open-once','different','success-open-turn'),/başka bir işlemde kullanıldı/);
});

test('elden bitiş geçerli grupları ve son taşı tek işlemde doğrular, puanlar ve 30 saniye herkese açık el gösterir',()=>{
  const state=playingRoom(),selection=serialHand(101,98200),finalTile=tile(98299,'black',1);
  state.joker={color:'black',number:13};
  state.hands.p0=[...selection.groups.flat(),finalTile];
  const originalHands=Object.fromEntries(state.players.map(player=>[player.id,[...(state.hands[player.id]||[])]]));
  const timed=startTurnClock(state,2_000,'elden-turn'),requestId='elden-once',groups=selection.groups.map(group=>group.map(candidate=>candidate.id));
  assert.equal(publicGame(timed,'p1',2_999).revealedHands,null,'normal oyun sırasında rakip elleri gizli kalmalı');
  const ended=finishFromHand(timed,'p0',groups,finalTile.id,false,requestId,3_000);
  assert.equal(ended.status,'round-end');
  assert.equal(ended.roundFinishKind,'elden');
  assert.equal(ended.roundFinisherId,'p0');
  assert.equal(ended.hands.p0.length,0);
  assert.equal(ended.discard.at(-1)?.id,finalTile.id);
  assert.equal(ended.melds.length,3);
  assert.equal(ended.players.find(player=>player.id==='p0')?.score,-202);
  assert.equal(ended.players.find(player=>player.id==='p1')?.score,404);
  assert.equal(ended.roundRevealUntilAt,33_000);
  for(const viewer of ended.players){
    const publicState=publicGame(ended,viewer.id,32_999);
    assert.deepEqual(publicState.revealedHands,ended.revealedHands,'her oyuncu aynı el gösterimini görmeli');
    for(const other of ended.players){
      if(other.id==='p0')continue;
      assert.deepEqual(publicState.revealedHands?.[other.id],originalHands[other.id],`${other.id} eli ${viewer.id} için açılmalı`);
    }
    assert.equal(publicState.revealedHands?.p0.length,0,'biten oyuncunun taşları açılmış perlerde ve atılan son taşta görünür');
    const finisherMeldIds=publicState.melds.filter(meld=>meld.ownerId==='p0').flatMap(meld=>meld.tileIds);
    const finisherVisibleIds=[...finisherMeldIds,finalTile.id];
    assert.equal(new Set(finisherVisibleIds).size,originalHands.p0.length,'biten oyuncunun her taşı perlerde veya son atıkta yalnızca bir kez bulunmalı');
    assert.deepEqual([...finisherVisibleIds].sort((a,b)=>a-b),originalHands.p0.map(tile=>tile.id).sort((a,b)=>a-b),'bitiş eli açılmış perler ve son atılan taş olarak eksiksiz gösterilmeli');
    const visibleIds=new Set([...publicState.melds.flatMap(meld=>meld.tileIds),...publicState.discard.map(discarded=>discarded.id)]);
    assert.ok(groups.flat().every(id=>visibleIds.has(id)));
    assert.ok(visibleIds.has(finalTile.id));
  }
  assert.equal(publicGame(ended,'p1',33_000).revealedHands,null);
  assert.equal(finishFromHand(ended,'p0',groups,finalTile.id,false,requestId,4_000),ended,'tekrar gelen bitiş aynı sonucu ikinci kez puanlamamalı');
  const invalid={...timed,hands:{...timed.hands,p0:[...selection.groups.flat(),finalTile,tile(98298,'yellow',1)]}};
  assert.throws(()=>finishFromHand(invalid,'p0',groups,finalTile.id,false,'elden-invalid',3_000),/bütün taşlar geçerli gruplarda kullanılmalı/);
  assert.equal(invalid.players.find(player=>player.id==='p0')?.opened,false);
});

test('merkezi el puanlama tablosu tüm bitiş türlerine ve deste tükenmesine doğru uygulanır',()=>{
  const cases=[
    ['normal',[-101,202,5,18]],['okey',[-202,404,10,36]],['pair',[-202,404,10,36]],['pair-okey',[-404,808,20,72]],['elden',[-202,404,10,36]],
  ] as const;
  for(const [kind,expected] of cases){
    const state=playingRoom();state.joker={color:'black',number:13};state.players=state.players.map(player=>player.id==='p2'?{...player,opened:true}:player.id==='p3'?{...player,opened:true,pairMode:true}:player);
    const hands={p0:[],p1:[tile(98301,'red',1)],p2:[tile(98302,'red',2),tile(98303,'red',3)],p3:[tile(98304,'yellow',4),tile(98305,'yellow',5)]};
    const ended=settleRound(state,kind,'p0',hands,1_000);
    assert.deepEqual(ended.players.map(player=>player.score),expected,`${kind} puan tablosu`);
    assert.equal(ended.scoredRound,1);
    assert.equal(settleRound(ended,kind,'p0',hands,2_000),ended,'aynı el ikinci kez puanlanmamalı');
  }
  const state=playingRoom();state.joker={color:'black',number:13};state.players=state.players.map(player=>player.id==='p1'?{...player,opened:true}:player.id==='p2'?{...player,opened:true,pairMode:true}:player);
  const stock=settleRound(state,'stock',null,{p0:[],p1:[tile(98311,'red',2),tile(98312,'red',3)],p2:[tile(98313,'yellow',4),tile(98314,'yellow',5)],p3:[]},1_000);
  assert.deepEqual(stock.players.map(player=>player.score),[202,5,18,202]);
});

test('eşli el bitişinde partner el cezası almaz; kendi bağımsız cezası ve rakip puanları korunur',()=>{
  const state=playingRoom();state.settings={...state.settings,mode:'pairs'};state.joker={color:'black',number:13};state.players=state.players.map(player=>player.id==='p2'?{...player,opened:true,score:101}:player.id==='p3'?{...player,opened:true,pairMode:true}:player);
  state.roundScoreStart=Object.fromEntries(state.players.map(player=>[player.id,player.score]));
  const ended=settleRound(state,'normal','p0',{p0:[],p1:[tile(98401,'red',1)],p2:[tile(98402,'red',2),tile(98403,'red',3)],p3:[tile(98404,'yellow',4),tile(98405,'yellow',5)]},1_000);
  assert.deepEqual(ended.players.map(player=>player.score),[-101,202,101,18]);
  assert.equal(ended.roundScores.find(entry=>entry.playerId==='p2')?.points,0);
  const teams=calculateTeamScoreboard(ended.players,ended.roundScores,1);
  assert.equal(teams.find(team=>team.teamId===0)?.roundPoints,-101);
  assert.equal(teams.find(team=>team.teamId===0)?.total,0);
});

test('çift+okey bitişinde bireysel ve eşli oyunda çift açmış rakip x8 alır; eşlide takım çarpanı eklenmez',()=>{
  const solo=playingRoom();solo.joker={color:'black',number:13};solo.players=solo.players.map(player=>player.id==='p3'?{...player,opened:true,pairMode:true}:player);
  const hands={p0:[],p1:[],p2:[],p3:[tile(98501,'yellow',4),tile(98502,'yellow',5)]};
  const soloEnd=settleRound(solo,'pair-okey','p0',hands,1_000);
  assert.deepEqual(soloEnd.players.map(player=>player.score),[-404,808,808,72]);

  const paired=playingRoom();paired.settings={...paired.settings,mode:'pairs'};paired.joker={color:'black',number:13};
  paired.players=paired.players.map(player=>player.id==='p0'?{...player,opened:true,pairMode:true}:player.id==='p3'?{...player,opened:true,pairMode:true}:player);
  const pairedEnd=settleRound(paired,'pair-okey','p0',hands,1_000);
  assert.deepEqual(pairedEnd.players.map(player=>player.score),[-404,808,0,72]);
  const teams=calculateTeamScoreboard(pairedEnd.players,pairedEnd.roundScores,1);
  assert.equal(teams.find(team=>team.teamId===0)?.total,-404);
  assert.equal(teams.find(team=>team.teamId===1)?.total,880,'eşli takım puanına ayrıca çarpan uygulanmamalı');
});

test('elden bitişte eşli mod açmamış rakibe +404, normal açmış rakibe x2 ve çift açmış rakibe x4 uygular; partner el cezası almaz',()=>{
  const state=playingRoom();state.settings={...state.settings,mode:'pairs'};state.joker={color:'black',number:13};
  state.players=state.players.map(player=>player.id==='p2'?{...player,opened:true}:player.id==='p3'?{...player,opened:true,pairMode:true}:player);
  const hands={p0:[],p1:[],p2:[tile(98601,'red',2),tile(98602,'red',3)],p3:[tile(98603,'yellow',4),tile(98604,'yellow',5)]};
  const ended=settleRound(state,'elden','p0',hands,1_000);
  assert.deepEqual(ended.players.map(player=>player.score),[-202,404,0,36]);
  assert.equal(ended.roundScores.find(entry=>entry.playerId==='p2')?.points,0);

  const openedOpponent=playingRoom();openedOpponent.settings={...openedOpponent.settings,mode:'pairs'};openedOpponent.joker={color:'black',number:13};
  openedOpponent.players=openedOpponent.players.map(player=>player.id==='p1'||player.id==='p2'?{...player,opened:true}:player.id==='p3'?{...player,opened:true,pairMode:true}:player);
  const openedEnd=settleRound(openedOpponent,'elden','p0',{...hands,p1:[tile(98605,'red',1)],p2:hands.p2},1_000);
  assert.equal(openedEnd.players.find(player=>player.id==='p1')?.score,2,'normal açmış rakip kalan puanın x2 katını almalı');
  assert.equal(openedEnd.players.find(player=>player.id==='p2')?.score,0,'biten oyuncunun partneri el cezası almamalı');
  assert.equal(openedEnd.players.find(player=>player.id==='p3')?.score,36,'çift açmış rakip kalan puanın x4 katını almalı');
});

test('hatalı açma +101 cezası, el sonunda açmamış oyuncu +202 cezasına eklenir ve eşli takım toplamına yansır',()=>{
  const state=startTurnClock(playingRoom(),10_000,'invalid-open-end-turn');state.settings={...state.settings,mode:'pairs'};state.players=state.players.map(player=>player.id==='p2'?{...player,opened:true}:player);
  const fingerprint=JSON.stringify(['open',false,[]]);
  const penalized=recordInvalidOpenAttempt(state,'p0','invalid-open-end',fingerprint,'Seçilen per geçersiz','invalid-open-end-turn',10_100);
  const ended=settleRound(penalized,'normal','p1',{p0:penalized.hands.p0,p1:[],p2:[],p3:[]},11_000);
  assert.equal(ended.players.find(player=>player.id==='p0')?.score,303);
  assert.equal(ended.penaltyHistory?.filter(entry=>entry.round===1&&entry.playerId==='p0'&&entry.reason==='invalid-open').reduce((sum,entry)=>sum+entry.points,0),101);
  const scored=recordRoundScores(ended);
  assert.equal(scored.roundScores.find(entry=>entry.playerId==='p0')?.points,303);
  assert.equal(calculateTeamScoreboard(scored.players,scored.roundScores,1).find(team=>team.teamId===0)?.roundPoints,303);
});

test('el ve maç sonuç süreleri ile elden bitiş gösterim süresi birbirinden ayrıdır',()=>{
  assert.equal(ROUND_SUMMARY_DURATION_MS,15_000);
  assert.equal(ELDEN_REVEAL_DURATION_MS,30_000);
  assert.equal(MATCH_SUMMARY_DURATION_MS,60_000);
  assert.equal(roundSummaryDurationMs('normal'),15_000);
  assert.equal(roundSummaryDurationMs('stock'),15_000);
  assert.equal(roundSummaryDurationMs('elden'),30_000);
});
