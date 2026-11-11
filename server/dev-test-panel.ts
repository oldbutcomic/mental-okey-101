import { COLORS, findRackMeldGroups, findRackPairGroups, isRealOkey, isValidPair, openMelds, openSeriesMelds, serialMeldPointValue, serialOpeningThreshold, pairOpeningThreshold, type GameState, type Tile, type TileColor } from '../shared/game.js';

export type DevTestTileSelection =
  | { kind: 'normal'; color: TileColor; number: number; quantity: number }
  | { kind: 'realOkey'; quantity: number }
  | { kind: 'fakeOkey'; quantity: number };

export type DevTestInventory = {
  stockCount: number;
  realOkeys: number;
  fakeOkeys: number;
  normalTiles: { color: TileColor; number: number; count: number }[];
  stockTiles: DevTestTilePreview[];
  ownHand: DevTestTilePreview[];
  players: { playerId: string; name: string; seat: number; opened: boolean; pairMode: boolean }[];
  otherPlayers: { playerId: string; name: string; seat: number; tiles: DevTestTilePreview[] }[];
};

export type DevTestTilePreview = { id: number; color: TileColor | null; number: number | null; fakeJoker: boolean; realOkey: boolean };
export type DevTestSwapSource = { kind: 'stock'; tileId: number } | { kind: 'player'; playerId: string; tileId: number };
export type DevTestSwapTransfer = { playerId: string; fromTileId: number; toTileId: number; handIndex: number };
export type DevTestSwapResult = { state: GameState; transfers: DevTestSwapTransfer[]; sourceTile: DevTestTilePreview; offeredTile: DevTestTilePreview };
export type DevOpeningPreparationKind = 'series' | 'pairs';
export type DevOpeningPreparationPlayer = { playerId: string; name: string; seat: number; handSize: number; groupCount: number; openingValue: number };
export type DevOpeningPreparationResult = { state: GameState; players: DevOpeningPreparationPlayer[]; openingGroups: Record<string, number[][]> };

export function devTestPanelIsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production' && env.ENABLE_TEST_PANEL !== 'false';
}

export function requireDevTestOwner(state: GameState, playerId: string): void {
  if (state.players[0]?.id !== playerId) throw new Error('Test panelini yalnızca masa sahibi kullanabilir');
  if (!state.players.some(player => player.id === playerId && player.online)) throw new Error('Masa sahibi bu masada çevrimiçi değil');
}

function assertFreshTestRound(state: GameState, playerId: string): void {
  requireDevTestOwner(state, playerId);
  const players = [...state.players].sort((a, b) => a.seat - b.seat);
  if (state.status !== 'playing' || state.round !== 1 || state.phase !== 'discard' || !state.turnPlayerId || state.turnPlayerId !== state.roundStarterId || !state.turnId || state.turnDeadlineAt === null) {
    throw new Error('Test eli yalnızca yeni maçın ilk oyuncu sırası başlamışken hazırlanabilir');
  }
  if (players.length !== 4 || players.some((player, index) => player.seat !== index || player.opened || player.pairMode || (state.hands[player.id] || []).length !== (player.id===state.turnPlayerId?22:21))) {
    throw new Error('Test eli yalnızca dört oyuncunun da ilk eli dağıtılmışken hazırlanabilir');
  }
  if (state.stock.length !== 20 || state.discard.length || state.melds.length || state.players.some(player => (state.throwsByPlayer[player.id] || []).length)) {
    throw new Error('Bir oyuncu hamle yaptıktan sonra test eli hazırlanamaz');
  }
  if (state.serialOpeningHistory.length || state.pairOpeningHistory.length || state.meldLayUsage.length || state.processedMeldActions.length || state.realOkeyReclaimPenalties.length || state.takenDiscardUse || state.openingTurn || state.undoOpen || state.discardTakeUndo) {
    throw new Error('Açılış veya işleme başladıktan sonra test eli hazırlanamaz');
  }
  const allTiles = [state.indicator, ...state.stock, ...Object.values(state.hands).flat()].filter((tile): tile is Tile => tile !== null);
  const allIds = allTiles.map(tile => tile.id).sort((a, b) => a - b);
  if (allIds.length !== 106 || new Set(allIds).size !== 106 || allIds.some((id, index) => id !== index + 1)) {
    throw new Error('Test eli hazırlanamadı: fiziksel deste 106 benzersiz taş olmalı');
  }
}

