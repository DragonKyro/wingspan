// The Dragon Guild: a circular track around a guild tile. Each [DragonGuild]
// advancement moves the guild token 1 space clockwise and grants the printed
// benefit of every space passed/landed on. Reaching either of the 2 brown
// spaces requires placing an unused player marker on an empty square of the
// guild tile (the long bottom-right rectangle holds any number) and gaining
// its benefit. Max 4 markers per player.

import type { Counter, GainItem, GuildTileId, GuildTileSquare, Step } from './types';

const gainRes = (res: 'meat' | 'gold' | 'crystal' | 'milk' | 'any', count = 1): Step => ({
  op: 'gain',
  items: [{ kind: 'resource', res, count }],
});
const gainCard = (deck: 'dragon' | 'cave', count = 1): Step => ({
  op: 'gain',
  items: [{ kind: 'card', deck, count }],
});
const gainCoin = (count = 1): Step => ({ op: 'gain', items: [{ kind: 'coin', count }] });
const layEgg = (count = 1): Step => ({ op: 'layEggs', count, target: { kind: 'any' } });

// ---------------------------------------------------------------------------
// Track: 12-space loop matching the printed Dragon Guild board (dragon_p12.png).
// Index 0 is the top brown space ("Place unused marker below | START") where
// tokens begin; index 6 is the bottom brown space ("Place unused marker above").

export interface GuildTrackSpace {
  brown?: boolean;
  steps: Step[];
  label: string;
}

export const GUILD_TRACK: GuildTrackSpace[] = [
  { brown: true, steps: [], label: 'place a guild marker (brown / START)' },
  { steps: [layEgg()], label: 'lay 1 egg' },
  { steps: [gainRes('meat')], label: 'gain 1 meat' },
  { steps: [gainCard('dragon')], label: 'gain 1 dragon card' },
  { steps: [gainCard('cave')], label: 'gain 1 cave card' },
  { steps: [gainRes('crystal')], label: 'gain 1 crystal' },
  { brown: true, steps: [], label: 'place a guild marker (brown)' },
  { steps: [layEgg()], label: 'lay 1 egg' },
  { steps: [gainRes('gold')], label: 'gain 1 gold' },
  { steps: [gainCard('dragon')], label: 'gain 1 dragon card' },
  { steps: [gainCoin()], label: 'gain 1 coin' },
  { steps: [gainRes('milk')], label: 'gain 1 milk' },
];

// ---------------------------------------------------------------------------
// Guild tiles. Each has a small grid of squares plus one `unlimited` square
// (the long rectangle). Squares may grant immediate steps and/or end-game VP.

const eg = (
  vpPer: number,
  counter?: Counter,
  extra?: Partial<NonNullable<GuildTileSquare['endGame']>>,
): NonNullable<GuildTileSquare['endGame']> => ({
  vpPer,
  counter,
  ...extra,
});

