# wingspan

Play Wingspan, Wyrmspan, and Finspan in the browser, with bots to test AI
against. TypeScript + Vite + React + Zustand, deterministic seeded engines,
Firebase Realtime Database multiplayer, GitHub Pages hosting. Modeled on the
sibling `catan` project.

```bash
npm run dev          # dev server
npm run test:run     # vitest (262 tests)
npm run build        # typecheck + production build
npm run cards        # regenerate Wingspan card data from wingsearch
npm run deploy:rules # merge + deploy Firebase RTDB rules
```

## Checklist

### Wingspan — base game (`src/wingspan/`)

- [x] Card data pipeline (707 birds, 61 bonus cards, 56 goal tiles converted
      from wingsearch data)
- [x] Deterministic engine (`applyAction`/`settle`, seeded RNG, pending-step
      system for player choices, replayable log)
- [x] Four main actions with column costs, trade slots, and right-to-left
      activation rows
- [x] All core-set power texts implemented and audit-verified against the
      rulebook PDF (when-activated / once-between-turns pink / when-played /
      end-of-round teal / game-end yellow)
- [x] Setup, ranked goal scoring (both board sides), final scoring, tiebreakers
- [x] Heuristic AI (`chooseAction` + greedy pending-step answers)
- [x] UI (board, hand, birdfeeder, tray, bonus cards, pending-choice bar) —
      functional wireframe; art/polish owned by another effort
- [x] Hot-seat / solo vs AI
- [x] Online rooms (Firebase RTDB + anonymous auth, room links, lobby)
- [x] Expansion set selection in game setup (`settings.sets`)

### Wingspan — expansions

- [x] **European** — teal round-end powers, sideways/cover birds, card and
      cached-food payments (`687bad8`)
- [x] **Oceania** — nectar (wild, spoils at round end, end-game habitat
      majorities), Oceania mat, all 95 set power texts (`f3527ed`)
- [x] **Asia** — standalone play, Duet mode (6×6 map, marker placement,
      duet scoring), Flock mode (6–7 players)
- [x] **Americas** — hummingbird subsystem (attract/return/cover, garden,
      track bonuses), all 111 set power texts, americas goals + bonus cards
- [ ] Promo card packs — 144 birds' powers unimplemented (locked as a known
      gap by `src/wingspan/coverage.test.ts`)

### Wyrmspan (`src/wyrmspan/`)

- [x] Engine — excavate/entice/explore actions, adventurer walk, cave cards,
      Dragon Guild track, all 300 ability texts parsed (`fc061e3`)
- [x] Objectives (friendly ties), end-game scoring, tiebreakers
- [x] Heuristic AI
- [x] **Dragon Academy** — fledglings + training tracks, walk-over training,
      income squares, Academy objectives (`f4f3e5e`)
- [ ] 5 Academy Dragon Guild tiles — tile text is garbled in the rules PDF
      and absent from the card data (documented in AGENTS.md)
- [ ] UI, hot-seat wiring, online rooms — engine-only right now

### Finspan (`src/finspan/`)

- [x] Engine — play/dive actions, depth zones, hatchery, schools, weeks,
      achievements (side A + B tiles)
- [x] **Sharks & Reefs** — reef overlay, coral, S&R fish + tiles (`14cb607`)
- [x] Scoring (waves, tokens, schools, consumed, coral) + heuristic AI
- [ ] UI, hot-seat wiring, online rooms — engine-only right now

### Rules audit

- [x] Cross-game audit vs the official rulebook PDFs; ~20 rule bugs found and
      fixed (turn-stall on end-of-turn discards, supply-cache duplication,
      guild-square stacking, explore cost cap, phantom-card payments, …)
- [x] Coverage tests pin every power/ability text to an implementation
- [x] AI self-play sweep over every set, player count, and mode of all three
      games (`src/selfplay.test.ts`); fixed the 8 engine/AI bugs it found (most
      pinned in each engine's `regressions.test.ts`)
- [x] 262 tests, `tsc` clean

### Still to do

- [ ] Deploy GitHub Pages + Firebase rules (needs `firebase login`)
- [ ] Approximations to verify against printed components (documented in
      AGENTS.md): Asia duet map space positions, Americas hummingbird track
      layouts, some Finspan dive-site bonus icons, Wyrmspan guild-track and
      mat-icon data
- [ ] Remaining unsupported goal tiles (unusual count expressions)
- [ ] Wyrmspan/Finspan UI + multiplayer integration
- [ ] Art, animations, UX polish — separate effort, not the engine work
- [ ] Automa / solo variant

### AI experimentation

- [x] Heuristic bots for all three engines
- [ ] Headless self-play runner (bulk games, win-rate stats)
- [ ] RL agent — self-play training loop + model serving
- [ ] Difficulty tiers (random / greedy / search / learned)

## Data sources

- `../wingsearch` — Wingspan card database (`master`, `bonus`, `goals` JSON)
- `../wyrmsearch` — Wyrmspan dragons + caves
- `../finsearch` — Finspan fish + achievements
- `../catan` — architecture reference (net/store layer ported from it)
- `docs/` — official rulebook PDFs (gitignored, local only)
