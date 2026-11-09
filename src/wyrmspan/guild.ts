// The Dragon Guild: a circular track around a guild tile. Each [DragonGuild]
// advancement moves the guild token 1 space clockwise and grants the printed
// benefit of every space passed/landed on. Reaching either of the 2 brown
// spaces requires placing an unused player marker on an empty square of the
// guild tile (the long bottom-right rectangle holds any number) and gaining
// its benefit. Max 4 markers per player.
//
// NOTE (approximation): the exact printed benefits of the track spaces and of
// each guild tile's squares could not be fully reconstructed from the
// rulebook PDF layout. The structure (loop track, 2 brown spaces, per-square
// immediate/end-game effects, unlimited rectangle, 4-marker cap) is faithful;
// specific benefit icons are reasonable estimates pending better data.

import type { Counter, GuildTileId, GuildTileSquare, Step } from './types';

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
const vp = (count: number): Step => ({ op: 'vp', count });

// ---------------------------------------------------------------------------
// Track: 12-space loop. Brown spaces at index 3 and 9 trigger marker placement.

export interface GuildTrackSpace {
  brown?: boolean;
  steps: Step[];
  label: string;
}

export const GUILD_TRACK: GuildTrackSpace[] = [
  { steps: [gainCoin()], label: 'gain 1 coin' },
  { steps: [gainRes('any')], label: 'gain 1 resource' },
  { steps: [gainCard('dragon')], label: 'gain 1 dragon card' },
  { brown: true, steps: [], label: 'place a guild marker (brown)' },
  { steps: [layEgg()], label: 'lay 1 egg' },
  { steps: [gainCard('cave')], label: 'gain 1 cave card' },
  { steps: [gainRes('any'), gainRes('any')], label: 'gain 2 resources' },
  { steps: [gainCoin(), gainCard('dragon')], label: 'gain 1 coin + 1 dragon card' },
  { brown: true, steps: [], label: 'place a guild marker (brown)' },
  { steps: [vp(1)], label: 'gain 1 VP' },
  { steps: [gainCard('cave'), gainRes('any')], label: 'gain 1 cave card + 1 resource' },
  { steps: [gainCoin(), layEgg()], label: 'gain 1 coin + lay 1 egg' },
];

// ---------------------------------------------------------------------------
// Guild tiles. Each has a small grid of squares plus one `unlimited` square
// (the long rectangle). Squares may grant immediate steps and/or end-game VP.

const eg = (vpPer: number, counter?: Counter): NonNullable<GuildTileSquare['endGame']> => ({
  vpPer,
  counter,
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
        label: 'pay 1 coin, then play a dragon from your hand for free',
        immediate: [
          {
            op: 'pay',
            cost: [{ kind: 'coin', count: 1 }],
            then: [{ op: 'playDragonFree', source: 'hand' }],
          },
        ],
      },
      { label: 'end game: +3 VP per filled column', endGame: eg(3, { kind: 'filledColumns' }) },
      {
        label: 'end game: +1 VP per dragon on your mat',
        endGame: eg(1, { kind: 'dragons', where: 'mat' }),
      },
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
        label: 'end game: +1 VP per printed resource cost in your best cave',
        endGame: eg(1, { kind: 'printedResourceCost', where: 'cave' }),
      },
      { label: 'end game: +1 VP per adult dragon', endGame: eg(1, { kind: 'dragons', where: 'mat', cond: { sizeGroup: 'adult' } }) },
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
      { label: 'gain 2 coins', immediate: [gainCoin(2)] },
      { label: 'lay 1 egg and gain 1 cave card', immediate: [layEgg(), gainCard('cave')] },
      { label: 'end game: +1 VP per trait set', endGame: eg(1, { kind: 'traitSets' }) },
      { label: 'end game: +1 VP per egg on your mat', endGame: eg(1, { kind: 'eggs', where: 'mat' }) },
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
      { label: 'gain 1 dragon card + 1 resource', immediate: [gainCard('dragon'), gainRes('any')] },
      { label: 'gain 2 resources + 1 coin', immediate: [gainRes('any'), gainRes('any'), gainCoin()] },
      { label: 'end game: +1 VP per size set', endGame: eg(1, { kind: 'sizeSets' }) },
      {
        label: 'end game: +2 VP per fully trained fledgling',
        endGame: eg(2, { kind: 'fullyTrainedFledglings' }),
      },
      {
        label: 'end game: +1 VP per cave card on your mat (unlimited markers)',
        endGame: eg(1, { kind: 'dragons', where: 'mat' }),
        unlimited: true,
      },
    ],
  },
};

export const GUILD_TILE_IDS = Object.keys(GUILD_TILES) as GuildTileId[];