export const GUILD_TILES: Record<GuildTileId, { name: string; squares: GuildTileSquare[] }> = {
  seafarers: {
    name: 'Guild of Seafarers',
    squares: [
      {
        label: 'excavate 1 space for free with a cave card from your hand',
        immediate: [{ op: 'excavateFree', source: 'hand', count: 1 }],
      },
      {
        label: 'pay 1 cave card, then play a dragon from your hand for free',
        immediate: [
          {
            op: 'pay',
            cost: [{ kind: 'card', deck: 'cave', count: 1 }],
            then: [{ op: 'playDragonFree', source: 'hand' }],
          },
        ],
      },
      {
        label: 'gain 2 dragon cards',
        immediate: [gainCard('dragon', 2)],
      },
      { label: 'end game: +3 VP per filled column', endGame: eg(3, { kind: 'filledColumns' }) },
      {
        label: 'end game: +1 VP per tucked card (unlimited markers)',
        endGame: eg(1, { kind: 'tucked', where: 'mat' }),
        unlimited: true,
      },
    ],
  },
  highlands: {
    name: 'Guild of Highlands',
    squares: [
      {
        label: 'pay 1 coin, then excavate up to 2 spaces for free',
        immediate: [
          {
            op: 'pay',
            cost: [{ kind: 'coin', count: 1 }],
            then: [{ op: 'excavateFree', source: 'hand', count: 2 }],
          },
        ],
      },
      {
        label: 'discard a cave card, then play a dragon on top of a dragon for free',
        immediate: [
          {
            op: 'discardFromHand',
            what: 'cave',
            count: 1,
            then: [{ op: 'playDragonFree', source: 'hand', onTop: true }],
          },
        ],
      },
      {
        label: 'gain 1 gold and 1 crystal',
        immediate: [gainRes('gold'), gainRes('crystal')],
      },
      {
        label: 'play a dragon from your hand or the display for free',
        immediate: [{ op: 'playDragonFree', source: 'handOrDisplay' }],
      },
      {
        label: 'end game: +1 VP per cached resource (unlimited markers)',
        endGame: eg(1, { kind: 'cached', where: 'mat' }),
        unlimited: true,
      },
    ],
  },
  plains: {
    name: 'Plains Guild',
    squares: [
      {
        label: 'pay 1 egg, then draw a dragon from the deck and play it for free',
        immediate: [
          {
            op: 'pay',
            cost: [{ kind: 'egg', count: 1 }],
            then: [{ op: 'playDragonFree', source: 'deck' }],
          },
        ],
      },
      { label: 'gain 1 resource and lay 1 egg', immediate: [gainRes('any'), layEgg()] },
      {
        label: 'end game: +1 VP for every 2 eggs you have (round down)',
        endGame: eg(1, { kind: 'eggs', where: 'mat' }, { divisor: 2 }),
      },
      { label: 'end game: +1 VP per cave card on your mat', endGame: eg(1, { kind: 'caveCards' }) },
      {
        label: 'end game: +1 VP per dragon on your mat (unlimited markers)',
        endGame: eg(1, { kind: 'dragons', where: 'mat' }),
        unlimited: true,
      },
    ],
  },
  rainforest: {
    name: 'Rainforest Guild',
    squares: [
      {
        label: 'pay 1 coin, then play a dragon from your hand for free',
        immediate: [
          {
            op: 'pay',
            cost: [{ kind: 'coin', count: 1 }],
            then: [{ op: 'playDragonFree', source: 'hand' }],
          },
        ],
      },
      {
        label: 'pay 1 egg, then excavate 1 space for free with a cave card from your hand or the display',
        immediate: [
          {
            op: 'pay',
            cost: [{ kind: 'egg', count: 1 }],
            then: [{ op: 'excavateFree', source: 'handOrDisplay', count: 1 }],
          },
        ],
      },
      { label: 'gain 2 milk', immediate: [gainRes('milk', 2)] },
      {
        label: 'end game: +1 VP per printed resource cost in your best cave',
        endGame: eg(1, { kind: 'printedResourceCost', where: 'cave' }),
      },
      {
        label: 'end game: +1 VP per cave card on your mat (unlimited markers)',
        endGame: eg(1, { kind: 'caveCards' }),
        unlimited: true,
      },
    ],
  },
  merchants: {
    name: 'Guild of Merchants',
    squares: [
      {
        label: 'pay 1 coin, then excavate 1 space for free with a cave card from your hand and activate its ability 2x',
        immediate: [
          {
            op: 'pay',
            cost: [{ kind: 'coin', count: 1 }],
            then: [{ op: 'excavateFree', source: 'hand', count: 1, activateTimes: 2 }],
          },
        ],
      },
      {
        label: 'pay 1 coin, then play a dragon from your hand or the display for free',
        immediate: [
          {
            op: 'pay',
            cost: [{ kind: 'coin', count: 1 }],
            then: [{ op: 'playDragonFree', source: 'handOrDisplay' }],
          },
        ],
      },
      {
        label: 'up to 2x, pay 1 resource to gain 1 coin',
        immediate: [
          {
            op: 'pay',
            cost: [{ kind: 'resource', res: 'any', count: 1 }],
            then: [gainCoin(1)],
            repeat: 2,
          },
        ],
      },
      {
        label: 'end game: +3 VP per dragon on your mat with coin in its cost (max 15 VP)',
        endGame: eg(3, { kind: 'dragons', where: 'mat', cond: { costHas: 'coin' } }, { max: 15 }),
      },
      {
        label: 'end game: +1 VP (unlimited markers)',
        endGame: eg(1),
        unlimited: true,
      },
    ],
  },
  gamblers: {
    name: "Gambler's Guild",
    squares: [
      {
        label: 'draw 3 dragon cards from the deck; play 1 for free (or keep it) and discard the others',
        immediate: [{ op: 'drawDistribute', deck: 'dragon', count: 3, playFree: 1, discard: 2, orKeep: true }],
      },
      {
        label: 'draw 3 cave cards from the deck; excavate for free with 1 (or keep it) and discard the others',
        immediate: [{ op: 'drawDistribute', deck: 'cave', count: 3, playFree: 1, discard: 2, orKeep: true }],
      },
      {
        label: 'draw 1 dragon card from the deck; either gain its printed cost or discard it to gain 1 coin',
        immediate: [{ op: 'gamblerDraw' }],
      },
      {
        label: 'end game: draw 4 dragon cards from the deck; score the printed VP on 2 of them, then discard all 4 cards',
        immediate: [{ op: 'gamblerEndGameDraw' }],
        endGame: eg(1, undefined, { gamblerDraw4: true }),
      },
      {
        label: 'end game: +1 VP (unlimited markers)',
        endGame: eg(1),
        unlimited: true,
      },
    ],
  },
  kings: {
    name: "King's Guild",
    squares: [
      {
        label: 'pay 2 tithe, then excavate 1 space for free with a cave card from your hand or the display',
        immediate: [
          {
            op: 'pay',
            cost: [{ kind: 'tithe', count: 2 }],
            then: [{ op: 'excavateFree', source: 'handOrDisplay', count: 1 }],
          },
        ],
      },
      {
        label: 'pay 3 tithe, then play a dragon from your hand or the display for free',
        immediate: [
          {
            op: 'pay',
            cost: [{ kind: 'tithe', count: 3 }],
            then: [{ op: 'playDragonFree', source: 'handOrDisplay' }],
          },
        ],
      },
      {
        label: 'pay 1 tithe to gain 2 coins',
        immediate: [
          {
            op: 'pay',
            cost: [{ kind: 'tithe', count: 1 }],
            then: [gainCoin(2)],
          },
        ],
      },
      {
        label: 'pay 2 tithe; end game: +8 VP',
        immediate: [{ op: 'pay', cost: [{ kind: 'tithe', count: 2 }], then: [] }],
        endGame: eg(8),
      },
      {
        label: 'pay 1 tithe; end game: +3 VP (unlimited markers)',
        immediate: [{ op: 'pay', cost: [{ kind: 'tithe', count: 1 }], then: [] }],
        endGame: eg(3),
        unlimited: true,
      },
    ],
  },
  veterinary: {
    name: 'Veterinary Guild',
    squares: [
      {
        label: 'pay 1 coin, then play a hatchling or fledgling from your hand or the display for free',
        immediate: [
          {
            op: 'pay',
            cost: [{ kind: 'coin', count: 1 }],
            then: [
              {
                op: 'playDragonFree',
                source: 'handOrDisplay',
                cond: { anyOf: [{ size: 'Hatchling' }, { size: 'Fledgling' }] },
              },
            ],
          },
        ],
      },
      {
        label: 'choose 1: cache 2 from general supply onto any dragon(s); tuck 2 from deck under any dragon(s); or gain 1 coin',
        immediate: [
          {
            op: 'chooseOption',
            options: [
              {
                label: 'cache 2 resources from general supply onto any dragon(s)',
                steps: [{ op: 'cache', count: 2, res: 'any', from: 'general', target: { kind: 'any' } }],
              },
              {
                label: 'tuck 2 dragon cards from the deck under any dragon(s)',
                steps: [{ op: 'tuck', count: 2, from: 'deck', target: { kind: 'any' } }],
              },
              {
                label: 'gain 1 coin',
                steps: [gainCoin(1)],
              },
            ],
          },
        ],
      },
      {
        label: 'choose 1: train 1 fledgling 2x for free; or train 1 fledgling 1x for free, then gain the covered benefit',
        immediate: [
          {
            op: 'chooseOption',
            options: [
              {
                label: 'train 1 fledgling 2x for free',
                steps: [{ op: 'trainFledgling', times: 2, free: true, target: 'any' }],
              },
              {
                label: 'train 1 fledgling 1x for free, then gain the benefit covered by its training token',
                steps: [{ op: 'trainFledgling', times: 1, free: true, gainItem: true, target: 'any' }],
              },
            ],
          },
        ],
      },
      {
        label: 'end game: +2 VP per hatchling and +2 VP per fledgling on your player mat',
        endGame: eg(2, {
          kind: 'dragons',
          where: 'mat',
          cond: { anyOf: [{ size: 'Hatchling' }, { size: 'Fledgling' }] },
        }),
      },
      {
        label: 'end game: +1 VP (unlimited markers)',
        endGame: eg(1),
        unlimited: true,
      },
    ],
  },
  magicians: {
    name: 'Guild of Magicians',
    squares: [
      {
        label: 'pay 1 coin, then swap any dragon in your cave with a dragon in your hand (ignore normal cave requirements)',
        immediate: [
          {
            op: 'pay',
            cost: [{ kind: 'coin', count: 1 }],
            then: [{ op: 'swapHandDragon' }],
          },
        ],
      },
      {
        label: 'swap any uncovered cave card in your cave with a cave card in your hand and activate its when-played ability',
        immediate: [{ op: 'swapCaveCard' }],
      },
      {
        label: 'activate any WhenPlayed or Adventurer ability on a dragon on your player mat',
        immediate: [{ op: 'activateAbility', kinds: ['WhenPlayed', 'Adventurer'], count: 1 }],
      },
      {
        label: 'end game: +2 VP per EndGame dragon on your player mat',
        endGame: eg(2, { kind: 'dragons', where: 'mat', cond: { abilityType: 'EndGame' } }),
      },
      {
        label: 'end game: +1 VP (unlimited markers)',
        endGame: eg(1),
        unlimited: true,
      },
    ],
  },
};

