// Procedural Wyrmspan dragon portraits, driven by card data:
//  - NAME → body plan: classic winged dragon, wyvern, wingless drake, eastern
//    lung, serpent/wyrm, amphiptere/coatl (winged serpent), fey/moth dragon,
//    gryphdragon (feathered); plus name colours ("Red", "White-Bellied") and
//    traits ("Horned", "Whiskered", "Fanged", "Spotted").
//  - PERSONALITY → palette + pose cue: Aggressive breathes fire, Helpful
//    cradles a gem, Playful sticks out a tongue, Shy hides behind a wing.
//  - CAVE → backdrop (Crimson embers, Golden coin hoard, Amethyst crystals).
//  - SIZE → scale; Hatchlings hatch from a patterned egg.

import { memo, type ReactNode } from 'react';
import { COLOR } from './birdArt';
import { hashStr, r1, seeded, shade } from './core';

type Plan = 'classic' | 'wyvern' | 'drake' | 'lung' | 'serpent' | 'amph' | 'fey' | 'gryph';

const PLAN_RULES: [RegExp, Plan][] = [
  [/feydragon|\bfae\b|moth|dragonette|cricketcatcher|pixie|sprite/, 'fey'],
  [/gryph/, 'gryph'],
  [/amphiptere|coatl|coatyl|manta/, 'amph'],
  [/\blung\b|koiwyrm/, 'lung'],
  [/serpent|wyrm|lindworm|moray|remora|cobrette|basilisk|eel/, 'serpent'],
  [/wyvern|firevern|vern\b/, 'wyvern'],
  [/drake|grazer|rockbreaker|ridgedragon|anteldragon|licheneater|chameleon|rex\b/, 'drake'],
];

const PERSONA: Record<string, { b: string; w: string; u: string; a: string }> = {
  aggressive: { b: '#b8322a', w: '#6e1a16', u: '#f2b25a', a: '#ffb703' },
  helpful: { b: '#2f7a52', w: '#1f4f37', u: '#c8e6a8', a: '#95d5b2' },
  playful: { b: '#e07a3f', w: '#9c4129', u: '#ffd9a0', a: '#f2cc8f' },
  shy: { b: '#3d5a80', w: '#293241', u: '#b8d0e0', a: '#98c1d9' },
};

const P = (strs: TemplateStringsArray, ...vals: number[]) =>
  strs.reduce((acc, s, i) => acc + s + (i < vals.length ? r1(vals[i]!) : ''), '');

function caveBackdrop(cave: string, rand: () => number): ReactNode[] {
  const c = /crimson/i.test(cave) ? 'crimson' : /golden/i.test(cave) ? 'golden' : /amethyst/i.test(cave) ? 'amethyst' : 'any';
  const out: ReactNode[] = [<rect key="bg" width="120" height="56" fill={`url(#ws-cave-${c})`} />];
  let st = '';
  for (let x = -2; x < 122; x += 9 + rand() * 8) {
    const h = 5 + rand() * 11;
    st += P`M${x} 0L${x + 2.6} ${h}L${x + 5.4} 0Z`;
  }
  out.push(<path key="stal" d={st} fill="#000" opacity="0.38" />);
  out.push(<path key="floor" d="M0 49Q20 45 44 47.5T88 46.5T120 48V56H0Z" fill="#000" opacity="0.42" />);
  if (c === 'crimson') {
    let em = '';
    for (let i = 0; i < 10; i++) em += P`M${rand() * 120} ${10 + rand() * 38}h0.01`;
    out.push(<path key="emb" d={em} stroke="#ffb703" strokeWidth="1.1" strokeLinecap="round" opacity="0.8" />);
    out.push(<path key="lava" d="M6 53q8 -3 14 0t16 -1M78 52q10 2 18 -1t14 1" stroke="#ff7b2a" strokeWidth="1" fill="none" opacity="0.85" />);
  } else if (c === 'golden') {
    let coins = '';
    for (let i = 0; i < 9; i++) coins += P`M${92 + (i % 4) * 5 + rand() * 2} ${53 - Math.floor(i / 4) * 3}h0.01`;
    out.push(<path key="coins" d={coins} stroke="url(#ws-gold)" strokeWidth="4" strokeLinecap="round" />);
    out.push(<path key="spark" d="M20 14l1 -3 1 3 3 1 -3 1 -1 3 -1 -3 -3 -1ZM102 20l0.7 -2 0.7 2 2 0.7 -2 0.7 -0.7 2 -0.7 -2 -2 -0.7Z" fill="#fff3b0" opacity="0.85" />);
  } else if (c === 'amethyst') {
    out.push(<path key="crys" d="M8 56L11 41L15 56ZM14 56L19 45L21 56ZM100 56L104 38L109 56ZM107 56L112 46L114 56Z" fill="#b48ae8" opacity="0.9" />);
    out.push(<path key="crysh" d="M11 41L12.4 56M104 38L105.8 56" stroke="#f0e2ff" strokeWidth="0.6" opacity="0.8" />);
  } else {
    out.push(<path key="moss" d="M0 49Q20 45 44 47.5T88 46.5T120 48" stroke="#5a7a5a" strokeWidth="1.2" fill="none" opacity="0.7" />);
  }
  return out;
}

