# wingspan

Play **Wingspan**, **Wyrmspan**, and **Finspan** (plus all of their expansions)
in the browser, with heuristic bots to test AI against. TypeScript + Vite +
React + Zustand, deterministic seeded engines, custom SVG artwork & FLIP card
animations, Firebase Realtime Database multiplayer, GitHub Pages hosting.
Modeled on the sibling `catan` and `card-collecting` projects.

```bash
npm run dev          # dev server
npm run test:run     # vitest (284 tests across 16 test files)
npm run build        # typecheck + production build
npm run cards        # regenerate Wingspan card data from wingsearch
npm run deploy:rules # merge + deploy Firebase RTDB rules
```

## Checklist

### Wingspan — base game & all expansions (`src/wingspan/`)

- [x] Card data pipeline (707 birds, 61 bonus cards, 56 goal tiles, 40
      hummingbirds converted from wingsearch data)
- [x] Deterministic engine (`applyAction`/`settle`, seeded RNG, pending-step
      system for player choices, replayable log)
- [x] Four main actions with column costs, trade slots, and right-to-left
      activation rows
- [x] **100% power coverage across all 707 birds** (Base, European, Oceania,
      Asia, Americas, and all 6 Promo packs — `src/wingspan/coverage.test.ts`)
- [x] Setup, ranked Green-side AND per-item Blue-side goal scoring, final
      scoring, tiebreakers
- [x] **European Expansion** — teal round-end powers, sideways/cover birds,
      card and cached-food payments
- [x] **Oceania Expansion** — nectar (wild, spoils at round end, end-game 5/2
      habitat majorities), 6-column Oceania player mat, all 95 set power texts,
      Oceania bonus cards & goal rulings verified against `bird ocean.pdf`
- [x] **Asia Expansion** — standalone play, Duet mode (exact 6×6 Duet Map
      transcribed from rulebook, Yin-Yang token placement, contiguous-group
      scoring), Flock mode (6–7 players)
- [x] **Americas Expansion** — hummingbird subsystem (attract/return/cover,
      5-slot garden, exact printed Hummingbird Track bonus spaces & ladder),
      all 111 set power texts, Americas goals & bonus cards
- [x] **Promo Card Packs** — all 150 promo birds (`promoUS`, `promoEurope`,
      `promoAsia`, `promoNZ`, `promoCA`, `promoUK`) implemented

### Wyrmspan & Dragon Academy (`src/wyrmspan/`)

- [x] Engine — excavate/entice/explore actions, continuation-chained adventurer
      walk, cave cards, exact 5-segment printed player-mat path icons & 4th-col
      when-covered benefit, 100% ability coverage (`KNOWN_PARTIAL` = 0)
- [x] Dragon Guild — exact 12-space rondel track, all 4 base guild tiles
      (Seafarers, Highlands, Plains, Rainforest), and all **5 Dragon Academy
      guild tiles** (Merchants, Gamblers, Kings with tithes, Veterinary,
      Magicians with dragon/cave swaps)
- [x] **Dragon Academy** — fledgling dragons + training tracks, walk-over
      training, pass-income round tracker, Academy objectives, and replacement
      card deduplication
- [x] Objectives (friendly ties), end-game scoring, tiebreakers, heuristic AI

### Finspan & Sharks & Reefs (`src/finspan/`)

- [x] Engine — play/dive actions, Sunlight/Twilight/Midnight depth zones, exact
      printed Ocean Mat (`INITIAL_OCEAN` forage fish & starting tokens,
      `DIVE_BONUSES`), schools, weeks, Side A + Side B achievements (+3 leader
      bonus)
- [x] **Sharks & Reefs** — printed coral reef overlays, coral placement &
      completion bonuses (`+6 / +8 / +5`), S&R fish + achievement tiles
- [x] All 215 fish abilities implemented (including `[Discard]` discard-pile
      recovery and multi-step ability chaining) + heuristic AI

### UI, UX, Thematic SVG Art & Animations (`src/ui/`)

- [x] Multi-game picker (`Wingspan`, `Wyrmspan`, `Finspan`) with custom
      280×140 SVG scene thumbnails (`src/ui/MenuScreen.tsx`)
- [x] Local & Online Lobby supporting all 3 games, expansions, modes, color
      swatch picker, and live room chat (`src/ui/LobbyScreen.tsx`)
- [x] Full interactive game views for all 3 games (`GameScreen.tsx`,
      `WyrmspanScreen.tsx`, `FinspanScreen.tsx`) with solo undo & AI speed toggle
- [x] Hand-crafted SVG artwork & inline iconizers (`src/ui/svgArt.tsx`) for
      birds, dragons, caves, fish, dice, food, resources, eggs, nests, schools,
      coral, and meeples
- [x] Smooth Web Animations API FLIP card flights, token pulses, and live
      action toast banners (`src/ui/fx.tsx`)
- [x] Interactive paginated Rulebook modal (`src/ui/RulesBook.tsx`) and
      post-game SVG Match Statistics charts & tables (`src/ui/MatchCharts.tsx`)

### Rules Audit & Verification

- [x] Visual + textual audit against all 9 official rulebook PDFs (`bird.pdf`,
      `bird europe.pdf`, `bird ocean.pdf`, `bird asia.pdf`, `bird america.pdf`,
      `dragon.pdf`, `academy.pdf`, `fish.pdf`, `sharks.pdf`)
- [x] AI self-play sweep across every set, player count, and mode of all three
      games (`src/selfplay.test.ts`)
- [x] 284 tests passing across 16 test files, `tsc` & `vite build` clean

### Still to do

- [ ] Deploy GitHub Pages + Firebase rules (needs `firebase login`)
- [ ] Automa / solo card-deck variant
- [ ] Headless self-play runner & RL policy training loop

## Data sources

- `../wingsearch` — Wingspan card database (`master`, `bonus`, `goals` JSON)
- `../wyrmsearch` — Wyrmspan dragons + caves
- `../finsearch` — Finspan fish + achievements
- `../catan` & `../card-collecting` — architecture & UI/UX references
- `docs/` — official rulebook PDFs (gitignored, local only)