function faceKey(tile: Tile): string {
  return `${tile.color ?? 'none'}-${tile.number ?? 'none'}`;
}

function sameGroups(actual: number[][], expected: number[][]): boolean {
  return actual.length === expected.length && actual.every((group, index) => group.length === expected[index].length && group.every((id, tileIndex) => id === expected[index][tileIndex]));
}

function chooseSpacedSetNumbers(state: GameState): number[] {
  const excluded = new Set([state.indicator?.number, state.joker?.number]);
  // 12-tile runs score 78, so these sets must start at 8 to clear 101.
  const candidates = Array.from({ length: 6 }, (_, index) => index + 8).filter(number => !excluded.has(number));
  const selected: number[] = [];
  const search = (start: number): boolean => {
    if (selected.length === 4) return true;
    for (let index = start; index < candidates.length; index++) {
      const number = candidates[index];
      if (selected.length && number - selected[selected.length - 1] < 2) continue;
      selected.push(number);
      if (search(index + 1)) return true;
      selected.pop();
    }
    return false;
  };
  if (!search(0)) {
    // The six high values can be adjacent after indicator/joker exclusions.
    // Distinct ascending values still keep the planned groups separate; the
    // rack analyzer below rejects any filler that creates an accidental meld.
    selected.splice(0);
    selected.push(...candidates.slice(0, 4));
    if (selected.length !== 4) throw new Error('Bu göstergeyle dört güvenli test per sayısı seçilemedi');
  }
  return selected;
}

function takeTile(pool: Tile[], predicate: (tile: Tile) => boolean, label: string): Tile {
  const index = pool.findIndex(predicate);
  if (index < 0) throw new Error(`Gerçek destede test için ${label} taşı bulunamadı`);
  return pool.splice(index, 1)[0];
}