interface Look {
  b: string; w: string; u: string; a: string; eye: string;
  horns: number; spots: boolean; whiskers: boolean; fangs: boolean; crest: boolean; antlers: boolean;
  hood: boolean; ridge: boolean;
}

function dragonLook(name: string, persona: string, rand: () => number): Look {
  const base = PERSONA[persona] ?? PERSONA.shy!;
  const look: Look = {
    ...base,
    eye: ['#ffd166', '#f8f272', '#7af0ff', '#ff6b6b'][Math.floor(rand() * 4)]!,
    horns: 1 + Math.floor(rand() * 2),
    spots: false, whiskers: false, fangs: persona === 'aggressive', crest: false, antlers: false,
    hood: /cobr/.test(name.toLowerCase()), ridge: /rock|ridge|spine|guardian/.test(name.toLowerCase()),
  };
  for (const word of name.toLowerCase().split(/\s+/)) {
    const bits = word.split('-');
    const col = bits.map((x) => COLOR[x]).find(Boolean);
    if (col && /bellied|breasted/.test(word)) look.u = col;
    else if (col && /winged/.test(word)) look.w = col;
    else if (col) {
      look.b = col;
      look.w = shade(col, -0.4);
    }
    if (/spotted|mosaic|dappled/.test(word)) look.spots = true;
    if (/whisker|bearded/.test(word)) look.whiskers = true;
    if (/fang|sharpclaw|venom/.test(word)) look.fangs = true;
    if (/crest|ruff|frill|feather/.test(word)) look.crest = true;
    if (/horn/.test(word)) look.horns = 3;
    if (/antel/.test(word)) look.antlers = true;
    if (/ancient|archaic|titanic/.test(word)) {
      look.b = shade(look.b, -0.25);
      look.w = shade(look.w, -0.2);
    }
  }
  return look;
}

