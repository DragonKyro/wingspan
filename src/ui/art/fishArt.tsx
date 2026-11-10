// Procedural Finspan fish portraits, driven by card data:
//  - NAME → body plan (shark, hammerhead, sawshark, ray, eel, angler/deep-sea
//    fangtooth, seahorse, puffer, flatfish, billfish, tuna, reef disc,
//    lionfish/scorpionfish, default perch) + colour words ("Blue", "Yellowfin").
//  - ZONES → water backdrop (sunlight rays + sand, twilight snow, midnight
//    specks, deepwater seabed); coral-cost cards grow coral in the scene.
//  - TAGS → overlays: bioluminescent photophores, electric sparks, venomous
//    spines, camouflage mottling, predator teeth. Forage fish swim as a school.

import { memo, type ReactNode } from 'react';
import { COLOR } from './birdArt';
import { hashStr, r1, seeded, shade } from './core';

type Plan = 'shark' | 'hammer' | 'saw' | 'ray' | 'eel' | 'angler' | 'horse' | 'puffer' | 'flat' | 'bill' | 'tuna' | 'disc' | 'spiny' | 'fish';

const PLAN_RULES: [RegExp, Plan][] = [
  [/hammerhead/, 'hammer'],
  [/sawshark|sawfish/, 'saw'],
  [/angelshark|wobbegong|\bray\b|skate|stingray|manta|guitarfish/, 'ray'],
  [/shark|spurdog|dogfish|mako|chimaera/, 'shark'],
  [/\beel\b|moray|cusk-eel|hagfish|oarfish|pipefish|lancetfish|swallower|snailfish|halosaur|grenadier|whipnose|loosejaw/, 'eel'],
  [/angler|seadevil|footballfish|netdevil|fangtooth|viperfish|dragonfish|snaggletooth|daggertooth|coffinfish|frogfish|stargazer|batfish/, 'angler'],
  [/seahorse|seadragon|pipehorse/, 'horse'],
  [/puffer|porcupinefish|boxfish/, 'puffer'],
  [/flounder|sunfish|\bdory\b|halibut|tripodfish/, 'flat'],
  [/sailfish|marlin|swordfish/, 'bill'],
  [/tuna|mackerel|bonito|barracuda|trevally|mahi|kawakawa|escolar|salmon|sardine|anchovy|sablefish|barramundi|toothfish|bonefish|pilotfish|kaluga|sturgeon/, 'tuna'],
  [/angelfish|butterflyfish|\btang\b|idol|surgeonfish|damselfish|\bscat\b|unicornfish|rabbitfish|porkfish|clownfish|anemonefish|sweetlips|triggerfish|hatchetfish/, 'disc'],
  [/lionfish|scorpionfish|stonefish|thornyhead|searobin|sculpin|wolffish|fringehead/, 'spiny'],
];

const ZONE_PAL: Record<string, [string, string, string][]> = {
  sunlight: [['#f6c85f', '#e58e2a', '#fff2c8'], ['#48cae4', '#0077b6', '#caf0f8'], ['#ff7f6a', '#c8452a', '#ffe0d6'], ['#9b5de5', '#5a189a', '#f0d8ff'], ['#52b788', '#2d6a4f', '#d8f3dc']],
  twilight: [['#8fa9c0', '#4f6f8f', '#e0ecf4'], ['#c0c8d0', '#6f7f90', '#f0f4f8'], ['#5a8ab0', '#2a4f70', '#cfe2f0']],
  midnight: [['#3a2a3a', '#1f141f', '#6a4a5a'], ['#2a2f3a', '#141820', '#50607a'], ['#5a1f24', '#2a0c10', '#8a3a40']],
};

const P = (strs: TemplateStringsArray, ...vals: number[]) =>
  strs.reduce((acc, s, i) => acc + s + (i < vals.length ? r1(vals[i]!) : ''), '');

interface Tags {
  bioluminescent?: number;
  camouflage?: number;
  electric?: number;
  predator?: number;
  venomous?: number;
}
interface Look {
  b: string; f: string; u: string;
  stripes: boolean;
}