function prepareSeriesHands(state: GameState, pool: Tile[], players: GameState['players']): { hands: Record<string, Tile[]>; summary: DevOpeningPreparationPlayer[] } {
  const numbers = chooseSpacedSetNumbers(state);
  const prepared = players.map((player, seat) => ({ player, runColor: COLORS[seat], run: [] as Tile[], set: [] as Tile[], extender: null as Tile | null }));
  for (const entry of prepared) {
    for (let number = 1; number <= 12; number++) {
      const natural = pool.findIndex(tile => !tile.fakeJoker && !isRealOkey(tile, state.joker) && tile.color === entry.runColor && tile.number === number);
      if (natural >= 0) entry.run.push(pool.splice(natural, 1)[0]);
      else if (state.joker?.color === entry.runColor && state.joker.number === number) entry.run.push(takeTile(pool, tile => isRealOkey(tile, state.joker), 'gerçek okey'));
      else throw new Error(`Gerçek destede ${entry.runColor} ${number} test serisi taşı bulunamadı`);
    }
  }
  for (let seat = 0; seat < prepared.length; seat++) {
    const entry = prepared[seat];
    const number = numbers[seat];
    const naturalColors = COLORS.filter(color => color !== entry.runColor);
    entry.set = naturalColors.map(color => takeTile(pool, tile => !tile.fakeJoker && !isRealOkey(tile, state.joker) && tile.color === color && tile.number === number, `${color} ${number}`));
    if (seat === 3) entry.set.push(takeTile(pool, tile => isRealOkey(tile, state.joker), 'gerçek okey'));
    const value = serialMeldPointValue(entry.set, state.joker);
    if (value === null) throw new Error(`Hazırlanan ${playerLabel(entry.player)} test grubu geçerli seri değil`);
    entry.extender = takeTile(pool, tile => !tile.fakeJoker && !isRealOkey(tile, state.joker) && tile.color === entry.runColor && tile.number === number, `${entry.runColor} ${number} işleme taşı`);
  }
  const hands: Record<string, Tile[]> = Object.fromEntries(players.map(player => [player.id, []]));
  const expected: Record<string, number[][]> = {};
  for (const entry of prepared) {
    const runValue = serialMeldPointValue(entry.run, state.joker);
    const setValue = serialMeldPointValue(entry.set, state.joker);
    if (runValue === null || setValue === null) throw new Error(`Hazırlanan ${playerLabel(entry.player)} perleri geçersiz`);
    hands[entry.player.id].push(...entry.run, ...entry.set);
    expected[entry.player.id] = [entry.run.map(tile => tile.id), entry.set.map(tile => tile.id)];
  }
  // Put each missing-color extension tile in the next player's hand, so it can
  // be used against an already-opened opponent meld without merging into their own opening.
  for (let seat = 0; seat < prepared.length; seat++) hands[prepared[(seat + 1) % prepared.length].player.id].push(prepared[seat].extender!);

  const handSizes = new Map(players.map(player => [player.id, player.id === state.turnPlayerId ? 22 : 21]));
  let attempts = 0;
  const fill = (seat: number): boolean => {
    if (seat >= players.length) return true;
    const player = players[seat], hand = hands[player.id], targetSize = handSizes.get(player.id)!;
    if (hand.length >= targetSize) return fill(seat + 1);
    const occupiedFaces = new Set(hand.map(faceKey));
    const candidates = pool.filter(tile => !tile.fakeJoker && !isRealOkey(tile, state.joker) && !occupiedFaces.has(faceKey(tile)));
    for (const candidate of candidates) {
      if (++attempts > 10000) return false;
      const index = pool.findIndex(tile => tile.id === candidate.id);
      if (index < 0) continue;
      pool.splice(index, 1);
      hand.push(candidate);
      if (sameGroups(findRackMeldGroups(hand, state.joker), expected[player.id]) && fill(hand.length < targetSize ? seat : seat + 1)) return true;
      hand.pop();
      pool.splice(index, 0, candidate);
    }
    return false;
  };
  if (!fill(0)) throw new Error('Güvenli seri test eli için çakışmasız gerçek taş dağılımı bulunamadı');
  const summary = prepared.map((entry, seat) => {
    const groups = expected[entry.player.id];
    const openingValue = groups.reduce((sum, ids) => sum + (serialMeldPointValue(ids.map(id => hands[entry.player.id].find(tile => tile.id === id)!), state.joker) || 0), 0);
    const thresholdState = { ...state, hands: { ...state.hands, ...hands } };
    if (openingValue < serialOpeningThreshold(thresholdState, entry.player.id)) throw new Error(`${playerLabel(entry.player)} için hazırlanan seri açılışı gerekli eşiği karşılamıyor`);
    if (groups.length < 2) throw new Error(`${playerLabel(entry.player)} için testte en az iki seri grubu gerekli`);
    return { playerId: entry.player.id, name: entry.player.name, seat, handSize: hands[entry.player.id].length, groupCount: groups.length, openingValue };
  });
  return { hands, summary };
}

function playerLabel(player: GameState['players'][number]): string { return `${player.seat}. koltuktaki oyuncu`; }