/** Dragon head facing left with its snout tip at (x-13, y+1). */
function head(x: number, y: number, c: Look, persona: string, beak: boolean, key: string): ReactNode {
  const parts: ReactNode[] = [];
  if (c.antlers) {
    parts.push(<path key="ant" d={P`M${x + 1} ${y - 4}l2 -7l-3 -3M${x + 3} ${y - 9}l3 -1M${x + 4} ${y - 3}l4 -6l1 -4M${x + 7} ${y - 7}l3 0`} stroke={shade(c.u, -0.25)} strokeWidth="1.1" strokeLinecap="round" fill="none" />);
  } else {
    let hd = '';
    for (let i = 0; i < c.horns; i++) hd += P`M${x + 1 + i * 2.4} ${y - 3.6}Q${x + 5 + i * 2.4} ${y - 9 - i} ${x + 10 + i * 2} ${y - 9.5 - i}Q${x + 6 + i * 2.4} ${y - 6} ${x + 3.6 + i * 2.4} ${y - 2.4}Z`;
    parts.push(<path key="horn" d={hd} fill={c.u} stroke={shade(c.u, -0.4)} strokeWidth="0.4" />);
  }
  if (c.crest) parts.push(<path key="crest" d={P`M${x + 3} ${y - 3}l4 -4l0 3l4 -3l-1 4l4 -1l-4 4Z`} fill={c.a} />);
  parts.push(<circle key="sk" cx={x} cy={y} r="4.6" fill={c.b} />);
  if (beak) {
    parts.push(<path key="beak" d={P`M${x - 3} ${y - 3}Q${x - 11} ${y - 3} ${x - 12} ${y + 3}Q${x - 8} ${y + 1} ${x - 3} ${y + 3}Z`} fill={c.u} stroke={shade(c.u, -0.45)} strokeWidth="0.5" />);
  } else {
    parts.push(<path key="snout" d={P`M${x - 1} ${y - 3.8}L${x - 11.5} ${y - 1.2}Q${x - 13.6} ${y + 0.6} ${x - 11.6} ${y + 2.4}L${x - 1} ${y + 3.6}Z`} fill={c.b} />);
    parts.push(<path key="jaw" d={P`M${x - 11.4} ${y + 1.2}L${x - 2.5} ${y + 1.6}`} stroke={shade(c.b, -0.45)} strokeWidth="0.6" />);
    parts.push(<circle key="nos" cx={r1(x - 11)} cy={r1(y - 0.8)} r="0.6" fill={shade(c.b, -0.55)} />);
    if (c.fangs) parts.push(<path key="fang" d={P`M${x - 9.5} ${y + 1.3}l0.6 1.8l0.6 -1.7M${x - 6.5} ${y + 1.5}l0.6 1.8l0.6 -1.7`} fill="#fff" />);
    if (persona === 'playful') parts.push(<path key="tongue" d={P`M${x - 11} ${y + 1.6}q-3 0.6 -3.6 2.6q0.4 -2.2 -1.4 -1.6`} stroke="#e85a7a" strokeWidth="0.9" fill="none" strokeLinecap="round" />);
  }
  if (c.whiskers) parts.push(<path key="wh" d={P`M${x - 10} ${y}q-4 -1 -6 -5M${x - 9} ${y + 2}q-4 3 -9 3`} stroke={c.a} strokeWidth="0.7" fill="none" strokeLinecap="round" />);
  parts.push(<circle key="vol" cx={x} cy={y} r="4.6" fill="url(#ws-vol)" />);
  const shy = persona === 'shy';
  parts.push(<ellipse key="eye" cx={r1(x - 1.6)} cy={r1(y - 1.2)} rx="1.5" ry={shy ? 0.7 : 1.3} fill={c.eye} />);
  parts.push(<ellipse key="pup" cx={r1(x - 1.6)} cy={r1(y - 1.2)} rx="0.35" ry={shy ? 0.5 : 1.05} fill="#140a04" />);
  return <g key={key}>{parts}</g>;
}

function batWing(sx: number, sy: number, s: number, fill: string, bone: string, key: string, feathered = false): ReactNode {
  const pt = (x: number, y: number) => `${r1(sx + x * s)} ${r1(sy + y * s)}`;
  if (feathered) {
    const d = `M${pt(0, 0)}Q${pt(6, -18)} ${pt(24, -22)}L${pt(28, -16)}L${pt(24, -14.5)}L${pt(28, -10)}L${pt(23, -8.4)}L${pt(26, -4)}L${pt(20, -3)}Q${pt(10, 0)} ${pt(5, 3)}Z`;
    return (
      <g key={key}>
        <path d={d} fill={fill} />
        <path d={`M${pt(8, -10)}Q${pt(16, -12)} ${pt(25, -15)}M${pt(8, -5)}Q${pt(16, -6)} ${pt(24, -7)}`} stroke={bone} strokeWidth="0.6" fill="none" />
      </g>
    );
  }
  const d = `M${pt(0, 0)}L${pt(8, -16)}L${pt(26, -21)}Q${pt(23, -14)} ${pt(28, -9)}Q${pt(21, -7)} ${pt(22, -1)}Q${pt(13, -2)} ${pt(5, 3)}Z`;
  return (
    <g key={key}>
      <path d={d} fill={fill} />
      <path d={`M${pt(0, 0)}L${pt(8, -16)}L${pt(26, -21)}M${pt(8, -16)}L${pt(28, -9)}M${pt(8, -16)}L${pt(22, -1)}`} stroke={bone} strokeWidth="0.8" fill="none" strokeLinecap="round" />
    </g>
  );
}

function fire(x: number, y: number): ReactNode {
  return <path key="fire" d={P`M${x} ${y}Q${x - 10} ${y - 7} ${x - 24} ${y - 4}Q${x - 18} ${y} ${x - 26} ${y + 5}Q${x - 12} ${y + 6} ${x} ${y + 1.5}Z`} fill="url(#ws-fire)" />;
}