function zoneBack(zone: string, bottom: boolean, coral: string | null, rand: () => number): ReactNode[] {
  const out: ReactNode[] = [<rect key="sea" width="120" height="40" fill={`url(#ws-sea-${zone})`} />];
  if (zone === 'sunlight') {
    out.push(<path key="rays" d="M18 0h10L44 40H22ZM62 0h7L84 40H70ZM96 0h6l8 40h-8Z" fill="url(#ws-ray)" opacity="0.5" />);
    out.push(<path key="sand" d="M0 36Q30 33 60 35.5T120 34V40H0Z" fill="#e8d3a0" opacity="0.85" />);
    out.push(<path key="kelp" d="M6 40q-3 -8 1 -15t-1 -16M11 40q3 -7 -1 -13t1 -11" stroke="#4f8a3f" strokeWidth="1.6" fill="none" strokeLinecap="round" />);
  } else if (zone === 'twilight') {
    out.push(<path key="ray" d="M50 0h14L78 40H52Z" fill="url(#ws-ray)" opacity="0.18" />);
  }
  if (zone !== 'sunlight') {
    let snow = '';
    for (let i = 0; i < 12; i++) snow += P`M${rand() * 120} ${rand() * 40}h0.01`;
    out.push(<path key="snow" d={snow} stroke={zone === 'midnight' ? '#7af0ff' : '#e0f0ff'} strokeWidth={zone === 'midnight' ? 0.9 : 0.6} strokeLinecap="round" opacity={zone === 'midnight' ? 0.55 : 0.5} />);
  }
  if (bottom) {
    out.push(<path key="bed" d="M0 35Q16 31 34 34T74 33T120 35V40H0Z" fill="#1c1a22" />);
    out.push(<path key="rocks" d="M84 35a5 3 0 0 1 10 0ZM20 34.5a4 2.6 0 0 1 8 0Z" fill="#2c2a34" />);
  }
  if (coral) {
    out.push(<path key="coral" d="M100 40v-8l-3 -5M100 34l4 -6l1 -4M104 40v-5l3 -3M112 40v-9l-2 -3M112 34l3 -4" stroke={coral} strokeWidth="1.8" fill="none" strokeLinecap="round" />);
  }
  let bub = '';
  for (let i = 0; i < 3; i++) {
    const x = 70 + rand() * 40;
    const y = 4 + rand() * 18;
    bub += P`M${x} ${y}a1 1 0 1 0 0.1 0`;
  }
  out.push(<path key="bub" d={bub} stroke="#e8fbff" strokeWidth="0.5" fill="none" opacity="0.7" />);
  return out;
}

