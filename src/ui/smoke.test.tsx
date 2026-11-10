// Guardrail: each game screen renders without crashing at several points of a
// real AI-vs-AI game (setup, early, mid-game, game end), with every expansion
// on so the widest range of cards, tokens and panels is exercised.
import { cleanup, render } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadEngine } from '@/games/engines';
import type { GameId } from '@/net/types';
import { useGameStore } from '@/store/gameStore';
import { FinspanScreen } from './finspan/FinspanScreen';
import { GameScreen } from './wingspan/GameScreen';
import { WyrmspanScreen } from './wyrmspan/WyrmspanScreen';

beforeAll(() => {
  // jsdom has no Web Animations API; the FLIP layer only needs a stub.
  Element.prototype.animate = function () {
    return { onfinish: null, oncancel: null, cancel() {}, finish() {}, finished: Promise.resolve(), addEventListener() {} } as never;
  };
});
afterEach(cleanup);

const SLOT = { wingspan: 'game', wyrmspan: 'wyrmspanGame', finspan: 'finspanGame' } as const;

const GAMES: { id: GameId; Screen: ComponentType; options: unknown }[] = [
  {
    id: 'wingspan',
    Screen: GameScreen,
    options: {
      playerNames: ['A', 'B'],
      playerTypes: ['ai', 'ai'],
      playerColors: ['red', 'blue'],
      seed: 11,
      settings: { sets: ['core', 'european', 'oceania', 'asia', 'americas'], goalSide: 'green', mode: 'standard' },
    },
  },
  {
    id: 'wyrmspan',
    Screen: WyrmspanScreen,
    options: { seed: 11, playerNames: ['A', 'B'], isAI: [true, true], expansions: ['base', 'academy'] },
  },
  {
    id: 'finspan',
    Screen: FinspanScreen,
    options: {
      playerNames: ['A', 'B'],
      playerTypes: ['ai', 'ai'],
      playerColors: ['red', 'blue'],
      seed: 11,
      settings: { sets: ['base', 'sr'], achievementSide: 'A' },
    },
  },
];

describe('game screens render through a whole AI game', () => {
  for (const g of GAMES) {
    it(g.id, async () => {
      const engine = await loadEngine(g.id);
      let state = engine.createGame(g.options as never);
      const snapshots = [0, 25, 120, Infinity];
      let step = 0;
      for (const at of snapshots) {
        while (step < at && step < 5000) {
          const pid = engine.aiToAct(state as never);
          if (!pid) break;
          const action = engine.chooseAction(state as never, pid);
          if (!action) break;
          state = engine.applyAction(state as never, action as never);
          step++;
        }
        useGameStore.setState({ activeGameId: g.id, game: null, wyrmspanGame: null, finspanGame: null, [SLOT[g.id]]: state });
        const { container, unmount } = render(<g.Screen />);
        expect(container.querySelectorAll('.ccard').length, `${g.id} @ step ${step}`).toBeGreaterThan(0);
        unmount();
      }
      expect(step, 'the AI game should progress').toBeGreaterThan(120);
    }, 60000);
  }
});
