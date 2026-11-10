// AI self-play for all three engines across every card set, player count,
// and mode. Any exception, stuck AI, or game that never ends is an
// engine/rules/AI bug — this sweep found the issues pinned in each engine's
// regressions.test.ts. Bump SELFPLAY_SEEDS locally (e.g. 250) for a much
// wider sweep.

import { describe, expect, it } from 'vitest';
import { chooseAction as finAI } from './finspan/ai/chooseAction';
import { createGame as finCreate } from './finspan/createGame';
import { applyAction as finApply } from './finspan/engine';
import { chooseAction as wingAI } from './wingspan/ai/chooseAction';
import { createGame as wingCreate } from './wingspan/createGame';
import { applyAction as wingApply } from './wingspan/engine';
import { actingPlayerId } from './wingspan/helpers';
import type { GameMode, PlayerColor } from './wingspan/types';
import { chooseAction as wyrmAI } from './wyrmspan/ai';
import { createGame as wyrmCreate } from './wyrmspan/createGame';
import { applyAction as wyrmApply } from './wyrmspan/engine';
import type { Expansion } from './wyrmspan/types';

const SEEDS = Number(process.env.SELFPLAY_SEEDS ?? 5);
const names = (n: number) => Array.from({ length: n }, (_, i) => `P${i + 1}`);

/** Drive one game with the AI until `done`; throws on any engine/AI fault. */
function playOut<S, A>(
  state: S,
  g: {
    done: (s: S) => boolean;
    actor: (s: S) => string | undefined;
    choose: (s: S, pid: string) => A | null;
    apply: (s: S, a: A) => S;
    maxActions: number;
  },
): S {
  let s = state;
  for (let n = 0; !g.done(s); n++) {
    if (n > g.maxActions) throw new Error(`no end after ${g.maxActions} actions`);
    const pid = g.actor(s);
    if (!pid) throw new Error('nobody to act');
    const action = g.choose(s, pid);
    if (!action) throw new Error(`AI has no move for ${pid}`);
    s = g.apply(s, action);
  }
  return s;
}

/** Run every seed, collecting failures so one report names all of them. */
function sweep(run: (seed: number) => void): void {
  const failures: string[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    try {
      run(seed);
    } catch (e) {
      failures.push(`seed ${seed}: ${(e as Error).message}`);
    }
  }
  expect(failures).toEqual([]);
}

describe('wingspan self-play', () => {
  const COLORS: PlayerColor[] = ['red', 'blue', 'orange', 'white', 'purple', 'pink', 'teal'];
  const play = (sets: string[], players: number, seed: number, mode?: GameMode) => {
    const s = playOut(
      wingCreate({
        playerNames: names(players),
        playerTypes: names(players).map(() => 'ai' as const),
        playerColors: COLORS.slice(0, players),
        seed,
        settings: { sets, goalSide: 'green', mode },
      }),
      {
        done: (s) => s.phase === 'gameOver',
        actor: (s) => s.pending[0]?.playerId ?? (s.phase === 'setup' ? s.setupRemaining[0] : actingPlayerId(s)),
        choose: (s, pid) => wingAI(s, pid as `p${number}`),
        apply: wingApply,
        maxActions: 6000, // a normal game is a few hundred
      },
    );
    for (const pid of s.playerOrder) expect(Number.isFinite(s.finalScores![pid]!.total)).toBe(true);
  };
  const SET_COMBOS = [
    ['core'],
    ['core', 'european'],
    ['core', 'oceania'],
    ['core', 'asia'],
    ['core', 'americas'],
    ['core', 'european', 'oceania', 'asia', 'americas'],
  ];
  for (const sets of SET_COMBOS) {
    for (const players of [1, 2, 3, 4, 5]) {
      it(`${sets.join('+')} · ${players}p`, () => sweep((seed) => play(sets, players, seed)));
    }
  }
  it('asia duet · 2p', () => sweep((seed) => play(['core', 'asia'], 2, seed, 'duet')));
  for (const players of [6, 7]) {
    it(`asia flock · ${players}p`, () => sweep((seed) => play(['core', 'asia'], players, seed, 'flock')));
  }
  it('all sets + promo packs · 3p', () =>
    sweep((seed) =>
      play(
        [
          'core',
          'european',
          'oceania',
          'asia',
          'americas',
          'promoUS',
          'promoEurope',
          'promoAsia',
          'promoNZ',
          'promoCA',
          'promoUK',
        ],
        3,
        seed,
      ),
    ));
  it('automa solo · all sets', () =>
    sweep((seed) => {
      const s = playOut(
        wingCreate({
          playerNames: ['P1'],
          playerTypes: ['ai'],
          playerColors: ['red'],
          seed,
          settings: {
            sets: ['core', 'european', 'oceania', 'asia', 'americas'],
            goalSide: 'green',
            automa: { difficulty: 'eagle', automubonSociety: true, hoard: true },
          },
        }),
        {
          done: (s) => s.phase === 'gameOver',
          actor: (s) => s.pending[0]?.playerId ?? (s.phase === 'setup' ? s.setupRemaining[0] : actingPlayerId(s)),
          choose: (s, pid) => wingAI(s, pid as `p${number}`),
          apply: wingApply,
          maxActions: 6000,
        },
      );
      for (const pid of s.playerOrder) expect(Number.isFinite(s.finalScores![pid]!.total)).toBe(true);
    }));
});

