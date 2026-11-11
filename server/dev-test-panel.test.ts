import assert from 'node:assert/strict';
import test from 'node:test';
import { availableMeldProcessingTargets, createDeck, findRackMeldGroups, findRackPairGroups, freshRoom, isRealOkey, isValidPair, openMelds, openSeriesMelds, serialMeldPointValue, startRound, startTurnClock, type GameState, type TableSettings, type Tile, type TileColor } from '../shared/game.js';
import { applyDevTestTiles, devTestPanelIsEnabled, getDevTestInventory, openPreparedDevPlayer, prepareDevOpeningHands, requireDevTestOwner, swapDevTestTiles, type DevTestTileSelection } from './dev-test-panel.js';

const settings: TableSettings = { rounds: 3, mode: 'solo', folding: false, assisted: true, tableColor: 'wood', turnDurationSeconds: 45 };
function playingFixture(): GameState {
  const state = freshRoom(settings);
  state.players = ['owner', 'p1', 'p2', 'p3'].map((id, seat) => ({ id, name: id, avatar: '🙂', online: true, seat, score: 0, opened: false, pairMode: false }));
  const deck = createDeck();
  state.indicator = deck.find(tile => tile.color === 'yellow' && tile.number === 6)!;
  state.stock = deck.filter(tile => tile.id !== state.indicator!.id);
  state.joker = { color: 'yellow', number: 7 };
  state.hands = { owner: [], p1: [], p2: [], p3: [] };
  state.status = 'playing';
  state.turnPlayerId = 'p1';
  state.phase = 'draw';
  state.turnId = 'fixture-turn';
  state.turnStartedAt = 100;
  state.turnDeadlineAt = 45100;
  return state;
}

function freshOpeningFixture(mode: TableSettings['mode'], folding: boolean): GameState {
  const state = freshRoom({ ...settings, mode, folding });
  state.players = ['owner', 'p1', 'p2', 'p3'].map((id, seat) => ({ id, name: id.toUpperCase(), avatar: '🙂', online: true, seat, score: 0, opened: false, pairMode: false }));
  return startTurnClock(startRound(state), Date.now(), 'fresh-opening-turn');
}

function physicalTileIds(state: GameState): number[] {
  return [state.indicator, ...state.stock, ...Object.values(state.hands).flat(), ...state.discard, ...state.melds.flatMap(meld => meld.tiles)].filter((tile): tile is Tile => tile !== null).map(tile => tile.id);
}

function moveStockTileToHand(state: GameState, playerId: string, predicate: (tile: Tile) => boolean): Tile {
  const index=state.stock.findIndex(predicate);assert.notEqual(index,-1,'test fixture must contain requested tile');
  const [tile]=state.stock.splice(index,1);state.hands[playerId].push(tile);return tile;
}

test('normal taş kopyaları gerçek stoktan eklenir; kimlik tekrarı ve toplam taş sayısı değişmez', () => {
  const state = playingFixture();
  const beforeCount = physicalTileIds(state).length;
  const beforeHandSizes = Object.fromEntries(Object.entries(state.hands).map(([id, hand]) => [id, hand.length]));
  const next = applyDevTestTiles(state, 'owner', [{ kind: 'normal', color: 'red', number: 5, quantity: 2 }], false);
  assert.equal(next.hands.owner.length, 2);
  assert.ok(next.hands.owner.every(tile => tile.color === 'red' && tile.number === 5));
  assert.equal(next.stock.length, state.stock.length - 2);
  assert.equal(new Set(physicalTileIds(next)).size, beforeCount);
  assert.equal(physicalTileIds(next).length, beforeCount);
  assert.deepEqual(Object.fromEntries(Object.entries(next.hands).filter(([id]) => id !== 'owner').map(([id, hand]) => [id, hand.length])), Object.fromEntries(Object.entries(beforeHandSizes).filter(([id]) => id !== 'owner')));
  assert.equal(next.turnId, state.turnId);
  assert.equal(next.turnDeadlineAt, state.turnDeadlineAt);
  assert.equal(next.phase, state.phase);
});

