import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AccountError, MemoryAccountStore, PostgresAccountStore, SqliteAccountStore, type CoinInteractionPurchase } from './account-store.js';

function interactionPurchase(accountId: string, now: number, overrides: Partial<CoinInteractionPurchase> = {}): CoinInteractionPurchase {
  return {
    accountId, targetPlayerId: 'target-player', itemId: 'tea', amount: 25,
    idempotencyKey: 'interaction:test-request-001', type: 'gift_purchase', description: 'Çay ikramı · Hedef',
    gameId: 'match-interaction-test', cooldownMs: 30_000, now, ...overrides,
  };
}

test('account register uses a case-insensitive unique username and returns a durable identity shape', async () => {
  const store = new MemoryAccountStore();
  await store.initialize();
  const created = await store.register('Oyun Arkadaşı', '481516');
  assert.ok(created.account.id);
  assert.equal(created.account.username, 'Oyun Arkadaşı');
  assert.equal(created.account.mentalCoins, 1000);
  const welcome = await store.getCoinTransactions(created.account.id);
  assert.equal(welcome.length, 1);
  assert.equal(welcome[0].type, 'welcome_bonus');
  assert.equal(welcome[0].balanceAfter, 1000);
  assert.equal('pin' in created.account, false);
  await assert.rejects(store.register('  oyun   arkadaşı ', '481516'), error => error instanceof AccountError && error.code === 'duplicate');
});

test('account login accepts the correct PIN and rejects an incorrect PIN', async () => {
  const store = new MemoryAccountStore();
  const created = await store.register('Luna Test', '123456');
  const loggedIn = await store.login('luna test', '123456', '127.0.0.1');
  assert.equal(loggedIn.account.id, created.account.id);
  assert.ok(loggedIn.account.lastLoginAt);
  await assert.rejects(store.login('Luna Test', '000000', '127.0.0.1'), /Kullanıcı adı veya PIN hatalı/);
});

test('login rate limiting locks repeated failures and then allows the correct PIN after lock expiry', async () => {
  const store = new MemoryAccountStore();
  await store.register('Lock Test', '123456');
  for (let attempt = 0; attempt < 4; attempt++) await assert.rejects(store.login('Lock Test', '000000', '127.0.0.2'), /Kullanıcı adı veya PIN hatalı/);
  await assert.rejects(store.login('Lock Test', '000000', '127.0.0.2'), error => error instanceof AccountError && error.code === 'locked');
  await assert.rejects(store.login('Lock Test', '123456', '127.0.0.2'), error => error instanceof AccountError && error.code === 'locked');
});

test('opaque session token resolves the account, rotates once, and logout revokes it', async () => {
  const store = new MemoryAccountStore();
  const session = await store.register('Session Test', '654321');
  assert.equal((await store.findBySessionToken(session.sessionToken))?.id, session.account.id);
  const nextToken = 'a'.repeat(43);
  assert.equal(await store.rotateSession(session.account.id, session.sessionToken, nextToken), true);
  assert.equal(await store.findBySessionToken(session.sessionToken), null);
  assert.equal((await store.findBySessionToken(nextToken))?.id, session.account.id);
  await store.logout(session.account.id, nextToken);
  assert.equal(await store.findBySessionToken(nextToken), null);
});

