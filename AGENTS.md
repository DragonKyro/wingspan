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
  (BEFORE goal scoring — they can change it); yellow powers drain
  via `gameEndQueue` during 'gameEnd'.
- `settle()` in engine.ts drains the roundEnd queue, calls `finishRound`
  (goal scoring → tray restock → cube reset → first-player rotation), then
  drains the gameEnd queue and computes finalScores/winner.
- Goal board: 'green' side = ranked majority scoring, points escalate per
  round (4/1, 5/2/1, 6/3/2, 7/4/3 — see GOAL_POINTS); players with 0 units
  score 0. 'blue' side (1 pt/item, max 5) is unimplemented.
- Round end (EE order): teal powers → goal scored → tray discarded +
  restocked → cubes reset → first player rotates.

## European expansion (`set: 'european'`, 81 birds)

- Sideways birds (`Place this bird sideways…`) push a `ghost` PlayedBird into
  the covered slot: it occupies board space/row length and the filled-columns
  goal but is skipped by `playedBirds`, egg/cube targets, and power scans.
- Alternative-cost predators: `coverBird` plays on top of a bird (its eggs +
  caches are discarded, the bird + its tucks go underneath); `cardPayments`
  pays 1 hand card per [rodent] item (the cards tuck behind the bird);
  `cachedFoodPayments` spends food cached on birds. `autoPayBird` in
  helpers.ts builds all three for UI/AI.
