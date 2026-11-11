# Project scope audit — MENTAL OKEY 101

Date: 2026-11-03

## Implemented in this prototype

| Area | Current state |
|---|---|
| Client | React 18 + TypeScript + Elastic UI, custom room/table CSS, username/avatar selection. |
| Table setup | 1, 3, 5, 7, or 11 hands; wood/green/blue/burgundy cloth; paired/solo, folding, and assisted options. |
| Multiplayer | Socket.IO room server, six-character room code, four seats, presence, reconnect attempt, chat, and invite-link copy. A solo room can start three basic bots for a practice hand. |
| 101 game slice | 106-tile shuffled set, indicator/joker, hands, stock/discard draw, turn flow, per-player discard history, 101 or five-pair opening, placing tiles onto open melds, round-end screen, and simple score tracking. |
| Rack interaction | Click to select; pointer drag to reorder tiles; drag to a public meld after opening. |
| Hosting setup | GitHub Pages workflow and free Render service configuration are included. Neither service has been connected or deployed from this workspace. |

## Still incomplete / practical limits

- The rule engine is an early playable subset. It needs a careful review for all 101 house rules, penalties, forced discard behavior, opening/lay edge cases, tied results, and paired/folding scoring.
- There is no turn clock/automatic skip, table leave/seat reservation flow, persisted room state, or reliable recovery after a server restart.
- Display names are not authenticated; another player can reuse a name. Do not treat points as secure or competitive.
- Solo/pairs and assisted/folding settings are stored and shown; they do not yet implement a complete distinct ruleset.
- Practice bots take a random draw and discard; they are for trying the controls, not strategic opponents.
- Düz Okey mode is not implemented; this is currently 101 Okey only.
- The EUI import produces a large initial script (~891 KB uncompressed / 251 KB gzip). A lighter UI import strategy is a follow-up for slower computers.
- The current app is online only after the GitHub Pages client and Render server are deployed and their URLs/origins are set. Render free service may sleep and room memory is volatile.

## Build check

`pnpm run build` completes successfully (`tsc -b` and Vite production build). No automated game-rule tests have been run.
