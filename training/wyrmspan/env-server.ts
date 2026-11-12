// stdio bridge from WyrmspanVecEnv to an out-of-process learner (Python).
// One JSON object per line in, one per line out, strictly request/response.
//
//   → {"cmd":"spec"}
//   ← {"ok":true,"dims":{global,token,cand,cardStatic},"shape":{tokens,cands,seats,cardIndex},
//      "zones":{name:[start,size]},"layouts":{global,token},"cardTable":[…],
//      "encoderVersion":…,"actionSpaceVersion":…}
//   → {"cmd":"reset","options":{numEnvs, seed, players, opponents, maxSteps, scoreNorm, shaping,
//      quota, teacher, expansions?, automaDifficulty?}}
//   → {"cmd":"step","actions":[candidateIndex, …]}          (one per env)
//   ← {"ok":true,"n":…,"seat":[…],"role":[…],"reward":[…],"done":[…],"kind":[…],"episodes":[…],
//      "binary":[["global",bytes],["tokenIds",bytes],["tokenFeat",bytes],["tokenMask",bytes],
//      ["candFeat",bytes],["candSel",bytes],["candPay",bytes],["candTarget",bytes],["candMask",bytes],["teacher",bytes],
//      ["teacherValue",bytes]]}
//     followed by those raw bytes, in that order: f32 little-endian features, i16 token ids,
//     u8 masks / selection counts, i8 targets, i16 teacher index per row (−1 = none), f32 teacher
//     value per candidate (NaN = none). `kind` = each row's decision: pending step kind or 'turn'.
//   → {"cmd":"configure","options":{opponents?, players?, teacher?}}  ← {"ok":true}
//   → {"cmd":"close"}
//   ← {"ok":false,"error":"…"}                       (on any failure)
//
// `cardTable` is the static per-card feature table (NUM_CARD_INDEX × CARD_STATIC_DIM,
// row-major, row 0 = no card) the network looks token card ids up in.
//
// Nothing else is written to stdout; diagnostics go to stderr.

import { createInterface } from 'node:readline';
import { CARD_STATIC_DIM, NUM_CARD_INDEX, cardStaticTable } from '@/wyrmspan/nn/cardFeatures';
import { ACTION_SPACE_VERSION, CAND_DIM, MAX_CANDS, VERBS } from '@/wyrmspan/nn/candidates';
import {
  ENCODER_VERSION, GLOBAL_DIM, NUM_TOKENS, TOKEN_DIM, TOKEN_ZONES, ZONE_SIZES, ZONE_START, type Segment, encodeView,
} from '@/wyrmspan/nn/encode';
import { newMatch } from '@/wyrmspan/nn/play';
import { redact } from '@/wyrmspan/nn/view';
import { MAX_SEATS, type VecBatch, type VecEnvOptions, WyrmspanVecEnv } from './vec-env';

const bytes = (a: ArrayBufferView) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);

/** A batch reply: the JSON line, then the feature arrays as raw bytes. */
class BatchReply {
  constructor(readonly b: VecBatch) {}

  write(): void {
    const b = this.b;
    const arrays: Array<[string, ArrayBufferView]> = [
      ['global', b.global], ['tokenIds', b.tokenIds], ['tokenFeat', b.tokenFeat], ['tokenMask', b.tokenMask],
      ['candFeat', b.candFeat], ['candSel', b.candSel], ['candPay', b.candPay], ['candTarget', b.candTarget], ['candMask', b.candMask],
      ['teacher', b.teacher], ['teacherValue', b.teacherValue],
    ];
    const header = {
      ok: true,
      n: b.seat.length,
      seat: Array.from(b.seat),
      role: Array.from(b.role),
      reward: Array.from(b.reward),
      done: Array.from(b.done),
      kind: b.kind,
      episodes: b.episodes,
      binary: arrays.map(([name, a]) => [name, a.byteLength]),
    };
    process.stdout.write(Buffer.concat([Buffer.from(JSON.stringify(header) + '\n'), ...arrays.map(([, a]) => bytes(a))]));
  }
}

function spec() {
  // Record the feature layouts once from a fresh game.
  const s = newMatch(1, 2);
  const record = { global: [] as Segment[], token: [] as Segment[] };
  encodeView(redact(s, 'p1'), 'p1', undefined, record);
  return {
    ok: true,
    dims: { global: GLOBAL_DIM, token: TOKEN_DIM, cand: CAND_DIM, cardStatic: CARD_STATIC_DIM },
    shape: { tokens: NUM_TOKENS, cands: MAX_CANDS, seats: MAX_SEATS, cardIndex: NUM_CARD_INDEX },
    zones: Object.fromEntries(TOKEN_ZONES.map((z) => [z, [ZONE_START[z], ZONE_SIZES[z]]])),
    verbs: VERBS,
    layouts: record,
    cardTable: Array.from(cardStaticTable(), (x) => Math.round(x * 1e6) / 1e6),
    encoderVersion: ENCODER_VERSION,
    actionSpaceVersion: ACTION_SPACE_VERSION,
  };
}

let env: WyrmspanVecEnv | null = null;

interface Request {
  cmd?: string;
  options?: Partial<VecEnvOptions>;
  actions?: number[];
}

function handle(msg: Request): object | BatchReply {
  switch (msg.cmd) {
    case 'spec':
      return spec();
    case 'reset':
      env = new WyrmspanVecEnv(msg.options ?? {});
      return new BatchReply(env.reset());
    case 'step':
      if (!env) throw new Error('step before reset');
      if (!Array.isArray(msg.actions)) throw new Error('step needs "actions": number[]');
      return new BatchReply(env.step(msg.actions));
    case 'configure':
      if (!env) throw new Error('configure before reset');
      env.configure(msg.options ?? {});
      return { ok: true };
    case 'close':
      process.exit(0);
    default:
      throw new Error(`unknown cmd ${JSON.stringify(msg.cmd)}`);
  }
}

createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) => {
  if (!line.trim()) return;
  let reply: object | BatchReply;
  try {
    reply = handle(JSON.parse(line));
  } catch (e) {
    reply = { ok: false, error: (e as Error).stack ?? (e as Error).message };
  }
  if (reply instanceof BatchReply) reply.write();
  else process.stdout.write(JSON.stringify(reply) + '\n');
});