/** Fish facing left, centred on 0,0 (≈ 64×28 box). Returns [behind, body, front]. */
function drawFish(plan: Plan, c: Look, t: Tags, rand: () => number): ReactNode[] {
  const out: ReactNode[] = [];
  const eye = (x: number, y: number, r = 1.6) => [
    <circle key="eye" cx={x} cy={y} r={r} fill="#fff" />,
    <circle key="pupil" cx={r1(x - r * 0.15)} cy={y} r={r1(r * 0.62)} fill="#0b1420" />,
  ];
  const vol = (d: string) => <path key="vol" d={d} fill="url(#ws-vol)" />;
  let bodyD = '';
  switch (plan) {
    case 'shark':
    case 'hammer':
    case 'saw': {
      bodyD = 'M-28 0Q-24 -8 -6 -8Q14 -7 24 -2L34 -12L31 0L34 6L24 2Q12 8 -6 7Q-24 7 -28 0Z';
      out.push(<path key="pf" d="M-10 5L-2 14L2 6Z" fill={c.f} />);
      out.push(<path key="b" d={bodyD} fill={c.b} />);
      out.push(<path key="u" d="M-27 1.5Q-14 7 10 5Q-6 3 -27 1.5Z" fill={c.u} />);
      out.push(<path key="df" d="M-6 -7.6L0 -17L5 -7.2Z" fill={c.f} />);
      out.push(<path key="gills" d="M-17 -2.5v4.5M-15 -3v5M-13 -3v5" stroke={shade(c.b, -0.4)} strokeWidth="0.5" />);
      out.push(vol(bodyD));
      if (plan === 'hammer') out.push(<path key="hh" d="M-29 -6h5v12h-5Z" fill={c.b} />);
      if (plan === 'saw') out.push(<path key="saw" d="M-28 -0.6H-44V0.6H-28ZM-42 -0.6v-1.4M-38 -0.6v-1.4M-34 -0.6v-1.4M-42 0.6v1.4M-38 0.6v1.4M-34 0.6v1.4" stroke={shade(c.b, 0.2)} strokeWidth="0.6" fill={c.u} />);
      out.push(...eye(plan === 'hammer' ? -28 : -21, plan === 'hammer' ? -5.5 : -2.4, 1.2));
      break;
    }
    case 'ray': {
      bodyD = 'M-30 0Q-14 -4 -4 -19Q4 -6 14 -2Q18 0 14 2Q4 6 -4 19Q-14 4 -30 0Z';
      out.push(<path key="tail" d="M14 0Q30 1 40 -4" stroke={c.f} strokeWidth="1.1" fill="none" />);
      out.push(<path key="b" d={bodyD} fill={c.b} />);
      out.push(<path key="spots" d="M-10 -6h0.01M-6 4h0.01M-2 -2h0.01M2 8h0.01M-4 -11h0.01" stroke={c.u} strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />);
      out.push(vol(bodyD));
      out.push(...eye(-16, -3, 1.1));
      break;
    }
    case 'eel': {
      const d = 'M-30 -1Q-18 -10 -4 -1T22 1T40 -2';
      out.push(<path key="fin" d={d} stroke={c.f} strokeWidth="8" fill="none" strokeLinecap="round" transform="translate(0 -0.6)" />);
      out.push(<path key="b" d={d} stroke={c.b} strokeWidth="6" fill="none" strokeLinecap="round" />);
      out.push(<path key="u" d={d} stroke={c.u} strokeWidth="1.6" fill="none" transform="translate(0 1.8)" opacity="0.8" />);
      out.push(<path key="mouth" d="M-33 0.5l4 -0.2" stroke="#0b1420" strokeWidth="0.6" />);
      out.push(...eye(-29, -2.4, 1.1));
      break;
    }
    case 'angler': {
      bodyD = 'M-16 -2Q-14 -14 2 -13Q16 -12 18 -2L28 -9L27 1L29 9L18 3Q14 12 0 12Q-16 12 -16 -2Z';
      out.push(<path key="b" d={bodyD} fill={c.b} />);
      out.push(vol(bodyD));
      out.push(<path key="mouth" d="M-17 -3Q-10 2 -16 7" fill="#0b0608" stroke={shade(c.b, -0.4)} strokeWidth="0.8" />);
      out.push(<path key="teeth" d="M-16 -2.6l1.2 1.6l0.6 -1.8l1 1.8l0.4 -1.6M-15.6 6.4l1 -1.6l0.8 1.6l0.8 -1.8" stroke="#f0ece0" strokeWidth="0.7" fill="none" />);
      out.push(<path key="lure" d="M-6 -12Q-10 -24 -20 -18" stroke={shade(c.b, 0.2)} strokeWidth="0.8" fill="none" />);
      out.push(<circle key="glow" cx="-20" cy="-17" r="5" fill="url(#ws-glow)" />);
      out.push(<circle key="bulb" cx="-20" cy="-17" r="1.5" fill="#e8fbff" />);
      out.push(...eye(-8, -6, 1.4));
      break;
    }
    case 'horse': {
      bodyD = 'M-4 -14Q2 -18 6 -12Q8 -4 4 4Q2 12 6 16Q10 18 8 21Q4 22 2 18Q-2 10 0 2Q-2 -4 -6 -8L-14 -8L-14 -10L-6 -11Z';
      out.push(<path key="b" d={bodyD} fill={c.b} />);
      out.push(<path key="rings" d="M0 -4h5M-0.4 0h5M0 4h4.6M0.6 8h4M1.4 12h3.6" stroke={shade(c.b, -0.3)} strokeWidth="0.5" />);
      out.push(<path key="fin" d="M5 -2q5 2 2 7" fill={c.f} opacity="0.8" />);
      out.push(vol(bodyD));
      out.push(...eye(-1, -12, 1.2));
      break;
    }
    case 'puffer': {
      bodyD = 'M-14 0A14 12 0 1 1 14 0A14 12 0 1 1 -14 0Z';
      out.push(<path key="tail" d="M12 0L22 -6L21 0L22 6Z" fill={c.f} />);
      out.push(<path key="b" d={bodyD} fill={c.b} />);
      out.push(<path key="u" d="M-13 3A14 9 0 0 0 13 3Z" fill={c.u} />);
      let sp = '';
      for (let a = 0; a < 14; a++) {
        const ang = (a / 14) * Math.PI * 2;
        sp += P`M${14 * Math.cos(ang)} ${12 * Math.sin(ang)}l${2.6 * Math.cos(ang)} ${2.4 * Math.sin(ang)}`;
      }
      out.push(<path key="sp" d={sp} stroke={shade(c.b, -0.35)} strokeWidth="0.8" />);
      out.push(vol(bodyD));
      out.push(...eye(-7, -3, 2.2));
      break;
    }
    case 'flat': {
      bodyD = 'M-22 0Q-18 -13 0 -13Q18 -13 22 0Q18 13 0 13Q-18 13 -22 0Z';
      out.push(<path key="fins" d="M-18 -6Q0 -21 18 -6M-18 6Q0 21 18 6" stroke={c.f} strokeWidth="3" fill="none" />);
      out.push(<path key="tail" d="M20 0L30 -7L30 7Z" fill={c.f} />);
      out.push(<path key="b" d={bodyD} fill={c.b} />);
      out.push(<path key="spots" d="M-6 -6h0.01M4 -4h0.01M-2 5h0.01M10 4h0.01M12 -6h0.01" stroke={c.u} strokeWidth="2.4" strokeLinecap="round" opacity="0.6" />);
      out.push(vol(bodyD));
      out.push(...eye(-14, -4, 1.5));
      break;
    }
    case 'bill':
    case 'tuna': {
      bodyD = 'M-24 0Q-20 -8 -2 -8Q14 -7 22 -1L32 -11L29 0L32 11L22 1Q14 7 -2 8Q-20 8 -24 0Z';
      if (plan === 'bill') out.push(<path key="bill" d="M-23 -1L-42 0.4L-23 1.6Z" fill={c.f} />);
      out.push(<path key="b" d={bodyD} fill={c.b} />);
      out.push(<path key="u" d="M-23 1.5Q-6 9 18 2Q-2 4 -23 1.5Z" fill={c.u} />);
      out.push(<path key="df" d={c.stripes ? 'M-14 -7.6Q-4 -24 12 -7Z' : 'M-6 -7.6L0 -14L4 -7.4Z'} fill={c.f} opacity={c.stripes ? 0.85 : 1} />);
      out.push(<path key="finlets" d="M10 -5.6l1.6 -1.6M13 -4.6l1.6 -1.6M16 -3.4l1.4 -1.4M10 5.6l1.6 1.6M13 4.6l1.6 1.6" stroke={c.f} strokeWidth="0.8" />);
      out.push(vol(bodyD));
      out.push(...eye(-18, -2, 1.5));
      break;
    }
    case 'disc': {
      bodyD = 'M-16 0Q-12 -14 2 -14Q14 -12 16 0Q14 12 2 14Q-12 14 -16 0Z';
      out.push(<path key="fins" d="M-6 -12Q8 -22 16 -6M-6 12Q8 22 16 6" fill={c.f} />);
      out.push(<path key="tail" d="M15 0L24 -7L24 7Z" fill={c.f} />);
      out.push(<path key="b" d={bodyD} fill={c.b} />);
      out.push(<path key="stripes" d="M-8 -11.6Q-5 0 -8 11.6M2 -13.8Q5 0 2 13.8M10 -10Q12 0 10 10" stroke={c.u} strokeWidth="2.2" fill="none" opacity="0.85" />);
      out.push(vol(bodyD));
      out.push(...eye(-10, -3, 1.6));
      break;
    }
    case 'spiny': {
      bodyD = 'M-20 0Q-16 -9 0 -9Q14 -8 18 -1L26 -8L25 0L26 8L18 1Q12 9 0 9Q-16 9 -20 0Z';
      let sp = '';
      for (let i = 0; i < 7; i++) sp += P`M${-10 + i * 3.6} ${-8.4}l${-1.5 + i * 0.4} ${-9 + Math.abs(i - 3) * 1.4}`;
      out.push(<path key="spines" d={sp} stroke={c.f} strokeWidth="1" strokeLinecap="round" />);
      out.push(<path key="pf" d="M-6 3Q2 18 10 16Q4 10 -2 4Z" fill={c.f} opacity="0.8" />);
      out.push(<path key="b" d={bodyD} fill={c.b} />);
      out.push(<path key="stripes" d="M-10 -7.6v15M-4 -8.6v17M2 -8.6v17M8 -7.6v15" stroke={c.u} strokeWidth="1.2" opacity="0.7" />);
      out.push(vol(bodyD));
      out.push(...eye(-13, -2, 1.5));
      break;
    }
    default: {
      bodyD = 'M-20 0Q-16 -10 0 -10Q14 -9 18 -1L28 -10L26 0L28 10L18 1Q12 10 0 10Q-16 10 -20 0Z';
      out.push(<path key="df" d="M-6 -9.6Q4 -16 12 -7.8Z" fill={c.f} />);
      out.push(<path key="af" d="M2 9.4Q8 14 12 7.6Z" fill={c.f} />);
      out.push(<path key="b" d={bodyD} fill={c.b} />);
      out.push(<path key="u" d="M-19 2Q-4 11 16 2Q-2 5 -19 2Z" fill={c.u} />);
      if (c.stripes) out.push(<path key="stripes" d="M-8 -9.4Q-6 0 -8 9.4M2 -10Q4 0 2 10" stroke={c.u} strokeWidth="2" fill="none" />);
      out.push(<path key="gill" d="M-11 -6Q-8 0 -11 6" stroke={shade(c.b, -0.35)} strokeWidth="0.6" fill="none" />);
      out.push(<path key="scales" d="M-4 -3q2 2 4 0q2 2 4 0q2 2 4 0M-2 1q2 2 4 0q2 2 4 0" stroke={shade(c.b, 0.3)} strokeWidth="0.45" fill="none" opacity="0.7" />);
      out.push(vol(bodyD));
      out.push(...eye(-14, -2.5, 1.6));
    }
  }
  // Trait overlays (on top of the body).
  if ((t.camouflage ?? 0) > 0 && plan !== 'eel') {
    let d = '';
    for (let i = 0; i < 6; i++) d += P`M${-12 + rand() * 26} ${-6 + rand() * 12}h0.01`;
    out.push(<path key="camo" d={d} stroke={shade(c.b, -0.35)} strokeWidth="3" strokeLinecap="round" opacity="0.45" />);
  }
  if ((t.bioluminescent ?? 0) > 0) {
    out.push(<path key="photo" d="M-14 4h0.01M-8 5h0.01M-2 5.4h0.01M4 5h0.01M10 3.6h0.01" stroke="#9ef6ff" strokeWidth="1.4" strokeLinecap="round" />);
    out.push(<ellipse key="pglow" cx="-2" cy="5" rx="16" ry="3.4" fill="url(#ws-glow)" opacity="0.6" />);
  }
  if ((t.electric ?? 0) > 0) {
    out.push(<path key="zap" d="M-4 -20l3 4l-3 1l4 5M14 -16l-2 4l3 0l-3 4M-26 10l3 2l-2 2l4 2" stroke="#fff35a" strokeWidth="0.9" fill="none" strokeLinejoin="round" />);
  }
  if ((t.venomous ?? 0) > 0 && plan !== 'spiny') {
    out.push(<path key="ven" d="M-4 -9l-1 -5M0 -9.4l0 -5.4M4 -9l1 -5" stroke="#b05ad8" strokeWidth="1" strokeLinecap="round" />);
  }
  if ((t.predator ?? 0) > 0 && (plan === 'fish' || plan === 'tuna' || plan === 'spiny')) {
    out.push(<path key="teeth" d="M-19.6 1l0.8 1.2l0.6 -1.1l0.7 1.1" stroke="#f0ece0" strokeWidth="0.55" fill="none" />);
  }
  return out;
}