test('gerçek okey ve sahte okey stoktan doğru fiziksel tür olarak seçilir', () => {
  const state = playingFixture();
  const next = applyDevTestTiles(state, 'owner', [{ kind: 'realOkey', quantity: 2 }, { kind: 'fakeOkey', quantity: 2 }], false);
  assert.equal(next.hands.owner.filter(tile => isRealOkey(tile, next.joker)).length, 2);
  assert.equal(next.hands.owner.filter(tile => tile.fakeJoker).length, 2);
  assert.equal(new Set(physicalTileIds(next)).size, physicalTileIds(next).length);
});

test('stoktan eklenen numaralı taşlar gerçek seri açılışında normal kurallarla doğrulanır', () => {
  const state = playingFixture();
  const selections: DevTestTileSelection[] = [];
  for (const color of ['red', 'blue'] as const) for (let number = 9; number <= 13; number++) selections.push({ kind: 'normal', color, number, quantity: 1 });
  selections.push({ kind: 'normal', color: 'black', number: 1, quantity: 1 });
  const prepared = applyDevTestTiles(state, 'owner', selections, false);
  const groupIds = (color: TileColor) => prepared.hands.owner.filter(tile => tile.color === color).sort((a, b) => a.number! - b.number!).map(tile => tile.id);
  const openingState = { ...prepared, turnPlayerId: 'owner', phase: 'discard' as const };
  const opened = openSeriesMelds(openingState, 'owner', [groupIds('red'), groupIds('blue')]);
  assert.equal(opened.melds.length, 2);
  assert.equal(opened.serialOpeningHistory[0].points, 110);
  assert.equal(opened.players[0].opened, true);
});

test('stoktan eklenen çift kopyaları beş çift açılışında gerçek kurallarla değerlendirilir', () => {
  const state = playingFixture();
  const selections: DevTestTileSelection[] = [1, 2, 3, 4, 5].map(number => ({ kind: 'normal', color: 'red', number, quantity: 2 }));
  selections.push({ kind: 'normal', color: 'blue', number: 12, quantity: 1 });
  const prepared = applyDevTestTiles(state, 'owner', selections, false);
  const groups = [1, 2, 3, 4, 5].map(number => prepared.hands.owner.filter(tile => tile.color === 'red' && tile.number === number).map(tile => tile.id));
  const opened = openMelds({ ...prepared, turnPlayerId: 'owner', phase: 'discard' }, 'owner', groups, true);
  assert.equal(opened.melds.filter(meld => meld.kind === 'pairs').length, 5);
  assert.equal(opened.players[0].pairMode, true);
});

test('test destesinden eklenen gerçek okey seride ve çiftte joker olur; sahte okey joker olmaz', () => {
  const state = playingFixture();
  const selections: DevTestTileSelection[] = [
    { kind: 'normal', color: 'red', number: 5, quantity: 1 },
    { kind: 'normal', color: 'red', number: 6, quantity: 1 },
    { kind: 'normal', color: 'red', number: 9, quantity: 1 },
    { kind: 'realOkey', quantity: 1 },
    { kind: 'fakeOkey', quantity: 1 },
  ];
  const prepared = applyDevTestTiles(state, 'owner', selections, false);
  const real = prepared.hands.owner.find(tile => isRealOkey(tile, prepared.joker))!;
  const fake = prepared.hands.owner.find(tile => tile.fakeJoker)!;
  const redFiveSix = prepared.hands.owner.filter(tile => tile.color === 'red' && (tile.number === 5 || tile.number === 6));
  assert.equal(findRackMeldGroups([...redFiveSix, real], prepared.joker).length, 1);
  assert.equal(findRackMeldGroups([...redFiveSix, fake], prepared.joker).length, 0);
  const redNine = prepared.hands.owner.find(tile => tile.color === 'red' && tile.number === 9)!;
  assert.equal(isValidPair([real, redNine], prepared.joker), true);
  assert.equal(isValidPair([fake, redNine], prepared.joker), false);
});

