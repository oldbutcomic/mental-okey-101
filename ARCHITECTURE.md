# Architecture — MENTAL OKEY 101

## Current prototype

- React 18, TypeScript, Vite, and Elastic UI for the browser client.
- A typed TypeScript game engine in `shared/game.ts` owns the shuffled 106-tile set, deal, turn, draw/discard, opening, melding, and round scoring.
- A Node.js + Socket.IO server in `server/index.ts` is authoritative for room state and broadcasts each player's private hand plus public table state.
- The client has no account flow. A local player ID, chosen username, and avatar are stored in browser local storage.
- GitHub Pages serves the static client; Render can host the Socket.IO service on its free tier.

## Four-player deployment shape

```text
Browser (React/EUI) ── Socket.IO ── Node.js room server
         │                               │
         └── GitHub Pages                 └── Render free web service
```

There is no database. Rooms and scores exist in server memory and disappear when the service restarts or sleeps. Render's free instance may sleep when idle, so this is suitable for a friends' prototype rather than an always-on service. Each game event is checked by the server, but the rules and scoring are still a first playable subset and need a dedicated rules review before treating results as official.

## Lightweight client notes

CSS draws the table and tiles; no large background images, canvas engine, or animation framework is needed. EUI is used for controls and dialogs, but the full EUI icon module makes the initial JavaScript bundle large (about 891 KB uncompressed / 251 KB gzip at the current build). For older PCs or slower networks, next optimization is loading only the EUI pieces needed or replacing those few controls with native HTML while keeping the React/TypeScript client.

## Deployment setup

1. Push the project to a GitHub repository and enable Pages with GitHub Actions.
2. Create a Render web service from the same repository using `render.yaml`.
3. Set the actual GitHub Pages origin in Render's `CLIENT_ORIGIN` and the Render URL in `.github/workflows/deploy-pages.yml` (`VITE_SERVER_URL`).
4. Push changes to `main`; GitHub Actions builds and publishes the client.

The current workspace has not been connected to a GitHub repository or Render account, so deployment is configured in files but not published.
