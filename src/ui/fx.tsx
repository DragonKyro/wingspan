// Smooth FLIP card-flight & token/action animation layer using the Web
// Animations API (modeled on card-collecting's cardFlip.tsx + machi-koro/fx.tsx).
//
// 1. Every card on screen registers its DOM node and the zone it sits in via
//    `useFlipCard(cardKey, zone)`; decks, trays, displays, and piles register
//    anchors via `useFlipAnchor(anchorKey)`.
// 2. In `getSnapshotBeforeUpdate`, before React mutates the DOM, the provider
//    records every card's and anchor's bounding rect.
// 3. In `componentDidUpdate`, any card whose `zone` changed (or that freshly
//    appeared from a known origin anchor like `'deck'` or `'tray'`) flies
//    smoothly from its old screen rect to its new one via `node.animate(...)`.
// 4. New log entries also trigger subtle card/slot pulses and floating toast
//    banners for round transitions, powers, dives, and explorations.
// 5. Respects `prefers-reduced-motion: reduce` and skips cleanly in JSDOM/tests
//    where `Element.prototype.animate` is absent.

import {
  Component,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

const DURATION_MS = 380;
const EASING = 'cubic-bezier(0.22, 0.78, 0.28, 1)';

interface Registry {
  nodes: Map<string, HTMLElement>;
  zones: Map<string, string>;
  anchors: Map<string, HTMLElement>;
}

interface Snapshot {
  cards: Map<string, DOMRect>;
  anchors: Map<string, DOMRect>;
}

const FlipCtx = createContext<Registry | null>(null);

export interface FlipProviderProps {
  /** Optional map of cardKey -> anchorKey ('deck', 'tray', 'display') for cards
   *  entering the screen from an off-screen pile. */
  origins?: ReadonlyMap<string, string>;
  /** Default origin anchor when a card appears on screen for the first time. */
  defaultOrigin?: string;
  /** Scene key (e.g. `${gameId}:${phase === 'gameOver'}`); changing it skips flights on that frame. */
  scene: string;
  children: ReactNode;
}

function canAnimate(): boolean {
  if (typeof window === 'undefined' || typeof Element === 'undefined') return false;
  if (typeof Element.prototype.animate !== 'function') return false;
  if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return false;
  }
  return true;
}

export class FlipProvider extends Component<FlipProviderProps> {
  private readonly registry: Registry = {
    nodes: new Map(),
    zones: new Map(),
    anchors: new Map(),
  };
  private lastZones = new Map<string, string>();
  private lastOrigins: ReadonlyMap<string, string> = new Map();
  private readonly flights = new WeakMap<HTMLElement, Animation>();

  override componentDidMount(): void {
    this.remember();
  }

  override getSnapshotBeforeUpdate(): Snapshot {
    const cards = new Map<string, DOMRect>();
    for (const [id, node] of this.registry.nodes) {
      cards.set(id, node.getBoundingClientRect());
    }
    const anchors = new Map<string, DOMRect>();
    for (const [name, node] of this.registry.anchors) {
      anchors.set(name, node.getBoundingClientRect());
    }
    return { cards, anchors };
  }

  override componentDidUpdate(prev: FlipProviderProps, _state: unknown, before: Snapshot): void {
    if (prev.scene === this.props.scene && canAnimate()) {
      const moves: Array<{ node: HTMLElement; from: DOMRect }> = [];
      for (const [id, node] of this.registry.nodes) {
        const zone = this.registry.zones.get(id);
        const was = this.lastZones.get(id);
        if (zone === undefined || zone === was) continue;
        let from: DOMRect | undefined;
        if (was !== undefined) {
          from = before.cards.get(id);
        } else {
          const origin = this.lastOrigins.get(id) ?? this.props.defaultOrigin;
          if (origin !== undefined && origin !== zone) {
            from =
              before.anchors.get(origin) ??
              this.registry.anchors.get(origin)?.getBoundingClientRect();
          }
        }
        if (from && (from.width > 0 || from.height > 0)) {
          moves.push({ node, from });
        } else if (was === undefined) {
          this.popIn(node);
        }
      }
      for (const { node, from } of moves) {
        this.fly(node, from);
      }
    }
    this.remember();
  }

