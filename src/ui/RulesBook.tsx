// Comprehensive, easy-to-read visual Rulebook modal & spreads for Wingspan,
// Wyrmspan, and Finspan (including all expansions and official Automa/Nautoma
// solo modes). Modeled on catan's Rulebook and card-collecting's RulesBook.

import { useState, type ReactNode } from 'react';
import {
  ActionCubeSvg,
  AdventurerMeepleSvg,
  DiverMeepleSvg,
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
      <div className="rules-toc">
        {pages.map((p, i) => (
          <button
            key={i}
            type="button"
            className={`rules-toc-btn${i === safeIdx ? ' active' : ''}`}
            onClick={() => setIdx(i)}
          >
            {i + 1}. {p.title}
          </button>
        ))}
      </div>
      <div className="rules-book-header">
        <span className="rules-book-page-no">
          Page {safeIdx + 1} of {pages.length}
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
          ← Previous
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
  gameId: initialGameId,
  onClose,
}: {
  gameId: 'wingspan' | 'wyrmspan' | 'finspan';
  onClose: () => void;
}) {
  const [gameId, setGameId] = useState<'wingspan' | 'wyrmspan' | 'finspan'>(initialGameId);
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
          <div className="row">
            <h3>📖 Rulebook</h3>
            <div className="pill-group">
              {(['wingspan', 'wyrmspan', 'finspan'] as const).map((gid) => (
                <button
                  key={gid}
                  type="button"
                  className={gameId === gid ? 'primary' : 'secondary'}
                  onClick={() => setGameId(gid)}
                >
                  {gid === 'wingspan' ? '🪶 Wingspan' : gid === 'wyrmspan' ? '🐉 Wyrmspan' : '🐟 Finspan'}
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="secondary" onClick={onClose}>
            ✕ Close
          </button>
        </div>
        <div className="rules-modal-content">
          <RulesBook key={gameId} pages={pages} />
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

// ============================================================================
// WINGSPAN RULEBOOK (6 PAGES)
// ============================================================================

const WINGSPAN_PAGES: RulesPage[] = [
  {
    title: 'Setup & Turn Flow',
    body: (
      <div className="rules-spread">
        <Hero
          title="Wingspan (1–7 Players · 4 Rounds)"
          subtitle="Build an engine of birds across Forest, Grassland, and Wetland habitats to score the most Victory Points."
          color="#4a7c59"
        />
        <p>
          <b>Setup:</b> Each player receives <b>5 Bird Cards</b>, <b>2 Bonus Cards</b>, and{' '}
          <b>1 of each base food</b> (<FoodIcon food="invertebrate" size={14} />{' '}
          <FoodIcon food="seed" size={14} /> <FoodIcon food="fish" size={14} />{' '}
          <FoodIcon food="fruit" size={14} /> <FoodIcon food="rodent" size={14} />). Keep as many
          of your 5 birds as you wish, but <b>discard 1 food token for each bird kept</b> (keep 3
          birds → keep 2 food). Keep <b>1 of your 2 Bonus Cards</b> and discard the other. With{' '}
          <b>Oceania</b>, each player also starts with 1 <FoodIcon food="nectar" size={14} /> Nectar
          gained after setup choices.
        </p>
        <div className="rules-grid">
          <Tile
            icon={<ActionCubeSvg color="orange" size={22} />}
            label="Action Cubes per Round"
            hint="Round 1: 8 cubes · Round 2: 7 cubes · Round 3: 6 cubes · Round 4: 5 cubes (1 cube sits on each round's Goal scoreboard)."
          />
          <Tile
            icon={<EggTokenSvg index={0} size={20} />}
            label="One Action per Turn"
            hint="On your turn, spend 1 action cube on Play a Bird, Gain Food (Forest), Lay Eggs (Grassland), or Draw Cards (Wetland)."
          />
        </div>
      </div>
    ),
  },
  {
    title: 'The Four Actions',
    body: (
      <div className="rules-spread">
        <Hero
          title="Playing Birds & Activating Habitat Rows"
          subtitle="Playing birds left-to-right makes your habitat actions stronger and unlocks brown powers."
          color="#e0a458"
        />
        <div className="rules-grid">
          <Tile
            icon={<EggTokenSvg index={1} size={20} />}
            label="1. Play a Bird from Hand"
            hint="Place a bird in the leftmost empty slot of a matching habitat. Pay its Column Egg Cost (Col 1: 0🥚, Cols 2–3: 1🥚, Cols 4–5: 2🥚) from any birds on your mat + its Food Cost (any 2 food tokens may substitute for any 1 required food icon). Trigger any White 'When Played' power."
          />
          <Tile
            icon={<HabitatIcon habitat="forest" size={22} />}
            label="2. Forest — Gain Food"
            hint="Gain dice from the Birdfeeder based on the leftmost empty slot (Base: 1/1/2/2/3 dice; Oceania: 1/2/2/2/3/3). Trade 1 hand card for +1 die on trade slots. Then activate Brown powers right-to-left."
          />
          <Tile
            icon={<HabitatIcon habitat="grassland" size={22} />}
            label="3. Grassland — Lay Eggs"
            hint="Lay eggs on any birds on your mat up to each bird's egg limit (Base: 2/2/3/3/4 eggs; Oceania: 1/2/2/2/3/4). Trade 1 food for +1 egg on trade slots. Then activate Brown powers right-to-left."
          />
          <Tile
            icon={<HabitatIcon habitat="wetland" size={22} />}
            label="4. Wetland — Draw Cards"
            hint="Draw face-up cards from the Bird Tray or face-down from the Deck (Base: 1/1/2/2/3 cards; Oceania: 1/2/2/2/3/4). Trade 1 egg for +1 card on trade slots. Tray refills at the end of your turn."
          />
        </div>
        <p className="muted">
          <b>Birdfeeder Reroll Rule:</b> Whenever you are about to gain food from the birdfeeder (from
          an action or a power) and all dice currently inside the tray show the <i>same face</i>{' '}
          (including when only 1 die remains), you may reroll all 5 dice first. When the feeder
          empties, all 5 dice automatically reroll.
        </p>
      </div>
    ),
  },
  {
    title: 'Powers, Nests & Icons',
    body: (
      <div className="rules-spread">
        <Hero
          title="Five Power Colors & Four Nest Types"
          subtitle="All bird powers are optional. You may decline or skip any power."
          color="#c44569"
        />
        <div className="rules-grid">
          <Tile label="🟫 Brown — When Activated" hint="Triggers right-to-left each time you take that habitat's row action." />
          <Tile label="⬜ White — When Played" hint="Triggers once immediately when you play the bird onto your mat." />
          <Tile label="🩷 Pink — Once Between Turns" hint="Triggers on an opponent's turn when its condition occurs; re-arms at the start of your next turn." />
          <Tile label="🟦 Teal — Round End" hint="Triggers at the end of each of the 4 rounds, BEFORE the Round Goal is scored." />
          <Tile label="🟨 Yellow — Game End" hint="Triggers once after Round 4 ends, before final Victory Points are counted." />
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
            label="Nest Types & Wild Star Nests"
            hint="Bowl, Cavity, Ground, Platform, and Star (Wild — counts as every nest type for goals, bonus cards, and powers). Flightless (*) wingspan counts as wild for < X and > X comparisons."
          />
        </div>
      </div>
    ),
  },
  {
    title: 'Goals & Final Scoring',
    body: (
      <div className="rules-spread">
        <Hero
          title="End-of-Round Goals & End-of-Game Victory Points"
          subtitle="At the end of each round: Teal powers → discard unspent Nectar → score Goal → wipe & refill Tray."
          color="#4f8ba9"
        />
        <div className="rules-grid">
          <Tile
            label="🟩 Green Goal Board (Ranked Majority)"
            hint="Compete for 1st / 2nd / 3rd place each round: R1 = 4/1/0 · R2 = 5/2/1 · R3 = 6/3/2 · R4 = 7/4/3. Tied players sum the tied places and divide evenly (rounded down). You must have ≥1 qualifying unit to score!"
          />
          <Tile
            label="🟦 Blue Goal Board (1 pt / item)"
            hint="Non-competitive: score 1 point per qualifying item at the end of each round, up to a maximum of 5 points per round."
          />
          <Tile
            label="🪶 End-of-Game Score Categories"
            hint="Sum of: Printed Bird VP + Bonus Cards + End-of-Round Goals + 1 VP per Egg on birds + 1 VP per Cached Food on birds + 1 VP per Tucked Card (+ Nectar Majorities / Duet Group / Hummingbird Track)."
          />
          <Tile
            label="⚖️ Tiebreaker"
            hint="Ties are broken by the most unused food tokens remaining in your personal supply."
          />
        </div>
      </div>
    ),
  },
  {
    title: 'Expansions Guide',
    body: (
      <div className="rules-spread">
        <Hero
          title="European, Oceania, Asia (Duet & Flock) & Americas"
          subtitle="All four official expansions and promo packs can be mixed freely."
          color="#9b6bd6"
        />
        <div className="rules-grid">
          <Tile
            label="🇪🇺 European Expansion"
            hint="Adds Teal Round-End powers, sideways birds covering 2 slots in a habitat (paying only the left slot's egg cost), raptors that play on top of an existing bird for free (tucking it underneath), and paying rodent costs with hand cards."
          />
          <Tile
            icon={<FoodIcon food="nectar" size={20} />}
            label="🇦🇺 Oceania Expansion"
            hint="Nectar is wild for food costs. Spent nectar is tracked per habitat: at game end, ≥1 spent nectar competes for 5 VP (1st) and 2 VP (2nd) per habitat. Unspent supply nectar is discarded at the end of every round."
          />
          <Tile
            label="🌏 Asia — Duet (2p) & Flock (6–7p)"
            hint="In Duet Mode, playing a bird places a Yin-Yang token onto a matching space of the 6×6 Duet Map (+1 VP per token in your largest contiguous group at game end; bonus spaces grant immediate resources). Flock Mode scales up to 6–7 players."
          />
          <Tile
            label="🌎 Americas — Hummingbirds"
            hint="Every habitat row action ends on that row's Hummingbird space: Attract a hummingbird from the 5-slot Garden to an empty space for its benefit, or Return one to cover a Garden slot and advance 1 step on the 5-column Hummingbird Track (-3 to +10 VP; landing on ✨ grants a bonus hummingbird action)."
          />
        </div>
      </div>
    ),
  },
  {
    title: 'Automa Solo Mode',
    body: (
      <div className="rules-spread">
        <Hero
          title="Official Solo Mode against the Automa"
          subtitle="Play 1v1 against the 11-card Automa decision deck across any combination of expansions."
          color="#d9534f"
        />
        <div className="rules-grid">
          <Tile
            label="🃏 Automa Turn Deck"
            hint="You always go first. On the Automa's turn, it flips the top Automa card and executes the current round's icons: Draw Cards (wipes tray + takes 1 face-down bird), Gain Food (removes all dice of its preferred face), Play a Bird (keeps highest-VP tray bird matching its Bonus Card, else 1 face-down bird), Lay Eggs, Goal Cube +/-, or Activate All Pink Powers on your mat."
          />
          <Tile
            label="🎯 Automa Scoring & Difficulty"
            hint="Automa scores its face-up birds' printed VP + 3 / 4 / 5 VP per face-down bird (Eaglet / Eagle / Eagle-eyed Eagle) + 1 VP per egg + Round Goals (Base Value + Goal Cubes) + expansion Nectar/Duet/Hummingbird points. Automa ignores brown-power comparisons (you always win them) and has 2 food for tiebreakers."
          />
        </div>
      </div>
    ),
  },
];

// ============================================================================
// WYRMSPAN RULEBOOK (5 PAGES)
// ============================================================================

const WYRMSPAN_PAGES: RulesPage[] = [
  {
    title: 'Setup & Coin Economy',
    body: (
      <div className="rules-spread">
        <Hero
          title="Wyrmspan (1–5 Players · 4 Rounds)"
          subtitle="Excavate three caverns, entice dragons into your sanctuary, and explore with your adventurer."
          color="#e09f3e"
        />
        <p>
          <b>Setup:</b> Each player starts with <b>6 Silver Coins</b> (<WyrmResourceIcon kind="coin" size={14} />),{' '}
          <b>1 Nest Egg</b> (<WyrmResourceIcon kind="egg" size={14} />), <b>any 3 Resources</b> of
          choice (<WyrmResourceIcon kind="meat" size={14} /> <WyrmResourceIcon kind="gold" size={14} />{' '}
          <WyrmResourceIcon kind="crystal" size={14} /> <WyrmResourceIcon kind="milk" size={14} />),
          and keeps <b>4 of 6 dealt cards</b> (any combination of Dragon Cards & Cave Cards). The
          leftmost space (Col 1) of each cavern starts pre-excavated.
        </p>
        <div className="rules-grid">
          <Tile
            icon={<WyrmResourceIcon kind="coin" size={22} />}
            label="Coins Instead of Action Cubes"
            hint="Every turn action costs 1 Silver Coin (plus eggs for deeper columns or repeated explorations). You keep taking turns until you choose to Pass for the round."
          />
          <Tile
            icon={<WyrmResourceIcon kind="any" size={22} />}
            label="Hand/Resource Limits & 2→1 Trade"
            hint="At any time on your turn, you may trade any 2 resources for 1 resource of choice. At the end of your turn, excess coins/cards/resources above 9 each are trimmed/discarded."
          />
        </div>
      </div>
    ),
  },
  {
    title: 'The Three Actions',
    body: (
      <div className="rules-spread">
        <Hero
          title="Excavate · Entice · Explore"
          subtitle="Excavate spaces with Cave Cards first, then Entice Dragons onto excavated spaces."
          color="#c1121f"
        />
        <div className="rules-grid">
          <Tile
            icon={<WyrmResourceIcon kind="caveCard" size={22} />}
            label="1. Excavate a Cavern Space"
            hint="Pay 1 Coin (+0🥚 on Col 2, +1🥚 on Col 3, +2🥚 on Col 4) to play a Cave Card from hand into the leftmost unexcavated space of Crimson Cavern, Golden Grotto, or Amethyst Abyss. Immediately trigger the Cave Card's When Played benefit (Col 4 also offers a 3-items → 1 Coin trade)."
          />
          <Tile
            icon={<WyrmResourceIcon kind="dragonCard" size={22} />}
            label="2. Entice a Dragon"
            hint="Pay 1 Coin + the dragon's printed Resource/Egg/Coin cost to place it onto the leftmost excavated empty space of a cavern matching its habitat. Trigger any When Played ability. Hatchlings arm recurring Cache/Tuck hooks."
          />
          <Tile
            icon={<AdventurerMeepleSvg color="orange" size={22} />}
            label="3. Explore a Cavern"
            hint="Enter Crimson Cavern, Golden Grotto, or Amethyst Abyss: 1st entry costs 1🪙, 2nd costs 1🪙+1🥚, 3rd costs 1🪙+2🥚 (max 3 entries per cavern per round). Walk left-to-right activating printed path icons and each dragon's If Activated ability until reaching a space without a dragon."
          />
          <Tile
            icon={<WyrmResourceIcon kind="egg" size={22} />}
            label="Cavern Path Specialties"
            hint="Crimson Cavern path grants Resources & Cache · Golden Grotto path grants Dragon Cards & Tuck · Amethyst Abyss path grants Cave Cards & Cave-Discard-for-Eggs."
          />
        </div>
      </div>
    ),
  },
  {
    title: 'Dragon Guild & Abilities',
    body: (
      <div className="rules-spread">
        <Hero
          title="The Dragon Guild Rondel & Dragon Types"
          subtitle="Every [DragonGuild] icon advances your token clockwise around the 12-space Guild Track."
          color="#7b42bc"
        />
        <div className="rules-grid">
          <Tile
            icon={<WyrmResourceIcon kind="guild" size={22} />}
            label="Dragon Guild Track & Brown Spaces"
            hint="Each step grants the space's printed reward (Egg, Meat, Dragon Card, Cave Card, Crystal, Gold, Coin, Milk). Landing on or passing either Brown Space (spaces 0 & 6) lets you place 1 of your 4 Guild Markers onto the active Dragon Guild Tile for major rewards or end-game VP!"
          />
          <Tile
            label="🐣 Hatchlings & Dragon Sizes"
            hint="Dragons come in Small, Medium, Large, Hatchling (recurring abilities that fire every time you cache/tuck onto them, with a big bonus on the 3rd item!), and Fledgling (Dragon Academy)."
          />
          <Tile
            label="⚡ When Played · 🧭 Adventurer · 🌙 Once Per Round · 🛡 End Game"
            hint="When Played fires on Entice; Adventurer fires when walked over during Explore; Once Per Round fires in turn order at Round End; End Game scores bonus VP after Round 4."
          />
        </div>
      </div>
    ),
  },
  {
    title: 'Objectives & Scoring',
    body: (
      <div className="rules-spread">
        <Hero
          title="Round-End Upkeep & Final Victory Points"
          subtitle="Once all players pass: Once-Per-Round dragons → Public Objective → Display wipe → Upkeep."
          color="#2d6a4f"
        />
        <div className="rules-grid">
          <Tile
            label="🏆 Public Objectives (Friendly Ties)"
            hint="At the end of each round, rank players on that round's Objective Tile: R1 = 4/1/0 · R2 = 5/2/1 · R3 = 6/3/2 · R4 = 7/4/3. Ties are friendly: tied players all receive that rank's full VP, and the next player gets the next rank! (0 units = 0 VP)."
          />
          <Tile
            label="🛡 Final Score Breakdown"
            hint="Sum of: Dragon Guild Tile markers + Printed Dragon VP (Fledglings score 1 VP × total fledglings on your mat) + End-Game Dragon Abilities + 1 VP per Egg + 1 VP per Cached Resource + 1 VP per Tucked Card + Public Objectives + 1 VP per remaining Coin + 1 VP per 4 remaining items (hand cards + resources, rounded down)."
          />
        </div>
      </div>
    ),
  },
  {
    title: 'Dragon Academy & Automa',
    body: (
      <div className="rules-spread">
        <Hero
          title="Dragon Academy Expansion & Official Automa / Ravel Mode"
          subtitle="Fledgling training tracks, pass-income round tracker, 5 new Guilds, and solo Automa."
          color="#9b6bd6"
        />
        <div className="rules-grid">
          <Tile
            label="🐣 Fledgling Training"
            hint="Whenever your adventurer walks over a Fledgling during Explore (or via a training effect), you may pay the leftmost uncovered cost box on its training track. Once all boxes are trained, its ability unlocks!"
          />
          <Tile
            label="🏛 Pass Income & 5 Academy Guilds"
            hint="In Rounds 1–3, when you pass you claim an open Income Space on the Round Tracker for next round's upkeep. Adds Merchants, Gamblers, King's Guild (tithes), Veterinary, and Magicians (swap dragons/caves with hand)."
          />
          <Tile
            label="⚙️ Official Automa & Ravel Mode"
            hint="Automa uses a 7-card active decision deck (+1 set aside unseen) each round to refresh the display, adjust objective coins, and advance around the Dragon Guild (taking display cards & placing Guild markers on brown spaces). In Ravel Mode, her guild steps scale with your most/least excavated cavern and you may keep at most 2 coins between rounds."
          />
        </div>
      </div>
    ),
  },
];

// ============================================================================
// FINSPAN RULEBOOK (5 PAGES)
// ============================================================================

const FINSPAN_PAGES: RulesPage[] = [
  {
    title: 'Setup & Ocean Mat',
    body: (
      <div className="rules-spread">
        <Hero
          title="Finspan (1–5 Players · 4 Weeks)"
          subtitle="Explore Sunlight, Twilight, and Midnight ocean zones across 3 Dive Sites (6 turns per week)."
          color="#48cae4"
        />
        <p>
          <b>Setup:</b> Each player receives <b>2 Starter Fish + 3 Main Fish</b> in hand (hands and
          personal discard piles are face-up/public) and <b>6 Divers</b> per week. Your Ocean Mat
          has 3 Dive Site columns (<b>Blue</b>, <b>Purple</b>, <b>Green</b>) across 6 rows: Rows
          1–3 = <b>☀️ Sunlight</b> (Row 1 = <i>Estuary</i>), Row 4 = <b>🌅 Twilight</b>, Rows 5–6 ={' '}
          <b>🌑 Midnight</b> (Row 6 = <i>Deepwater</i>).
        </p>
        <div className="rules-grid">
          <Tile
            icon={<FinIcon kind="egg" size={22} />}
            label="Printed Forage Fish & Starting Tokens"
            hint="Every Ocean Mat starts with Catalina Goby (1cm, Green Sunlight Row 2, with 1🥚), 1🐟 Young on open Purple Sunlight Row 3, Showy Bristlemouth (3cm, Purple Twilight Row 4), and Glasshead Grenadier (9cm, Blue Midnight Row 5, with 1🥚)."
          />
          <Tile
            icon={<DiverMeepleSvg color="c0" size={22} />}
            label="6 Turns per Week"
            hint="On each turn, spend 1 Diver either to Play a Fish from your hand OR to Dive down one of the 3 Dive Sites."
          />
        </div>
      </div>
    ),
  },
  {
    title: 'Playing & Consuming Fish',
    body: (
      <div className="rules-spread">
        <Hero
          title="Playing a Fish & Consuming Shorter Fish"
          subtitle="Cards discarded for costs go to your personal discard pile and can be recovered!"
          color="#0077b6"
        />
        <div className="rules-grid">
          <Tile
            icon={<FinIcon kind="draw" size={22} />}
            label="1. Play a Fish from Hand"
            hint="Choose a fish in your hand and a legal ocean slot matching its allowed Depth Zone(s) and Dive Site band (if colored). Pay its cost by discarding other cards from hand and/or removing Eggs, Young, or Schools from anywhere in your ocean. Trigger any When Played (⚡) ability."
          />
          <Tile
            icon={<FinIcon kind="consume" size={22} />}
            label="Consuming a Shorter Fish (1 VP)"
            hint="You may play a fish on top of an existing fish in your ocean if the new fish is strictly longer (cm) than the covered fish! Some fish require consuming (Consume<). The covered fish is tucked underneath (worth 1 VP at game end) and any tokens on the slot remain."
          />
        </div>
      </div>
    ),
  },
  {
    title: 'Diving & Forming Schools',
    body: (
      <div className="rules-spread">
        <Hero
          title="Diving Down a Dive Site & Merging Schools"
          subtitle="Your diver travels top-to-bottom through Sunlight → Twilight → Midnight → Bottom."
          color="#2a9d8f"
        />
        <div className="rules-grid">
          <Tile
            icon={<FinIcon kind="draw" size={22} />}
            label="🔵 Blue Dive Site (Left — Cards)"
            hint="Each depth zone (Sunlight, Twilight, Midnight) containing ≥1 fish grants Draw 1 Card. First diver reaching the bottom each week recovers 1 Card from your discard pile (or deck if empty)."
          />
          <Tile
            icon={<FinIcon kind="egg" size={22} />}
            label="🟣 Purple Dive Site (Center — Eggs)"
            hint="Each depth zone containing ≥1 fish lets you Lay 1 Egg on any fish without an egg (max 1 egg per fish). First diver reaching the bottom each week lays +1 Egg."
          />
          <Tile
            icon={<FinIcon kind="hatch" size={22} />}
            label="🟢 Green Dive Site (Right — Hatch & Move)"
            hint="Sunlight & Twilight zones with ≥1 fish Hatch 1 Egg into 1 Young; Midnight zone & bottom bonus Move 1 Young or School in a straight horizontal/vertical line."
          />
          <Tile
            icon={<FinIcon kind="school" size={22} />}
            label="🐠 Schools (6 VP)"
            hint="At any time, whenever 3 Young share a single slot (by hatching, placing, or moving), they immediately merge into a School token worth 6 VP! Schools cannot enter or cross another School's slot."
          />
        </div>
      </div>
    ),
  },
  {
    title: 'Achievements & Scoring',
    body: (
      <div className="rules-spread">
        <Hero
          title="Weekly Achievements & End-of-Game Victory Points"
          subtitle="Weeks 1–3 score achievements; Week 4 triggers Game-End abilities and final scoring."
          color="#f4a261"
        />
        <div className="rules-grid">
          <Tile
            label="🏅 Weekly Achievements (Sides A & B)"
            hint="At the end of Weeks 1, 2, and 3, every player scores points for the active Week's Achievement (Side A: W1 Eggs/Young 1pt, W2 Full Rows 2pt, W3 Schools 2pt; Side B: random tiles + 3 VP bonus to the weekly leader!)."
          />
          <Tile
            label="🌊 Final Score Breakdown"
            hint="Sum of: Weekly Achievement VP + Game-End Wave Abilities on visible fish + Printed VP on visible fish + 1 VP per Consumed Fish + 1 VP per Egg + 1 VP per Young + 6 VP per School (+ S&R Coral & Reef Completion VP). Tiebreaker: most cards in hand."
          />
        </div>
      </div>
    ),
  },
  {
    title: 'Sharks & Reefs + Nautoma',
    body: (
      <div className="rules-spread">
        <Hero
          title="Sharks & Reefs Expansion & Official Nautoma Solo Mode"
          subtitle="Build Coral Reefs during Twilight dives or challenge the 7-card Nautoma deck."
          color="#f15bb5"
        />
        <div className="rules-grid">
          <Tile
            icon={<FinIcon kind="coral" size={22} />}
            label="🪸 Sharks & Reefs — Coral Reefs"
            hint="The Coral Reef overlay replaces the Twilight zone checkpoint bonus: when diving through Twilight, you may discard that site's indicated item (Blue: 1 Egg, Purple: 1 Young, Green: 1 Card) to place 1 Coral in that site (max 6). Each Coral scores 1 VP, and reaching 6 Coral in a site awards +6 VP (Blue), +8 VP (Purple), or +5 VP (Green)!"
          />
          <Tile
            label="⚙️ Official Nautoma Solo Mode & Ravel Mode"
            hint="Nautoma uses 6 of 7 decision cards each week to adjust achievement divers, Dive (1× 3 Young → 1 School, ≤4 Eggs → Young, +2 Eggs), and Play a Fish (if it has an 'all players' benefit, you gain it!). When you trigger an 'all players' ability, Nautoma gains 1 Egg instead. Includes Difficulties 1–5 (Calm & Stormy achievements) and 6 Ravel Mode scoring cards."
          />
        </div>
      </div>
    ),
  },
];
