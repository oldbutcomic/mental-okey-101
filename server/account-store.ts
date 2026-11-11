import { createHash, randomBytes, randomUUID, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';

const SCRYPT_BYTES = 64;
const SCRYPT_OPTIONS = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const LOGIN_LIMIT = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

export type AccountProfile = {
  id: string;
  username: string;
  avatar: string;
  createdAt: string;
  lastLoginAt: string | null;
  status: 'active' | 'disabled';
  mentalCoins: number;
};

export type AuthSession = { account: AccountProfile; sessionToken: string };

export type CoinTransactionType = 'welcome_bonus' | 'daily_bonus' | 'round_reward' | 'gift_purchase' | 'joke_purchase';
export type CoinTransaction = {
  id: string;
  accountId: string;
  amount: number;
  type: CoinTransactionType;
  description: string;
  gameId: string | null;
  round: number | null;
  balanceAfter: number;
  createdAt: string;
  itemId?: string | null;
  targetPlayerId?: string | null;
};
export type CoinCredit = {
  accountId: string;
  amount: number;
  idempotencyKey: string;
  type: CoinTransactionType;
  description: string;
  gameId?: string | null;
  round?: number | null;
};
export type CoinCreditResult = { granted: boolean; accounts: AccountProfile[] };
export type DailyRewardResult = { granted: boolean; account: AccountProfile };
export type CoinInteractionPurchase = {
  accountId: string;
  targetPlayerId: string;
  itemId: string;
  amount: number;
  idempotencyKey: string;
  type: 'gift_purchase' | 'joke_purchase';
  description: string;
  gameId: string;
  cooldownMs: number;
  now?: number;
};
export type CoinInteractionPurchaseResult = {
  status: 'purchased' | 'duplicate' | 'cooldown' | 'insufficient';
  account: AccountProfile;
  cooldownUntil: number | null;
};
const DAILY_COIN_REWARD = 1000;
const DAILY_REWARD_INTERVAL_MS = 24 * 60 * 60 * 1000;

function validateCoinCredit(credit: CoinCredit): void {
  if (!credit.accountId || !credit.idempotencyKey || credit.idempotencyKey.length > 256 || !Number.isSafeInteger(credit.amount) || credit.amount <= 0) {
    throw new AccountError('Coin işlemi geçersiz.', 'invalid');
  }
  if (!['welcome_bonus', 'daily_bonus', 'round_reward'].includes(credit.type)) throw new AccountError('Coin işlem türü geçersiz.', 'invalid');
}

function coinTransactionFromRow(row: any): CoinTransaction {
  return {
    id: String(row.id), accountId: String(row.account_id), amount: Number(row.amount),
    type: row.type as CoinTransactionType, description: String(row.description),
    gameId: row.game_id ? String(row.game_id) : null, round: row.round === null || row.round === undefined ? null : Number(row.round),
    balanceAfter: Number(row.balance_after), createdAt: new Date(row.created_at).toISOString(),
    itemId: row.item_id ? String(row.item_id) : null, targetPlayerId: row.target_player_id ? String(row.target_player_id) : null,
  };
}

function validateInteractionPurchase(purchase: CoinInteractionPurchase): void {
  if (!purchase.accountId || !purchase.targetPlayerId || purchase.accountId === purchase.targetPlayerId || !purchase.itemId ||
      !purchase.idempotencyKey || purchase.idempotencyKey.length > 256 || !purchase.gameId ||
      !Number.isSafeInteger(purchase.amount) || purchase.amount <= 0 || purchase.cooldownMs !== 30_000 ||
      !['gift_purchase', 'joke_purchase'].includes(purchase.type)) {
    throw new AccountError('İkram veya şaka işlemi geçersiz.', 'invalid');
  }
}

function interactionPurchaseFingerprint(purchase: CoinInteractionPurchase): string {
  return JSON.stringify([purchase.accountId, purchase.targetPlayerId, purchase.itemId, purchase.amount, purchase.type, purchase.description, purchase.gameId]);
}

function timestampMs(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export class AccountError extends Error {
  constructor(message: string, readonly code: 'invalid' | 'duplicate' | 'locked' | 'unavailable' | 'session' = 'invalid') {
    super(message);
  }
}

export interface AccountStore {
  initialize(): Promise<void>;
  healthCheck(): Promise<boolean>;
  register(username: string, pin: string): Promise<AuthSession>;
  login(username: string, pin: string, clientAddress: string): Promise<AuthSession>;
  findBySessionToken(token: string): Promise<AccountProfile | null>;
  rotateSession(accountId: string, oldToken: string, newToken: string): Promise<boolean>;
  getAccount(accountId: string): Promise<AccountProfile | null>;
  updateAvatar(accountId: string, avatar: string): Promise<AccountProfile>;
  logout(accountId: string, token: string): Promise<void>;
  claimDailyReward(accountId: string, now?: number): Promise<DailyRewardResult>;
  applyCoinCredits(credits: CoinCredit[]): Promise<CoinCreditResult>;
  getInteractionCooldown(accountId: string): Promise<number | null>;
  purchaseInteraction(purchase: CoinInteractionPurchase): Promise<CoinInteractionPurchaseResult>;
  getCoinTransactions(accountId: string, limit?: number): Promise<CoinTransaction[]>;
}

export function normalizeUsername(username: string): { display: string; key: string } {
  const display = username.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (Array.from(display).length < 3 || Array.from(display).length > 16 || !/^[\p{L}\p{N}_ ]+$/u.test(display)) {
    throw new AccountError('Kullanıcı adı 3–16 harf, rakam, boşluk veya alt çizgi içermeli.');
  }
  return { display, key: display.toLocaleLowerCase('tr-TR') };
}

function validatePin(pin: string): void {
  if (!/^\d{6,12}$/.test(pin)) throw new AccountError('PIN 6–12 rakamdan oluşmalı.');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function makeToken(): string {
  return randomBytes(32).toString('base64url');
}

function derivePin(pin:string,salt:string):Promise<Buffer>{
  return new Promise((resolve,reject)=>nodeScrypt(pin,salt,SCRYPT_BYTES,SCRYPT_OPTIONS,(error,key)=>error?reject(error):resolve(key)));
}

async function hashPin(pin: string, salt = randomBytes(16).toString('hex')): Promise<{ salt: string; hash: string }> {
  const derived = await derivePin(pin,salt);
  return { salt, hash: derived.toString('hex') };
}

async function pinMatches(pin: string, salt: string, encodedHash: string): Promise<boolean> {
  const candidate = await derivePin(pin,salt);
  const expected = Buffer.from(encodedHash, 'hex');
  return expected.length === candidate.length && timingSafeEqual(candidate, expected);
}

function profileFromRow(row: any): AccountProfile {
  return {
    id: String(row.id), username: String(row.username), avatar: String(row.avatar || '🙂'),
    createdAt: new Date(row.created_at).toISOString(),
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
    status: row.status === 'disabled' ? 'disabled' : 'active', mentalCoins: Number(row.mental_coins || 0),
  };
}

const PROFILE_COLUMNS = 'id, username, avatar, created_at, last_login_at, status, mental_coins';

export class PostgresAccountStore implements AccountStore {
  private pool: Pool | null = null;

  async initialize(): Promise<void> {
    const connectionString = process.env.DATABASE_URL?.trim();
    if (!connectionString) throw new AccountError('Kalıcı hesap veritabanı ayarlı değil. DATABASE_URL gerekli.', 'unavailable');
    this.pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 8_000 });
    try {
      await this.pool.query('SELECT 1');
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS player_accounts (
          id text PRIMARY KEY,
          username text NOT NULL,
          username_key text NOT NULL UNIQUE,
          pin_salt text NOT NULL,
          pin_hash text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          last_login_at timestamptz,
          status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
          mental_coins bigint NOT NULL DEFAULT 0,
          daily_reward_at timestamptz,
          interaction_cooldown_until timestamptz,
          avatar text NOT NULL DEFAULT '🙂'
        );
        CREATE TABLE IF NOT EXISTS account_sessions (
          account_id text PRIMARY KEY REFERENCES player_accounts(id) ON DELETE CASCADE,
          token_hash char(64) NOT NULL UNIQUE,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS account_login_attempts (
          scope_key text PRIMARY KEY,
          failed_count integer NOT NULL DEFAULT 0,
          locked_until timestamptz,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS account_login_attempts_updated_at_idx ON account_login_attempts(updated_at);
      `);
      await this.pool.query('ALTER TABLE player_accounts ADD COLUMN IF NOT EXISTS daily_reward_at timestamptz');
      await this.pool.query('ALTER TABLE player_accounts ADD COLUMN IF NOT EXISTS interaction_cooldown_until timestamptz');
      await this.pool.query('UPDATE player_accounts SET daily_reward_at = COALESCE(last_login_at, created_at) WHERE daily_reward_at IS NULL');
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS mental_coin_transactions (
          id text PRIMARY KEY,
          idempotency_key text NOT NULL UNIQUE,
          account_id text NOT NULL REFERENCES player_accounts(id) ON DELETE CASCADE,
          amount bigint NOT NULL CHECK (amount <> 0),
          type text NOT NULL CHECK (type IN ('welcome_bonus', 'daily_bonus', 'round_reward', 'gift_purchase', 'joke_purchase')),
          description text NOT NULL,
          game_id text,
          round integer,
          item_id text,
          target_player_id text,
          balance_after bigint NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS mental_coin_transactions_account_created_idx
          ON mental_coin_transactions(account_id, created_at DESC);
      `);
      await this.pool.query('ALTER TABLE mental_coin_transactions ADD COLUMN IF NOT EXISTS item_id text');
      await this.pool.query('ALTER TABLE mental_coin_transactions ADD COLUMN IF NOT EXISTS target_player_id text');
      await this.pool.query('ALTER TABLE mental_coin_transactions DROP CONSTRAINT IF EXISTS mental_coin_transactions_amount_check');
      await this.pool.query('ALTER TABLE mental_coin_transactions ADD CONSTRAINT mental_coin_transactions_amount_check CHECK (amount <> 0)');
      await this.pool.query('ALTER TABLE mental_coin_transactions DROP CONSTRAINT IF EXISTS mental_coin_transactions_type_check');
      await this.pool.query("ALTER TABLE mental_coin_transactions ADD CONSTRAINT mental_coin_transactions_type_check CHECK (type IN ('welcome_bonus', 'daily_bonus', 'round_reward', 'gift_purchase', 'joke_purchase'))");
      await this.pool.query("DELETE FROM account_login_attempts WHERE updated_at < now() - interval '2 days'");
    } catch (error) {
      await this.pool.end().catch(() => undefined);
      this.pool = null;
      throw new AccountError('Kalıcı hesap veritabanına ulaşılamıyor; hesap işlemleri kapalı.', 'unavailable');
    }
  }

  private db(): Pool {
    if (!this.pool) throw new AccountError('Kalıcı hesap veritabanı kullanılamıyor.', 'unavailable');
    return this.pool;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.db().query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async register(username: string, pin: string): Promise<AuthSession> {
    const clean = normalizeUsername(username); validatePin(pin);
    const credentials = await hashPin(pin), sessionToken = makeToken(), id = randomUUID();
    const client = await this.db().connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO player_accounts(id, username, username_key, pin_salt, pin_hash, mental_coins, daily_reward_at)
         VALUES ($1, $2, $3, $4, $5, 1000, now()) RETURNING ${PROFILE_COLUMNS}`,
        [id, clean.display, clean.key, credentials.salt, credentials.hash],
      );
      await client.query(
        `INSERT INTO mental_coin_transactions(id, idempotency_key, account_id, amount, type, description, balance_after)
         VALUES ($1, $2, $3, 1000, 'welcome_bonus', 'Hesap oluşturma hoş geldin bonusu', 1000)`,
        [randomUUID(), `welcome:${id}`, id],
      );
      await client.query('INSERT INTO account_sessions(account_id, token_hash) VALUES ($1, $2)', [id, hashToken(sessionToken)]);
      await client.query('COMMIT');
      return { account: profileFromRow(inserted.rows[0]), sessionToken };
    } catch (error: any) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error?.code === '23505') throw new AccountError('Bu kullanıcı adı zaten kullanılıyor.', 'duplicate');
      if (error instanceof AccountError) throw error;
      throw new AccountError('Hesap oluşturulamadı; veritabanı işlemi tamamlanmadı.', 'unavailable');
    } finally { client.release(); }
  }

  private async isLocked(client: PoolClient, scopes: string[]): Promise<boolean> {
    const result = await client.query(
      'SELECT 1 FROM account_login_attempts WHERE scope_key = ANY($1::text[]) AND locked_until > now() LIMIT 1', [scopes],
    );
    return result.rowCount !== 0;
  }

  private async recordFailed(client: PoolClient, scope: string): Promise<number> {
    const result = await client.query(
      `INSERT INTO account_login_attempts(scope_key, failed_count, updated_at)
       VALUES ($1, 1, now())
       ON CONFLICT(scope_key) DO UPDATE SET
         failed_count = CASE WHEN account_login_attempts.locked_until IS NOT NULL AND account_login_attempts.locked_until <= now() THEN 1 ELSE account_login_attempts.failed_count + 1 END,
         locked_until = CASE WHEN (CASE WHEN account_login_attempts.locked_until IS NOT NULL AND account_login_attempts.locked_until <= now() THEN 1 ELSE account_login_attempts.failed_count + 1 END) >= $2 THEN now() + interval '15 minutes' ELSE NULL END,
         updated_at = now()
       RETURNING failed_count`, [scope, LOGIN_LIMIT],
    );
    return Number(result.rows[0].failed_count);
  }

  async login(username: string, pin: string, clientAddress: string): Promise<AuthSession> {
    const clean = normalizeUsername(username); validatePin(pin);
    const userScope = `user:${clean.key}`;
    const addressHash = createHash('sha256').update(clientAddress || 'unknown').digest('hex');
    const ipScope = `ip:${addressHash}`;
    const client = await this.db().connect();
    try {
      await client.query('BEGIN');
      const scopes = [userScope, ipScope];
      if (await this.isLocked(client, scopes)) throw new AccountError('Çok fazla hatalı giriş denemesi. 15 dakika sonra tekrar deneyin.', 'locked');
      const result = await client.query(
        `SELECT ${PROFILE_COLUMNS}, pin_salt, pin_hash FROM player_accounts WHERE username_key = $1`, [clean.key],
      );
      const row = result.rows[0];
      const matched = await pinMatches(pin, row?.pin_salt || 'mental-okey-unknown-account-salt', row?.pin_hash || '0'.repeat(SCRYPT_BYTES * 2));
      if (!row || !matched || row.status !== 'active') {
        const userFailures = await this.recordFailed(client, userScope);
        await this.recordFailed(client, ipScope);
        await client.query('COMMIT');
        if (userFailures >= LOGIN_LIMIT) throw new AccountError('Çok fazla hatalı giriş denemesi. 15 dakika sonra tekrar deneyin.', 'locked');
        throw new AccountError('Kullanıcı adı veya PIN hatalı.');
      }
      const sessionToken = makeToken();
      const updated = await client.query(
        `UPDATE player_accounts SET last_login_at = now() WHERE id = $1 RETURNING ${PROFILE_COLUMNS}`, [row.id],
      );
      await client.query(
        `INSERT INTO account_sessions(account_id, token_hash, updated_at) VALUES ($1, $2, now())
         ON CONFLICT(account_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, updated_at = now()`,
        [row.id, hashToken(sessionToken)],
      );
      await client.query('DELETE FROM account_login_attempts WHERE scope_key = ANY($1::text[])', [scopes]);
      await client.query('COMMIT');
      return { account: profileFromRow(updated.rows[0]), sessionToken };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof AccountError) throw error;
      throw new AccountError('Giriş yapılamadı; hesap veritabanı kullanılamıyor.', 'unavailable');
    } finally { client.release(); }
  }

  async findBySessionToken(token: string): Promise<AccountProfile | null> {
    if (!token || token.length > 128) return null;
    const result = await this.db().query(
      `SELECT a.${PROFILE_COLUMNS.split(', ').join(', a.')}
       FROM player_accounts a JOIN account_sessions s ON s.account_id = a.id
       WHERE s.token_hash = $1 AND a.status = 'active'`, [hashToken(token)],
    );
    return result.rows[0] ? profileFromRow(result.rows[0]) : null;
  }

  async rotateSession(accountId: string, oldToken: string, newToken: string): Promise<boolean> {
    const result = await this.db().query(
      'UPDATE account_sessions SET token_hash = $3, updated_at = now() WHERE account_id = $1 AND token_hash = $2',
      [accountId, hashToken(oldToken), hashToken(newToken)],
    );
    return result.rowCount === 1;
  }

  async getAccount(accountId: string): Promise<AccountProfile | null> {
    const result = await this.db().query(`SELECT ${PROFILE_COLUMNS} FROM player_accounts WHERE id = $1`, [accountId]);
    return result.rows[0] ? profileFromRow(result.rows[0]) : null;
  }

  async updateAvatar(accountId: string, avatar: string): Promise<AccountProfile> {
    const safeAvatar = ['🙂', '😎', '🦊', '🐼', '🐯', '🐸', '🦉', '🐙'].includes(avatar) ? avatar : '🙂';
    const result = await this.db().query(`UPDATE player_accounts SET avatar = $2 WHERE id = $1 RETURNING ${PROFILE_COLUMNS}`, [accountId, safeAvatar]);
    if (!result.rows[0]) throw new AccountError('Hesap bulunamadı.', 'session');
    return profileFromRow(result.rows[0]);
  }

  async logout(accountId: string, token: string): Promise<void> {
    await this.db().query('DELETE FROM account_sessions WHERE account_id = $1 AND token_hash = $2', [accountId, hashToken(token)]);
  }

  async claimDailyReward(accountId: string, now = Date.now()): Promise<DailyRewardResult> {
    const client = await this.db().connect();
    try {
      await client.query('BEGIN');
      const found = await client.query('SELECT daily_reward_at FROM player_accounts WHERE id = $1 FOR UPDATE', [accountId]);
      if (!found.rows[0]) throw new AccountError('Hesap bulunamadı.', 'session');
      const last = found.rows[0].daily_reward_at ? new Date(found.rows[0].daily_reward_at).getTime() : null;
      if (last !== null && now - last < DAILY_REWARD_INTERVAL_MS) {
        await client.query('COMMIT');
        const account = await this.getAccount(accountId);
        if (!account) throw new AccountError('Hesap bulunamadı.', 'session');
        return { granted: false, account };
      }
      const transactionId = randomUUID(), key = `daily:${accountId}:${now}`;
      const reservation = await client.query(
        `INSERT INTO mental_coin_transactions(id, idempotency_key, account_id, amount, type, description, game_id, round, balance_after, created_at)
         VALUES ($1, $2, $3, $4, 'daily_bonus', '24 saatlik günlük giriş ödülü', NULL, NULL, 0, $5)
         ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,
        [transactionId, key, accountId, DAILY_COIN_REWARD, new Date(now)],
      );
      if (reservation.rowCount !== 1) {
        await client.query('COMMIT');
        const account = await this.getAccount(accountId);
        if (!account) throw new AccountError('Hesap bulunamadı.', 'session');
        return { granted: false, account };
      }
      const updated = await client.query(
        'UPDATE player_accounts SET mental_coins = mental_coins + $2, daily_reward_at = $3 WHERE id = $1 RETURNING mental_coins',
        [accountId, DAILY_COIN_REWARD, new Date(now)],
      );
      if (!updated.rows[0]) throw new AccountError('Hesap bulunamadı.', 'session');
      await client.query('UPDATE mental_coin_transactions SET balance_after = $2 WHERE id = $1', [transactionId, updated.rows[0].mental_coins]);
      await client.query('COMMIT');
      const account = await this.getAccount(accountId);
      if (!account) throw new AccountError('Hesap bulunamadı.', 'session');
      return { granted: true, account };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof AccountError) throw error;
      throw new AccountError('Günlük coin ödülü verilemedi.', 'unavailable');
    } finally { client.release(); }
  }

  async applyCoinCredits(credits: CoinCredit[]): Promise<CoinCreditResult> {
    if (!credits.length) return { granted: false, accounts: [] };
    credits.forEach(validateCoinCredit);
    const client = await this.db().connect(), changed = new Set<string>();
    try {
      await client.query('BEGIN');
      for (const credit of credits) {
        const id = randomUUID();
        const inserted = await client.query(
          `INSERT INTO mental_coin_transactions(id, idempotency_key, account_id, amount, type, description, game_id, round, balance_after)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0)
           ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,
          [id, credit.idempotencyKey, credit.accountId, credit.amount, credit.type, credit.description, credit.gameId || null, credit.round ?? null],
        );
        if (inserted.rowCount !== 1) continue;
        const updated = await client.query('UPDATE player_accounts SET mental_coins = mental_coins + $2 WHERE id = $1 RETURNING mental_coins', [credit.accountId, credit.amount]);
        if (!updated.rows[0]) throw new AccountError('Coin verilecek hesap bulunamadı.', 'session');
        await client.query('UPDATE mental_coin_transactions SET balance_after = $2 WHERE id = $1', [id, updated.rows[0].mental_coins]);
        changed.add(credit.accountId);
      }
      await client.query('COMMIT');
      const accounts: AccountProfile[] = [];
      for (const accountId of new Set(credits.map(credit => credit.accountId))) {
        const account = await this.getAccount(accountId);
        if (account) accounts.push(account);
      }
      return { granted: changed.size > 0, accounts };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof AccountError) throw error;
      throw new AccountError('Coin ödülü ve işlem kaydı birlikte tamamlanamadı.', 'unavailable');
    } finally { client.release(); }
  }

  async getInteractionCooldown(accountId: string): Promise<number | null> {
    const result = await this.db().query('SELECT interaction_cooldown_until FROM player_accounts WHERE id = $1', [accountId]);
    if (!result.rows[0]) throw new AccountError('Hesap bulunamadı.', 'session');
    return timestampMs(result.rows[0].interaction_cooldown_until);
  }

  async purchaseInteraction(purchase: CoinInteractionPurchase): Promise<CoinInteractionPurchaseResult> {
    validateInteractionPurchase(purchase);
    const client = await this.db().connect(), now = purchase.now ?? Date.now(), fingerprint = interactionPurchaseFingerprint(purchase);
    try {
      await client.query('BEGIN');
      const accountResult = await client.query('SELECT mental_coins, interaction_cooldown_until FROM player_accounts WHERE id = $1 FOR UPDATE', [purchase.accountId]);
      if (!accountResult.rows[0]) throw new AccountError('Hesap bulunamadı.', 'session');
      const accountRow = accountResult.rows[0], cooldownUntil = timestampMs(accountRow.interaction_cooldown_until);
      const previousResult = await client.query('SELECT account_id, amount, type, description, game_id, item_id, target_player_id FROM mental_coin_transactions WHERE idempotency_key = $1', [purchase.idempotencyKey]);
      if (previousResult.rows[0]) {
        const previous = previousResult.rows[0];
        const matches = String(previous.account_id) === purchase.accountId && Number(previous.amount) === -purchase.amount && previous.type === purchase.type &&
          previous.description === purchase.description && previous.game_id === purchase.gameId && previous.item_id === purchase.itemId && previous.target_player_id === purchase.targetPlayerId;
        if (!matches) throw new AccountError('İstek kimliği başka bir coin işlemi için kullanılmış.', 'invalid');
        await client.query('COMMIT');
        const account = await this.getAccount(purchase.accountId);
        if (!account) throw new AccountError('Hesap bulunamadı.', 'session');
        return { status: 'duplicate', account, cooldownUntil };
      }
      if (cooldownUntil !== null && cooldownUntil > now) {
        await client.query('COMMIT');
        const account = await this.getAccount(purchase.accountId);
        if (!account) throw new AccountError('Hesap bulunamadı.', 'session');
        return { status: 'cooldown', account, cooldownUntil };
      }
      if (Number(accountRow.mental_coins) < purchase.amount) {
        await client.query('COMMIT');
        const account = await this.getAccount(purchase.accountId);
        if (!account) throw new AccountError('Hesap bulunamadı.', 'session');
        return { status: 'insufficient', account, cooldownUntil };
      }
      const id = randomUUID(), nextCooldown = new Date(now + purchase.cooldownMs);
      await client.query(
        `INSERT INTO mental_coin_transactions(id,idempotency_key,account_id,amount,type,description,game_id,round,item_id,target_player_id,balance_after,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,0,$10)`,
        [id,purchase.idempotencyKey,purchase.accountId,-purchase.amount,purchase.type,purchase.description,purchase.gameId,purchase.itemId,purchase.targetPlayerId,new Date(now)],
      );
      const updated = await client.query('UPDATE player_accounts SET mental_coins = mental_coins - $2, interaction_cooldown_until = $3 WHERE id = $1 RETURNING mental_coins', [purchase.accountId,purchase.amount,nextCooldown]);
      await client.query('UPDATE mental_coin_transactions SET balance_after = $2 WHERE id = $1', [id,updated.rows[0].mental_coins]);
      await client.query('COMMIT');
      const account = await this.getAccount(purchase.accountId);
      if (!account) throw new AccountError('Hesap bulunamadı.', 'session');
      return { status: 'purchased', account, cooldownUntil: nextCooldown.getTime() };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof AccountError) throw error;
      throw new AccountError('İkram veya şaka coin işlemi tamamlanamadı.', 'unavailable');
    } finally { client.release(); }
  }

  async getCoinTransactions(accountId: string, limit = 100): Promise<CoinTransaction[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const result = await this.db().query(
      `SELECT id, account_id, amount, type, description, game_id, round, item_id, target_player_id, balance_after, created_at
       FROM mental_coin_transactions WHERE account_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
      [accountId, safeLimit],
    );
    return result.rows.map(coinTransactionFromRow);
  }
}

/** Persistent local-development store. Production uses PostgreSQL and never falls back here. */
export class SqliteAccountStore implements AccountStore {
  private database: import('node:sqlite').DatabaseSync | null = null;
  private loginQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath = process.env.ACCOUNT_SQLITE_PATH?.trim() || resolve(process.cwd(), '.data', 'accounts.sqlite')) {}

  async initialize(): Promise<void> {
    try {
      if (this.filePath !== ':memory:') mkdirSync(dirname(this.filePath), { recursive: true });
      const { DatabaseSync } = await import('node:sqlite');
      this.database = new DatabaseSync(this.filePath);
      this.database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 8000;');
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS player_accounts (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          username_key TEXT NOT NULL UNIQUE,
          pin_salt TEXT NOT NULL,
          pin_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          last_login_at TEXT,
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
          mental_coins INTEGER NOT NULL DEFAULT 0,
          daily_reward_at TEXT,
          interaction_cooldown_until TEXT,
          avatar TEXT NOT NULL DEFAULT '🙂'
        );
        CREATE TABLE IF NOT EXISTS account_sessions (
          account_id TEXT PRIMARY KEY REFERENCES player_accounts(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS account_login_attempts (
          scope_key TEXT PRIMARY KEY,
          failed_count INTEGER NOT NULL DEFAULT 0,
          locked_until INTEGER,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS account_login_attempts_updated_at_idx ON account_login_attempts(updated_at);
      `);
      const accountColumns = this.database.prepare('PRAGMA table_info(player_accounts)').all() as Array<{ name: string }>;
      if (!accountColumns.some(column => column.name === 'daily_reward_at')) this.database.exec('ALTER TABLE player_accounts ADD COLUMN daily_reward_at TEXT');
      if (!accountColumns.some(column => column.name === 'interaction_cooldown_until')) this.database.exec('ALTER TABLE player_accounts ADD COLUMN interaction_cooldown_until TEXT');
      this.database.exec('UPDATE player_accounts SET daily_reward_at = COALESCE(last_login_at, created_at) WHERE daily_reward_at IS NULL');
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS mental_coin_transactions (
          id TEXT PRIMARY KEY,
          idempotency_key TEXT NOT NULL UNIQUE,
          account_id TEXT NOT NULL REFERENCES player_accounts(id) ON DELETE CASCADE,
          amount INTEGER NOT NULL CHECK (amount <> 0),
          type TEXT NOT NULL CHECK (type IN ('welcome_bonus', 'daily_bonus', 'round_reward', 'gift_purchase', 'joke_purchase')),
          description TEXT NOT NULL,
          game_id TEXT,
          round INTEGER,
          item_id TEXT,
          target_player_id TEXT,
          balance_after INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS mental_coin_transactions_account_created_idx
          ON mental_coin_transactions(account_id, created_at DESC);
      `);
      const transactionColumns = this.database.prepare('PRAGMA table_info(mental_coin_transactions)').all() as Array<{ name: string }>;
      const transactionSchema = this.database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'mental_coin_transactions'").get() as { sql?: string } | undefined;
      if (!transactionSchema?.sql?.includes('gift_purchase') || !transactionSchema.sql.includes('amount <> 0') || !transactionColumns.some(column => column.name === 'item_id') || !transactionColumns.some(column => column.name === 'target_player_id')) {
        const oldColumns = new Set(transactionColumns.map(column => column.name));
        this.database.exec('BEGIN IMMEDIATE');
        try {
          this.database.exec('ALTER TABLE mental_coin_transactions RENAME TO mental_coin_transactions_before_interactions');
          this.database.exec(`CREATE TABLE mental_coin_transactions (
            id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE,
            account_id TEXT NOT NULL REFERENCES player_accounts(id) ON DELETE CASCADE,
            amount INTEGER NOT NULL CHECK (amount <> 0),
            type TEXT NOT NULL CHECK (type IN ('welcome_bonus', 'daily_bonus', 'round_reward', 'gift_purchase', 'joke_purchase')),
            description TEXT NOT NULL, game_id TEXT, round INTEGER, item_id TEXT, target_player_id TEXT,
            balance_after INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
          )`);
          const itemExpression = oldColumns.has('item_id') ? 'item_id' : 'NULL';
          const targetExpression = oldColumns.has('target_player_id') ? 'target_player_id' : 'NULL';
          this.database.exec(`INSERT INTO mental_coin_transactions(id,idempotency_key,account_id,amount,type,description,game_id,round,item_id,target_player_id,balance_after,created_at)
            SELECT id,idempotency_key,account_id,amount,type,description,game_id,round,${itemExpression},${targetExpression},balance_after,created_at
            FROM mental_coin_transactions_before_interactions`);
          this.database.exec('DROP TABLE mental_coin_transactions_before_interactions');
          this.database.exec('COMMIT');
        } catch (error) {
          this.database.exec('ROLLBACK');
          throw error;
        }
      }
      this.database.exec('CREATE INDEX IF NOT EXISTS mental_coin_transactions_account_created_idx ON mental_coin_transactions(account_id, created_at DESC)');
      this.database.prepare('DELETE FROM account_login_attempts WHERE updated_at < ?').run(Date.now() - 2 * 24 * 60 * 60 * 1000);
    } catch {
      this.database?.close();
      this.database = null;
      throw new AccountError('Yerel kalıcı hesap veritabanı açılamadı.', 'unavailable');
    }
  }

  private db(): import('node:sqlite').DatabaseSync {
    if (!this.database) throw new AccountError('Yerel kalıcı hesap veritabanı kullanılamıyor.', 'unavailable');
    return this.database;
  }

  async healthCheck(): Promise<boolean> {
    try {
      this.db().prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }

  private async serializeLogin<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.loginQueue;
    let release!: () => void;
    this.loginQueue = new Promise<void>(resolveQueue => { release = resolveQueue; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  async register(username: string, pin: string): Promise<AuthSession> {
    const clean = normalizeUsername(username); validatePin(pin);
    const credentials = await hashPin(pin), sessionToken = makeToken(), id = randomUUID(), now = new Date().toISOString(), db = this.db();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO player_accounts(id, username, username_key, pin_salt, pin_hash, created_at, mental_coins, daily_reward_at) VALUES (?, ?, ?, ?, ?, ?, 1000, ?)')
        .run(id, clean.display, clean.key, credentials.salt, credentials.hash, now, now);
      db.prepare('INSERT INTO account_sessions(account_id, token_hash, updated_at) VALUES (?, ?, ?)').run(id, hashToken(sessionToken), now);
      db.prepare(`INSERT INTO mental_coin_transactions(id, idempotency_key, account_id, amount, type, description, balance_after, created_at)
        VALUES (?, ?, ?, 1000, 'welcome_bonus', 'Hesap oluşturma hoş geldin bonusu', 1000, ?)`)
        .run(randomUUID(), `welcome:${id}`, id, now);
      db.exec('COMMIT');
      const row = db.prepare(`SELECT ${PROFILE_COLUMNS.replaceAll(', ', ', ')} FROM player_accounts WHERE id = ?`).get(id);
      return { account: profileFromRow(row), sessionToken };
    } catch (error: any) {
      db.exec('ROLLBACK');
      if (error instanceof AccountError) throw error;
      if (String(error?.message || '').includes('player_accounts.username_key')) {
        throw new AccountError('Bu kullanıcı adı zaten kullanılıyor.', 'duplicate');
      }
      throw new AccountError('Hesap oluşturulamadı; yerel veritabanı işlemi tamamlanmadı.', 'unavailable');
    }
  }

  private recordFailed(scope: string, now: number): number {
    const db = this.db();
    const previous = db.prepare('SELECT failed_count, locked_until FROM account_login_attempts WHERE scope_key = ?').get(scope) as { failed_count: number; locked_until: number | null } | undefined;
    const count = previous?.locked_until !== null && previous?.locked_until !== undefined && previous.locked_until <= now ? 1 : (previous?.failed_count || 0) + 1;
    const lockedUntil = count >= LOGIN_LIMIT ? now + LOGIN_LOCK_MS : null;
    db.prepare(`INSERT INTO account_login_attempts(scope_key, failed_count, locked_until, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(scope_key) DO UPDATE SET failed_count = excluded.failed_count, locked_until = excluded.locked_until, updated_at = excluded.updated_at`)
      .run(scope, count, lockedUntil, now);
    return count;
  }

  async login(username: string, pin: string, clientAddress: string): Promise<AuthSession> {
    const clean = normalizeUsername(username); validatePin(pin);
    const userScope = `user:${clean.key}`;
    const ipScope = `ip:${createHash('sha256').update(clientAddress || 'unknown').digest('hex')}`;
    return this.serializeLogin(async () => {
      const db = this.db(), now = Date.now(), scopes = [userScope, ipScope];
      db.exec('BEGIN IMMEDIATE');
      let row: any;
      try {
        const locked = db.prepare('SELECT 1 FROM account_login_attempts WHERE scope_key IN (?, ?) AND locked_until > ? LIMIT 1').get(userScope, ipScope, now);
        if (locked) throw new AccountError('Çok fazla hatalı giriş denemesi. 15 dakika sonra tekrar deneyin.', 'locked');
        row = db.prepare(`SELECT ${PROFILE_COLUMNS}, pin_salt, pin_hash FROM player_accounts WHERE username_key = ?`).get(clean.key);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      const matched = await pinMatches(pin, row?.pin_salt || 'mental-okey-unknown-account-salt', row?.pin_hash || '0'.repeat(SCRYPT_BYTES * 2));
      if (!row || !matched || row.status !== 'active') {
        db.exec('BEGIN IMMEDIATE');
        let userFailures: number;
        try {
          userFailures = this.recordFailed(userScope, now);
          this.recordFailed(ipScope, now);
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        if (userFailures >= LOGIN_LIMIT) throw new AccountError('Çok fazla hatalı giriş denemesi. 15 dakika sonra tekrar deneyin.', 'locked');
        throw new AccountError('Kullanıcı adı veya PIN hatalı.');
      }
      const sessionToken = makeToken(), nowIso = new Date().toISOString();
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('UPDATE player_accounts SET last_login_at = ? WHERE id = ?').run(nowIso, row.id);
        db.prepare(`INSERT INTO account_sessions(account_id, token_hash, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(account_id) DO UPDATE SET token_hash = excluded.token_hash, updated_at = excluded.updated_at`)
          .run(row.id, hashToken(sessionToken), nowIso);
        db.prepare('DELETE FROM account_login_attempts WHERE scope_key IN (?, ?)').run(...scopes);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      const updated = db.prepare(`SELECT ${PROFILE_COLUMNS} FROM player_accounts WHERE id = ?`).get(row.id);
      return { account: profileFromRow(updated), sessionToken };
    });
  }

  async findBySessionToken(token: string): Promise<AccountProfile | null> {
    if (!token || token.length > 128) return null;
    const row = this.db().prepare(`SELECT a.id, a.username, a.avatar, a.created_at, a.last_login_at, a.status, a.mental_coins
      FROM player_accounts a JOIN account_sessions s ON s.account_id = a.id
      WHERE s.token_hash = ? AND a.status = 'active'`).get(hashToken(token));
    return row ? profileFromRow(row) : null;
  }

  async rotateSession(accountId: string, oldToken: string, newToken: string): Promise<boolean> {
    const result = this.db().prepare('UPDATE account_sessions SET token_hash = ?, updated_at = ? WHERE account_id = ? AND token_hash = ?')
      .run(hashToken(newToken), new Date().toISOString(), accountId, hashToken(oldToken));
    return result.changes === 1;
  }

  async getAccount(accountId: string): Promise<AccountProfile | null> {
    const row = this.db().prepare(`SELECT ${PROFILE_COLUMNS} FROM player_accounts WHERE id = ?`).get(accountId);
    return row ? profileFromRow(row) : null;
  }

  async updateAvatar(accountId: string, avatar: string): Promise<AccountProfile> {
    const safeAvatar = ['🙂', '😎', '🦊', '🐼', '🐯', '🐸', '🦉', '🐙'].includes(avatar) ? avatar : '🙂';
    const db = this.db();
    db.prepare('UPDATE player_accounts SET avatar = ? WHERE id = ?').run(safeAvatar, accountId);
    const row = db.prepare(`SELECT ${PROFILE_COLUMNS} FROM player_accounts WHERE id = ?`).get(accountId);
    if (!row) throw new AccountError('Hesap bulunamadı.', 'session');
    return profileFromRow(row);
  }

  async logout(accountId: string, token: string): Promise<void> {
    this.db().prepare('DELETE FROM account_sessions WHERE account_id = ? AND token_hash = ?').run(accountId, hashToken(token));
  }

  async claimDailyReward(accountId: string, now = Date.now()): Promise<DailyRewardResult> {
    const db = this.db(), nowIso = new Date(now).toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      const row = db.prepare('SELECT daily_reward_at FROM player_accounts WHERE id = ?').get(accountId) as { daily_reward_at: string | null } | undefined;
      if (!row) throw new AccountError('Hesap bulunamadı.', 'session');
      const last = row.daily_reward_at ? Date.parse(row.daily_reward_at) : null;
      if (last !== null && now - last < DAILY_REWARD_INTERVAL_MS) {
        db.exec('COMMIT');
        const account = await this.getAccount(accountId);
        if (!account) throw new AccountError('Hesap bulunamadı.', 'session');
        return { granted: false, account };
      }
      const transactionId = randomUUID(), idempotencyKey = `daily:${accountId}:${now}`;
      const reservation = db.prepare(`INSERT OR IGNORE INTO mental_coin_transactions(
        id, idempotency_key, account_id, amount, type, description, balance_after, created_at
      ) VALUES (?, ?, ?, ?, 'daily_bonus', '24 saatlik günlük giriş ödülü', 0, ?)`)
        .run(transactionId, idempotencyKey, accountId, DAILY_COIN_REWARD, nowIso);
      if (reservation.changes !== 1) {
        db.exec('COMMIT');
        const account = await this.getAccount(accountId);
        if (!account) throw new AccountError('Hesap bulunamadı.', 'session');
        return { granted: false, account };
      }
      db.prepare('UPDATE player_accounts SET mental_coins = mental_coins + ?, daily_reward_at = ? WHERE id = ?')
        .run(DAILY_COIN_REWARD, nowIso, accountId);
      const updated = db.prepare('SELECT mental_coins FROM player_accounts WHERE id = ?').get(accountId) as { mental_coins: number };
      db.prepare('UPDATE mental_coin_transactions SET balance_after = ? WHERE id = ?').run(updated.mental_coins, transactionId);
      db.exec('COMMIT');
      const account = await this.getAccount(accountId);
      if (!account) throw new AccountError('Hesap bulunamadı.', 'session');
      return { granted: true, account };
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* Transaction already committed. */ }
      if (error instanceof AccountError) throw error;
      throw new AccountError('Günlük coin ödülü verilemedi.', 'unavailable');
    }
  }

  async applyCoinCredits(credits: CoinCredit[]): Promise<CoinCreditResult> {
    if (!credits.length) return { granted: false, accounts: [] };
    credits.forEach(validateCoinCredit);
    const db = this.db(), changed = new Set<string>();
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const credit of credits) {
        const id = randomUUID();
        const inserted = db.prepare(`INSERT OR IGNORE INTO mental_coin_transactions(
          id, idempotency_key, account_id, amount, type, description, game_id, round, balance_after, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`)
          .run(id, credit.idempotencyKey, credit.accountId, credit.amount, credit.type, credit.description, credit.gameId || null, credit.round ?? null, new Date().toISOString());
        if (inserted.changes !== 1) continue;
        const updated = db.prepare('UPDATE player_accounts SET mental_coins = mental_coins + ? WHERE id = ?').run(credit.amount, credit.accountId);
        if (updated.changes !== 1) throw new AccountError('Coin verilecek hesap bulunamadı.', 'session');
        const balance = db.prepare('SELECT mental_coins FROM player_accounts WHERE id = ?').get(credit.accountId) as { mental_coins: number };
        db.prepare('UPDATE mental_coin_transactions SET balance_after = ? WHERE id = ?').run(balance.mental_coins, id);
        changed.add(credit.accountId);
      }
      db.exec('COMMIT');
      const accounts: AccountProfile[] = [];
      for (const accountId of new Set(credits.map(credit => credit.accountId))) {
        const account = await this.getAccount(accountId);
        if (account) accounts.push(account);
      }
      return { granted: changed.size > 0, accounts };
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* Transaction already committed. */ }
      if (error instanceof AccountError) throw error;
      throw new AccountError('Coin ödülü ve işlem kaydı birlikte tamamlanamadı.', 'unavailable');
    }
  }

  async getInteractionCooldown(accountId: string): Promise<number | null> {
    const row = this.db().prepare('SELECT interaction_cooldown_until FROM player_accounts WHERE id = ?').get(accountId) as { interaction_cooldown_until?: string | null } | undefined;
    if (!row) throw new AccountError('Hesap bulunamadı.', 'session');
    return timestampMs(row.interaction_cooldown_until);
  }

  async purchaseInteraction(purchase: CoinInteractionPurchase): Promise<CoinInteractionPurchaseResult> {
    validateInteractionPurchase(purchase);
    const db = this.db(), now = purchase.now ?? Date.now(), fingerprint = interactionPurchaseFingerprint(purchase);
    db.exec('BEGIN IMMEDIATE');
    try {
      const accountRow = db.prepare('SELECT mental_coins, interaction_cooldown_until FROM player_accounts WHERE id = ?').get(purchase.accountId) as { mental_coins: number; interaction_cooldown_until?: string | null } | undefined;
      if (!accountRow) throw new AccountError('Hesap bulunamadı.', 'session');
      const cooldownUntil = timestampMs(accountRow.interaction_cooldown_until);
      const previous = db.prepare('SELECT account_id, amount, type, description, game_id, item_id, target_player_id FROM mental_coin_transactions WHERE idempotency_key = ?').get(purchase.idempotencyKey) as any;
      if (previous) {
        const matches = previous.account_id === purchase.accountId && Number(previous.amount) === -purchase.amount && previous.type === purchase.type &&
          previous.description === purchase.description && previous.game_id === purchase.gameId && previous.item_id === purchase.itemId && previous.target_player_id === purchase.targetPlayerId;
        if (!matches) throw new AccountError('İstek kimliği başka bir coin işlemi için kullanılmış.', 'invalid');
        db.exec('COMMIT');
        const account = await this.getAccount(purchase.accountId);
        if (!account) throw new AccountError('Hesap bulunamadı.', 'session');
        return { status: 'duplicate', account, cooldownUntil };
      }
      if (cooldownUntil !== null && cooldownUntil > now) {
        db.exec('COMMIT');
        const account = await this.getAccount(purchase.accountId);
        if (!account) throw new AccountError('Hesap bulunamadı.', 'session');
        return { status: 'cooldown', account, cooldownUntil };
      }
      if (accountRow.mental_coins < purchase.amount) {
        db.exec('COMMIT');
        const account = await this.getAccount(purchase.accountId);
        if (!account) throw new AccountError('Hesap bulunamadı.', 'session');
        return { status: 'insufficient', account, cooldownUntil };
      }
      const id = randomUUID(), nextCooldown = now + purchase.cooldownMs;
      db.prepare(`INSERT INTO mental_coin_transactions(id,idempotency_key,account_id,amount,type,description,game_id,round,item_id,target_player_id,balance_after,created_at)
        VALUES(?,?,?,?,?,?,?,NULL,?,?,0,?)`).run(id,purchase.idempotencyKey,purchase.accountId,-purchase.amount,purchase.type,purchase.description,purchase.gameId,purchase.itemId,purchase.targetPlayerId,new Date(now).toISOString());
      db.prepare('UPDATE player_accounts SET mental_coins = mental_coins - ?, interaction_cooldown_until = ? WHERE id = ?').run(purchase.amount,new Date(nextCooldown).toISOString(),purchase.accountId);
      const updated = db.prepare('SELECT mental_coins FROM player_accounts WHERE id = ?').get(purchase.accountId) as { mental_coins: number };
      db.prepare('UPDATE mental_coin_transactions SET balance_after = ? WHERE id = ?').run(updated.mental_coins,id);
      db.exec('COMMIT');
      const account = await this.getAccount(purchase.accountId);
      if (!account) throw new AccountError('Hesap bulunamadı.', 'session');
      return { status: 'purchased', account, cooldownUntil: nextCooldown };
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* Transaction already committed. */ }
      if (error instanceof AccountError) throw error;
      throw new AccountError('İkram veya şaka coin işlemi tamamlanamadı.', 'unavailable');
    }
  }

  async getCoinTransactions(accountId: string, limit = 100): Promise<CoinTransaction[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const rows = this.db().prepare(`SELECT id, account_id, amount, type, description, game_id, round, item_id, target_player_id, balance_after, created_at
      FROM mental_coin_transactions WHERE account_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`).all(accountId, safeLimit);
    return rows.map(coinTransactionFromRow);
  }

  close(): void { this.database?.close(); this.database = null; }
}

type MemoryAccount = AccountProfile & { usernameKey: string; pinSalt: string; pinHash: string; dailyRewardAt: number | null; interactionCooldownUntil: number | null };

/** Test-only adapter. Production never selects this store and never falls back to it. */
export class MemoryAccountStore implements AccountStore {
  private readonly accounts = new Map<string, MemoryAccount>();
  private readonly accountsByName = new Map<string, MemoryAccount>();
  private readonly sessionHashes = new Map<string, string>();
  private readonly sessionByAccount = new Map<string, string>();
  private readonly attempts = new Map<string, { count: number; until: number }>();
  private readonly coinTransactions: CoinTransaction[] = [];
  private readonly coinIdempotencyKeys = new Set<string>();
  private readonly coinPurchases = new Map<string, string>();

  async initialize(): Promise<void> {}

  async healthCheck(): Promise<boolean> { return true; }

  private async createSession(account: MemoryAccount): Promise<AuthSession> {
    const sessionToken = makeToken(), tokenKey = hashToken(sessionToken), previous = this.sessionByAccount.get(account.id);
    if (previous) this.sessionHashes.delete(previous);
    this.sessionHashes.set(tokenKey, account.id); this.sessionByAccount.set(account.id, tokenKey);
    return { account: { ...account }, sessionToken };
  }

  async register(username: string, pin: string): Promise<AuthSession> {
    const clean = normalizeUsername(username); validatePin(pin);
    if (this.accountsByName.has(clean.key)) throw new AccountError('Bu kullanıcı adı zaten kullanılıyor.', 'duplicate');
    const credentials = await hashPin(pin), createdAt = new Date().toISOString(), account: MemoryAccount = {
      id: randomUUID(), username: clean.display, usernameKey: clean.key, avatar: '🙂',
      pinSalt: credentials.salt, pinHash: credentials.hash, createdAt, lastLoginAt: null,
      status: 'active', mentalCoins: 1000, dailyRewardAt: Date.parse(createdAt), interactionCooldownUntil: null,
    };
    this.accounts.set(account.id, account); this.accountsByName.set(clean.key, account);
    const key = `welcome:${account.id}`;
    this.coinIdempotencyKeys.add(key);
    this.coinTransactions.push({ id: randomUUID(), accountId: account.id, amount: 1000, type: 'welcome_bonus', description: 'Hesap oluşturma hoş geldin bonusu', gameId: null, round: null, balanceAfter: 1000, createdAt });
    return this.createSession(account);
  }

  async login(username: string, pin: string, clientAddress: string): Promise<AuthSession> {
    const clean = normalizeUsername(username); validatePin(pin);
    const keys = [`user:${clean.key}`, `ip:${createHash('sha256').update(clientAddress || 'unknown').digest('hex')}`];
    if (keys.some(key => (this.attempts.get(key)?.until || 0) > Date.now())) throw new AccountError('Çok fazla hatalı giriş denemesi. 15 dakika sonra tekrar deneyin.', 'locked');
    const account = this.accountsByName.get(clean.key);
    const matched = await pinMatches(pin, account?.pinSalt || 'mental-okey-unknown-account-salt', account?.pinHash || '0'.repeat(SCRYPT_BYTES * 2));
    if (!account || !matched || account.status !== 'active') {
      const userAttempt = this.incrementAttempt(keys[0]); this.incrementAttempt(keys[1]);
      if (userAttempt >= LOGIN_LIMIT) throw new AccountError('Çok fazla hatalı giriş denemesi. 15 dakika sonra tekrar deneyin.', 'locked');
      throw new AccountError('Kullanıcı adı veya PIN hatalı.');
    }
    for (const key of keys) this.attempts.delete(key);
    account.lastLoginAt = new Date().toISOString();
    return this.createSession(account);
  }

  private incrementAttempt(key: string): number {
    const current = this.attempts.get(key), count = current?.until && current.until <= Date.now() ? 1 : (current?.count || 0) + 1;
    this.attempts.set(key, { count, until: count >= LOGIN_LIMIT ? Date.now() + LOGIN_LOCK_MS : 0 });
    return count;
  }

  async findBySessionToken(token: string): Promise<AccountProfile | null> {
    const id = token && token.length <= 128 ? this.sessionHashes.get(hashToken(token)) : undefined;
    const account = id ? this.accounts.get(id) : undefined;
    return account?.status === 'active' ? { ...account } : null;
  }

  async rotateSession(accountId: string, oldToken: string, newToken: string): Promise<boolean> {
    const oldHash = hashToken(oldToken);
    if (this.sessionByAccount.get(accountId) !== oldHash) return false;
    this.sessionHashes.delete(oldHash); const newHash = hashToken(newToken);
    this.sessionHashes.set(newHash, accountId); this.sessionByAccount.set(accountId, newHash); return true;
  }

  async getAccount(accountId: string): Promise<AccountProfile | null> {
    const account = this.accounts.get(accountId); return account ? { ...account } : null;
  }

  async updateAvatar(accountId: string, avatar: string): Promise<AccountProfile> {
    const account = this.accounts.get(accountId); if (!account) throw new AccountError('Hesap bulunamadı.', 'session');
    account.avatar = ['🙂', '😎', '🦊', '🐼', '🐯', '🐸', '🦉', '🐙'].includes(avatar) ? avatar : '🙂';
    return { ...account };
  }

  async logout(accountId: string, token: string): Promise<void> {
    const hash = hashToken(token); if (this.sessionByAccount.get(accountId) !== hash) return;
    this.sessionByAccount.delete(accountId); this.sessionHashes.delete(hash);
  }

  async claimDailyReward(accountId: string, now = Date.now()): Promise<DailyRewardResult> {
    const account = this.accounts.get(accountId);
    if (!account) throw new AccountError('Hesap bulunamadı.', 'session');
    if (account.dailyRewardAt !== null && now - account.dailyRewardAt < DAILY_REWARD_INTERVAL_MS) return { granted: false, account: { ...account } };
    const idempotencyKey = `daily:${accountId}:${now}`;
    if (this.coinIdempotencyKeys.has(idempotencyKey)) return { granted: false, account: { ...account } };
    account.mentalCoins += DAILY_COIN_REWARD;
    account.dailyRewardAt = now;
    this.coinIdempotencyKeys.add(idempotencyKey);
    this.coinTransactions.push({ id: randomUUID(), accountId, amount: DAILY_COIN_REWARD, type: 'daily_bonus', description: '24 saatlik günlük giriş ödülü', gameId: null, round: null, balanceAfter: account.mentalCoins, createdAt: new Date(now).toISOString() });
    return { granted: true, account: { ...account } };
  }

  async applyCoinCredits(credits: CoinCredit[]): Promise<CoinCreditResult> {
    credits.forEach(validateCoinCredit);
    for (const credit of credits) if (!this.accounts.has(credit.accountId)) throw new AccountError('Coin verilecek hesap bulunamadı.', 'session');
    let granted = false;
    for (const credit of credits) {
      if (this.coinIdempotencyKeys.has(credit.idempotencyKey)) continue;
      const account = this.accounts.get(credit.accountId)!;
      account.mentalCoins += credit.amount;
      this.coinIdempotencyKeys.add(credit.idempotencyKey);
      this.coinTransactions.push({ id: randomUUID(), accountId: credit.accountId, amount: credit.amount, type: credit.type, description: credit.description, gameId: credit.gameId || null, round: credit.round ?? null, balanceAfter: account.mentalCoins, createdAt: new Date().toISOString() });
      granted = true;
    }
    return { granted, accounts: [...new Set(credits.map(credit => credit.accountId))].map(id => ({ ...this.accounts.get(id)! })) };
  }

  async getInteractionCooldown(accountId: string): Promise<number | null> {
    const account = this.accounts.get(accountId);
    if (!account) throw new AccountError('Hesap bulunamadı.', 'session');
    return account.interactionCooldownUntil;
  }

  async purchaseInteraction(purchase: CoinInteractionPurchase): Promise<CoinInteractionPurchaseResult> {
    validateInteractionPurchase(purchase);
    const account = this.accounts.get(purchase.accountId);
    if (!account) throw new AccountError('Hesap bulunamadı.', 'session');
    const now = purchase.now ?? Date.now(), fingerprint = interactionPurchaseFingerprint(purchase);
    const previousFingerprint = this.coinPurchases.get(purchase.idempotencyKey);
    if (previousFingerprint !== undefined) {
      if (previousFingerprint !== fingerprint) throw new AccountError('İstek kimliği başka bir coin işlemi için kullanılmış.', 'invalid');
      return { status: 'duplicate', account: { ...account }, cooldownUntil: account.interactionCooldownUntil };
    }
    if (this.coinIdempotencyKeys.has(purchase.idempotencyKey)) throw new AccountError('İstek kimliği başka bir coin işlemi için kullanılmış.', 'invalid');
    if (account.interactionCooldownUntil !== null && account.interactionCooldownUntil > now) return { status: 'cooldown', account: { ...account }, cooldownUntil: account.interactionCooldownUntil };
    if (account.mentalCoins < purchase.amount) return { status: 'insufficient', account: { ...account }, cooldownUntil: account.interactionCooldownUntil };
    account.mentalCoins -= purchase.amount;
    account.interactionCooldownUntil = now + purchase.cooldownMs;
    this.coinIdempotencyKeys.add(purchase.idempotencyKey);
    this.coinPurchases.set(purchase.idempotencyKey, fingerprint);
    this.coinTransactions.push({ id: randomUUID(), accountId: purchase.accountId, amount: -purchase.amount, type: purchase.type, description: purchase.description, gameId: purchase.gameId, round: null, itemId: purchase.itemId, targetPlayerId: purchase.targetPlayerId, balanceAfter: account.mentalCoins, createdAt: new Date(now).toISOString() });
    return { status: 'purchased', account: { ...account }, cooldownUntil: account.interactionCooldownUntil };
  }

  async getCoinTransactions(accountId: string, limit = 100): Promise<CoinTransaction[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    return this.coinTransactions.filter(transaction => transaction.accountId === accountId).slice(-safeLimit).reverse().map(transaction => ({ ...transaction }));
  }
}

function createAccountStore(): AccountStore {
  if (process.env.NODE_ENV === 'test') return new MemoryAccountStore();
  if (process.env.DATABASE_URL?.trim() || process.env.NODE_ENV === 'production') return new PostgresAccountStore();
  return new SqliteAccountStore();
}

export const accountStore: AccountStore = createAccountStore();