function preparePairHands(state: GameState, pool: Tile[], players: GameState['players']): { hands: Record<string, Tile[]>; summary: DevOpeningPreparationPlayer[] } {
  const reclaimSeat=1;
  const pairCounts = [5, 6, 7, 8];
  const buckets = new Map<string, Tile[]>();
  for (const tile of pool) {
    if (tile.fakeJoker || isRealOkey(tile, state.joker) || !tile.color || !tile.number) continue;
    const key = faceKey(tile), bucket = buckets.get(key) || [];
    bucket.push(tile); buckets.set(key, bucket);
  }
  const pairs = [...buckets.values()].filter(bucket => bucket.length >= 2).sort((a, b) => (a[0].number || 0) - (b[0].number || 0)).map(bucket => bucket.slice(0, 2));
  if (pairs.length < pairCounts.reduce((sum, count) => sum + count, 0)) throw new Error('Gerçek destede dört oyuncu için yeterli doğal çift yok');
  const reclaimPairIndex = pairs.reduce((best, pair, index) => (pair[0].number || 0) > (pairs[best]?.[0].number || 0) ? index : best, 0);
  if (reclaimPairIndex > 0) [pairs[0], pairs[reclaimPairIndex]] = [pairs[reclaimPairIndex], pairs[0]];
  const hands: Record<string, Tile[]> = Object.fromEntries(players.map(player => [player.id, []]));
  const assignedPairs: Record<string, number[][]> = {};
  let reclaimTile: Tile | null = null;
  let pairIndex = 0;
  for (let seat = 0; seat < players.length; seat++) {
    const player = players[seat], groups = pairs.slice(pairIndex, pairIndex + pairCounts[seat]).map(group => [...group]);
    pairIndex += pairCounts[seat];
    if (seat === 0) {
      const [naturalTile, releasedCopy] = groups[0];
      takeTile(pool, candidate => candidate.id === naturalTile.id, 'okeyli çiftin doğal taşı');
      takeTile(pool, candidate => candidate.id === releasedCopy.id, 'okeyli çiftin yedek taşı');
      const realOkey = takeTile(pool, tile => isRealOkey(tile, state.joker), 'çift testindeki gerçek okey');
      groups[0] = [naturalTile, realOkey];
      for (const group of groups.slice(1)) for (const tile of group) takeTile(pool, candidate => candidate.id === tile.id, 'çift');
      reclaimTile = releasedCopy;
    } else {
      for (const group of groups) for (const tile of group) takeTile(pool, candidate => candidate.id === tile.id, 'çift');
    }
    assignedPairs[player.id] = groups.map(group => group.map(tile => tile.id));
    hands[player.id].push(...groups.flat());
  }
  const handSizes = new Map(players.map(player => [player.id, player.id === state.turnPlayerId ? 22 : 21]));
  for (let seat = 0; seat < players.length; seat++) {
    const player = players[seat], hand = hands[player.id], targetSize = handSizes.get(player.id)!;
    const occupiedFaces = new Set(hand.map(faceKey));
    if (seat === reclaimSeat && reclaimTile) {
      if (occupiedFaces.has(faceKey(reclaimTile))) throw new Error('Gerçek okeyi geri alma taşı çift test elinde zaten kullanılıyor');
      hand.push(reclaimTile);
      occupiedFaces.add(faceKey(reclaimTile));
    }
    while (hand.length < targetSize) {
      const index = pool.findIndex(tile => !tile.fakeJoker && !isRealOkey(tile, state.joker) && !occupiedFaces.has(faceKey(tile)) && !(seat === 0 && reclaimTile && (tile.number || 0) >= (reclaimTile.number || 0)));
      if (index < 0) throw new Error(`${playerLabel(player)} için çift oluşturmayan gerçek taş yedeği bulunamadı`);
      const [tile] = pool.splice(index, 1);
      hand.push(tile); occupiedFaces.add(faceKey(tile));
    }
    const detected = findRackPairGroups(hand, state.joker);
    if (detected.length !== pairCounts[seat] || detected.some(group => !isValidPair(group.map(id => hand.find(tile => tile.id === id)!), state.joker))) {
      throw new Error(`${playerLabel(player)} test elinde çift sayısı değişti`);
    }
    const thresholdState = { ...state, hands: { ...state.hands, ...hands } };
    if (detected.length < pairOpeningThreshold(thresholdState, player.id)) throw new Error(`${playerLabel(player)} için hazırlanan çift açılışı gerekli eşiği karşılamıyor`);
  }
  const summary = players.map((player, seat) => ({ playerId: player.id, name: player.name, seat, handSize: hands[player.id].length, groupCount: assignedPairs[player.id].length, openingValue: assignedPairs[player.id].length }));
  return { hands, summary };
}