function serpentBody(c: Look, d: string, w: number, key: string): ReactNode {
  return (
    <g key={key}>
      <path d={d} stroke={c.b} strokeWidth={w} fill="none" strokeLinecap="round" />
      <path d={d} stroke={c.u} strokeWidth={w * 0.32} fill="none" strokeLinecap="round" transform="translate(0.6 1.4)" opacity="0.85" />
      <path d={d} stroke={shade(c.b, 0.25)} strokeWidth={w * 0.55} fill="none" strokeDasharray="1.2 2.2" opacity="0.5" transform="translate(0 -0.8)" />
    </g>
  );
}

function drawDragon(plan: Plan, c: Look, persona: string): ReactNode[] {
  const out: ReactNode[] = [];
  const darkB = shade(c.b, -0.32);
  if (plan === 'lung' || plan === 'serpent' || plan === 'amph') {
    const d = 'M36 16C24 26 16 2 4 9S-10 17 -12 -2';
    if (plan === 'amph') out.push(batWing(-2, 4, 1, c.w, c.a, 'fw', true));
    out.push(serpentBody(c, d, 7.5, 'body'));
    out.push(<path key="tip" d="M34 15.5l8 -3l-5 6Z" fill={c.a} />);
    if (plan === 'lung') {
      out.push(<path key="mane" d="M-11 -4l3 -3l-1 4l4 -3l-1 4l4 -2l-2 4M6 4l2 -4l1 4l3 -3l0 4M20 12l2 -4l1 4" stroke={c.a} strokeWidth="1.2" fill="none" strokeLinejoin="round" />);
      out.push(<path key="legs" d="M8 12l-1 6l-2 1M22 20l1 5l-2 1" stroke={c.b} strokeWidth="2" fill="none" strokeLinecap="round" />);
    } else {
      let sp = '';
      for (const [x, y] of [[-10, -4], [-4, 4], [4, 4], [12, 9], [20, 15], [28, 17]] as const) sp += P`M${x} ${y - 3}l2 -3l1 3.4`;
      out.push(<path key="spine" d={sp} fill={c.a} />);
    }
    if (c.hood) out.push(<ellipse key="hood" cx="-11" cy="-5" rx="5.5" ry="8" fill={c.w} stroke={c.a} strokeWidth="0.6" />);
    if (plan === 'amph') out.push(batWing(0, 6, 1.05, shade(c.w, 0.12), c.a, 'nw', true));
    const lc = { ...c, whiskers: c.whiskers || plan === 'lung' };
    out.push(head(-13, -6, lc, persona, false, 'head'));
    if (persona === 'aggressive') out.unshift(fire(-26, -5));
    return out;
  }
  if (plan === 'fey') {
    const wingFill = shade(c.a, 0.25);
    out.push(<path key="fw" d="M-2 -2Q-6 -24 12 -22Q16 -12 2 -1ZM2 0Q16 -6 22 4Q14 12 2 3Z" fill={wingFill} opacity="0.55" stroke={c.w} strokeWidth="0.5" />);
    out.push(<path key="tail" d="M6 6Q20 14 30 6Q36 2 34 -4" stroke={c.b} strokeWidth="2.2" fill="none" strokeLinecap="round" />);
    out.push(<ellipse key="body" cx="0" cy="4" rx="9" ry="5" fill={c.b} />);
    out.push(<ellipse key="bv" cx="0" cy="4" rx="9" ry="5" fill="url(#ws-vol)" />);
    out.push(<path key="legs" d="M-4 8l-1 5M3 8l1 5" stroke={c.b} strokeWidth="1.6" strokeLinecap="round" />);
    out.push(<path key="nw" d="M0 -1Q2 -28 22 -24Q24 -10 3 0ZM3 2Q20 2 24 12Q14 16 3 5Z" fill={wingFill} opacity="0.75" stroke={c.w} strokeWidth="0.6" />);
    out.push(<path key="wspots" d="M14 -18h0.01M8 -12h0.01M16 8h0.01" stroke={c.w} strokeWidth="2.4" strokeLinecap="round" opacity="0.7" />);
    out.push(<path key="ant" d="M-9 -9q-2 -7 -7 -9M-7 -9q1 -7 -2 -11" stroke={darkB} strokeWidth="0.6" fill="none" />);
    out.push(head(-9, -4, { ...c, horns: 0 }, persona, false, 'head'));
    if (persona === 'aggressive') out.unshift(fire(-22, -3));
    return out;
  }
  // Legged plans: classic, wyvern, drake, gryph.
  const winged = plan !== 'drake';
  const fore = plan !== 'wyvern';
  const tilt = plan === 'wyvern' ? -12 : 0;
  const g: ReactNode[] = [];
  if (winged) g.push(batWing(-4, -6, 0.9, c.w, shade(c.w, -0.3), 'fw', plan === 'gryph'));
  g.push(<path key="tail" d="M12 0Q30 12 35 1Q38 -6 33 -12L36 -12Q42 -4 38 4Q32 18 10 9Z" fill={c.b} />);
  g.push(<path key="tspade" d="M30.5 -11L34.5 -18.5L38.4 -11Z" fill={c.a} />);
  g.push(<path key="flegs" d={fore ? 'M-8 8L-10 18M9 7L12 18' : 'M7 7L10 18'} stroke={darkB} strokeWidth="3.4" strokeLinecap="round" />);
  g.push(<path key="body" d="M-14 2C-14 -8 10 -10 16 -2C20 4 12 12 0 12C-10 12 -14 8 -14 2Z" fill={c.b} />);
  g.push(<path key="belly" d="M-13 5Q0 14 13 7Q0 10 -13 2Z" fill={c.u} />);
  g.push(<path key="plates" d="M-8 7.4l0.8 -2M-3 8.8l0.6 -2M2 9.2l0.4 -2M7 8.6l0.2 -2" stroke={shade(c.u, -0.35)} strokeWidth="0.5" />);
  if (c.spots) g.push(<path key="spots" d="M-6 -2h0.01M0 -4h0.01M6 -2h0.01M-2 2h0.01M10 1h0.01" stroke={c.a} strokeWidth="2" strokeLinecap="round" opacity="0.8" />);
  g.push(<path key="bvol" d="M-14 2C-14 -8 10 -10 16 -2C20 4 12 12 0 12C-10 12 -14 8 -14 2Z" fill="url(#ws-vol)" />);
  g.push(<path key="neck" d="M-10 -3Q-16 -10 -16 -16L-10 -19Q-11 -11 -3 -6Z" fill={c.b} />);
  let sp = '';
  const sh = c.ridge ? 5.5 : 3.4;
  for (let i = 0; i < 4; i++) sp += P`M${-8 + i * 6} ${-8.6 + Math.abs(i - 1.5) * 0.8}l2 ${-sh}l2 ${sh - 0.2}`;
  sp += 'M-15 -14l-1 -3l3 1.4M-13 -9l-1.6 -3l3 1';
  g.push(<path key="spine" d={sp} fill={c.a} />);
  g.push(<path key="nlegs" d={fore ? 'M-5 8Q-7 14 -8 19M11 6Q15 12 13 19' : 'M11 6Q15 12 13 19M-6 4Q-10 6 -11 9'} stroke={c.b} strokeWidth={fore ? 4 : 3.6} strokeLinecap="round" fill="none" />);
  g.push(<path key="claws" d={fore ? 'M-10 19.4h3.6M11 19.4h3.6' : 'M11 19.4h3.6'} stroke={c.u} strokeWidth="1.1" strokeLinecap="round" />);
  if (persona === 'helpful') {
    g.push(<path key="gem" d="M-13 8l2 -3l2 3l-2 3Z" fill="#7af0ff" stroke="#fff" strokeWidth="0.4" />);
    g.push(<circle key="gemglow" cx="-11" cy="8" r="4" fill="url(#ws-glow)" />);
  }
  g.push(head(-14, -20, c, persona, plan === 'gryph', 'head'));
  if (winged) {
    const shy = persona === 'shy';
    g.push(batWing(shy ? -6 : -2, shy ? -2 : -6, shy ? 0.95 : 1, c.w, shade(c.w, -0.35), 'nw', plan === 'gryph'));
  }
  if (persona === 'aggressive') g.unshift(fire(-27, -19));
  out.push(<g key="dragon" transform={tilt ? `rotate(${tilt})` : undefined}>{g}</g>);
  return out;
}

