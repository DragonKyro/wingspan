// Interactive paginated Rulebook modal & visual spreads for Wingspan,
// Wyrmspan, and Finspan (modeled on card-collecting's RulesBook.tsx and
// catan's Rulebook.tsx).

import { useState, type ReactNode } from 'react';
import {
  EggTokenSvg,
  FinIcon,
  FoodIcon,
  HabitatIcon,
  NestIcon,
  WyrmResourceIcon,
} from './svgArt';

export interface RulesPage {
  title: string;
  body: ReactNode;
}

export function RulesBook({ pages }: { pages: RulesPage[] }) {
  const [idx, setIdx] = useState(0);
  const safeIdx = Math.max(0, Math.min(idx, pages.length - 1));
  const page = pages[safeIdx]!;
  return (
    <div className="rules-book">
      <div className="rules-book-header">
        <span className="rules-book-page-no">
          Page {safeIdx + 1} / {pages.length}
        </span>
        <h4 className="rules-book-title">{page.title}</h4>
      </div>
      <div className="rules-book-body">{page.body}</div>
      <div className="rules-book-nav">
        <button
          type="button"
          className="secondary"
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          disabled={safeIdx === 0}
        >
          ← Prev
        </button>
        <div className="rules-book-dots">
          {pages.map((p, i) => (
            <button
              key={i}
              type="button"
              className={`rules-book-dot${i === safeIdx ? ' active' : ''}`}
              title={p.title}
              onClick={() => setIdx(i)}
              aria-label={`Page ${i + 1}: ${p.title}`}
            />
          ))}
        </div>
        <button
          type="button"
          className="secondary"
          onClick={() => setIdx((i) => Math.min(pages.length - 1, i + 1))}
          disabled={safeIdx === pages.length - 1}
        >
          Next →
        </button>
      </div>
    </div>
  );
}

export function RulesModal({
  gameId,
  onClose,
}: {
  gameId: 'wingspan' | 'wyrmspan' | 'finspan';
  onClose: () => void;
}) {
  const title =
    gameId === 'wingspan'
      ? 'Wingspan & Expansions — Rulebook'
      : gameId === 'wyrmspan'
        ? 'Wyrmspan & Dragon Academy — Rulebook'
        : 'Finspan & Sharks & Reefs — Rulebook';
  const pages =
    gameId === 'wingspan'
      ? WINGSPAN_PAGES
      : gameId === 'wyrmspan'
        ? WYRMSPAN_PAGES
        : FINSPAN_PAGES;

  return (
    <div className="rules-modal-backdrop" onClick={onClose}>
      <div className="rules-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rules-modal-header">
          <h3>📖 {title}</h3>
          <button type="button" className="secondary" onClick={onClose}>
            ✕ Close
          </button>
        </div>
        <div className="rules-modal-content">
          <RulesBook pages={pages} />
        </div>
      </div>
    </div>
  );
}

function Hero({ title, subtitle, color }: { title: string; subtitle: string; color: string }) {
  return (
    <div className="rules-hero" style={{ borderLeft: `4px solid ${color}` }}>
      <strong>{title}</strong>
      <span>{subtitle}</span>
    </div>
  );
}

function Tile({
  icon,
  label,
  hint,
}: {
  icon?: ReactNode;
  label: ReactNode;
  hint: ReactNode;
}) {
  return (
    <div className="rules-tile">
      {icon && <div className="rules-tile-icon">{icon}</div>}
      <div>
        <div className="rules-tile-label">{label}</div>
        <div className="rules-tile-hint">{hint}</div>
      </div>
    </div>
  );
}

