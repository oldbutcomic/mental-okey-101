import test from 'node:test';
import assert from 'node:assert/strict';
import { discardTile, drawStock, freshRoom, openMelds, openSeriesMelds, publicGame, settleRound, takeDiscard, type GameState, type Tile } from './game';

const settings={rounds:3 as const,mode:'solo' as const,folding:false,assisted:true,tableColor:'wood' as const,turnDurationSeconds:45 as const};
const tile=(id:number,color:Tile['color'],number:number):Tile=>({id,color,number,fakeJoker:false});
function playingState():GameState{
  const state=freshRoom(settings,'match-events-test');
  state.players=[0,1,2,3].map(seat=>({id:`p${seat}`,name:`Player ${seat}`,avatar:'🙂',online:true,seat,score:0,opened:false,pairMode:false}));
  state.status='playing';state.turnPlayerId='p0';state.turnId='turn-1';state.phase='discard';state.turnStartedAt=1000;state.turnDeadlineAt=46000;
  state.joker={color:'yellow',number:2};state.hands={p0:[],p1:[],p2:[],p3:[]};state.stock=[tile(100,'yellow',1)];state.discard=[];state.throwsByPlayer={p0:[],p1:[],p2:[],p3:[]};
  return state;
}

test('draw events are public but hide the drawn tile identity from other players',()=>{
  const state=playingState();state.phase='draw';state.hands.p0=[];
  const next=drawStock(state,'p0'),own=publicGame(next,'p0'),opponent=publicGame(next,'p1');
  assert.equal(next.gameEvents?.length,1);
  assert.equal(next.gameEvents?.[0].kind,'draw-stock');
  assert.equal(next.gameEvents?.[0].tileId,100);
  assert.equal(own.gameEvents?.[0].tileId,100);
  assert.equal(opponent.gameEvents?.length,1);
  assert.equal(opponent.gameEvents?.[0].kind,'draw-stock');
  assert.equal(opponent.gameEvents?.[0].tileId,undefined);
  assert.equal(next.gameEvents?.[0].id,'match-events-test:fx:1');
});

test('taking a discard creates a public draw event while hiding its tile identity',()=>{
  const state=playingState(),discarded=tile(14,'red',5);state.phase='draw';state.discard=[discarded];state.throwsByPlayer.p3=[discarded];
  const next=takeDiscard(state,'p0');
  assert.equal(next.gameEvents?.[0].kind,'draw-discard');
  assert.equal(next.gameEvents?.[0].tileId,14);
  assert.equal(publicGame(next,'p1').gameEvents?.length,1);
  assert.equal(publicGame(next,'p1').gameEvents?.[0].tileId,undefined);
  assert.deepEqual(next.publicEvents,state.publicEvents);
});

test('a successful normal discard creates one public discard event',()=>{
  const state=playingState();state.hands.p0=[tile(20,'red',5),tile(21,'blue',8)];
  const next=discardTile(state,'p0',20);
  assert.equal(next.gameEvents?.length,1);
  assert.equal(next.gameEvents?.[0].kind,'discard');
  assert.equal(next.gameEvents?.[0].tileId,20);
  assert.equal(publicGame(next,'p3').gameEvents?.[0].id,next.gameEvents?.[0].id);
});

test('a workable or real okey discard emits one penalty effect instead of a second discard effect',()=>{
  const state=playingState();state.hands.p0=[tile(20,'red',5),tile(21,'blue',8)];
  state.melds=[{id:'m1',ownerId:'p1',kind:'run',tileIds:[30,31,32],tiles:[tile(30,'blue',4),tile(31,'blue',5),tile(32,'blue',6)]}];
  state.hands.p0[0]=tile(22,'blue',7);
  const next=discardTile(state,'p0',22);
  const effects=next.gameEvents||[];
  assert.equal(effects.length,1);
  assert.equal(effects[0].kind,'penalty');
  assert.equal(effects[0].points,101);
  assert.equal(effects[0].tileId,22);
});

test('series and pair openings emit group identities only after validation succeeds',()=>{
  const series=playingState();
  const seriesTiles:Tile[]=[];const seriesGroups:number[][]=[];let id=1;
  for(const color of ['red','blue','black'] as const){const group:Tile[]=[];for(let number=10;number<=13;number++)group.push(tile(id++,color,number));seriesTiles.push(...group);seriesGroups.push(group.map(item=>item.id))}
  series.hands.p0=[...seriesTiles,tile(90,'yellow',9)];
  const openedSeries=openSeriesMelds(series,'p0',seriesGroups);
  assert.equal(openedSeries.gameEvents?.[0].kind,'open-series');
  assert.equal(openedSeries.gameEvents?.[0].meldIds?.length,3);
  assert.equal(openedSeries.melds.length,3);

  const pairs=playingState(),pairGroups:number[][]=[];let pairId=200;
  for(let number=4;number<9;number++){
    const color=number%2?'red':'blue';const pair=[tile(pairId++,color,number),tile(pairId++,color,number)];pairs.hands.p0.push(...pair);pairGroups.push(pair.map(item=>item.id));
  }
  pairs.hands.p0.push(tile(299,'black',12));
  const openedPairs=openMelds(pairs,'p0',pairGroups,true);
  assert.equal(openedPairs.gameEvents?.[0].kind,'open-pairs');
  assert.equal(openedPairs.gameEvents?.[0].meldIds?.length,5);
  assert.equal(openedPairs.melds.length,5);
});

test('round finish adds exactly one finish event after the authoritative result',()=>{
  const state=playingState();
  const finished=settleRound(state,'normal','p0');
  assert.equal(finished.status,'round-end');
  assert.equal(finished.gameEvents?.length,1);
  assert.equal(finished.gameEvents?.[0].kind,'finish');
  assert.equal(finished.gameEvents?.[0].playerId,'p0');
});

test('stock exhaustion is also a public round finish event',()=>{
  const state=playingState();
  const finished=settleRound(state,'stock',null);
  assert.equal(finished.gameEvents?.[0].kind,'finish');
  assert.equal(finished.gameEvents?.[0].playerId,'system');
  assert.equal(publicGame(finished,'p2').gameEvents?.length,1);
});