test('stokta istenen kopya yoksa işlem tamamen reddedilir ve hiçbir state değişmez', () => {
  const state = playingFixture();
  const originalStock = [...state.stock], originalHand = [...state.hands.owner];
  assert.throws(() => applyDevTestTiles(state, 'owner', [{ kind: 'normal', color: 'red', number: 5, quantity: 3 }], false), /Stokta red 5 taşından yeterli yok/);
  assert.deepEqual(state.stock, originalStock);
  assert.deepEqual(state.hands.owner, originalHand);
});

test('ıstakayı temizleyerek yeni dizilim kurmak eski taşları stoğa iade eder ve diğer oyunculara dokunmaz', () => {
  const state = playingFixture();
  const returnedTiles = state.stock.splice(0, 3);
  state.hands.owner = returnedTiles;
  state.recognizedRealOkeyIds = [returnedTiles[0].id];
  const otherHands = { ...state.hands, owner: [] };
  const beforeStockCount = state.stock.length;
  const next = applyDevTestTiles(state, 'owner', [{ kind: 'normal', color: 'blue', number: 9, quantity: 2 }], true);
  assert.equal(next.hands.owner.length, 2);
  assert.ok(next.hands.owner.every(tile => tile.color === 'blue' && tile.number === 9));
  assert.equal(next.stock.length, beforeStockCount + 3 - 2);
  assert.ok(returnedTiles.every(tile => next.stock.some(stockTile => stockTile.id === tile.id)));
  assert.deepEqual({ ...next.hands, owner: [] }, otherHands);
  assert.ok(!next.recognizedRealOkeyIds.includes(returnedTiles[0].id));
  assert.equal(new Set(physicalTileIds(next)).size, physicalTileIds(next).length);
});

test('test panel ortam kilidi production ve sunucu opt-out değerinde kapalıdır', () => {
  assert.equal(devTestPanelIsEnabled({ ...process.env, NODE_ENV: 'production' }), false);
  assert.equal(devTestPanelIsEnabled({ ...process.env, NODE_ENV: 'development', ENABLE_TEST_PANEL: 'false' }), false);
  assert.equal(devTestPanelIsEnabled({ ...process.env, NODE_ENV: 'development', ENABLE_TEST_PANEL: 'true' }), true);
});

test('seçim doğrulaması renk ve sayı sınırlarını uygular', () => {
  const state = playingFixture();
  const invalid: DevTestTileSelection[] = [{ kind: 'normal', color: 'red' as TileColor, number: 14, quantity: 1 }];
  assert.throws(() => applyDevTestTiles(state, 'owner', invalid, false), /rengi veya sayısı geçersiz/);
  assert.equal(getDevTestInventory(state).stockCount, state.stock.length);
});

test('kapalı stoktaki fiziksel taş karşılıklı takas edilir, konum ve stok sayısı korunur',()=>{
  const state=playingFixture();
  const offered=moveStockTileToHand(state,'owner',tile=>tile.color==='red'&&tile.number===3&&!isRealOkey(tile,state.joker));
  moveStockTileToHand(state,'owner',tile=>tile.color==='black'&&tile.number===2);
  const source=state.stock.find(tile=>tile.color==='yellow'&&tile.number===13&&!tile.fakeJoker)!;
  const sourceIndex=state.stock.findIndex(tile=>tile.id===source.id),stockCount=state.stock.length,allIdsBefore=physicalTileIds(state);
  const handCountsBefore=Object.fromEntries(Object.entries(state.hands).map(([id,hand])=>[id,hand.length]));
  const result=swapDevTestTiles(state,'owner',{kind:'stock',tileId:source.id},offered.id);
  assert.equal(result.state.hands.owner[0].id,source.id,'incoming tile occupies the offered hand slot');
  assert.equal(result.state.hands.owner[1].id,state.hands.owner[1].id);
  assert.equal(result.state.stock.length,stockCount);
  assert.equal(result.state.stock[sourceIndex].id,offered.id,'offered tile replaces the selected stock slot');
  assert.deepEqual(Object.fromEntries(Object.entries(result.state.hands).map(([id,hand])=>[id,hand.length])),handCountsBefore);
  assert.equal(new Set(physicalTileIds(result.state)).size,allIdsBefore.length);
  assert.deepEqual(physicalTileIds(result.state).sort((a,b)=>a-b),allIdsBefore.sort((a,b)=>a-b));
  assert.deepEqual(result.transfers,[{playerId:'owner',fromTileId:offered.id,toTileId:source.id,handIndex:0}]);
  assert.equal(result.state.turnId,state.turnId);
  assert.equal(result.state.turnDeadlineAt,state.turnDeadlineAt);
  assert.equal(result.state.phase,state.phase);
});

