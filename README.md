# wingspan

Play Wingspan — and eventually Wyrmspan and Finspan — in the browser, with
bots to test AI against. TypeScript + Vite + React + Zustand, deterministic
game engine, Firebase Realtime Database multiplayer, GitHub Pages hosting.
Modeled on the sibling `catan` project.

```bash
npm run dev          # dev server
npm run test:run     # vitest
npm run build        # typecheck + production build
npm run cards        # regenerate card data from wingsearch
npm run deploy:rules # merge + deploy Firebase RTDB rules
```

## Checklist

### Wingspan — base game

- [x] Card data pipeline (707 birds, 61 bonus cards, 56 goal tiles converted
      from wingsearch data)
- [x] Deterministic engine core (`applyAction`, seeded RNG, replayable log)
- [x] Four main actions (gain food / lay eggs / draw cards / play bird)
      with column costs and activation rows
- [x] Bird powers — all distinct core-set texts
      (when-activated / once-between-turns / when-played /
      end-of-round / game-end)
- [x] End-of-round goals + end-game scoring (points, eggs, cached, tucked, bonus)
- [x] Heuristic AI (`chooseAction` + greedy pending-step answers)
- [x] UI (board, hand, birdfeeder, tray, bonus cards, pending-choice bar)
- [x] Hot-seat / solo vs AI
- [x] Online rooms (Firebase RTDB + anonymous auth, room links, lobby)
- [x] Tests (engine, AI full-game sim, fake transport) — 11 passing
- [ ] Deploy to GitHub Pages + deploy Firebase rules (needs `firebase login`)
- [ ] 22 goal tiles skipped by the converter (unusual count expressions)
- [ ] Oceania nectar scoring (stubbed at 0)
- [ ] Blue-side (1 point per item) goal tiles — green/ranked side is default
- [ ] Bird art, animations, sound — visual polish
- [ ] Undo (solo), game log UI, replay viewer
- [ ] Tournament/duet/automa variants

### Wingspan — expansions

Card data for all of these is already converted; each needs its powers
implemented in `POWER_IMPLS`/`PINK_IMPLS` plus its new mechanics.

- [ ] **European** — round-end powers, new bonus cards
- [ ] **Oceania** — nectar resource (wild, spoils at round end), new
      food dice, player mat with nectar costs
- [ ] **Asia** — duet mode board, flocking mode
- [ ] **Americas** — new birds/hummingbirds
- [ ] Promo card packs
- [ ] Expansion toggle in game setup (card pool selection)

### Wyrmspan

- [ ] Card data pipeline from wyrmsearch (dragons + caves)
- [ ] Engine variant: caves excavated before dragons, adventurer meeple,
      Dragon Guild track, resource types
- [ ] Powers (hatch/ability types differ from Wingspan)
- [ ] Scoring
- [ ] UI (cave/dragon cards, guild track)
- [ ] AI
- [ ] **Dragon Academy expansion**

### Finspan

- [ ] Card data pipeline from finsearch
- [ ] Engine variant: fish dive down depth zones, schools, no eggs
- [ ] Scoring
- [ ] UI
- [ ] AI

### AI experimentation

- [x] Heuristic bot (playable opponent)
- [ ] Headless self-play runner (bulk games, win-rate stats)
- [ ] RL agent — self-play training loop + model serving
- [ ] Difficulty tiers (random / greedy / search / learned)

## Data sources

- `../wingsearch` — Wingspan card database (`master`, `bonus`, `goals` JSON)
- `../wyrmsearch` — Wyrmspan cards
- `../finsearch` — Finspan cards
- `../catan` — architecture reference (net/store layer ported from it)