const WINGSPAN_PAGES: RulesPage[] = [
  {
    title: 'Overview & Setup',
    body: (
      <div className="rules-spread">
        <Hero
          title="Wingspan (1–7 Players)"
          subtitle="Build a wildlife preserve across Forest, Grassland, and Wetland habitats over 4 rounds."
          color="#4a7c59"
        />
        <p>
          Each player begins with <b>5 bird cards</b>, <b>2 bonus cards</b>, and <b>1 of each base food</b>{' '}
          (<FoodIcon food="invertebrate" size={14} /> <FoodIcon food="seed" size={14} />{' '}
          <FoodIcon food="fish" size={14} /> <FoodIcon food="fruit" size={14} />{' '}
          <FoodIcon food="rodent" size={14} />). For each bird card you keep, discard 1 food token, and
          keep 1 of your 2 bonus cards. (With <b>Oceania</b>, you also gain 1 <FoodIcon food="nectar" size={14} /> Nectar after setup.)
        </p>
        <div className="rules-grid">
          <Tile
            icon={<HabitatIcon habitat="forest" size={22} />}
            label="Forest — Gain Food"
            hint="Take food dice from the birdfeeder, then activate brown powers right-to-left."
          />
          <Tile
            icon={<HabitatIcon habitat="grassland" size={22} />}
            label="Grassland — Lay Eggs"
            hint="Place eggs on birds up to their egg limit, then activate brown powers right-to-left."
          />
          <Tile
            icon={<HabitatIcon habitat="wetland" size={22} />}
            label="Wetland — Draw Cards"
            hint="Draw face-up birds from the tray or face-down from the deck, then activate brown powers."
          />
          <Tile
            icon={<EggTokenSvg index={0} size={20} />}
            label="Play a Bird"
            hint="Pay its food cost + column egg cost (0 / 1 / 1 / 2 / 2 eggs) and trigger any white power."
          />
        </div>
      </div>
    ),
  },
  {
    title: 'Powers, Feeder & Nests',
    body: (
      <div className="rules-spread">
        <Hero
          title="Five Power Timings & Four Nest Types"
          subtitle="All bird powers are optional. Brown powers fire right-to-left when you activate a habitat."
          color="#e0a458"
        />
        <div className="rules-grid">
          <Tile label="🟫 Brown — When Activated" hint="Fires as your action cube walks right-to-left down the habitat row." />
          <Tile label="⬜ White — When Played" hint="Fires once immediately when you play the bird from your hand." />
          <Tile label="🩷 Pink — Once Between Turns" hint="Fires on an opponent's turn when its trigger occurs; resets at your turn start." />
          <Tile label="🟦 Teal — Round End (European/Asia)" hint="Fires at the end of each round before the round goal is scored." />
          <Tile label="🟨 Yellow — Game End (Oceania/Asia)" hint="Fires once after Round 4 before final victory points are tallied." />
          <Tile
            icon={
              <span style={{ display: 'flex', gap: 3 }}>
                <NestIcon nest="bowl" size={16} />
                <NestIcon nest="cavity" size={16} />
                <NestIcon nest="ground" size={16} />
                <NestIcon nest="platform" size={16} />
                <NestIcon nest="wild" size={16} />
              </span>
            }
            label="Nest Types"
            hint="Bowl, Cavity, Ground, Platform, and Star (wild — counts as every nest type)."
          />
        </div>
        <p className="muted">
          <b>Birdfeeder reroll:</b> Whenever you are about to gain food from the birdfeeder and all dice currently in the tray show the <i>same face</i> (including when only 1 die remains), you may reroll all 5 dice first. When paying to play a bird, any 2 food tokens may substitute for any 1 required food.
        </p>
      </div>
    ),
  },
  {
    title: 'Expansions: European, Oceania, Asia & Americas',
    body: (
      <div className="rules-spread">
        <Hero
          title="All Four Official Expansions"
          subtitle="Mix any combination of sets or play Asia Duet (2p) / Flock (6–7p) modes."
          color="#c44569"
        />
        <div className="rules-grid">
          <Tile
            label="🇪🇺 European Expansion"
            hint="Teal round-end powers, sideways birds covering 2 spaces, raptor cover-plays, and paying rodent costs with hand cards."
          />
          <Tile
            icon={<FoodIcon food="nectar" size={20} />}
            label="🇦🇺 Oceania Expansion"
            hint="Nectar wild food (spoils at round end; scores 5/2 habitat majorities at game end) and the 6-column Oceania player mat."
          />
          <Tile
            label="🌏 Asia — Duet & Flock"
            hint="Duet Mode adds a shared 6×6 Duet Map where each bird places a Yin-Yang token (+1 VP per token in your largest contiguous group). Flock Mode scales up to 6–7 players."
          />
          <Tile
            label="🌎 Americas — Hummingbirds"
            hint="Every habitat row ends with a hummingbird action: attract a hummingbird from the 5-slot garden to an empty space for its benefit, or return one to advance on the 5-column Hummingbird Track."
          />
        </div>
      </div>
    ),
  },
];