export const BASE_GUILD_TILE_IDS: GuildTileId[] = ['seafarers', 'highlands', 'plains', 'rainforest'];
export const GUILD_TILE_IDS = Object.keys(GUILD_TILES) as GuildTileId[];

// ---------------------------------------------------------------------------
// Academy round tracker: income spaces. In rounds 1-3 a player who passes
// places their adventurer on an unclaimed space of the current section and
// collects its benefit at the end of the round (after display refresh and
// start-player rotation), in turn order from the new start player.
//
// The board has two sections of 6 spaces each (decoded from the rulebook
// diagram): one shared by the round-1 and round-2 passes, one for round 3.
// Each space may be claimed by only one player per round.

export interface IncomeSpace {
  label: string;
  items: GainItem[];
}

const c = (count: number): GainItem => ({ kind: 'coin', count });
const e = (count: number): GainItem => ({ kind: 'egg', count });
const res = (count: number): GainItem => ({ kind: 'resource', res: 'any', count });
const card = (deck: 'dragon' | 'cave'): GainItem => ({ kind: 'card', deck, count: 1, source: 'display' });
const guild: GainItem = { kind: 'guild', count: 1 };

export const INCOME_SECTIONS: IncomeSpace[][] = [
  // Section claimed when passing during round 1 or round 2
  // (income collected at the start of rounds 2 and 3).
  [
    { label: '5 coins + 2 eggs', items: [c(5), e(2)] },
    { label: '5 coins + 1 egg + dragon card', items: [c(5), e(1), card('dragon')] },
    { label: '5 coins + 1 egg + cave card', items: [c(5), e(1), card('cave')] },
    { label: '5 coins + 1 egg + guild advancement', items: [c(5), e(1), guild] },
    { label: '5 coins + 1 egg + 1 resource', items: [c(5), e(1), res(1)] },
    { label: '6 coins', items: [c(6)] },
  ],
  // Section claimed when passing during round 3
  // (income collected at the start of round 4).
  [
    { label: '5 coins + 3 eggs', items: [c(5), e(3)] },
    { label: '5 coins + 2 eggs + dragon card', items: [c(5), e(2), card('dragon')] },
    { label: '5 coins + 2 eggs + cave card', items: [c(5), e(2), card('cave')] },
    { label: '5 coins + 1 egg + 2 resources', items: [c(5), e(1), res(2)] },
    { label: '6 coins + guild advancement', items: [c(6), guild] },
    { label: '6 coins + 1 egg', items: [c(6), e(1)] },
  ],
];

/** Which income section applies to a pass during `round` (1-3). */
export function incomeSectionIndex(round: number): number {
  return round <= 2 ? 0 : 1;
}