test('başka oyuncu ıstakasındaki taş aynı hand-index konumunda takas edilir ve iki el sayısı korunur',()=>{
  const state=playingFixture();
  const offered=moveStockTileToHand(state,'owner',tile=>tile.color==='red'&&tile.number===3);
  const ownerOther=moveStockTileToHand(state,'owner',tile=>tile.color==='blue'&&tile.number===4);
  const otherFirst=moveStockTileToHand(state,'p1',tile=>tile.color==='black'&&tile.number===6);
  const source=moveStockTileToHand(state,'p1',tile=>tile.color==='yellow'&&tile.number===13);
  const handCountsBefore=Object.fromEntries(Object.entries(state.hands).map(([id,hand])=>[id,hand.length]));
  const allIdsBefore=physicalTileIds(state);
  const result=swapDevTestTiles(state,'owner',{kind:'player',playerId:'p1',tileId:source.id},offered.id);
  assert.deepEqual(result.state.hands.owner.map(tile=>tile.id),[source.id,ownerOther.id]);
  assert.deepEqual(result.state.hands.p1.map(tile=>tile.id),[otherFirst.id,offered.id]);
  assert.deepEqual(Object.fromEntries(Object.entries(result.state.hands).map(([id,hand])=>[id,hand.length])),handCountsBefore);
  assert.deepEqual(physicalTileIds(result.state).sort((a,b)=>a-b),allIdsBefore.sort((a,b)=>a-b));
  assert.deepEqual(result.transfers,[
    {playerId:'owner',fromTileId:offered.id,toTileId:source.id,handIndex:0},
    {playerId:'p1',fromTileId:source.id,toTileId:offered.id,handIndex:1},
  ]);
});

test('aynı kaynak taş ikinci takasta kullanılamaz ve açılmış meld taşı kaynak olamaz',()=>{
  const state=playingFixture();
  const offered=moveStockTileToHand(state,'owner',tile=>tile.color==='red'&&tile.number===3);
  const source=moveStockTileToHand(state,'p1',tile=>tile.color==='yellow'&&tile.number===13);
  const first=swapDevTestTiles(state,'owner',{kind:'player',playerId:'p1',tileId:source.id},offered.id);
  assert.throws(()=>swapDevTestTiles(first.state,'owner',{kind:'player',playerId:'p1',tileId:source.id},offered.id),/ıstakanızda değil/);

  const meldState=playingFixture();
  const ownTile=moveStockTileToHand(meldState,'owner',tile=>tile.color==='red'&&tile.number===3);
  const meldTile=moveStockTileToHand(meldState,'p1',tile=>tile.color==='yellow'&&tile.number===13);
  meldState.hands.p1=meldState.hands.p1.filter(tile=>tile.id!==meldTile.id);
  meldState.melds=[{id:'open-1',ownerId:'p1',tileIds:[meldTile.id],tiles:[meldTile],kind:'run'}];
  assert.throws(()=>swapDevTestTiles(meldState,'owner',{kind:'player',playerId:'p1',tileId:meldTile.id},ownTile.id),/ıstakasında değil veya açılmış grupta/);
});