export function prepareDevOpeningHands(state: GameState, playerId: string, kind: DevOpeningPreparationKind): DevOpeningPreparationResult {
  assertFreshTestRound(state, playerId);
  if (kind !== 'series' && kind !== 'pairs') throw new Error('Test açılış türü geçersiz');
  const players = [...state.players].sort((a, b) => a.seat - b.seat);
  const pool = [...Object.values(state.hands).flat(), ...state.stock];
  const prepared = kind === 'series' ? prepareSeriesHands(state, pool, players) : preparePairHands(state, pool, players);
  const openingGroups = Object.fromEntries(players.map(player => [player.id, kind === 'series'
    ? findRackMeldGroups(prepared.hands[player.id], state.joker)
    : findRackPairGroups(prepared.hands[player.id], state.joker)]));
  const expectedIds = [state.indicator!, ...pool, ...Object.values(prepared.hands).flat()].map(tile => tile.id).sort((a, b) => a - b);
  if (expectedIds.length !== 106 || new Set(expectedIds).size !== 106 || expectedIds.some((id, index) => id !== index + 1)) throw new Error('Hazırlık fiziksel taş kimliklerini koruyamadı');
  // Run the actual authoritative opening functions in a throwaway state, in
  // seat order. This proves normal and folding thresholds accept every hand.
  let validationState: GameState = { ...state, hands: prepared.hands };
  for (const player of players) {
    validationState = { ...validationState, turnPlayerId: player.id, phase: 'discard', turnId: `dev-open-check-${kind}-${player.id}` };
    const groups = openingGroups[player.id];
    validationState = kind === 'series'
      ? openSeriesMelds(validationState, player.id, groups)
      : openMelds(validationState, player.id, groups, true);
  }
  const next: GameState = {
    ...state,
    hands: prepared.hands,
    stock: pool,
    recognizedRealOkeyIds: [],
    message: kind === 'series' ? 'Test serileri hazırlandı · oyuncular sırayla normal kurallarla açabilir' : 'Test çiftleri hazırlandı · oyuncular sırayla normal kurallarla açabilir',
  };
  return { state: next, players: prepared.summary, openingGroups };
}

/** Opens a server-prepared test hand through the normal authoritative rules while preserving the live turn clock. */
export function openPreparedDevPlayer(state: GameState, playerId: string, targetPlayerId: string, kind: DevOpeningPreparationKind, groups: number[][]): GameState {
  requireDevTestOwner(state, playerId);
  const target = state.players.find(player => player.id === targetPlayerId);
  if (!target) throw new Error('Açılış için seçilen oyuncu masada değil');
  if (target.opened) throw new Error(`${target.name} bu elde zaten açtı`);
  if (!Array.isArray(groups) || !groups.length || groups.some(group => !Array.isArray(group) || group.some(id => !(state.hands[targetPlayerId] || []).some(tile => tile.id === id)))) {
    throw new Error('Hazırlanan perler oyuncunun güncel ıstakasıyla eşleşmiyor; test elini yeniden hazırlayın');
  }
  const turnId = state.turnId || `dev-open-${state.matchId}-${state.round}-${targetPlayerId}-${Date.now()}`;
  const openingState: GameState = { ...state, turnPlayerId: targetPlayerId, phase: 'discard', turnId, turnStartedAt: state.turnStartedAt ?? Date.now(), turnDeadlineAt: state.turnDeadlineAt ?? Date.now() + 45_000 };
  const opened = kind === 'series'
    ? openSeriesMelds(openingState, targetPlayerId, groups)
    : openMelds(openingState, targetPlayerId, groups, true);
  const groupCount = groups.length;
  const openingValue = kind === 'series'
    ? (opened.serialOpeningHistory.at(-1)?.points ?? 0)
    : groupCount;
  return {
    ...opened,
    turnPlayerId: state.turnPlayerId,
    phase: state.phase,
    turnId: state.turnId,
    turnStartedAt: state.turnStartedAt,
    turnDeadlineAt: state.turnDeadlineAt,
    openingTurn: null,
    undoOpen: null,
    message: kind === 'series'
      ? `${target.name} test için seri açtı (${openingValue} puan)`
      : `${target.name} test için çift açtı (${openingValue} çift)`,
  };
}

function isNormalSelection(tile: GameState['stock'][number], color: TileColor, number: number, state: GameState): boolean {
  return !tile.fakeJoker && !isRealOkey(tile, state.joker) && tile.color === color && tile.number === number;
}

function previewTile(tile: GameState['stock'][number], state: GameState): DevTestTilePreview {
  return { id: tile.id, color: tile.color, number: tile.number, fakeJoker: tile.fakeJoker, realOkey: isRealOkey(tile, state.joker) };
}