function hatchling(plan: Plan, c: Look, persona: string, rand: () => number): ReactNode[] {
  const shell = ['#efe0c4', '#e8d3e8', '#d8ecd2', '#f0d8c0'][Math.floor(rand() * 4)]!;
  const pat =
    persona === 'aggressive'
      ? 'M-8 12l3 -2l3 2l3 -2l3 2l3 -2'
      : persona === 'helpful'
        ? 'M-9 9q9 3 18 0M-8 14q8 3 16 0'
        : persona === 'playful'
          ? 'M-6 10h0.01M0 14h0.01M5 9h0.01M-3 16h0.01M7 15h0.01'
          : 'M-5 12h0.01M5 13h0.01';
  // Type cues peeking out of the shell: wing nubs, a coiled tail, or fey wings.
  const coil = plan === 'lung' || plan === 'serpent';
  const cue: ReactNode =
    plan === 'fey' ? (
      <path key="cue" d="M4 -4Q10 -18 20 -12Q16 -4 6 -2ZM4 -2Q14 -2 16 6Q10 6 5 1Z" fill={shade(c.a, 0.25)} opacity="0.7" stroke={c.w} strokeWidth="0.5" />
    ) : coil ? (
      <path key="cue" d="M10 4Q22 2 20 -6Q18 -12 13 -9" stroke={c.b} strokeWidth="3" fill="none" strokeLinecap="round" />
    ) : plan === 'drake' ? null : (
      batWing(6, 0, 0.5, c.w, shade(c.w, -0.35), 'cue', plan === 'gryph')
    );
  return [
    cue,
    <ellipse key="nest" cx="0" cy="19" rx="18" ry="4" fill="#6a4a2a" />,
    <path key="straw" d="M-16 18l6 -2M-12 21l8 -3M4 21l9 -3M8 18l7 1" stroke="#c8a060" strokeWidth="0.8" />,
    <path key="egg" d="M-12 6L-8 2L-4 7L1 1L6 7L11 2L12.6 6C13 16 7 21 0 21C-7 21 -13 16 -12 6Z" fill={shell} stroke={shade(shell, -0.4)} strokeWidth="0.7" />,
    <path key="pat" d={pat} stroke={c.b} strokeWidth={persona === 'playful' ? 2.2 : 1} fill="none" strokeLinecap="round" opacity="0.7" />,
    <path key="shard" d="M14 -2l4 -3l1 4Z" fill={shell} stroke={shade(shell, -0.4)} strokeWidth="0.5" />,
    <path key="claw" d="M-9 4q-2 -3 0 -4M9 4q2 -3 0 -4" stroke={c.b} strokeWidth="2" strokeLinecap="round" fill="none" />,
    head(2, -4, { ...c, whiskers: c.whiskers || plan === 'lung', horns: plan === 'fey' ? 0 : c.horns }, persona === 'aggressive' ? 'playful' : persona, plan === 'gryph', 'head'),
    persona === 'aggressive' ? <path key="puff" d="M-14 -4q-3 -2 -5 0q-3 0 -3 3q2 2 5 0q3 1 3 -3Z" fill="#c8c8c8" opacity="0.6" /> : null,
  ];
}