function fishLook(name: string, zone: string, plan: Plan, forage: boolean, rand: () => number): Look {
  if (forage) return { b: '#b8c4cc', f: '#7a8a96', u: '#eef2f4', stripes: false };
  const pal = ZONE_PAL[zone] ?? ZONE_PAL.sunlight!;
  const p = pal[Math.floor(rand() * pal.length)]!;
  const look: Look = { b: p[0], f: p[1], u: p[2], stripes: plan === 'disc' || /clown|anemone|sergeant|zebra|tiger/i.test(name) };
  if (plan === 'shark' || plan === 'hammer' || plan === 'saw') Object.assign(look, { b: '#7f95a6', f: '#5c7182', u: '#eef2f4' });
  if (/clown|anemone/i.test(name)) Object.assign(look, { b: '#f08a24', f: '#1a1a1a', u: '#ffffff' });
  if (/sailfish/i.test(name)) look.stripes = true;
  for (const word of name.toLowerCase().split(/\s+/)) {
    const bits = word.replace(/fin$/, '-fin').split('-');
    const col = bits.map((x) => COLOR[x]).find(Boolean);
    if (!col) continue;
    if (bits.includes('fin') || /fin|tail/.test(word)) look.f = col;
    else {
      look.b = col;
      look.f = shade(col, -0.3);
      look.u = shade(col, 0.5);
    }
  }
  return look;
}