test('local SQLite account and session survive closing and reopening the store', async () => {
  const filePath = join(tmpdir(), `mental-okey-accounts-${randomUUID()}.sqlite`);
  const first = new SqliteAccountStore(filePath);
  let sessionToken = '';
  let accountId = '';
  try {
    await first.initialize();
    const created = await first.register('Kalıcı Oyuncu', '123456');
    sessionToken = created.sessionToken;
    accountId = created.account.id;
    first.close();

    const reopened = new SqliteAccountStore(filePath);
    await reopened.initialize();
    try {
      assert.equal((await reopened.findBySessionToken(sessionToken))?.id, accountId);
      const loggedIn = await reopened.login('kalıcı oyuncu', '123456', '127.0.0.1');
      assert.equal(loggedIn.account.id, accountId);
      assert.equal(loggedIn.account.mentalCoins, 1000);
      assert.equal(await reopened.findBySessionToken(sessionToken), null);
      const dailyTime = Date.parse(created.account.createdAt) + 24 * 60 * 60 * 1000;
      const daily = await reopened.claimDailyReward(accountId, dailyTime);
      assert.equal(daily.granted, true);
      assert.equal(daily.account.mentalCoins, 2000);
      const repeatedDaily = await reopened.claimDailyReward(accountId, dailyTime);
      assert.equal(repeatedDaily.granted, false);
      assert.equal(repeatedDaily.account.mentalCoins, 2000);
      const history = await reopened.getCoinTransactions(accountId);
      assert.deepEqual(history.map(entry => [entry.type, entry.amount, entry.balanceAfter]), [
        ['daily_bonus', 1000, 2000], ['welcome_bonus', 1000, 1000],
      ]);
      const otherDevice = await reopened.login('kalıcı oyuncu', '123456', '192.168.1.45');
      assert.equal(otherDevice.account.mentalCoins, 2000);
      assert.equal(otherDevice.account.id, accountId);
      await assert.rejects(reopened.register('KALICI OYUNCU', '123456'), error => error instanceof AccountError && error.code === 'duplicate');
    } finally { reopened.close(); }
  } finally {
    first.close();
    rmSync(filePath, { force: true });
    rmSync(`${filePath}-wal`, { force: true });
    rmSync(`${filePath}-shm`, { force: true });
  }
});

test('daily bonus is limited to one claim per rolling 24 hours', async () => {
  const store = new MemoryAccountStore();
  const created = await store.register('Daily Test', '123456');
  const start = Date.parse(created.account.createdAt);
  assert.equal(created.account.mentalCoins, 1000);
  assert.equal((await store.claimDailyReward(created.account.id, start + 23 * 60 * 60 * 1000)).granted, false);
  const first = await store.claimDailyReward(created.account.id, start + 24 * 60 * 60 * 1000);
  assert.equal(first.granted, true);
  assert.equal(first.account.mentalCoins, 2000);
  assert.equal((await store.claimDailyReward(created.account.id, start + 24 * 60 * 60 * 1000)).granted, false);
  const next = await store.claimDailyReward(created.account.id, start + 48 * 60 * 60 * 1000);
  assert.equal(next.granted, true);
  assert.equal(next.account.mentalCoins, 3000);
});

test('coin credits are idempotent and keep balance and ledger in sync', async () => {
  const store = new MemoryAccountStore();
  const created = await store.register('Coin Test', '123456');
  const credit = { accountId: created.account.id, amount: 500, idempotencyKey: 'match:1:round:1:player:coin-test', type: 'round_reward' as const, description: 'Tur ödülü', gameId: 'match-1', round: 1 };
  assert.equal((await store.applyCoinCredits([credit])).granted, true);
  const duplicate = await store.applyCoinCredits([credit]);
  assert.equal(duplicate.granted, false);
  assert.equal(duplicate.accounts[0].mentalCoins, 1500);
  const history = await store.getCoinTransactions(created.account.id);
  assert.equal(history.reduce((sum, entry) => sum + entry.amount, 0), duplicate.accounts[0].mentalCoins);
  assert.equal(history[0].balanceAfter, 1500);
});

test('player interaction purchase debits once, records the recipient, and treats retries idempotently', async () => {
  const store = new MemoryAccountStore();
  const created = await store.register('Gift Buyer', '123456');
  const purchase = interactionPurchase(created.account.id, 100_000);
  const first = await store.purchaseInteraction(purchase);
  assert.equal(first.status, 'purchased');
  assert.equal(first.account.mentalCoins, 975);
  assert.equal(first.cooldownUntil, 130_000);

  const retry = await store.purchaseInteraction({ ...purchase, now: 101_000 });
  assert.equal(retry.status, 'duplicate');
  assert.equal(retry.account.mentalCoins, 975);
  assert.equal((await store.getInteractionCooldown(created.account.id)), 130_000);
  const history = await store.getCoinTransactions(created.account.id);
  assert.equal(history.length, 2);
  assert.equal(history[0].type, 'gift_purchase');
  assert.equal(history[0].amount, -25);
  assert.equal(history[0].itemId, 'tea');
  assert.equal(history[0].targetPlayerId, 'target-player');
  assert.equal(history[0].balanceAfter, 975);
  assert.equal(history.reduce((sum, entry) => sum + entry.amount, 0), 975);

  await assert.rejects(store.purchaseInteraction({ ...purchase, itemId: 'coffee', amount: 50 }), error => error instanceof AccountError && error.code === 'invalid');
  assert.equal((await store.getAccount(created.account.id))?.mentalCoins, 975);
});

