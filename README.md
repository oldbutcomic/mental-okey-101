# MENTAL OKEY 101

React 18 + TypeScript + Elastic UI front end and a Node.js + Socket.IO game server. No Java, ads, or paid game currency.

## Local run

1. In the project folder, run `pnpm install`.
2. Copy `.env.example` to `.env`. Local development uses a persistent SQLite file automatically; no database service setup is needed. Set `DATABASE_URL` only if you want to use PostgreSQL locally.
3. Open one terminal and run `pnpm server`.
4. Open a second terminal and run `pnpm dev -- --host 127.0.0.1`.
5. Visit `http://localhost:5173/`, create an account or sign in, then create/join the same six-character room code from other players' accounts.

The server keeps room state in memory. It provides four-seat rooms, presence, chat, shuffle/deal, drawing, discarding, each player's discard history, 101/5-pair opening checks, placing tiles on open melds, a hand-end dialog, and simple round scoring. The rack supports tap-to-select and drag-to-reorder, with drag-to-meld for opened sets. A solo room can start a practice hand against three basic bots so you can try the controls without waiting for friends. This is an early playable 101 slice; full rules parity, penalties, turn timeout, durable reconnect after server restarts, Düz Okey, and complete paired/folding behavior remain to be completed. See [AUDIT.md](AUDIT.md).

## Accounts and persistent storage

Player accounts use a durable database. Local development creates `.data/accounts.sqlite` and stores accounts, sessions, and login-attempt limits there; the file survives server restarts and is ignored by Git. If `DATABASE_URL` is set, the server uses PostgreSQL instead. Production requires PostgreSQL and never falls back to SQLite or memory. On first start, the server creates `player_accounts`, `account_sessions`, and `account_login_attempts` if they do not exist. PINs are stored as scrypt hashes; raw PINs are never saved. The browser stores only the opaque session token and the separate seat token needed to reclaim a room.

Keep any database connection URL private and never commit `.env`. The test suite uses an isolated in-memory account adapter only when `NODE_ENV=test`; local development uses a persistent SQLite file, not an in-memory fallback. Game rooms remain in server memory and are still lost when the game server restarts; local account records remain in `.data/accounts.sqlite`, while deployed account records remain in PostgreSQL.

## Free deployment

- Create a persistent PostgreSQL database with a provider of your choice, then configure the existing Render Web Service from `render.yaml`. Set its secret `DATABASE_URL` environment variable to the database URL. The service builds the React app and serves it together with the Node.js + Socket.IO backend at `https://mental-okey-101.onrender.com`.
- The same repository can also publish its frontend on GitHub Pages at `https://oldbutcomic.github.io/mental-okey-101/`. That optional deployment uses its own Vite base path and connects back to the Render backend.

Render's free service may sleep after inactivity or restart; an in-memory room is lost on restart. The free tier is suitable for a friends' prototype, not an always-on service. The current workspace includes deploy configuration but is not connected to your GitHub or Render accounts, so it is not yet available as a public website.