test('test takas yetkisi masa sahibine ve çevrimiçi sahibine sınırlıdır',()=>{
  const state=playingFixture();
  assert.throws(()=>requireDevTestOwner(state,'p1'),/yalnızca masa sahibi/);
  state.players[0].online=false;
  assert.throws(()=>requireDevTestOwner(state,'owner'),/çevrimiçi değil/);
});

test('seri test hazırlığı dört oyuncunun gerçek açılışlarını normal kuralla ve 9.3 hedefleriyle destekler',()=>{
  for (const mode of ['solo','pairs'] as const) for (const folding of [false,true]) {
    let state = freshOpeningFixture(mode, folding);
    const result = prepareDevOpeningHands(state, 'owner', 'series');
    state = result.state;
    const liveTurn = { playerId: state.turnPlayerId, phase: state.phase, turnId: state.turnId, startedAt: state.turnStartedAt, deadlineAt: state.turnDeadlineAt };
    assert.ok(state.players.every(player=>state.hands[player.id].length===(player.id===state.turnPlayerId?22:21)));
    assert.equal(state.stock.length, 20);
    assert.equal(new Set(physicalTileIds(state)).size, 106);
    assert.deepEqual(physicalTileIds(state).sort((a,b)=>a-b), Array.from({length:106},(_,index)=>index+1));
    for (const player of [...state.players].sort((a,b)=>a.seat-b.seat)) {
      const groups = result.openingGroups[player.id];
      assert.equal(groups.length, 2, `${player.id} receives the intended run and processing group`);
      assert.deepEqual(groups, findRackMeldGroups(state.hands[player.id], state.joker));
      const points = groups.reduce((sum, group) => sum + (serialMeldPointValue(group.map(id=>state.hands[player.id].find(tile=>tile.id===id)!), state.joker) || 0), 0);
      state = openPreparedDevPlayer(state, 'owner', player.id, 'series', groups);
      assert.equal(state.serialOpeningHistory.at(-1)?.points, points);
      assert.deepEqual({ playerId: state.turnPlayerId, phase: state.phase, turnId: state.turnId, startedAt: state.turnStartedAt, deadlineAt: state.turnDeadlineAt }, liveTurn, 'test opening must not move or restart the real turn');
    }
    assert.ok(state.players.every(player => player.opened));
    assert.equal(state.melds.length, 8);
    assert.equal(new Set(physicalTileIds(state)).size, 106);

    const seatZeroMeld = state.melds.find(meld => meld.ownerId === 'owner' && meld.kind === 'group' && meld.tiles.length === 3)!;
    const seatOneReplacement = state.hands.p1.find(tile => !tile.fakeJoker && !isRealOkey(tile,state.joker) && tile.color === 'red' && tile.number === seatZeroMeld.tiles[0].number)!;
    state = { ...state, turnPlayerId: 'p1', phase: 'discard', turnId: `process-${mode}-${folding}`, turnDeadlineAt: Date.now()+45_000 };
    const layTargets = availableMeldProcessingTargets(state, 'p1');
    assert.ok(layTargets.some(target => target.tileId === seatOneReplacement.id && target.meldId === seatZeroMeld.id && target.target === 'group'));

    const okeyMeld = state.melds.find(meld => meld.ownerId === 'p3' && meld.kind === 'group' && meld.tiles.some(tile => isRealOkey(tile,state.joker)))!;
    const realId = okeyMeld.tiles.find(tile => isRealOkey(tile,state.joker))!.id;
    const represented = okeyMeld.realOkeyAssignments?.[realId];
    assert.ok(represented);
    const reclaimTile = state.hands.owner.find(tile => !tile.fakeJoker && !isRealOkey(tile,state.joker) && tile.color === represented.color && tile.number === represented.number)!;
    state = { ...state, turnPlayerId: 'owner', phase: 'discard', turnId: `reclaim-${mode}-${folding}`, turnDeadlineAt: Date.now()+45_000 };
    const reclaimTargets = availableMeldProcessingTargets(state, 'owner');
    assert.ok(reclaimTargets.some(target => target.tileId === reclaimTile.id && target.meldId === okeyMeld.id && target.target === 'reclaim-okey'));
  }
});