- `roundCubes` tracks cubes per action column each round (teal "action cubes
  on their [habitat]" powers); `gainedThisTurn` tracks food types gained per
  turn (European Robin) — reset by `resetPinkFlags`.
- Teal powers resolve in turn order before goal scoring; a teal-power bird
  played mid-roundEnd (Yellowhammer's extra play) fires immediately.
- "Counts double" teal birds contribute weight 2 in `goalScore` via
  `goalWeight`; "white & no powers" goal counts no-power AND white birds.
- New bonus-card scorers (Citizen Scientist, Diet Specialist, Ethologist,
  Behaviorist) live in `scoring.ts` `bonusUnits`; `[automa] …` bonus cards
  are filtered out of `bonusCardsInSets`.
- New PendingStep kinds: choosePlayer/chooseHabitat/chooseFoodDiscard/
  chooseFoodSteal/chooseTrayCard/chooseDieRemove/chooseBirds/assignHandTucks/
  chooseCacheOnBirds/chooseFoodType/chooseOption — all answered by
  `greedyChoice` in ai/choices.ts and rendered in PendingBar.
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

## Oceania expansion (`set: 'oceania'`, 95 birds)

- Nectar is a sixth food type and a die face (replaces the split face —
  `OCEANIA_DIE_FACES`). It's wild for food costs (`payFoodPlan`), tracked in
  `p.nectarSpent[habitat]` when spent, and discarded from the supply at
  round end after teal powers, before goal scoring (`finishRound`).
- End-game nectar majorities: `nectarPoints` in scoring.ts — per habitat,
  most spent nectar = 5 pts, second = 2 (`NECTAR_POINTS`); ties share the
  rank and skip the next.
- Every supply gain routes through `grantSupplyFood` (records the gain and
  fires the `gainNectar` pink watch — Spangled Drongo). Feeder nectar gains
  fire it in `takeDieFromFeeder`.
- The Oceania mat has 6 benefit boxes (the 6th only when a row is full —
  `actionSlot(p, h, oceania)`); constants `OCEANIA_*` in constants.ts give
  per-slot dice/eggs/cards plus reset/trade slots. Action fields:
  `GainFoodAction.rerollCost`, `LayEggsAction.extraTrades`,
  `DrawCardsAction.tradeNectar`/`resetTrayCost`, all validated in actions.ts.
- Players start with 1 nectar (can't be discarded during setup keeps).
- New PendingStep kinds: chooseCopyPower (Tūī/Lyrebird copy),
  chooseTrayCardEx (nest/wingspan filters + tray reset + hand-or-tuck
  destination), chooseTuckOrHand, chooseCacheFromSupply. Plus
  chooseBirdForEgg gains `onlyBird`/`adjacentTo`/`wingspanLt`,
  chooseBirdForEggDiscard gains `habitat`, chooseBirds gains
  `exclude`/`nest`/`eggsMin`, chooseBonusCards gains `fromDiscard`
  (Wrybill, using `state.bonusDiscard`), choosePlayer/chooseFoodDiscard/
  discardBonusCards gain `optional` declines (a declined optional drops its
  `then`), chooseWildTrade/chooseFoodDiscard track `spentHabitat` nectar,
  chooseAdditionalPlay gains `eggDiscount`.
- New PowerOptions: gainFruit/fruitToNectar (Mistletoebird),
  selfEggs2/gain2Dice (Red-Winged Parrot).
- "Copy a brown power" runs the target's POWER_IMPLS with the copier's
  playerId/ref; "play another bird" powers can fire the played bird's
  yellow (game-end) power immediately per the card text.

## Asia expansion (`set: 'asia'`, 90 birds)

- All 88 distinct asia power texts are implemented (86 in POWER_IMPLS,
  2 pinks: Asian Koel + Violet Cuckoo over-limit egg lays).
- New PendingStep kinds: chooseDuetSpace, chooseResources (mixed
  food+eggs+cards payment), chooseTrayDiscard, moveBirdToPlayer, confirm
  (yes/no gate for "you may"), chooseHandPick (inspect-only pick),
  choosePoolTuck (tuck some of a drawn pool), chooseCopyPlayed (white-power
  copy on a neighbour), chooseReroll (feeder dice), drawUpTo (draw-or-stop).
- New Choice kinds: resources, duetSpace, playedTarget. New PowerOptions:
  trayCard/gainSeed/tuckDeckCard/asiaCacheWild/asiaTuckHand.
- chooseBirdForEgg gained `columnOf`; chooseBonusCards gained `fromHand`
  (score-now powers) and `copyFrom` (Adjutants → `p.copiedBonus`, scored at
  game end against the copier's own birds).
- Tracked state: `p.feederGainedThisTurn` (dice-only gains, reset per turn),
  `b.eggsGainedThisTurn`/`b.cachedGainedThisTurn` (per-bird, reset per turn),
  `p.copiedBonus`.
- "feasible()" returns deliverable capacity (not a boolean) — count-bearing
  steps get clamped to it, so return `min(count, realCapacity)`.

### Duet mode (`settings.mode: 'duet'`, exactly 2 players)

- `state.duet` = 36-space fixed map (`duetMap.ts` DUET_MAP: 3 habitat regions
  × 12 spaces, each with a nest/food/wingspan/beak criterion, 9 bonus spaces)
  + an unbounded reset space. Every played bird queues a chooseDuetSpace
  (2 steps for "counts double" birds); bonus spaces grant a die/egg/card.
- Reset-space tokens fund `duetReset` actions (reset feeder or tray, any time
  on your turn). Goal scoring: winner takes DUET_GOAL_POINTS[r] (ties share),
  loser gets next round's first-player token. End game: +1 pt per token in
  the largest contiguous group (duetLargestGroup, hex-grid neighbours).
- Duet goal tiles are ids 2034–2045 (6 double-sided tiles, random 4 sides).

### Flock mode (`settings.mode: 'flock'`, 6–7 players)

- Standard tiles, FLOCK_GOAL_POINTS table (friendly ties share a rank).

## Known gaps (future work)

- `POWER_IMPLS` covers all distinct core + european + oceania + asia texts;
  other expansion texts warn once and no-op (`hasPowerImpl` is the check).
  The Amazonian Parrotlet (promo) has no implementation.
- The printed duet map layout is approximated (region criterion counts are
  official; exact space positions are not public data).
- Blue (per-item) goal side unimplemented.
- Oceania mat trades/reset options exist in the actions but the UI draft
  flow doesn't expose them yet (AI skips them too — always optional).
- When-played and pink powers auto-fire instead of prompting (all base
  powers are beneficial, so this is a safe simplification). European pinks
  that say "at the end of their turn" fire immediately.
- `endOfTurnDiscards` discards are picked from the whole hand, not the drawn
  subset ("keep 1 of the drawn cards" is not strictly enforced).
- Rulebooks for all games live in `docs/` (PDFs — extract with `pdftotext`).
- UI is functional, not pretty: no bird art, no animations. Sideways birds
  always cover 2 spaces when legal (the "may" is not offered).