test('gift and joke purchases share the server cooldown, and insufficient balance does not start it', async () => {
  const store = new MemoryAccountStore();
  const created = await store.register('Gift Cooldown', '123456');
  const insufficient = await store.purchaseInteraction(interactionPurchase(created.account.id, 50_000, { amount: 1001 }));
  assert.equal(insufficient.status, 'insufficient');
  assert.equal(insufficient.cooldownUntil, null);
  assert.equal(await store.getInteractionCooldown(created.account.id), null);
  assert.equal((await store.getCoinTransactions(created.account.id)).length, 1);

  const gift = await store.purchaseInteraction(interactionPurchase(created.account.id, 60_000));
  assert.equal(gift.status, 'purchased');
  const blockedJoke = await store.purchaseInteraction(interactionPurchase(created.account.id, 89_999, {
    itemId: 'applause', amount: 25, idempotencyKey: 'interaction:test-request-002', type: 'joke_purchase', description: 'Alkış · Hedef',
  }));
  assert.equal(blockedJoke.status, 'cooldown');
  assert.equal(blockedJoke.account.mentalCoins, 975);
  const afterCooldown = await store.purchaseInteraction(interactionPurchase(created.account.id, 90_000, {
    itemId: 'applause', amount: 25, idempotencyKey: 'interaction:test-request-002', type: 'joke_purchase', description: 'Alkış · Hedef',
  }));
  assert.equal(afterCooldown.status, 'purchased');
  assert.equal(afterCooldown.account.mentalCoins, 950);
  const blockedGift = await store.purchaseInteraction(interactionPurchase(created.account.id, 119_999, {
    itemId: 'tea', amount: 25, idempotencyKey: 'interaction:test-request-003', type: 'gift_purchase', description: 'Çay · Hedef',
  }));
  assert.equal(blockedGift.status, 'cooldown');
  assert.equal(blockedGift.account.mentalCoins, 950);
  const afterReverseCooldown = await store.purchaseInteraction(interactionPurchase(created.account.id, 120_000, {
    itemId: 'tea', amount: 25, idempotencyKey: 'interaction:test-request-003', type: 'gift_purchase', description: 'Çay · Hedef',
  }));
  assert.equal(afterReverseCooldown.status, 'purchased');
  assert.equal(afterReverseCooldown.account.mentalCoins, 925);
});

test('SQLite interaction balance, ledger, idempotency, and cooldown survive store restart', async () => {
  const filePath = join(tmpdir(), `mental-okey-interaction-${randomUUID()}.sqlite`);
  const first = new SqliteAccountStore(filePath);
  let accountId = '';
  try {
    await first.initialize();
    const created = await first.register('Gift Saved', '123456');
    accountId = created.account.id;
    const purchaseNow = Date.now() + 1_000;
    const purchase = interactionPurchase(accountId, purchaseNow, {
      itemId: 'confetti', amount: 50, idempotencyKey: 'interaction:persistent-request',
      type: 'joke_purchase', description: 'Mini konfeti · Hedef',
    });
    assert.equal((await first.purchaseInteraction(purchase)).status, 'purchased');
    first.close();

    const reopened = new SqliteAccountStore(filePath);
    await reopened.initialize();
    try {
      assert.equal((await reopened.getAccount(accountId))?.mentalCoins, 950);
      assert.equal(await reopened.getInteractionCooldown(accountId), purchaseNow + 30_000);
      const duplicate = await reopened.purchaseInteraction({ ...purchase, now: purchaseNow + 5_000 });
      assert.equal(duplicate.status, 'duplicate');
      assert.equal(duplicate.account.mentalCoins, 950);
      const duringCooldown = await reopened.purchaseInteraction(interactionPurchase(accountId, purchaseNow + 29_999, {
        itemId: 'tea', amount: 25, idempotencyKey: 'interaction:after-restart',
      }));
      assert.equal(duringCooldown.status, 'cooldown');
      assert.equal(duringCooldown.account.mentalCoins, 950);
      const history = await reopened.getCoinTransactions(accountId);
      assert.deepEqual(history.map(entry => [entry.type, entry.amount, entry.itemId, entry.targetPlayerId, entry.balanceAfter]), [
        ['joke_purchase', -50, 'confetti', 'target-player', 950], ['welcome_bonus', 1000, null, null, 1000],
      ]);
    } finally { reopened.close(); }
  } finally {
    first.close();
    rmSync(filePath, { force: true });
    rmSync(`${filePath}-wal`, { force: true });
    rmSync(`${filePath}-shm`, { force: true });
  }
});