const WYRMSPAN_PAGES: RulesPage[] = [
  {
    title: 'Overview & Three Actions',
    body: (
      <div className="rules-spread">
        <Hero
          title="Wyrmspan (1–5 Players)"
          subtitle="Excavate caverns, entice dragons into your sanctuary, and explore with your adventurer."
          color="#e09f3e"
        />
        <p>
          Each round, players start with <b>6 silver coins</b> (<WyrmResourceIcon kind="coin" size={14} />) and{' '}
          <b>1 egg</b> (<WyrmResourceIcon kind="egg" size={14} />). Instead of action cubes, every turn costs{' '}
          <b>1 coin</b> (plus escalating eggs for deeper excavations or repeated cave explorations) until you choose to pass.
        </p>
        <div className="rules-grid">
          <Tile
            icon={<WyrmResourceIcon kind="caveCard" size={22} />}
            label="1. Excavate a Cave Space"
            hint="Pay 1 coin (+1 egg on col 3, +2 eggs on col 4) to place a Cave Card into the leftmost unexcavated space and trigger its When Played benefit."
          />
          <Tile
            icon={<WyrmResourceIcon kind="dragonCard" size={22} />}
            label="2. Entice a Dragon"
            hint="Pay 1 coin + the dragon's printed resource/egg/coin cost to place it on an excavated cave space matching its habitat."
          />
          <Tile
            icon={<WyrmResourceIcon kind="guild" size={22} />}
            label="3. Explore a Cave"
            hint="Pay 1 coin (1st entry), +1 egg (2nd), or +2 eggs (3rd, max 3/round). Walk your adventurer left-to-right activating mat icons & dragon abilities until reaching an empty space."
          />
          <Tile
            icon={<WyrmResourceIcon kind="egg" size={22} />}
            label="Dragon Guild & Scoring"
            hint="Advancing on the Dragon Guild rondel grants immediate bonuses and lets you place markers on the Guild Tile on brown spaces."
          />
        </div>
      </div>
    ),
  },
  {
    title: 'Dragon Academy Expansion',
    body: (
      <div className="rules-spread">
        <Hero
          title="Dragon Academy Expansion"
          subtitle="Train fledgling dragons, claim pass-income bonuses, and master 5 new Dragon Guilds."
          color="#9b6bd6"
        />
        <div className="rules-grid">
          <Tile
            label="🐣 Fledgling Dragons"
            hint="Fledglings have a training track of cost boxes. Whenever your adventurer walks over a fledgling during Explore (or via guild/card effects), you may pay to train its next box. Once fully trained, its ability unlocks! Fledglings score 1 VP per fledgling on your mat."
          />
          <Tile
            label="🏛 Pass Income Tracker"
            hint="In Rounds 1–3, when you pass you place your adventurer on an unoccupied income space on the Round Tracker to choose your next round's starting coins, eggs, resources, cards, or guild steps."
          />
          <Tile
            label="🛡 5 New Dragon Guilds"
            hint="Gambler's Guild, King's Guild (tithe payments), Veterinary Guild (double cache/tuck), Guild of Magicians (swap dragons or caves from hand), and Guild of Merchants."
          />
        </div>
      </div>
    ),
  },
];

const FINSPAN_PAGES: RulesPage[] = [
  {
    title: 'Overview: Play a Fish or Dive',
    body: (
      <div className="rules-spread">
        <Hero
          title="Finspan (1–5 Players)"
          subtitle="Explore Sunlight, Twilight, and Midnight ocean zones across 4 weeks (6 turns per week)."
          color="#48cae4"
        />
        <p>
          Each player has <b>6 divers</b> per week. On your turn, either <b>Play a Fish</b> into a matching depth zone / dive site, or send a diver down one of the <b>3 Dive Sites</b> (Blue = Cards, Purple = Eggs, Green = Hatch & Move).
        </p>
        <div className="rules-grid">
          <Tile
            icon={<FinIcon kind="egg" size={22} />}
            label="Eggs & Young"
            hint="Eggs are laid on fish (max 1 egg per fish). Hatching turns an egg into a Young fish token."
          />
          <Tile
            icon={<FinIcon kind="school" size={22} />}
            label="Schools (6 VP)"
            hint="Whenever 3 Young share a single slot, they immediately merge into a School token worth 6 VP at game end!"
          />
          <Tile
            icon={<FinIcon kind="consume" size={22} />}
            label="Consuming Smaller Fish"
            hint="A fish may be played on top of a strictly shorter fish on your mat (tucking it underneath for 1 VP per consumed fish)."
          />
          <Tile
            icon={<FinIcon kind="coral" size={22} />}
            label="Sharks & Reefs Expansion"
            hint="While diving through the Twilight zone, you may discard the site's reef overlay item (egg, young, or card) to place 1 Coral. Completing 6 coral in a site awards +6 / +8 / +5 bonus VP!"
          />
        </div>
      </div>
    ),
  },
];