export function getDevTestInventory(state: GameState, viewerId?: string): DevTestInventory {
  const normalTiles: DevTestInventory['normalTiles'] = [];
  for (const color of COLORS) {
    for (let number = 1; number <= 13; number++) {
      normalTiles.push({
        color,
        number,
        count: state.stock.filter(tile => isNormalSelection(tile, color, number, state)).length,
      });
    }
  }
  return {
    stockCount: state.stock.length,
    realOkeys: state.stock.filter(tile => isRealOkey(tile, state.joker)).length,
    fakeOkeys: state.stock.filter(tile => tile.fakeJoker).length,
    normalTiles,
    stockTiles: state.stock.map(tile => previewTile(tile, state)),
    ownHand: viewerId ? (state.hands[viewerId] || []).map(tile => previewTile(tile, state)) : [],
    players: state.players.map(player => ({ playerId: player.id, name: player.name, seat: player.seat, opened: player.opened, pairMode: player.pairMode })),
    otherPlayers: viewerId ? state.players.filter(player => player.id !== viewerId).map(player => ({
      playerId: player.id,
      name: player.name,
      seat: player.seat,
      tiles: (state.hands[player.id] || []).map(tile => previewTile(tile, state)),
    })) : [],
  };
}

function validateSwapSource(value: unknown): DevTestSwapSource {
  if (!value || typeof value !== 'object') throw new Error('Takas kaynağı geçersiz');
  const source = value as Record<string, unknown>;
  if (!Number.isSafeInteger(source.tileId)) throw new Error('Kaynak taş kimliği geçersiz');
  if (source.kind === 'stock') return { kind: 'stock', tileId: Number(source.tileId) };
  if (source.kind === 'player' && typeof source.playerId === 'string' && source.playerId) return { kind: 'player', playerId: source.playerId, tileId: Number(source.tileId) };
  throw new Error('Takas kaynağı geçersiz');
}

export function swapDevTestTiles(state: GameState, playerId: string, rawSource: unknown, rawOwnTileId: unknown): DevTestSwapResult {
  if (state.status !== 'playing') throw new Error('Taş takası yalnızca oyun sırasında yapılabilir');
  if (!Number.isSafeInteger(rawOwnTileId)) throw new Error('Istakadan seçilen taş kimliği geçersiz');
  const player = state.players.find(candidate => candidate.id === playerId);
  if (!player) throw new Error('Oyuncu bu masada değil');
  const source = validateSwapSource(rawSource);
  if (source.kind === 'player' && source.playerId === playerId) throw new Error('Kaynak olarak kendi ıstakanız seçilemez');

  const ownHand = [...(state.hands[playerId] || [])];
  const ownIndex = ownHand.findIndex(tile => tile.id === rawOwnTileId);
  if (ownIndex < 0) throw new Error('Karşılık vereceğiniz taş artık ıstakanızda değil');
  const offeredTile = ownHand[ownIndex];
  let sourceTile: GameState['stock'][number];
  let nextStock = state.stock;
  let nextHands = state.hands;
  const transfers: DevTestSwapTransfer[] = [];

  if (source.kind === 'stock') {
    const stock = [...state.stock];
    const stockIndex = stock.findIndex(tile => tile.id === source.tileId);
    if (stockIndex < 0) throw new Error('Seçilen taş artık kapalı stokta değil; stoğu yenileyin');
    sourceTile = stock[stockIndex];
    stock[stockIndex] = offeredTile;
    ownHand[ownIndex] = sourceTile;
    nextStock = stock;
    nextHands = { ...state.hands, [playerId]: ownHand };
    transfers.push({ playerId, fromTileId: offeredTile.id, toTileId: sourceTile.id, handIndex: ownIndex });
  } else {
    const sourcePlayer = state.players.find(candidate => candidate.id === source.playerId);
    if (!sourcePlayer) throw new Error('Kaynak oyuncu masada değil');
    const sourceHand = [...(state.hands[source.playerId] || [])];
    const sourceIndex = sourceHand.findIndex(tile => tile.id === source.tileId);
    if (sourceIndex < 0) throw new Error('Seçilen taş oyuncunun ıstakasında değil veya açılmış grupta; stoğu yenileyin');
    sourceTile = sourceHand[sourceIndex];
    sourceHand[sourceIndex] = offeredTile;
    ownHand[ownIndex] = sourceTile;
    nextHands = { ...state.hands, [playerId]: ownHand, [source.playerId]: sourceHand };
    transfers.push(
      { playerId, fromTileId: offeredTile.id, toTileId: sourceTile.id, handIndex: ownIndex },
      { playerId: source.playerId, fromTileId: sourceTile.id, toTileId: offeredTile.id, handIndex: sourceIndex },
    );
  }

  return {
    state: {
      ...state,
      stock: nextStock,
      hands: nextHands,
      discardTakeUndo: null,
      undoOpen: null,
      message: `${player.name} test için taş takası yaptı`,
    },
    transfers,
    sourceTile: previewTile(sourceTile, state),
    offeredTile: previewTile(offeredTile, state),
  };
}

