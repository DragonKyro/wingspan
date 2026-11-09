// Immutable state helpers shared by the Wingspan, Finspan, and Wyrmspan
// engines. Each engine's GameState has `players` (with string ids) and a
// `pending` queue. Engines re-export these bound to their concrete types
// (e.g. `export const getPlayer: (s: GameState, id: PlayerId) => PlayerState`)
// so `ReturnType<typeof getPlayer>` and call sites stay exact.

/** The player with `id`; throws on an unknown id. */
export function getPlayer<P extends { id: string }>(
  state: { readonly players: readonly P[] },
  id: NoInfer<P['id']>,
): P {
  const p = state.players.find((x) => x.id === id);
  if (!p) throw new Error(`unknown player ${id}`);
  return p;
}

/** A copy of `state` with the player sharing `p`'s id replaced by `p`. */
export function setPlayer<S extends { readonly players: readonly { id: string }[] }>(
  state: S,
  p: S['players'][number],
): S {
  return { ...state, players: state.players.map((x) => (x.id === p.id ? p : x)) };
}

/** A copy of `state` with `steps` appended to its pending queue. */
export function pushPending<S extends { readonly pending: readonly unknown[] }>(
  state: S,
  ...steps: S['pending'][number][]
): S {
  return { ...state, pending: [...state.pending, ...steps] };
}