test('failed multi-player coin credit rolls back all balance and history changes in SQLite', async () => {
  const filePath = join(tmpdir(), `mental-okey-coin-atomic-${randomUUID()}.sqlite`);
  const store = new SqliteAccountStore(filePath);
  try {
    await store.initialize();
    const created = await store.register('Atomic Coin', '123456');
    await assert.rejects(store.applyCoinCredits([
      { accountId: created.account.id, amount: 500, idempotencyKey: 'atomic:good', type: 'round_reward', description: 'Test' },
      { accountId: 'missing-account', amount: 100, idempotencyKey: 'atomic:bad', type: 'round_reward', description: 'Test' },
    ]));
    assert.equal((await store.getAccount(created.account.id))?.mentalCoins, 1000);
    assert.equal((await store.getCoinTransactions(created.account.id)).length, 1);
  } finally {
    store.close();
    rmSync(filePath, { force: true });
    rmSync(`${filePath}-wal`, { force: true });
    rmSync(`${filePath}-shm`, { force: true });
  }
});

test('SQLite migration does not retroactively add the welcome bonus to existing accounts', async () => {
  const filePath = join(tmpdir(), `mental-okey-legacy-account-${randomUUID()}.sqlite`);
  const legacy = new DatabaseSync(filePath);
  const legacyCreatedAt = new Date().toISOString();
  legacy.exec(`CREATE TABLE player_accounts (
    id TEXT PRIMARY KEY, username TEXT NOT NULL, username_key TEXT NOT NULL UNIQUE, pin_salt TEXT NOT NULL,
    pin_hash TEXT NOT NULL, created_at TEXT NOT NULL, last_login_at TEXT, status TEXT NOT NULL DEFAULT 'active',
    mental_coins INTEGER NOT NULL DEFAULT 0, avatar TEXT NOT NULL DEFAULT '🙂'
  )`);
  legacy.prepare('INSERT INTO player_accounts(id, username, username_key, pin_salt, pin_hash, created_at, mental_coins) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('legacy-account', 'Eski Oyuncu', 'eski oyuncu', 'salt', 'hash', legacyCreatedAt, 77);
  legacy.close();

  const store = new SqliteAccountStore(filePath);
  try {
    await store.initialize();
    assert.equal((await store.getAccount('legacy-account'))?.mentalCoins, 77);
    assert.deepEqual(await store.getCoinTransactions('legacy-account'), []);
    assert.equal((await store.claimDailyReward('legacy-account', Date.parse(legacyCreatedAt) + 12 * 60 * 60 * 1000)).granted, false);
    assert.equal((await store.claimDailyReward('legacy-account', Date.parse(legacyCreatedAt) + 24 * 60 * 60 * 1000)).account.mentalCoins, 1077);
  } finally {
    store.close();
    rmSync(filePath, { force: true });
    rmSync(`${filePath}-wal`, { force: true });
    rmSync(`${filePath}-shm`, { force: true });
  }
});

test('production PostgreSQL store fails closed when DATABASE_URL is missing', async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const store = new PostgresAccountStore();
    assert.equal(await store.healthCheck(), false, 'an uninitialized or unavailable PostgreSQL pool is not healthy');
    await assert.rejects(store.initialize(), error => error instanceof AccountError && error.code === 'unavailable');
  } finally {
    if (previous !== undefined) process.env.DATABASE_URL = previous;
  }
});

test('account store readiness reflects its usable backing store', async () => {
  const memory = new MemoryAccountStore();
  await memory.initialize();
  assert.equal(await memory.healthCheck(), true);

  const filePath = join(tmpdir(), `mental-okey-health-${randomUUID()}.sqlite`);
  const sqlite = new SqliteAccountStore(filePath);
  try {
    assert.equal(await sqlite.healthCheck(), false, 'SQLite is not ready before initialization');
    await sqlite.initialize();
    assert.equal(await sqlite.healthCheck(), true);
    sqlite.close();
    assert.equal(await sqlite.healthCheck(), false, 'closed SQLite is not healthy');
  } finally {
    sqlite.close();
    rmSync(filePath, { force: true });
    rmSync(`${filePath}-wal`, { force: true });
    rmSync(`${filePath}-shm`, { force: true });
  }
});