  private fly(node: HTMLElement, from: DOMRect): void {
    this.flights.get(node)?.cancel();
    const to = node.getBoundingClientRect();
    if (to.width === 0 && to.height === 0) return;
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    const sx = Math.max(0.55, Math.min(1.35, from.width / Math.max(1, to.width)));
    const sy = Math.max(0.55, Math.min(1.35, from.height / Math.max(1, to.height)));
    const anim = node.animate(
      [
        {
          transform: `translate(${dx}px, ${dy}px) scale(${sx.toFixed(2)}, ${sy.toFixed(2)})`,
          opacity: 0.92,
          zIndex: '30',
        },
        {
          transform: 'translate(0px, 0px) scale(1, 1)',
          opacity: 1,
          zIndex: '30',
        },
      ],
      { duration: DURATION_MS, easing: EASING },
    );
    this.flights.set(node, anim);
  }

  private popIn(node: HTMLElement): void {
    this.flights.get(node)?.cancel();
    const anim = node.animate(
      [
        { transform: 'translateY(8px) scale(0.92)', opacity: 0.25 },
        { transform: 'translateY(0px) scale(1)', opacity: 1 },
      ],
      { duration: 260, easing: EASING },
    );
    this.flights.set(node, anim);
  }

  private remember(): void {
    this.lastZones = new Map(this.registry.zones);
    this.lastOrigins = this.props.origins ?? new Map();
  }

  override render(): ReactNode {
    return <FlipCtx.Provider value={this.registry}>{this.props.children}</FlipCtx.Provider>;
  }
}

/** Register a card element with its stable key (e.g. `bird:42`) and zone (`hand`, `tray`, `board:p1:forest:0`). */
export function useFlipCard(
  cardKey: string | number | undefined,
  zone: string,
): (node: HTMLElement | null) => (() => void) | void {
  const reg = useContext(FlipCtx);
  const key = cardKey != null ? String(cardKey) : undefined;
  return (node) => {
    if (!reg || !key || !node) return;
    reg.nodes.set(key, node);
    reg.zones.set(key, zone);
    return () => {
      if (reg.nodes.get(key) !== node) return;
      reg.nodes.delete(key);
      reg.zones.delete(key);
    };
  };
}

/** Register a named anchor element ('deck', 'tray', 'dragon-deck', 'cave-deck', 'fish-deck'). */
export function useFlipAnchor(
  name: string,
): (node: HTMLElement | null) => (() => void) | void {
  const reg = useContext(FlipCtx);
  return (node) => {
    if (!reg || !node) return;
    reg.anchors.set(name, node);
    return () => {
      if (reg.anchors.get(name) === node) reg.anchors.delete(name);
    };
  };
}

/** Pulse an element whenever `value` increments (e.g. egg count, cached food, coins, coral). */
export function useValuePulse<T extends HTMLElement = HTMLDivElement>(value: number) {
  const ref = useRef<T | null>(null);
  const prev = useRef(value);
  useEffect(() => {
    const delta = value - prev.current;
    prev.current = value;
    if (delta !== 0 && ref.current && canAnimate()) {
      ref.current.animate(
        [
          { transform: 'scale(1)', filter: 'brightness(1)' },
          {
            transform: delta > 0 ? 'translateY(-3px) scale(1.16)' : 'scale(0.9)',
            filter: delta > 0 ? 'brightness(1.25) drop-shadow(0 0 8px rgba(240,196,100,0.75))' : 'brightness(0.85)',
            offset: 0.4,
          },
          { transform: 'scale(1)', filter: 'brightness(1)' },
        ],
        { duration: 420, easing: 'ease-out' },
      );
    }
  }, [value]);
  return ref;
}

/** Live toast banner that briefly announces notable log events (powers, round ends, dives, explores). */
export function ActionToastBanner({ logMessages }: { logMessages: string[] }) {
  const seenCount = useRef(logMessages.length);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const seqRef = useRef(1);

  useEffect(() => {
    if (logMessages.length > seenCount.current) {
      const fresh = logMessages.slice(seenCount.current);
      seenCount.current = logMessages.length;
      if (fresh.length > 0 && fresh.length <= 8) {
        const last = fresh[fresh.length - 1]!;
        const id = seqRef.current++;
        setToast({ id, text: last });
        const t = setTimeout(() => {
          setToast((cur) => (cur?.id === id ? null : cur));
        }, 2400);
        return () => clearTimeout(t);
      }
    } else {
      seenCount.current = logMessages.length;
    }
  }, [logMessages]);

  if (!toast) return null;
  return (
    <div key={toast.id} className="fx-toast" role="status" aria-live="polite">
      <span className="fx-toast-dot" />
      <span>{toast.text}</span>
    </div>
  );
}
