# AGENTS.md

Context for agents working in this repo.

## What this is

A playable Wingspan web app — the foundation for heuristic AI now and RL
experiments later. Modeled on the sibling `catan` project (same stack, same
architecture, net layer ported nearly verbatim).

## Tech stack

TypeScript, Vite, React, Zustand, Vitest, Firebase Realtime Database +
anonymous Auth (shared project `github-games-e7c7d`, data namespaced under
`/wingspan`), GitHub Pages deploy (`base: '/wingspan/'`). No server code.

## Commands

- `npm run dev` — dev server
- `npm run build` — `tsc` + `vite build`
- `npm run test:run` / `npx vitest run` — tests
- `npx tsc --noEmit` — typecheck
- `npm run cards` — regenerate `src/game/data/*.json` from the card DB
  (reads `../wingsearch/src/assets/data/{master,bonus,goals}.json` — see
  `scripts/convert-cards.mjs`)
- `npm run deploy:rules` — merge + deploy RTDB rules (needs firebase auth)

## Architecture

- `src/game/` — pure engine. No React/DOM/net imports. Every state mutation
  goes through `applyAction(state, action) => state` in `engine.ts`.
  Deterministic from `createGame(options)` + the action log; `state.rngState`
  threads the seeded RNG.
  - `types.ts` — GameState, Action, PendingStep (sub-choices powers queue),
    Choice (answers), BirdCard/BonusCard/GoalTile data types.
  - `createGame.ts` — setup from seed (shuffles decks, deals, picks goal tiles).
  - `actions.ts` — the four turn actions + setup + activation + endTurn +
    round/game-end.
  - `powers.ts` — every distinct power text → implementation
    (`POWER_IMPLS`, `PINK_IMPLS`), plus state writers (drawFromDeck,
    tuckCardOnBird, refillFeeder/Tray, firePinkTriggers).
  - `resolve.ts` — resolves pending steps, runs `then` continuations, drops
    impossible steps.
  - `scoring.ts` — goal-tile unit counts + end-game ScoreBreakdown.
  - `cards.ts` — typed accessors over `src/game/data/*.json` (generated).
- `src/ai/` — pure heuristic. `chooseAction(state, playerId) => Action | null`;
  `choices.ts` gives greedy legal answers to pending steps.
- `src/net/` — room transport (ported from catan). `transport.ts` interface,
  `firebaseRoom.ts` (lazy-loaded, `DB_ROOT='wingspan'`, `PROTOCOL_VERSION=1`
  must match `database.rules.json`), `fakeTransport.ts` for tests,
  `identity.ts`, `roomLink.ts`.
- `src/store/` — `gameStore` (game + dispatch/applyLocal/broadcast hooks),
  `networkStore` (rooms, lobby, ActionSync), `actionSync` (log replay /
  rollback), `lobbyGame` (lobby→createGame settings).
- `src/ui/` — React. `GameScreen` runs a draft model for multi-click actions;
  `PendingBar` renders each pending-step kind; `AIDriver` feeds AI seats.

## Engine invariants

- One action per turn: `state.turnTookAction` is set by the four main actions;
  `endTurn` (or round end) clears it. Pending steps must be resolved before
  anything else; only the head of `pending` is answerable.
- Powers queue `PendingStep`s rather than blocking; compound powers chain via
  `PendingTag` continuations (`then`) resolved in `resolve.ts`.
- Die picks index the *live* feeder — it shrinks as dice are taken, so the
  k-th pick's index is against the k-th-smaller feeder.
- `pinkUsed` flags reset at the start of the bird owner's turn.
- Power colors: brown = when activated, pink = once between turns,
  white = when played, teal = end of round, yellow = game end.
  Teal powers drain via `roundEndQueue` during the 'roundEnd' phase
  (after goal scoring, before next round / game end); yellow powers drain
  via `gameEndQueue` during 'gameEnd'. The base set has no teal/yellow birds.
- `settle()` in engine.ts drains the roundEnd/gameEnd queues and computes
  finalScores/winner after every action.
- Goal board: 'green' side = ranked majority scoring, points escalate per
  round (4/1, 5/2/1, 6/3/2, 7/4/3 — see GOAL_POINTS); players with 0 units
  score 0. 'blue' side (1 pt/item, max 5) is unimplemented.
- Round end: goal scored → face-up tray cards discarded + restocked →
  cubes reset → first player rotates → teal queue drains.
- Setup: players keep up to 5 birds and discard 1 food PER BIRD KEPT
  (official: "for each bird card you keep, discard 1 food").
- The deck DOES reshuffle discards when emptied (official rule) — see
  drawFromDeck/refillTray/lookTuck in powers.ts.
- Feeder: empty tray auto-refills all 5; all-same-face (even 1 die) allows
  a reroll before ANY food gain — `reroll` on GainFoodAction and on the
  'dice' Choice (pickDie pending steps).
- Powers are officially "always optional": when-played/pink powers
  auto-fire (all beneficial); optional sub-choices honor `optional`
  (chooseHandTuck decline skips `then`, chooseAdditionalPlay can pass).

## Known gaps (future work)

- Expansion powers: `POWER_IMPLS` covers all distinct core-set texts;
  expansion-only texts warn once and no-op (`hasPowerImpl` is the check).
- Nectar/Oceania scoring stubbed (0), blue (per-item) goal side unimplemented.
- When-played and pink powers auto-fire instead of prompting (all base
  powers are beneficial, so this is a safe simplification).
- Rulebooks for all games live in `docs/` (PDFs — extract with `pdftotext`).
- UI is functional, not pretty: no bird art, no animations.