test('çift test hazırlığı normal ve katlamalı solo/eşli eşiklerde dört gerçek çift açılışını kabul ettirir',()=>{
  for (const mode of ['solo','pairs'] as const) for (const folding of [false,true]) {
    let state = freshOpeningFixture(mode, folding);
    const result = prepareDevOpeningHands(state, 'owner', 'pairs');
    const liveTurn = { playerId: result.state.turnPlayerId, phase: result.state.phase, turnId: result.state.turnId, startedAt: result.state.turnStartedAt, deadlineAt: result.state.turnDeadlineAt };
    assert.deepEqual(result.players.map(player => player.groupCount), [5,6,7,8]);
    assert.ok(state.players.every(player=>result.state.hands[player.id].length===(player.id===result.state.turnPlayerId?22:21)));
    assert.equal(result.state.stock.length, 20);
    assert.equal(new Set(physicalTileIds(result.state)).size, 106);
    assert.equal(result.state.stock.filter(tile => isRealOkey(tile,result.state.joker)).length, 1);
    assert.equal(result.state.hands.owner.filter(tile => isRealOkey(tile,result.state.joker)).length, 1);
    assert.equal(result.state.stock.filter(tile => tile.fakeJoker).length, 2);
    state = result.state;
    for (const player of [...state.players].sort((a,b)=>a.seat-b.seat)) {
      const groups = findRackPairGroups(state.hands[player.id], state.joker);
      assert.equal(groups.length, [5,6,7,8][player.seat]);
      assert.ok(groups.every(group => group.length === 2 && isValidPair(group.map(id=>state.hands[player.id].find(tile=>tile.id===id)!),state.joker)));
      assert.deepEqual(result.openingGroups[player.id], groups);
      state = openPreparedDevPlayer(state, 'owner', player.id, 'pairs', result.openingGroups[player.id]);
      assert.equal(state.pairOpeningHistory.at(-1)?.pairCount, groups.length);
      assert.deepEqual({ playerId: state.turnPlayerId, phase: state.phase, turnId: state.turnId, startedAt: state.turnStartedAt, deadlineAt: state.turnDeadlineAt }, liveTurn, 'test opening must not move or restart the real turn');
    }
    assert.ok(state.players.every(player => player.opened && player.pairMode));
    assert.equal(state.melds.length, 26);
    assert.equal(new Set(physicalTileIds(state)).size, 106);
    const okeyPair = state.melds.find(meld => meld.ownerId === 'owner' && meld.kind === 'pairs' && meld.tiles.some(tile => isRealOkey(tile,state.joker)))!;
    const realOkey = okeyPair.tiles.find(tile => isRealOkey(tile,state.joker))!;
    const represented = okeyPair.realOkeyAssignments?.[realOkey.id];
    assert.ok(represented, 'prepared pair opening keeps the real okey represented face for 9.3 reclaim');
    const replacement = state.hands.p1.find(tile => !tile.fakeJoker && !isRealOkey(tile,state.joker) && tile.color === represented.color && tile.number === represented.number)!;
    state = { ...state, turnPlayerId: 'p1', phase: 'discard', turnId: `pair-reclaim-${mode}-${folding}`, turnDeadlineAt: Date.now()+45_000 };
    assert.ok(availableMeldProcessingTargets(state,'p1').some(target => target.tileId === replacement.id && target.meldId === okeyPair.id && target.target === 'reclaim-okey'));
  }
});

test('test açılış hazırlığı hamle başladıktan sonra reddedilir ve mevcut oyun durumunu değiştirmez',()=>{
  const state = freshOpeningFixture('solo', false);
  const advanced = { ...state, phase: 'draw' as const };
  assert.throws(()=>prepareDevOpeningHands(advanced,'owner','series'),/yalnızca yeni maçın ilk oyuncu sırası/);
  assert.equal(advanced.stock.length,state.stock.length);
  assert.deepEqual(advanced.hands,state.hands);
});