const CORAL_HEX: Record<string, string> = { blue: '#3a86ff', purple: '#8338ec', green: '#38b000', red: '#ff006e', pink: '#ff4fa0', yellow: '#ffbe0b' };

export const FishIllustration = memo(function FishIllustration({
  id,
  name,
  size: fishSize,
  tags,
  forage,
  zones,
  coral,
}: {
  id: number;
  name: string;
  size: 'small' | 'medium' | 'large';
  tags?: Tags;
  forage?: boolean;
  zones?: { sunlight?: boolean; twilight?: boolean; midnight?: boolean | string };
  coral?: string | null;
}) {
  const rand = seeded(hashStr(name) ^ (id * 3266489917));
  const lower = name.toLowerCase();
  const plan: Plan = PLAN_RULES.find(([re]) => re.test(lower))?.[1] ?? 'fish';
  const zone = zones?.sunlight ? 'sunlight' : zones?.twilight ? 'twilight' : zones?.midnight ? 'midnight' : 'sunlight';
  const look = fishLook(name, zone, plan, !!forage, rand);
  const sc = (fishSize === 'small' ? 0.72 : fishSize === 'large' ? 0.98 : 0.86) * (plan === 'horse' ? 0.85 : 1);
  const coralHex = coral ? (CORAL_HEX[coral.toLowerCase()] ?? '#ff4fa0') : null;
  const body = drawFish(plan, look, tags ?? {}, rand);
  const flip = id % 3 === 0;
  const fx = flip ? -sc : sc;
  return (
    <svg viewBox="0 0 120 40" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden="true" className="art-svg">
      {zoneBack(zone, zones?.midnight === 'bottom', coralHex, rand)}
      {forage ? (
        [[-12, -6, 0.62], [10, 2, 0.7], [-4, 9, 0.55]].map(([dx, dy, s], i) => (
          <g key={i} transform={`translate(${60 + dx!} ${20 + dy!}) scale(${fx * s!} ${sc * s!})`}>{drawFish('fish', look, {}, rand)}</g>
        ))
      ) : (
        <g transform={`translate(60 ${plan === 'horse' ? 18 : 20}) scale(${r1(fx * 100) / 100} ${r1(sc * 100) / 100})`}>{body}</g>
      )}
      <rect width="120" height="40" fill="url(#ws-vignette)" />
    </svg>
  );
});