function validateSelection(selection: unknown): DevTestTileSelection {
  if (!selection || typeof selection !== 'object') throw new Error('Test taşı seçimi geçersiz');
  const value = selection as Record<string, unknown>;
  if (!Number.isSafeInteger(value.quantity) || Number(value.quantity) < 1 || Number(value.quantity) > 106) {
    throw new Error('Taş adedi 1 ile 106 arasında olmalı');
  }
  const quantity = Number(value.quantity);
  if (value.kind === 'realOkey' || value.kind === 'fakeOkey') return { kind: value.kind, quantity };
  if (value.kind !== 'normal' || !COLORS.includes(value.color as TileColor) || !Number.isSafeInteger(value.number) || Number(value.number) < 1 || Number(value.number) > 13) {
    throw new Error('Normal taşın rengi veya sayısı geçersiz');
  }
  return { kind: 'normal', color: value.color as TileColor, number: Number(value.number), quantity };
}

function matchesSelection(tile: GameState['stock'][number], selection: DevTestTileSelection, state: GameState): boolean {
  if (selection.kind === 'realOkey') return isRealOkey(tile, state.joker);
  if (selection.kind === 'fakeOkey') return tile.fakeJoker;
  return isNormalSelection(tile, selection.color, selection.number, state);
}

export function applyDevTestTiles(
  state: GameState,
  playerId: string,
  rawSelections: unknown,
  clearHand: boolean,
): GameState {
  if (state.status !== 'playing') throw new Error('Test taşları yalnızca oyun sırasında eklenebilir');
  const player = state.players.find(candidate => candidate.id === playerId);
  if (!player) throw new Error('Oyuncu bu masada değil');
  if (!Array.isArray(rawSelections) || rawSelections.length > 106) throw new Error('Test taşı listesi geçersiz');
  if (typeof clearHand !== 'boolean') throw new Error('Istaka temizleme seçimi geçersiz');

  const selections = rawSelections.map(validateSelection);
  if (!clearHand && selections.length === 0) throw new Error('Önce ıstakaya eklemek için taş seçin');
  const requestedCount = selections.reduce((sum, selection) => sum + selection.quantity, 0);
  if (requestedCount > state.stock.length) throw new Error(`Stokta yeterli taş yok. İstenen: ${requestedCount}, stok: ${state.stock.length}. Hiçbir taş eklenmedi.`);

  const stock = [...state.stock];
  const added = [] as GameState['stock'];
  for (const selection of selections) {
    for (let index = 0; index < selection.quantity; index++) {
      const stockIndex = stock.findIndex(tile => matchesSelection(tile, selection, state));
      if (stockIndex < 0) {
        const label = selection.kind === 'realOkey' ? 'Gerçek okey' : selection.kind === 'fakeOkey' ? 'Sahte okey' : `${selection.color} ${selection.number}`;
        throw new Error(`Stokta ${label} taşından yeterli yok. Hiçbir değişiklik yapılmadı.`);
      }
      added.push(stock.splice(stockIndex, 1)[0]);
    }
  }

  const previousHand = state.hands[playerId] || [];
  const nextHand = clearHand ? added : [...previousHand, ...added];
  const oldHandIds = clearHand ? new Set(previousHand.map(tile => tile.id)) : new Set<number>();
  const recognizedRealOkeyIds = state.recognizedRealOkeyIds.filter(tileId => !oldHandIds.has(tileId));
  return {
    ...state,
    stock: clearHand ? [...stock, ...previousHand] : stock,
    hands: { ...state.hands, [playerId]: nextHand },
    recognizedRealOkeyIds,
    discardTakeUndo: null,
    undoOpen: null,
    message: clearHand ? `${player.name} test ıstakasını yeniledi` : `${player.name} test için ${added.length} taş ekledi`,
  };
}