describe('finspan self-play', () => {
  for (const sets of [['base'], ['base', 'sr']]) {
    for (const players of [1, 2, 3, 4, 5]) {
      for (const side of ['A', 'B'] as const) {
        it(`${sets.join('+')} · ${players}p · side ${side}`, () =>
          sweep((seed) => {
            playOut(
              finCreate({
                playerNames: names(players),
                playerTypes: names(players).map(() => 'ai' as const),
                playerColors: names(players).map((_, i) => `c${i}`),
                seed,
                settings: { sets, achievementSide: side },
              }),
              {
                done: (s) => s.phase === 'gameOver',
                actor: (s) => s.pending[0]?.playerId ?? s.playerOrder[s.currentPlayerIndex],
                choose: (s, pid) => finAI(s, pid as `p${number}`),
                apply: finApply,
                maxActions: 8000,
              },
            );
          }));
      }
    }
    it(`${sets.join('+')} · nautoma ravel`, () =>
      sweep((seed) => {
        playOut(
          finCreate({
            playerNames: ['P1'],
            playerTypes: ['ai'],
            playerColors: ['c0'],
            seed,
            settings: {
              sets,
              achievementSide: 'B',
              automa: { difficulty: 4, ravelMode: true, ravelStrength: 3 },
            },
          }),
          {
            done: (s) => s.phase === 'gameOver',
            actor: (s) => s.pending[0]?.playerId ?? s.playerOrder[s.currentPlayerIndex],
            choose: (s, pid) => finAI(s, pid as `p${number}`),
            apply: finApply,
            maxActions: 8000,
          },
        );
      }));
  }
});

describe('wyrmspan self-play', () => {
  for (const expansions of [['base'], ['base', 'academy']] as Expansion[][]) {
    for (const players of [1, 2, 3, 4, 5]) {
      it(`${expansions.join('+')} · ${players}p`, () =>
        sweep((seed) => {
          playOut(wyrmCreate({ seed, playerNames: names(players), expansions }), {
            done: (s) => s.phase === 'gameEnd',
            actor: (s) => s.pending[0]?.playerId ?? s.turn,
            choose: (s, pid) => wyrmAI(s, pid as `p${number}`),
            apply: wyrmApply,
            maxActions: 20000,
          });
        }));
    }
    it(`${expansions.join('+')} · automa ravel`, () =>
      sweep((seed) => {
        playOut(
          wyrmCreate({
            seed,
            playerNames: ['P1'],
            isAI: [true],
            expansions,
            automa: { difficulty: 2, ravelMode: true },
          }),
          {
            done: (s) => s.phase === 'gameEnd',
            actor: (s) => s.pending[0]?.playerId ?? s.turn,
            choose: (s, pid) => wyrmAI(s, pid as `p${number}`),
            apply: wyrmApply,
            maxActions: 20000,
          },
        );
      }));
  }
});