export const DragonIllustration = memo(function DragonIllustration({
  id,
  name = '',
  personality,
  size: dragonSize,
  caves = [],
}: {
  id: number;
  name?: string;
  personality: string;
  size: string;
  caves?: readonly string[];
}) {
  const persona = personality.toLowerCase();
  const lower = name.toLowerCase();
  const rand = seeded(hashStr(name || `d${id}`) ^ (id * 2246822519));
  const plan: Plan = PLAN_RULES.find(([re]) => re.test(lower))?.[1] ?? 'classic';
  const look = dragonLook(name, persona, rand);
  const cave = caves.length >= 3 ? 'any' : (caves[0] ?? 'any');
  const s =
    dragonSize === 'Hatchling' ? 0.95 : dragonSize === 'Fledgling' ? 0.72 : dragonSize === 'Small' ? 0.8 : dragonSize === 'Large' ? 1.02 : 0.9;
  const body =
    dragonSize === 'Hatchling' ? hatchling(plan, look, persona, rand) : drawDragon(plan, look, persona);
  const flip = id % 2 === 1;
  const y = dragonSize === 'Hatchling' ? 28 : plan === 'fey' ? 26 : 30;
  return (
    <svg viewBox="0 0 120 56" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden="true" className="art-svg">
      {caveBackdrop(cave, rand)}
      <g transform={`translate(60 ${y}) scale(${flip ? -s : s} ${s})`}>{body}</g>
      <rect width="120" height="56" fill="url(#ws-vignette)" />
    </svg>
  );
});
