// Procedural Wingspan bird portraits. Everything is derived from card data:
//  - the NAME picks a body plan (owl, raptor, wader, duck, woodpecker, …) and
//    the plumage: species presets + colour/part words ("Red-winged" → red
//    shoulder patch, "Black-capped" → black cap, "Long-tailed" → long tail);
//  - the HABITAT picks the scene (forest branch, grassland post, wetland reeds
//    or water) and the card id seeds its time of day, trees, leaves and hills.
// No images: each portrait is ~40–60 small SVG nodes sharing <ArtDefs/> gradients.

import { memo, type ReactNode } from 'react';
import { hashStr, r1, seeded, shade } from './core';

type Pose = 'perch' | 'upright' | 'stand' | 'rock' | 'float' | 'wade' | 'fly' | 'hover' | 'cling';
type Beak = 'cone' | 'thin' | 'short' | 'hook' | 'long' | 'down' | 'up' | 'flat' | 'spoon' | 'huge' | 'pouch' | 'needle' | 'bent';
type Tail = 'short' | 'long' | 'fork' | 'stiff' | 'cocked' | 'train' | 'none';
type Crest = 'point' | 'tuft' | 'ears' | 'topknot' | 'shaggy';
type Kind = 'owl' | 'penguin' | 'swan' | 'hum' | 'swallow' | 'glide' | 'peacock' | 'turkey' | 'vulture';

interface Form {
  pose: Pose;
  L: number; // body half-length
  H: number; // body half-depth
  tilt: number; // degrees, + = chest up / tail down
  hx: number;
  hy: number;
  hr: number;
  beak: Beak;
  bl: number;
  tail: Tail;
  tl: number;
  leg: number;
  neck: number;
  kind?: Kind;
}

const F = (
  pose: Pose, L: number, H: number, tilt: number, hx: number, hy: number, hr: number,
  beak: Beak, bl: number, tail: Tail, tl: number, leg: number, neck = 0, kind?: Kind,
): Form => ({ pose, L, H, tilt, hx, hy, hr, beak, bl, tail, tl, leg, neck, kind });

const FORMS = {
  song: F('perch', 12, 7.5, 22, -11, -8, 5.5, 'thin', 5, 'short', 9, 5),
  finch: F('perch', 11.5, 7.8, 20, -10.5, -7.5, 5.9, 'cone', 4.6, 'fork', 8, 5),
  wren: F('perch', 9.5, 7.5, 14, -9, -6.5, 5.3, 'thin', 5.5, 'cocked', 8, 5),
  corvid: F('perch', 15, 9, 15, -14.5, -8.5, 6.4, 'cone', 8, 'long', 13, 7),
  longtail: F('perch', 13, 7, 14, -13, -7, 5.4, 'thin', 6, 'long', 22, 5),
  dove: F('perch', 12.5, 8.2, 12, -12.5, -8, 4.6, 'short', 3.2, 'long', 11, 4),
  nightjar: F('perch', 13, 6.5, -4, -13, -5, 5, 'short', 2.5, 'long', 10, 2),
  kingfisher: F('perch', 10.5, 7.5, 30, -9.5, -9.5, 7, 'long', 11, 'short', 6, 3),
  toucan: F('perch', 11.5, 8, 28, -9.5, -9.5, 6, 'huge', 16, 'long', 11, 3),
  parrot: F('upright', 11, 7.5, 62, -5.5, -14, 6.4, 'hook', 6, 'long', 16, 3),
  owl: F('upright', 13, 10.5, 82, -1, -14, 9, 'hook', 2.5, 'short', 4, 2, 0, 'owl'),
  raptor: F('upright', 14, 9.5, 58, -8.5, -15.5, 6.2, 'hook', 6.5, 'long', 12, 4),
  vulture: F('upright', 14, 10, 50, -10, -16, 4.6, 'hook', 6, 'short', 8, 4, 3, 'vulture'),
  cling: F('cling', 13, 7, 72, -5.5, -15, 5.5, 'long', 8, 'stiff', 9, 3),
  hum: F('hover', 8.5, 5, 35, -8, -7, 4.2, 'needle', 11, 'short', 6, 0, 0, 'hum'),
  duck: F('float', 15, 8, -3, -13, -10, 5.8, 'flat', 6.5, 'short', 5, 0, 6),
  swan: F('float', 16, 8.5, -3, -18, -22, 4.6, 'flat', 6, 'short', 5, 0, 4.5, 'swan'),
  grebe: F('float', 14, 6.5, -2, -14, -9, 5, 'long', 7, 'none', 0, 0, 5),
  pelican: F('float', 16, 9, -4, -14, -13, 5.5, 'pouch', 17, 'short', 4, 0, 6),
  wader: F('wade', 12, 7, 6, -14, -20, 4.2, 'long', 13, 'short', 6, 18, 3.6),
  crane: F('wade', 13, 8, 4, -13, -21, 4, 'long', 9, 'short', 7, 19, 3.2),
  flamingo: F('wade', 11, 7, 8, -12, -26, 3.8, 'bent', 7, 'short', 5, 20, 3),
  shore: F('stand', 10.5, 6.5, 6, -10.5, -6.5, 4.6, 'long', 8, 'short', 5, 9),
  plover: F('stand', 10, 7, 4, -9.5, -6.5, 5.2, 'short', 4, 'short', 5, 8),
  rail: F('stand', 12, 8, 8, -12, -9, 4.8, 'cone', 5, 'cocked', 5, 9, 4),
  game: F('stand', 14, 9.5, 0, -14, -10, 4.6, 'short', 3.5, 'short', 8, 7, 5),
  pheasant: F('stand', 13, 8.5, 0, -13.5, -9.5, 4.4, 'short', 3.5, 'train', 26, 7, 4.5),
  peacock: F('stand', 12, 8, 0, -12.5, -12, 4, 'short', 3.2, 'none', 0, 8, 3.5, 'peacock'),
  turkey: F('stand', 14, 10, 0, -14, -13, 3.8, 'short', 3, 'none', 0, 8, 4.5, 'turkey'),
  ratite: F('stand', 13, 10, 6, -11, -25, 4, 'short', 4, 'short', 5, 14, 3.5),
  kiwi: F('stand', 12, 9, 0, -11, -3, 4.2, 'down', 12, 'none', 0, 5),
  hoopoe: F('stand', 11, 7, 10, -11, -8, 5, 'down', 9, 'short', 7, 6),
  glide: F('fly', 14, 5.5, -2, -15.5, -2.5, 5, 'long', 6, 'short', 5, 0, 0, 'glide'),
  swallow: F('fly', 10, 4, -6, -11, -1, 4, 'short', 2.5, 'fork', 12, 0, 0, 'swallow'),
  auk: F('rock', 11.5, 8, 72, -2.5, -14, 6, 'cone', 6, 'short', 3, 3),
  penguin: F('rock', 13, 8, 84, -1, -16, 6, 'long', 6, 'short', 3, 2, 0, 'penguin'),
  cormorant: F('rock', 12, 7, 65, -5, -17, 4.5, 'hook', 7, 'long', 9, 3, 3.5),
} satisfies Record<string, Form>;
type FormKey = keyof typeof FORMS;

// First match wins — order matters (e.g. "Sparrowhawk" must hit raptor before finch).
const FORM_RULES: [RegExp, FormKey][] = [
  [/hummingbird/, 'hum'],
  [/\bowl\b|owlet|frogmouth|potoo/, 'owl'],
  [/vulture|condor/, 'vulture'],
  [/eagle|hawk|falcon|kite|harrier|buzzard|kestrel|merlin|hobby|osprey|caracara|secretary/, 'raptor'],
  [/woodpecker|flicker|sapsucker|wryneck|creeper|nuthatch|scythebill/, 'cling'],
  [/penguin/, 'penguin'],
  [/puffin|murre|auklet|dovekie|guillemot|razorbill/, 'auk'],
  [/cormorant|\bshag\b|anhinga/, 'cormorant'],
  [/pelican/, 'pelican'],
  [/swan/, 'swan'],
  [/duck|goose|brant|teal|mallard|merganser|wigeon|scaup|eider|goldeneye|shoveler|pintail|canvasback|smew|pochard|screamer/, 'duck'],
  [/grebe|loon|diver|dabchick/, 'grebe'],
  [/flamingo/, 'flamingo'],
  [/crane|brolga/, 'crane'],
  [/ibis(?!bill)|spoonbill|heron|egret|bittern|stork|jabiru|adjutant|limpkin|seriema/, 'wader'],
  [/gull|\btern\b|noddy|albatross|petrel|shearwater|frigatebird|gannet|booby|skimmer|kittiwake/, 'glide'],
  [/swallow|swift|martin|nighthawk/, 'swallow'],
  [/kiwi/, 'kiwi'],
  [/\bemu\b|\brhea\b|cassowary|ostrich/, 'ratite'],
  [/peafowl|peacock/, 'peacock'],
  [/turkey/, 'turkey'],
  [/pheasant|monal|tragopan|argus|junglefowl|chicken|capercaillie|lyrebird/, 'pheasant'],
  [/quail|bobwhite|grouse|ptarmigan|partridge|curassow|\bguan\b|chachalaca|malleefowl|scrubfowl|tinamou|nothura|bustard|florican|kākāpō|takahē|weka/, 'game'],
  [/coot|moorhen|gallinule|\brail\b|crake|pūkeko|jacana/, 'rail'],
  [/plover|killdeer|lapwing|dotterel|courser|wrybill|seedsnipe/, 'plover'],
  [/sandpiper|curlew|godwit|snipe|woodcock|avocet|stilt|oystercatcher|turnstone|\bknot\b|\bruff\b|willet|surfbird|dunlin|ibisbill/, 'shore'],
  [/parrot|parakeet|macaw|cockatoo|cockatiel|lorikeet|rosella|budgerigar|galah|\bkea\b/, 'parrot'],
  [/kingfisher|kookaburra|bee-eater|motmot|roller|trogon|quetzal|jacamar|puffbird/, 'kingfisher'],
  [/toucan|hornbill|aracari/, 'toucan'],
  [/hoopoe/, 'hoopoe'],
  [/dove|pigeon|kererū/, 'dove'],
  [/nightjar|pauraque|will|oilbird/, 'nightjar'],
  [/cuckoo|koel|coucal|roadrunner|\bani\b|magpie|wagtail|drongo|paradise|astrapia|whipbird|tailorbird/, 'longtail'],
  [/\bcrow\b|raven|\brook\b|jackdaw|chough|nutcracker|grackle|\bjay\b|butcherbird|hoatzin|oropendola|umbrellabird|bowerbird/, 'corvid'],
  [/wren|dipper/, 'wren'],
  [/finch|sparrow|grosbeak|bunting|cardinal|junco|towhee|crossbill|seedeater|siskin|serin|hawfinch|chaffinch|brambling|twite|longspur|dickcissel|pyrrhuloxia|grassquit|munia|mannikin|avadavat|weaver|bobolink|yellowhammer/, 'finch'],
];

const NIGHT = /\bowl\b|owlet|nightjar|nighthawk|pauraque|potoo|frogmouth|oilbird|will/;

// ---------------------------------------------------------------------------
// Plumage
// ---------------------------------------------------------------------------

export const COLOR: Record<string, string> = {
  red: '#c8352b', ruby: '#b3123b', scarlet: '#d62828', vermilion: '#e2492f', crimson: '#a4161a',
  rose: '#e07a8f', rosy: '#e59aa5', roseate: '#ee8ca8', pink: '#f19cb7', orange: '#e8822a',
  rufous: '#b5562b', chestnut: '#8a3b1f', cinnamon: '#b06a3b', ruddy: '#a8502e', ferruginous: '#a4552a',
  brown: '#7a5634', tawny: '#b98245', buff: '#d9b98a', yellow: '#f2c230', golden: '#e0a526',
  gold: '#e0a526', citrine: '#d8c02a', olive: '#7d7b38', green: '#4f9a4a', emerald: '#1f9d6a',
  blue: '#3a6fc4', azure: '#3c8fe0', indigo: '#3b3f9a', cerulean: '#3d8cc8', lazuli: '#3a6fd8',
  purple: '#6d3f99', violet: '#7a4bc4', black: '#26221f', white: '#f3f1ea', snowy: '#f7f6f0',
  gray: '#8d9298', grey: '#8d9298', ashy: '#9aa0a3', slaty: '#5d6670', sooty: '#3b3836',
  dusky: '#5a4f48', silver: '#c4c9cc', ivory: '#efe9d5', maroon: '#6b1f2a', copper: '#b0612f',
  bronze: '#8c6a2f', turquoise: '#2fb5a8', lilac: '#b59ad0', coral: '#f07f5a', slate: '#5d6670',
};

interface Look {
  b: string; w: string; u: string; h: string; k: string; l: string; t: string; iris: string;
  cap?: string; crown?: string; mask?: string; throat?: string; brow?: string; cheek?: string;
  face?: string; collar?: string; patch?: string; bar?: string; tip?: string; shield?: string;
  crest?: string; crestKind?: Crest; pat?: 'spots' | 'streaks' | 'bars';
  tailKind?: Tail;
}
type ColorKey = Exclude<keyof Look, 'pat' | 'crestKind' | 'tailKind'>;

// Species presets: "key:colour" pairs; colour = COLOR name or #hex.
const PRESET_SRC: [RegExp, string][] = [
  [/cardinal/, 'b:red w:crimson u:red h:red k:coral mask:black crest:red'],
  [/pyrrhuloxia/, 'b:gray face:red crest:red k:yellow u:#d9b5b0'],
  [/blue jay/, 'b:blue w:azure u:white k:black collar:black crest:blue bar:white'],
  [/\bjay\b/, 'b:#b99a86 w:#4a4f5c u:#e8dccf patch:azure k:black mask:black'],
  [/american robin/, 'b:slate w:slate u:rufous h:black k:yellow'],
  [/robin/, 'b:#7d6e52 w:#6a5a40 u:orange face:orange k:black'],
  [/european goldfinch/, 'b:#c9a77f w:black u:#f1e6d4 face:red k:ivory bar:yellow'],
  [/goldfinch/, 'b:yellow w:black u:yellow cap:black k:#f0a878 bar:white'],
  [/chickadee/, 'b:gray w:slate u:#f0e6d8 cap:black throat:black cheek:white'],
  [/great tit/, 'b:#b4b84a w:#6c8aa0 u:yellow h:black cheek:white'],
  [/blue tit/, 'b:#9bb35a w:azure u:yellow cap:azure cheek:white mask:#1d2a5a'],
  [/\btit\b|titmouse/, 'b:gray u:buff cap:black cheek:white'],
  [/red-winged blackbird/, 'b:black w:black u:black h:black k:black patch:red'],
  [/yellow-headed blackbird/, 'b:black w:black u:black k:black patch:white'],
  [/magpie/, 'b:black w:#1f3b66 u:white h:black k:black patch:white t:#1f3b66'],
  [/\bcrow\b|raven|\brook\b|jackdaw|chough|grackle|blackbird|cowbird|\bani\b|drongo/, 'b:black w:#1c1a24 u:#2e2b35 h:black k:black l:black'],
  [/nutcracker/, 'b:#5a4a3e pat:spots u:#6a5a4e'],
  [/starling|myna/, 'b:#2a2a3a w:#3a3048 u:#2b3a3a k:yellow pat:spots'],
  [/oriole/, 'b:orange w:black u:orange h:black bar:white k:slate'],
  [/tanager/, 'b:yellow w:black'],
  [/bluebird/, 'b:blue w:azure u:rufous throat:rufous'],
  [/painted bunting/, 'b:red h:indigo w:#7fb53a u:red'],
  [/yellowthroat/, 'b:olive u:yellow throat:yellow mask:black'],
  [/warbler|parula|redstart|whitestart/, 'b:#a8a23a w:#6f6b33 u:#f1d84a k:#3a3a2a'],
  [/vireo/, 'b:#8e9550 u:#f2eecf brow:white'],
  [/kinglet|goldcrest/, 'b:#8f9a55 u:#e6e3c8 crown:yellow bar:white'],
  [/waxwing/, 'b:#b99f7a w:#7a7f86 u:#d8c79a mask:black crest:#b99f7a tip:yellow'],
  [/sparrow|lark|pipit|longspur|dickcissel|seedeater|siskin|twite|bushlark/, 'b:#9a7046 w:#6e4e2f u:#e2d3b6 pat:streaks k:#5a4a3a'],
  [/meadowlark/, 'b:#a8865a u:yellow collar:black pat:streaks'],
  [/bobolink/, 'b:black u:black cap:#e8d8a0 patch:white'],
  [/\bwren\b|fairywren/, 'b:#8b5e3c w:#6b4428 u:#d9b48e pat:bars brow:#e6d3b3'],
  [/thrush|nightingale/, 'b:#8a6a4a u:#efe2cc pat:spots'],
  [/swallow/, 'b:#2a4f8a w:#1f3a66 u:#e8c49a throat:rufous'],
  [/swift/, 'b:#3d3a36 w:#2a2826 u:#4a4642 throat:#cfc8bb'],
  [/hummingbird/, 'b:#3f9a5a w:#5b6a5f u:#d9e2d4 k:black'],
  [/red-headed woodpecker/, 'b:white w:black h:red u:white bar:white k:slate'],
  [/woodpecker/, 'b:black w:black u:white h:white cap:red bar:white k:slate mask:black'],
  [/flicker/, 'b:#a88563 u:#efe0c8 pat:spots collar:black cap:#9aa0a8'],
  [/sapsucker/, 'b:black u:#f2e7a0 cap:red throat:red cheek:white'],
  [/nuthatch/, 'b:#6f8aa3 u:white cap:black mask:black'],
  [/creeper/, 'b:#8a6a48 pat:streaks u:white brow:white k:#3a3028'],
  [/barn owl/, 'b:#d9b27a w:#b98d55 u:#fbf6ea face:#fbf6ea iris:#1a1a1a pat:spots'],
  [/snowy owl/, 'b:white w:#ecebe4 u:white face:white pat:bars iris:yellow'],
  [/\bowl\b|owlet|frogmouth|potoo/, 'b:#8a6440 w:#6b4a2c u:#e3cba5 face:#ead8b8 pat:streaks iris:yellow'],
  [/bald eagle/, 'b:#4a321e w:#3e2a18 u:#4a321e h:white t:white k:yellow l:yellow iris:yellow'],
  [/golden eagle/, 'b:#5a3e26 w:#4a321e h:#c08c3a k:#d9b04a l:yellow'],
  [/eagle/, 'b:#5a3e26 w:#4a321e u:#6a4a2e k:yellow l:yellow iris:yellow'],
  [/osprey/, 'b:#4a3a2e w:#3a2c22 u:white h:white mask:#3a2c22 k:black l:#a8b0b8 iris:yellow'],
  [/red-tailed hawk/, 'b:#7a5232 u:#f3e7d3 t:rufous k:slate l:yellow pat:streaks'],
  [/kestrel/, 'b:#c27a45 w:#a86a3a u:#f0dcc0 cap:#7a8ea6 mask:#2a2a2a pat:spots l:yellow'],
  [/falcon|merlin|hobby/, 'b:#6a7480 w:#4f5862 u:#efe6d6 pat:spots mask:#2a2a2a k:#3a3a3a l:yellow iris:#2a1a10'],
  [/hawk|kite|harrier|buzzard|secretary/, 'b:#7a5232 w:#5a3a22 u:#efe0c8 pat:bars k:slate l:yellow iris:yellow'],
  [/caracara/, 'b:#2a2622 u:#efe6d6 cap:black face:#e86a3a k:#d9c9a3 l:yellow'],
  [/condor/, 'b:#1f1c19 w:#1f1c19 h:#d9906b collar:white k:#e8d8b8 bar:white'],
  [/vulture/, 'b:#2a2622 w:#1f1c19 u:#2a2622 h:#c94b3b k:#e8d8b8 l:#c8b8a8'],
  [/great egret|snowy egret|egret/, 'b:white w:#f0eee6 u:white k:yellow l:black'],
  [/heron/, 'b:#8a98a8 w:#6c7a8a u:#d6dde3 h:#e8ecef cap:black k:yellow l:#9a8a5a'],
  [/bittern/, 'b:#a88758 u:#e6d3ac pat:streaks k:yellow l:#a8a050'],
  [/crane|brolga/, 'b:#a9aeb3 w:#8c9196 u:#c8ccd0 h:#9aa0a6 crown:red k:#4a4a4a l:#2a2a2a'],
  [/stork|jabiru|adjutant/, 'b:white w:black u:white h:#2a2a2a k:#b8a080 l:#d98a7a'],
  [/spoonbill/, 'b:pink w:#e05a7a u:pink h:#f6c8d4 k:#9aa08a l:#c94b6b'],
  [/ibis|limpkin/, 'b:#5a3a4a w:#3a5a4a u:#5a3a4a k:#4a3a32 l:#5a4a3a'],
  [/flamingo/, 'b:#f48aa0 w:#e45a78 u:#f6a0b2 k:#f6e0e0 tip:black l:#e57a90'],
  [/mallard/, 'b:#a9a9a6 w:#7a6a5a u:#8a4a2e h:#1f6a3a collar:white k:yellow l:orange t:#2a2a2a patch:#3a4fb5'],
  [/wood duck/, 'b:#8a5a3a h:#1f5a4a u:#7a3a2a crest:#1f5a4a mask:white k:red patch:#3a5ab5'],
  [/merganser|smew/, 'b:#e8e2d8 w:#2a2a2a h:#1f4a3a crest:#1f4a3a k:red'],
  [/eider/, 'b:white w:black u:black h:white cap:black k:#b8c88a'],
  [/teal/, 'b:#9a8e7e h:#8a3a22 mask:#2a7a4a k:black patch:#2a8a5a'],
  [/goose|brant/, 'b:#8a7a66 w:#6a5a48 u:#d8cfc0 h:black throat:white k:black l:black'],
  [/black swan/, 'b:#1f1f22 w:#2a2a2e u:#1f1f22 h:#1f1f22 k:red l:black'],
  [/swan/, 'b:white w:#f2f0ea u:white h:white k:orange l:black'],
  [/duck|wigeon|scaup|goldeneye|shoveler|pintail|canvasback|pochard|screamer/, 'b:#8a6a4a w:#6a4f36 u:#a8875e h:#7a5a3e k:#4a4a3a l:orange patch:#3a6ab5'],
  [/grebe|dabchick/, 'b:#5a4a3e u:#a85a3a h:#2a2a2a k:black crest:#c8862a iris:red'],
  [/loon|diver/, 'b:#2a2a2a w:#1f1f1f u:white h:#1f3a3a collar:white k:black iris:red pat:spots'],
  [/cormorant|\bshag\b|anhinga/, 'b:#1f2222 w:#2a2e2a u:#1f2222 k:#5a5a4a throat:#e8a03a iris:#3ab0a0'],
  [/pelican/, 'b:white w:#9aa0a8 u:white h:#f3e7c3 k:#e8b84a l:#5a5a5a'],
  [/\btern\b|noddy|skimmer/, 'b:white w:#c8d0d8 u:white cap:black k:#e04a2a l:#e04a2a'],
  [/gull|kittiwake/, 'b:white w:#9aa6b0 u:white k:yellow tip:black l:#e8a87a'],
  [/albatross/, 'b:white w:#3a3a3a u:white k:#f0b0b0 tip:#2a2a2a'],
  [/gannet/, 'b:white w:white h:#f2e2a8 k:#a8b8c8 tip:black'],
  [/booby/, 'b:#8a6a4a w:#7a5a3e u:white h:#a8957a l:#3aa0d0 k:#7a8a9a'],
  [/frigatebird/, 'b:#1f1f22 w:#1f1f22 u:#1f1f22 throat:red k:#5a5a5a'],
  [/petrel|shearwater/, 'b:#5a5f66 w:#3a3e44 u:white k:#2a2a2a'],
  [/puffin/, 'b:#1f1f22 w:#1f1f22 u:white face:#f0eee6 k:#e8532a l:#f08a3a'],
  [/murre|auklet|dovekie|guillemot|razorbill/, 'b:#2a2a2e w:#2a2a2e u:white k:black l:#3a3a3a'],
  [/penguin/, 'b:#2a3038 w:#2a3038 u:white k:black l:#e8a0a0'],
  [/killdeer|plover/, 'b:#a88a62 u:white collar:black brow:white k:black l:#d9c08a'],
  [/lapwing/, 'b:#2a5a4a u:white h:#2a2a2a cheek:white crest:#2a2a2a crestKind:tuft l:#c87a6a'],
  [/avocet/, 'b:white w:black u:white h:#d9a070 k:black l:#7aa0c0'],
  [/stilt/, 'b:white w:black cap:black l:#e86a7a k:black'],
  [/oystercatcher/, 'b:#1f1f1f w:#1f1f1f u:white k:#e8532a l:#e8a0a0 iris:red'],
  [/sandpiper|curlew|godwit|snipe|woodcock|turnstone|\bknot\b|\bruff\b|willet|surfbird|dunlin|wrybill|ibisbill/, 'b:#9a8264 w:#7a6448 u:#ece2d0 pat:streaks k:#3a3a32 l:#7a7a5a'],
  [/quail|bobwhite/, 'b:#8a6a4a u:#b8a080 pat:spots face:white throat:white crest:black crestKind:topknot'],
  [/pheasant/, 'b:#a8582a w:#8a6a3a h:#1f5a4a face:red collar:white t:#a88a5a'],
  [/ptarmigan/, 'b:white w:white u:white brow:red k:black'],
  [/grouse|capercaillie/, 'b:#5a4a3e w:#4a3a2e pat:bars brow:red t:#3a2e26'],
  [/turkey/, 'b:#3a2e26 w:#5a4a3a h:#9ac0d8 throat:red k:#c8b89a l:#c8a8a0'],
  [/peafowl|peacock/, 'b:#1f5aa8 w:#c8b07a u:#1f5aa8 h:#1f5aa8 crest:#1f5aa8 crestKind:topknot k:#c8b89a'],
  [/chicken|junglefowl/, 'b:#a8452a w:#2a4a3a h:#d88a2a face:red crest:red crestKind:shaggy t:#1f3a2a'],
  [/partridge/, 'b:#9a8a7a u:#c8b8a8 face:#d98a4a pat:bars'],
  [/tragopan/, 'b:#b83a2a pat:spots h:#1f1f2a face:#3ab0e0'],
  [/monal/, 'b:#1f3a8a h:#2a8a5a crest:#2a8a5a crestKind:topknot w:#8a3aa0 t:#c8662a'],
  [/lyrebird/, 'b:#6a5a48 w:#5a4a3a t:#8a7a62'],
  [/curassow|guan|chachalaca|malleefowl|scrubfowl|tinamou|nothura/, 'b:#3a2e28 w:#2e2420 k:yellow'],
  [/bustard|florican/, 'b:#b8956a u:white h:#9aa0a8 pat:bars'],
  [/kākāpō/, 'b:#8aa83a w:#6a8a2a pat:bars face:#c8b86a'],
  [/takahē|pūkeko/, 'b:#2a4ab0 w:#2a6a5a k:red shield:red l:#e05a3a'],
  [/coot/, 'b:#2a2a2e w:#2a2a2e u:#2a2a2e h:#1f1f22 k:white shield:white l:#7a9a3a iris:red'],
  [/moorhen|gallinule/, 'b:#2a2e3a w:#4a4a32 u:#2a2e3a h:#1f2230 k:#e8c83a shield:red l:#c8c83a'],
  [/weka|\brail\b|crake/, 'b:#7a5a3a pat:streaks u:#9aa0a8 k:#c87a4a'],
  [/jacana/, 'b:#7a3a22 h:black k:#e8c83a shield:#e8c83a l:#7ab03a'],
  [/macaw/, 'b:#d62828 w:#2a5ab0 t:#2a5ab0 face:white k:#e8e0d0'],
  [/cockatoo/, 'b:white w:#f0eee6 h:white u:white crest:#f2d24a crestKind:shaggy k:#2a2a2a t:white'],
  [/galah/, 'b:#9aa0a8 u:#e85a8a h:#f0a0b8 crest:#f8d0dc crestKind:shaggy'],
  [/cockatiel/, 'b:#a8a8a8 h:#f2d24a crest:#f2d24a crestKind:point cheek:#e8732a'],
  [/lorikeet/, 'b:#3aa04a h:#2a4ab0 u:#e86a2a k:red'],
  [/rosella/, 'b:#d62828 w:#2a5ab0 cheek:white u:red'],
  [/budgerigar/, 'b:#7ad04a w:#d8d860 h:#f2e24a pat:bars'],
  [/\bkea\b/, 'b:#6a7a3a w:#5a6a2a patch:#e8732a k:#3a3a3a'],
  [/parrot|parakeet/, 'b:#3ab04a w:#2a8a3a u:#7ad04a k:#2a2a2a'],
  [/belted kingfisher/, 'b:#5a7a9a u:white collar:white crest:#5a7a9a crestKind:shaggy k:black'],
  [/kingfisher/, 'b:#2a7ab0 w:#2a5a8a u:#e0802a throat:white k:black l:#e05a3a'],
  [/kookaburra/, 'b:#8a6a4a w:#5a4a3a u:#efe6d6 h:#e8dcc8 mask:#5a4a3a k:#2a2a2a patch:#5aa0c0'],
  [/bee-eater/, 'b:#2a9a6a u:#3ab0c0 h:#a85a2a throat:yellow mask:black'],
  [/motmot/, 'b:#3a9a5a h:#2a8ab0 mask:black'],
  [/roller/, 'b:#5aa0d0 w:#2a4a9a u:#7ac0d8 h:#5aa0d0'],
  [/trogon|quetzal/, 'b:#1f9a6a w:#1f8a5a u:#d62828 k:yellow'],
  [/toucan|aracari/, 'b:#1f1f22 w:#1f1f22 u:#1f1f22 throat:#f2d24a k:#7ab03a tip:#e8532a'],
  [/hornbill/, 'b:#2a2a2a w:#2a2a2a u:white k:#e8b82a shield:#e8b82a'],
  [/barbet/, 'b:#3a9a4a h:#d62828 k:#e8c82a'],
  [/hoopoe/, 'b:#d8945a w:black bar:white crest:#d8945a crestKind:shaggy t:black'],
  [/roadrunner/, 'b:#8a7258 pat:streaks crest:#5a4a3a crestKind:shaggy'],
  [/koel/, 'b:#1f1f2a w:#1f1f2a u:#1f1f2a iris:red k:#b8c08a'],
  [/cuckoo|coucal/, 'b:#8a8e92 u:#e8e4dc pat:bars'],
  [/nightjar|nighthawk|pauraque|oilbird|will/, 'b:#8a7258 w:#6a5640 u:#a8906c pat:bars throat:#efe6d6'],
  [/kererū/, 'b:#3a6a4a w:#3a5a4a u:white k:red'],
  [/dove|pigeon/, 'b:#a8a39a w:#8a847a u:#c8b0a8 h:#9aa0a8 collar:#2a2a2a k:#5a4a4a l:#c86a6a'],
  [/kiskadee/, 'b:#8a6a3a u:yellow h:black brow:white crown:yellow'],
  [/kingbird/, 'b:#7a7e72 u:yellow h:#6a6e66'],
  [/flycatcher|phoebe|tyrant|pewee/, 'b:#6a6e5a u:#e8e4c8 h:#5a5e52'],
  [/shrike|butcherbird/, 'b:#9aa0a8 w:#2a2a2a u:white mask:black k:black'],
  [/tūī/, 'b:#1f2a2a w:#2a3a3a u:#1f2a2a throat:white'],
  [/honeyeater|wattlebird|stitchbird|korimako|bellbird/, 'b:#7a8a3a u:#d8d8a0 mask:#2a2a2a'],
  [/sunbird/, 'b:#2a8a6a u:yellow throat:#5a2ab0 k:black'],
  [/weaver/, 'b:yellow w:#7a7a2a h:black'],
  [/munia|mannikin|avadavat/, 'b:#7a4a2a h:black k:#a8b0b8'],
  [/bowerbird/, 'b:#1f2a5a w:#1f2a5a u:#1f2a5a iris:#5aa0f0 k:#d8d8b8'],
  [/paradise|astrapia/, 'b:#5a3a1a h:#e8d84a throat:#2a8a5a t:#f0a030'],
  [/\bemu\b/, 'b:#5a4a3a w:#4a3a2e u:#5a4a3a h:#3a4a5a'],
  [/cassowary/, 'b:#1f1f1f w:#1f1f1f u:#1f1f1f h:#3a8ad8 throat:red crest:#c8a87a crestKind:point'],
  [/\brhea\b/, 'b:#9aa0a8 w:#7a8088 u:#c8ccd0'],
  [/kiwi/, 'b:#7a5a3a w:#6a4a2e u:#8a6a48 pat:streaks k:#d8c8a8'],
  [/dipper/, 'b:#4a4a46 w:#3a3a36 u:#5a3a2a throat:white'],
  [/hoatzin/, 'b:#8a5a3a u:#d8a060 face:#3a8ad8 crest:#c87a3a crestKind:shaggy iris:red'],
  [/oropendola/, 'b:#5a3a2a t:yellow k:#e8d8a8'],
  [/umbrellabird/, 'b:black w:black u:black crest:black crestKind:shaggy'],
  [/evening grosbeak/, 'b:#c8a02a h:#5a4a2a w:black k:#d8e0a0 brow:yellow'],
  [/grosbeak|hawfinch/, 'b:#c8956a w:#3a2a22 k:#c8c0a8'],
  [/crossbill/, 'b:#c84a3a w:#5a3a2a'],
  [/bullfinch/, 'b:#8a8e92 u:#e86a5a cap:black w:black'],
  [/chaffinch|brambling/, 'b:#c8846a h:#7a8ea6 w:#3a3a2a bar:white'],
  [/wagtail/, 'b:#5a5a5a u:white face:white cap:black t:black'],
  [/towhee/, 'b:black u:#e8e4dc patch:rufous iris:red'],
  [/junco/, 'b:#6a7078 u:white k:pink'],
  [/blackcap/, 'b:#9a9a92 cap:black'],
  [/catbird/, 'b:#6a7078 w:#5a6068 cap:black'],
  [/mockingbird|thrasher/, 'b:#8a8a8a u:#e8e4dc bar:white iris:yellow'],
  [/phainopepla/, 'b:black w:black u:black crest:black iris:red'],
  [/kōkako/, 'b:#5a6a7a throat:#3a8ad8 mask:black'],
  [/saddleback/, 'b:black patch:rufous'],
  [/yellowhammer/, 'b:#b8864a h:yellow u:yellow pat:streaks'],
  [/silvereye/, 'b:#8a9a3a u:#c8c8b8 iris:white'],
  [/finch|bunting|serin|grassquit/, 'b:#a37d5a u:#e2d2bd pat:streaks'],
];

function parseSpec(src: string): Partial<Look> {
  const out: Record<string, string> = {};
  for (const pair of src.split(' ')) {
    const [k, v] = pair.split(':') as [string, string];
    out[k] = k === 'crestKind' || k === 'pat' || k === 'tailKind' ? v : (COLOR[v] ?? v);
  }
  return out as Partial<Look>;
}
const PRESETS: [RegExp, Partial<Look>][] = PRESET_SRC.map(([re, s]) => [re, parseSpec(s)]);

const PART: Record<string, ColorKey> = {
  headed: 'h', hooded: 'h', faced: 'face', fronted: 'face', capped: 'cap', crowned: 'crown',
  throated: 'throat', chinned: 'throat', breasted: 'u', bellied: 'u', chested: 'u', sided: 'u',
  vented: 'u', backed: 'w', mantled: 'w', winged: 'patch', shouldered: 'patch', tailed: 't',
  rumped: 't', billed: 'k', beaked: 'k', eyed: 'iris', legged: 'l', footed: 'l', necked: 'collar',
  collared: 'collar', naped: 'collar', browed: 'brow', cheeked: 'cheek', eared: 'cheek', crested: 'crest',
  masked: 'mask', tipped: 'tip',
};

const mixHex = (a: string, b: string, t: number) => {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const c = (s: number) =>
    Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t)
      .toString(16)
      .padStart(2, '0');
  return `#${c(16)}${c(8)}${c(0)}`;
};

const EARTH: [string, string, string][] = [
  ['#8a6a48', '#6e5236', '#e6d6bc'], ['#7d7b52', '#5f5d3a', '#e8e2c0'], ['#8e8a84', '#66625c', '#ece8e0'],
  ['#a0704a', '#7a5232', '#ead8bf'], ['#6f6252', '#534838', '#d8cbb4'], ['#9a8a62', '#776a48', '#f0e6cc'],
];

function lookFor(name: string, lower: string, form: Form, rand: () => number): Look {
  const e = EARTH[Math.floor(rand() * EARTH.length)]!;
  const raptorish = form.pose === 'upright' && form.beak === 'hook';
  const look: Partial<Look> = {
    b: e[0], w: e[1], u: e[2], k: '#3a3028', l: form.pose === 'float' ? '#e08a3a' : '#8a6a5a',
    iris: raptorish ? '#f2c230' : '#1a1410',
  };
  const fixed = new Set<string>();
  const preset = PRESETS.find(([re]) => re.test(lower));
  if (preset) {
    Object.assign(look, preset[1]);
    for (const k of Object.keys(preset[1])) fixed.add(k);
  }
  // Colour/part words from the modifiers (the last word is the species noun).
  const words = name.toLowerCase().split(/\s+/).slice(0, -1);
  let plainUsed = false;
  for (const word of words) {
    const bits = word.replace(/[’'s]+$/, '').split('-');
    const colors = bits.map((b) => COLOR[b]).filter((c): c is string => !!c);
    const part = bits.map((b) => PART[b]).find(Boolean);
    if (bits.includes('spotted') || bits.includes('speckled')) look.pat = 'spots';
    if (bits.includes('barred') || bits.includes('scaly')) look.pat = 'bars';
    if (bits.includes('streaked') || bits.includes('striated')) look.pat = 'streaks';
    if (bits.includes('bald')) look.h = COLOR.white;
    if (bits.includes('masked')) look.mask ??= COLOR.black;
    if (bits.includes('hooded') && !colors.length) look.h = COLOR.black;
    if (bits.includes('collared') && !colors.length) look.collar = COLOR.black;
    if (part === 't' && /long|scissor|fork|wedge|fan|swallow/.test(word)) {
      look.tailKind = /fork|scissor|swallow/.test(word) ? 'fork' : 'long';
    }
    if (part === 'crest' || bits.includes('tufted') || bits.includes('horned')) {
      look.crest ??= colors[0] ?? look.h ?? look.b;
      look.crestKind ??= bits.includes('horned') || bits.includes('eared') ? 'ears' : 'point';
      if (colors[0]) look.crest = colors[0];
      continue;
    }
    if (!colors.length) continue;
    if (part) {
      look[part] = colors[0];
      if (part === 'h' && bits.includes('hooded')) look.throat = colors[0];
      continue;
    }
    if (bits.includes('and') && colors.length >= 2) {
      look.b = look.h = look.w = colors[0]!;
      look.u = colors[1]!;
      plainUsed = true;
      continue;
    }
    if (plainUsed) continue;
    plainUsed = true;
    const c = colors[0]!;
    for (const k of ['b', 'h'] as const) {
      look[k] = fixed.has(k) ? mixHex(look[k] ?? c, c, 0.65) : c;
    }
    if (!fixed.has('u')) look.u = shade(c, 0.35);
    if (!fixed.has('w')) look.w = shade(c, -0.22);
  }
  look.h ??= look.b;
  look.t ??= shade(look.w!, -0.12);
  return look as Look;
}

// ---------------------------------------------------------------------------
// Bird drawing (local frame: facing left, body centre at 0,0)
// ---------------------------------------------------------------------------

const P = (strs: TemplateStringsArray, ...vals: number[]) =>
  strs.reduce((acc, s, i) => acc + s + (i < vals.length ? r1(vals[i]!) : ''), '');

function beakPath(beak: Beak, bx: number, by: number, bl: number, r: number): string {
  switch (beak) {
    case 'cone': { const t = r * 0.72; return P`M${bx} ${by - t * 0.55}L${bx - bl} ${by + t * 0.08}L${bx} ${by + t * 0.55}Z`; }
    case 'short': { const t = r * 0.5; return P`M${bx} ${by - t * 0.5}L${bx - bl} ${by + t * 0.15}L${bx} ${by + t * 0.5}Z`; }
    case 'thin': { const t = r * 0.42; return P`M${bx} ${by - t * 0.5}L${bx - bl} ${by + t * 0.2}L${bx} ${by + t * 0.5}Z`; }
    case 'needle': { const t = r * 0.26; return P`M${bx} ${by - t}L${bx - bl} ${by + t * 0.6}L${bx} ${by + t}Z`; }
    case 'long': { const t = r * 0.5; return P`M${bx} ${by - t * 0.5}L${bx - bl} ${by + t * 0.15}L${bx} ${by + t * 0.5}Z`; }
    case 'hook': {
      const t = r * 0.62;
      return P`M${bx} ${by - t * 0.6}Q${bx - bl * 0.85} ${by - t * 0.75} ${bx - bl} ${by + t * 0.55}Q${bx - bl * 0.7} ${by + t * 0.05} ${bx - bl * 0.5} ${by + t * 0.3}L${bx} ${by + t * 0.55}Z`;
    }
    case 'down': {
      const t = r * 0.4;
      return P`M${bx} ${by - t * 0.6}Q${bx - bl * 0.65} ${by - t * 0.4} ${bx - bl} ${by + bl * 0.45}Q${bx - bl * 0.55} ${by + t * 0.5} ${bx} ${by + t * 0.6}Z`;
    }
    case 'up': {
      const t = r * 0.38;
      return P`M${bx} ${by - t * 0.5}Q${bx - bl * 0.6} ${by} ${bx - bl} ${by - bl * 0.32}Q${bx - bl * 0.55} ${by + t * 0.7} ${bx} ${by + t * 0.6}Z`;
    }
    case 'flat': {
      const t = r * 0.5;
      return P`M${bx} ${by - t * 0.6}L${bx - bl * 0.8} ${by - t * 0.35}Q${bx - bl} ${by - t * 0.3} ${bx - bl} ${by + t * 0.1}Q${bx - bl} ${by + t * 0.5} ${bx - bl * 0.8} ${by + t * 0.45}L${bx} ${by + t * 0.55}Z`;
    }
    case 'spoon': {
      const t = r * 0.32;
      return P`M${bx} ${by - t}L${bx - bl * 0.75} ${by - t * 0.4}Q${bx - bl * 1.05} ${by - t * 2.2} ${bx - bl * 1.05} ${by + t}Q${bx - bl * 1.02} ${by + t * 2.6} ${bx - bl * 0.75} ${by + t * 0.9}L${bx} ${by + t}Z`;
    }
    case 'huge': {
      return P`M${bx + 1} ${by - r * 0.85}Q${bx - bl * 0.55} ${by - r * 1.15} ${bx - bl} ${by + r * 0.15}Q${bx - bl * 0.5} ${by + r * 0.35} ${bx + 0.5} ${by + r * 0.7}Z`;
    }
    case 'pouch': {
      const t = r * 0.4;
      return P`M${bx} ${by - t}L${bx - bl} ${by - t * 0.1}L${bx - bl} ${by + t * 0.5}Q${bx - bl * 0.55} ${by + r * 1.6} ${bx} ${by + r * 0.9}Z`;
    }
    case 'bent': {
      const t = r * 0.6;
      return P`M${bx} ${by - t * 0.6}L${bx - bl * 0.5} ${by - t * 0.5}Q${bx - bl * 0.9} ${by - t * 0.35} ${bx - bl * 0.9} ${by + bl * 0.55}Q${bx - bl * 0.6} ${by + t * 0.3} ${bx - bl * 0.45} ${by + t * 0.55}L${bx} ${by + t * 0.6}Z`;
    }
  }
}

function tailPath(tail: Tail, L: number, H: number, tl: number): string {
  switch (tail) {
    case 'short': return P`M${L * 0.7} ${-H * 0.3}L${L + tl} ${-H * 0.12}L${L + tl} ${H * 0.3}L${L * 0.7} ${H * 0.32}Z`;
    case 'long': return P`M${L * 0.7} ${-H * 0.28}L${L + tl} ${-H * 0.05}L${L + tl + 1.5} ${H * 0.15}L${L + tl} ${H * 0.32}L${L * 0.7} ${H * 0.3}Z`;
    case 'fork': return P`M${L * 0.7} ${-H * 0.3}L${L + tl} ${-H * 0.55}L${L + tl * 0.6} ${H * 0.02}L${L + tl} ${H * 0.55}L${L * 0.7} ${H * 0.3}Z`;
    case 'stiff': return P`M${L * 0.7} ${-H * 0.3}L${L + tl} ${H * 0.05}L${L * 0.7} ${H * 0.3}Z`;
    case 'cocked': return P`M${L * 0.55} ${-H * 0.45}L${L + tl * 0.3} ${-H - tl * 0.9}L${L + tl * 0.7} ${-H - tl * 0.65}L${L * 0.95} ${H * 0.1}Z`;
    case 'train': return P`M${L * 0.6} ${-H * 0.25}Q${L + tl * 0.5} ${-H * 0.25} ${L + tl} ${H * 0.35}L${L + tl * 0.94} ${H * 0.6}Q${L + tl * 0.45} ${H * 0.45} ${L * 0.6} ${H * 0.3}Z`;
    case 'none': return '';
  }
}

interface Placed {
  node: ReactNode;
  /** World-space x of the beak tip (for trunks/flowers). */
  tipX: number;
  tipY: number;
}

function drawBird(f: Form, c: Look, sc: number, ox: number, oy: number, crestKind?: Crest): Placed {
  const { L, H, tilt, hx, hy, hr } = f;
  const rad = (tilt * Math.PI) / 180;
  const fx = -L * Math.cos(rad);
  const fy = -L * Math.sin(rad);
  const ext = Math.hypot(L * Math.sin(rad), H * Math.cos(rad));
  const hipX = -L * 0.12 * Math.cos(rad);
  const hipY = ext * 0.7;
  const footY = hipY + f.leg;
  const tail = c.tailKind && (f.tail === 'short' || f.tail === 'long') ? c.tailKind : f.tail;
  const tl = tail !== f.tail ? Math.max(f.tl, 13) * (tail === 'long' ? 1.4 : 1.15) : f.tl;
  const bx = hx - hr * 0.86;
  const by = hy + hr * 0.12;
  const out: ReactNode[] = [];
  const dark = shade(c.w, -0.35);
  const k = (n: string) => `${n}${out.length}`;

  // Far wing for flight poses.
  if (f.kind === 'glide') {
    out.push(<path key={k('fw')} d="M-1 -3Q2 -12 7 -16L19 -23Q13 -12 7 -3Z" fill={shade(c.w, -0.18)} />);
  } else if (f.kind === 'swallow') {
    out.push(<path key={k('fw')} d="M-1 -2Q6 -11 23 -15Q12 -5 6 -1Z" fill={shade(c.w, -0.2)} />);
  } else if (f.kind === 'hum') {
    out.push(<ellipse key={k('fw')} cx="3" cy="-11" rx="2.6" ry="9" transform="rotate(28 3 -11)" fill="#fff" fillOpacity="0.35" stroke={c.w} strokeOpacity="0.4" strokeWidth="0.5" />);
  }

  // Display fans (behind body).
  if (f.kind === 'peacock') {
    const R = 24;
    const cx = 9;
    const cy = -3;
    const eyes: ReactNode[] = [];
    for (const [rr, n] of [[0.86, 9], [0.6, 6], [0.36, 4]] as const) {
      for (let i = 0; i < n; i++) {
        const a = Math.PI + (Math.PI * (i + 0.5)) / n;
        const ex = cx + R * rr * Math.cos(a);
        const ey = cy + R * 0.82 * rr * Math.sin(a);
        eyes.push(<circle key={`e${rr}${i}`} cx={r1(ex)} cy={r1(ey)} r="2.1" fill="#c8b04a" />);
        eyes.push(<circle key={`f${rr}${i}`} cx={r1(ex)} cy={r1(ey)} r="1.2" fill="#1f4aa8" />);
      }
    }
    out.push(<path key={k('fan')} d={P`M${cx - R} ${cy}A${R} ${R * 0.82} 0 0 1 ${cx + R} ${cy}Z`} fill="#2a8a5a" stroke="#1f6a46" strokeWidth="0.6" />);
    out.push(<g key={k('eyes')}>{eyes}</g>);
  } else if (f.kind === 'turkey') {
    const R = 16;
    out.push(<path key={k('fan')} d={P`M${10 - R} ${-1}A${R} ${R * 0.9} 0 0 1 ${10 + R} ${-1}Z`} fill="#6a4a32" stroke="#e8d8b8" strokeWidth="1.4" />);
    out.push(<path key={k('fan2')} d={P`M${10 - R * 0.7} ${-1}A${R * 0.7} ${R * 0.63} 0 0 1 ${10 + R * 0.7} ${-1}`} fill="none" stroke="#3a2a1e" strokeWidth="1.1" />);
  }

  // Legs.
  if (f.leg > 0) {
    const lp = [-1.6, 1.6]
      .map((dx) => P`M${hipX + dx} ${hipY}L${hipX + dx - 0.6} ${footY}m-2.4 0h3.8`)
      .join('');
    out.push(<path key={k('leg')} d={lp} stroke={c.l} strokeWidth={f.leg > 12 ? 1.1 : 1.3} fill="none" strokeLinecap="round" />);
  }

  // Body, belly, tail, wing — rotated together.
  const bodyD = P`M${-L} 0C${-L} ${-H * 1.05} ${L * 0.35} ${-H} ${L} ${-H * 0.2}L${L} ${H * 0.2}C${L * 0.35} ${H * 1.05} ${-L} ${H * 1.05} ${-L} 0Z`;
  const bellyD = P`M${-L * 0.92} ${-H * 0.25}C${-L * 0.9} ${H * 0.95} ${L * 0.3} ${H} ${L * 0.75} ${H * 0.4}C${L * 0.2} ${H * 0.3} ${-L * 0.45} ${H * 0.2} ${-L * 0.92} ${-H * 0.25}Z`;
  const wingD =
    f.kind === 'penguin'
      ? P`M${-L * 0.4} ${-H * 0.7}C${L * 0.1} ${-H * 0.9} ${L * 0.6} ${-H * 0.2} ${L * 0.75} ${H * 0.15}C${L * 0.4} ${H * 0.05} ${-L * 0.1} ${-H * 0.2} ${-L * 0.4} ${-H * 0.7}Z`
      : P`M${-L * 0.45} ${-H * 0.55}C${L * 0.05} ${-H * 1.2} ${L * 0.85} ${-H * 0.7} ${L * 1.3} ${H * 0.1}C${L * 0.7} ${H * 0.5} ${-L * 0.05} ${H * 0.55} ${-L * 0.45} ${-H * 0.55}Z`;
  const tailD = tailPath(tail, L, H, tl);
  const marks: ReactNode[] = [];
  if (c.pat) {
    let d = '';
    for (let i = 0; i < 6; i++) {
      const x = -L * 0.72 + i * L * 0.24;
      const y = H * (0.3 + (i % 2) * 0.28);
      d +=
        c.pat === 'spots'
          ? P`M${x} ${y}h0.01`
          : c.pat === 'streaks'
            ? P`M${x} ${y - 1}l0.8 2.2`
            : P`M${x - 1.6} ${y}q1.6 1 3.2 0`;
    }
    marks.push(
      <path key="pat" d={d} stroke={shade(c.u, -0.45)} strokeWidth={c.pat === 'spots' ? 1.7 : 0.8} strokeLinecap="round" fill="none" opacity="0.75" />,
    );
  }
  const flying = f.kind === 'glide' || f.kind === 'swallow';
  out.push(
    <g key={k('body')} transform={`rotate(${tilt})`}>
      {tailD && <path d={tailD} fill={c.t} />}
      {tail === 'train' && <path d={P`M${L + 4} ${-H * 0.1}l4 1.6m4 0.8l4 2m3 1.4l3 2.4`} stroke={shade(c.t, -0.35)} strokeWidth="0.8" />}
      {c.tip && f.kind === 'glide' && tailD && <path d={tailD} fill={c.tip} opacity="0.15" />}
      <path d={bodyD} fill={c.b} />
      <path d={bellyD} fill={c.u} />
      {marks}
      <path d={bodyD} fill="url(#ws-vol)" />
      {!flying && f.kind !== 'hum' && (
        <>
          <path d={wingD} fill={c.w} />
          {f.kind !== 'penguin' && (
            <path d={P`M${L * 0.35} ${-H * 0.28}L${L * 1.22} ${H * 0.06}M${L * 0.22} ${H * 0.05}L${L * 1.05} ${H * 0.2}M${L * 0.5} ${-H * 0.55}L${L * 1.1} ${-H * 0.12}`} stroke={dark} strokeWidth="0.55" strokeLinecap="round" />
          )}
          {c.bar && <path d={P`M${-L * 0.15} ${-H * 0.32}Q${L * 0.15} ${-H * 0.15} ${L * 0.32} ${H * 0.32}`} stroke={c.bar} strokeWidth="1.1" fill="none" />}
          {c.patch && <ellipse cx={r1(-L * 0.12)} cy={r1(-H * 0.42)} rx={r1(L * 0.24)} ry={r1(H * 0.22)} fill={c.patch} />}
          {c.tip && <path d={P`M${L * 0.95} ${-H * 0.15}L${L * 1.3} ${H * 0.1}L${L * 0.9} ${H * 0.3}Z`} fill={c.tip} />}
          <path d={wingD} fill="url(#ws-vol)" opacity="0.7" />
        </>
      )}
    </g>,
  );

  // Near wing for flight poses (drawn over the body).
  if (f.kind === 'glide') {
    out.push(<path key={k('nw')} d="M-5 -1Q-2 -9 2 -13L22 -17Q15 -6 7 1Z" fill={c.w} />);
    out.push(<path key={k('nwt')} d="M15 -15.6L22 -17L18.4 -11.2Z" fill={c.tip ?? shade(c.w, -0.3)} />);
    out.push(<path key={k('nwv')} d="M-5 -1Q-2 -9 2 -13L22 -17Q15 -6 7 1Z" fill="url(#ws-vol)" opacity="0.6" />);
  } else if (f.kind === 'swallow') {
    out.push(<path key={k('nw')} d="M-3 1Q8 6 25 10Q12 1 4 0Z" fill={c.w} />);
  } else if (f.kind === 'hum') {
    out.push(<ellipse key={k('nw')} cx="1" cy="-9" rx="2.4" ry="8.5" transform="rotate(-12 1 -9)" fill="#fff" fillOpacity="0.45" stroke={c.w} strokeOpacity="0.5" strokeWidth="0.5" />);
  }

  // Neck.
  if (f.neck > 0) {
    const sx = fx * 0.82;
    const sy = fy - H * 0.35;
    const qx = f.kind === 'swan' ? sx - 10 : sx + (hx - sx) * 0.2 - 4;
    const qy = (sy + hy) / 2 + (f.kind === 'swan' ? 3 : 0);
    out.push(<path key={k('neck')} d={P`M${sx} ${sy}Q${qx} ${qy} ${hx + hr * 0.15} ${hy + hr * 0.35}`} stroke={f.kind === 'vulture' ? c.h : c.b} strokeWidth={f.neck} strokeLinecap="round" fill="none" />);
    if (f.kind === 'vulture') {
      out.push(<ellipse key={k('ruff')} cx={r1(sx + 1)} cy={r1(sy - 1)} rx="5" ry="3.2" fill={c.collar ?? shade(c.b, 0.15)} />);
    }
  }

  // Head.
  out.push(<circle key={k('head')} cx={hx} cy={hy} r={hr} fill={c.h} />);
  const hp: ReactNode[] = [];
  if (f.kind === 'owl') {
    const ex = hr * 0.4;
    hp.push(<ellipse key="disc" cx={hx} cy={hy + hr * 0.08} rx={hr * 0.88} ry={hr * 0.78} fill={c.face ?? shade(c.h, 0.35)} />);
    hp.push(<path key="rim" d={P`M${hx} ${hy - hr * 0.55}L${hx} ${hy + hr * 0.15}`} stroke={shade(c.h, -0.25)} strokeWidth="0.6" />);
    for (const s of [-1, 1]) {
      hp.push(<circle key={`i${s}`} cx={r1(hx + s * ex)} cy={r1(hy - hr * 0.05)} r={r1(hr * 0.27)} fill={c.iris} stroke={shade(c.h, -0.4)} strokeWidth="0.5" />);
      hp.push(<circle key={`p${s}`} cx={r1(hx + s * ex)} cy={r1(hy - hr * 0.05)} r={r1(hr * 0.14)} fill="#120c06" />);
      hp.push(<circle key={`g${s}`} cx={r1(hx + s * ex - hr * 0.07)} cy={r1(hy - hr * 0.13)} r={r1(hr * 0.05)} fill="#fff" />);
    }
    hp.push(<path key="bk" d={P`M${hx - hr * 0.12} ${hy + hr * 0.12}L${hx} ${hy + hr * 0.45}L${hx + hr * 0.12} ${hy + hr * 0.12}Z`} fill={c.k === '#3a3028' ? '#c89a4a' : c.k} />);
    if (crestKind === 'ears') {
      hp.push(<path key="ear" d={P`M${hx - hr * 0.75} ${hy - hr * 0.5}L${hx - hr * 0.6} ${hy - hr * 1.35}L${hx - hr * 0.2} ${hy - hr * 0.75}ZM${hx + hr * 0.75} ${hy - hr * 0.5}L${hx + hr * 0.6} ${hy - hr * 1.35}L${hx + hr * 0.2} ${hy - hr * 0.75}Z`} fill={shade(c.h, -0.2)} />);
    }
  } else {
    if (c.face) hp.push(<ellipse key="face" cx={r1(hx - hr * 0.2)} cy={r1(hy + hr * 0.1)} rx={r1(hr * 0.72)} ry={r1(hr * 0.62)} fill={c.face} />);
    if (c.cap) hp.push(<path key="cap" d={P`M${hx - hr} ${hy - hr * 0.1}A${hr} ${hr} 0 0 1 ${hx + hr * 0.92} ${hy - hr * 0.38}Q${hx} ${hy - hr * 0.5} ${hx - hr} ${hy - hr * 0.1}Z`} fill={c.cap} />);
    if (c.crown) hp.push(<path key="crown" d={P`M${hx - hr * 0.6} ${hy - hr * 0.78}Q${hx} ${hy - hr * 1.12} ${hx + hr * 0.6} ${hy - hr * 0.78}`} stroke={c.crown} strokeWidth={r1(hr * 0.4)} strokeLinecap="round" fill="none" />);
    if (c.cheek) hp.push(<ellipse key="cheek" cx={r1(hx + hr * 0.08)} cy={r1(hy + hr * 0.28)} rx={r1(hr * 0.5)} ry={r1(hr * 0.34)} fill={c.cheek} />);
    if (c.mask) hp.push(<path key="mask" d={P`M${hx - hr * 1.0} ${hy - hr * 0.32}L${hx + hr * 0.72} ${hy - hr * 0.35}L${hx + hr * 0.8} ${hy + hr * 0.05}L${hx - hr * 0.9} ${hy + hr * 0.15}Z`} fill={c.mask} />);
    if (c.throat) hp.push(<ellipse key="thr" cx={r1(hx - hr * 0.42)} cy={r1(hy + hr * 0.72)} rx={r1(hr * 0.55)} ry={r1(hr * 0.42)} fill={c.throat} />);
    if (c.collar) hp.push(<path key="col" d={P`M${hx - hr * 0.7} ${hy + hr * 0.82}Q${hx + hr * 0.1} ${hy + hr * 1.3} ${hx + hr * 0.95} ${hy + hr * 0.45}`} stroke={c.collar} strokeWidth={r1(hr * 0.32)} fill="none" />);
    if (c.brow) hp.push(<path key="brow" d={P`M${hx - hr * 0.8} ${hy - hr * 0.48}Q${hx - hr * 0.2} ${hy - hr * 0.78} ${hx + hr * 0.6} ${hy - hr * 0.42}`} stroke={c.brow} strokeWidth={r1(hr * 0.2)} fill="none" strokeLinecap="round" />);
  }
  hp.push(<circle key="vol" cx={hx} cy={hy} r={hr} fill="url(#ws-vol)" opacity="0.8" />);

  // Crest.
  const ck = crestKind;
  if (c.crest && ck && ck !== 'ears') {
    const cc = c.crest;
    const d =
      ck === 'point'
        ? P`M${hx - hr * 0.35} ${hy - hr * 0.8}L${hx + hr * 1.15} ${hy - hr * 1.75}L${hx + hr * 0.75} ${hy - hr * 0.25}Z`
        : ck === 'tuft'
          ? P`M${hx + hr * 0.2} ${hy - hr * 0.7}Q${hx + hr * 1.4} ${hy - hr * 1.5} ${hx + hr * 2.3} ${hy - hr * 1.05}`
          : ck === 'topknot'
            ? P`M${hx - hr * 0.1} ${hy - hr * 0.85}Q${hx - hr * 0.5} ${hy - hr * 2.1} ${hx - hr * 1.05} ${hy - hr * 1.65}`
            : P`M${hx - hr * 0.5} ${hy - hr * 0.7}L${hx - hr * 0.3} ${hy - hr * 1.9}L${hx + hr * 0.15} ${hy - hr * 0.95}L${hx + hr * 0.6} ${hy - hr * 2}L${hx + hr * 0.7} ${hy - hr * 0.8}L${hx + hr * 1.5} ${hy - hr * 1.7}L${hx + hr * 1} ${hy - hr * 0.3}Z`;
    const stroke = ck === 'tuft' || ck === 'topknot';
    hp.unshift(<path key="crest" d={d} fill={stroke ? 'none' : cc} stroke={stroke ? cc : undefined} strokeWidth={stroke ? 1.3 : undefined} strokeLinecap="round" />);
  } else if (ck === 'ears' && f.kind !== 'owl') {
    hp.unshift(<path key="crest" d={P`M${hx - hr * 0.1} ${hy - hr * 0.8}L${hx + hr * 0.5} ${hy - hr * 1.6}L${hx + hr * 0.6} ${hy - hr * 0.6}Z`} fill={c.crest ?? c.h} />);
  }
  out.push(<g key={k('hp')}>{hp}</g>);

  // Beak, frontal shield and eye.
  if (f.kind !== 'owl') {
    out.push(<path key={k('beak')} d={beakPath(f.beak, bx, by, f.bl, hr)} fill={c.k} stroke={shade(c.k, -0.45)} strokeWidth="0.35" />);
    if (f.beak === 'huge' && c.tip) {
      out.push(<path key={k('btip')} d={P`M${bx - f.bl * 0.7} ${by - hr * 0.55}Q${bx - f.bl * 0.95} ${by - hr * 0.2} ${bx - f.bl} ${by + hr * 0.15}Q${bx - f.bl * 0.8} ${by + hr * 0.2} ${bx - f.bl * 0.7} ${by + hr * 0.25}Z`} fill={c.tip} />);
    }
    if (f.beak === 'bent' && c.tip) {
      out.push(<path key={k('btip')} d={P`M${bx - f.bl * 0.85} ${by}L${bx - f.bl * 0.9} ${by + f.bl * 0.55}L${bx - f.bl * 0.7} ${by + hr * 0.4}Z`} fill={c.tip} />);
    }
    if (c.shield) {
      out.push(<ellipse key={k('sh')} cx={r1(bx + 0.4)} cy={r1(by - hr * 0.42)} rx={r1(hr * 0.28)} ry={r1(hr * 0.42)} fill={c.shield} />);
    }
    const er = Math.max(0.85, hr * 0.2);
    const ex = hx - hr * 0.34;
    const ey = hy - hr * 0.14;
    out.push(<circle key={k('eye')} cx={r1(ex)} cy={r1(ey)} r={r1(er)} fill={c.iris === '#1a1410' ? '#120c06' : c.iris} stroke="#120c06" strokeWidth={c.iris === '#1a1410' ? 0 : 0.5} />);
    if (c.iris !== '#1a1410') out.push(<circle key={k('pup')} cx={r1(ex)} cy={r1(ey)} r={r1(er * 0.5)} fill="#120c06" />);
    out.push(<circle key={k('glint')} cx={r1(ex - er * 0.3)} cy={r1(ey - er * 0.35)} r={r1(Math.max(0.3, er * 0.3))} fill="#fff" />);
  }

  const tipX = ox + (bx - f.bl) * sc;
  const tipY = oy + by * sc;
  return {
    node: <g transform={`translate(${r1(ox)} ${r1(oy)}) scale(${r1(sc * 100) / 100})`}>{out}</g>,
    tipX,
    tipY,
  };
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

function pines(rand: () => number, n: number, base: number, hMin: number, hVar: number): string {
  let d = '';
  for (let i = 0; i < n; i++) {
    const x = rand() * 124 - 2;
    const h = hMin + rand() * hVar;
    const w = h * 0.3;
    d += P`M${x} ${base - h}L${x - w} ${base - h * 0.45}L${x - w * 0.5} ${base - h * 0.45}L${x - w * 1.25} ${base}L${x + w * 1.25} ${base}L${x + w * 0.5} ${base - h * 0.45}L${x + w} ${base - h * 0.45}Z`;
  }
  return d;
}

function reeds(x0: number, n: number, base: number, rand: () => number): { stems: string; heads: string } {
  let stems = '';
  let heads = '';
  for (let i = 0; i < n; i++) {
    const x = x0 + i * 3 + rand() * 2;
    const top = base - 14 - rand() * 12;
    const lean = (rand() - 0.5) * 6;
    stems += P`M${x} ${base}Q${x + lean * 0.3} ${(base + top) / 2} ${x + lean} ${top}`;
    if (i % 2 === 0) heads += P`M${x + lean * 0.9} ${top + 2}l0.1 5`;
  }
  return { stems, heads };
}

interface SceneOpts {
  hab: string;
  pose: Pose;
  night: boolean;
  rand: () => number;
  flocking?: boolean;
  cavity?: boolean;
}

function sceneBack({ hab, pose, night, rand, flocking }: SceneOpts): ReactNode[] {
  const out: ReactNode[] = [];
  const variant = Math.floor(rand() * 3);
  out.push(<rect key="sky" width="120" height="56" fill={night ? 'url(#ws-sky-night)' : `url(#ws-sky-${hab}-${variant})`} />);
  if (night) {
    const mx = 12 + rand() * 96;
    out.push(<circle key="moon" cx={r1(mx)} cy="11" r="5" fill="#f4efd6" />);
    out.push(<circle key="moonc" cx={r1(mx + 2.2)} cy="9.6" r="4.4" fill="#2a3352" opacity="0.9" />);
    let st = '';
    for (let i = 0; i < 9; i++) st += P`M${rand() * 120} ${rand() * 28}h0.01`;
    out.push(<path key="stars" d={st} stroke="#fff8d8" strokeWidth="0.9" strokeLinecap="round" opacity="0.85" />);
  } else if (hab === 'grassland' || rand() < 0.35) {
    out.push(<circle key="sun" cx={r1(14 + rand() * 92)} cy={r1(9 + rand() * 6)} r="9" fill="url(#ws-sun)" />);
  }
  if (!night && rand() < 0.6) {
    const cx = rand() * 110;
    const cy = 6 + rand() * 10;
    out.push(<path key="cloud" d={P`M${cx} ${cy + 3}a3.5 3.5 0 0 1 4 -4a5 5 0 0 1 9 1a3 3 0 0 1 2 5Z`} fill="#fff" opacity="0.55" />);
  }
  if (flocking) {
    let d = '';
    const fx = 8 + rand() * 30;
    for (let i = 0; i < 4; i++) d += P`M${fx + i * 5 + rand() * 2} ${6 + rand() * 7}q1.4 -1.4 2.8 0q1.4 -1.4 2.8 0`;
    out.push(<path key="flock" d={d} stroke={night ? '#c8c8d8' : '#3a4038'} strokeWidth="0.6" fill="none" opacity="0.55" />);
  }
  const dim = night ? 0.45 : 1;
  if (hab === 'forest') {
    out.push(<path key="far" d={pines(rand, 7, 40, 12, 12)} fill={night ? '#2c3a4a' : '#8fb092'} opacity={0.65 * dim + 0.2} />);
    out.push(<path key="near" d={pines(rand, 3, 46, 20, 14)} fill={night ? '#1d2832' : '#5d8a64'} opacity="0.55" />);
    out.push(<path key="floor" d="M0 44Q30 40 60 43T120 42V56H0Z" fill={night ? '#1f2a2a' : '#6f8f5c'} opacity="0.6" />);
  } else if (hab === 'grassland') {
    const a = 26 + rand() * 6;
    out.push(<path key="far" d={P`M0 36Q25 ${a} 55 34T120 32V56H0Z`} fill={night ? '#3a4040' : '#cbc995'} opacity="0.8" />);
    if (rand() < 0.6) {
      const tx = 10 + rand() * 100;
      out.push(<path key="tree" d={P`M${tx} 33v-4`} stroke="#6a5a3a" strokeWidth="0.8" />);
      out.push(<circle key="treec" cx={r1(tx)} cy="27.5" r="3" fill={night ? '#2a3a2a' : '#8a9a5a'} />);
    }
    out.push(<path key="near" d={P`M0 44Q40 ${36 + rand() * 4} 80 42T120 40V56H0Z`} fill={night ? '#2f3a2a' : '#a9a85a'} opacity="0.85" />);
  } else {
    out.push(<path key="shore" d="M0 31Q20 27 40 30T80 29T120 30V34H0Z" fill={night ? '#2a3a3a' : '#79a08a'} opacity="0.7" />);
    out.push(<rect key="water" y="33" width="120" height="23" fill={night ? 'url(#ws-water-night)' : 'url(#ws-water)'} opacity="0.6" />);
    let rip = '';
    for (let i = 0; i < 6; i++) rip += P`M${rand() * 110} ${36 + rand() * 18}h${4 + rand() * 6}`;
    out.push(<path key="rip" d={rip} stroke="#e8f6fb" strokeWidth="0.5" opacity="0.6" />);
  }
  // Perch / ground.
  if (pose === 'perch' || pose === 'upright') {
    if (hab === 'forest') {
      const y0 = 33 + rand() * 6;
      out.push(<path key="br" d={P`M124 ${y0}Q86 ${y0 + 6} 38 41`} stroke="#5d3f26" strokeWidth="3.2" strokeLinecap="round" fill="none" />);
      out.push(<path key="brh" d={P`M122 ${y0 - 0.8}Q86 ${y0 + 5} 42 39.9`} stroke="#8a6440" strokeWidth="0.9" strokeLinecap="round" fill="none" />);
      out.push(<path key="tw" d={P`M96 ${y0 + 3.6}q5 -6 12 -8M84 ${y0 + 4.4}q-2 6 2 11`} stroke="#5d3f26" strokeWidth="1.1" strokeLinecap="round" fill="none" />);
      const leafHue = rand() < 0.22 ? ['#d08a2a', '#b85a2a'] : ['#5f9a4f', '#3f7a3a'];
      let la = '';
      let lb = '';
      const spots: [number, number][] = [[108, y0 - 4.5], [102, y0 - 1.4], [86, y0 + 15], [112, y0 - 2], [91, y0 + 9]];
      spots.forEach(([x, y], i) => {
        const leaf = P`M${x} ${y}q3 -3.4 6 0q-3 3.4 -6 0`;
        if (i % 2) la += leaf;
        else lb += leaf;
      });
      out.push(<path key="la" d={la} fill={leafHue[0]} />);
      out.push(<path key="lb" d={lb} fill={leafHue[1]} />);
    } else if (hab === 'grassland') {
      out.push(<path key="wire" d="M0 45.5Q30 47 60 45.5T120 45.5" stroke="#6a6a62" strokeWidth="0.45" fill="none" />);
      out.push(<rect key="post" x="55" y="40" width="10" height="17" rx="1" fill="#8a6a48" />);
      out.push(<path key="grain" d="M57.5 42.5v12M61 41.5v14M63.5 44v9" stroke="#6a4e32" strokeWidth="0.5" />);
      out.push(<rect key="postcap" x="54.4" y="39.4" width="11.2" height="2.2" rx="1" fill="#6f5236" />);
    } else {
      out.push(<path key="stem" d="M64 57Q62 48 58.5 40.6" stroke="#6a8a3a" strokeWidth="2.2" strokeLinecap="round" fill="none" />);
      const r = reeds(86, 5, 57, rand);
      out.push(<path key="reeds" d={r.stems} stroke="#5f7f36" strokeWidth="1.1" fill="none" />);
      out.push(<path key="tails" d={r.heads} stroke="#7a4a2a" strokeWidth="2.3" strokeLinecap="round" />);
    }
  } else if (pose === 'stand') {
    const fill = hab === 'forest' ? '#5d4a34' : hab === 'grassland' ? '#9aa04a' : '#7d6e52';
    out.push(<path key="gnd" d="M0 48Q30 45 60 47.5T120 46.5V56H0Z" fill={night ? shade(fill, -0.45) : fill} />);
    if (hab === 'forest') {
      out.push(<path key="moss" d="M0 48Q30 45 60 47.5T120 46.5" stroke="#6f9a4a" strokeWidth="1.6" fill="none" />);
      if (rand() < 0.6) {
        const mx = 92 + rand() * 18;
        out.push(<path key="mush" d={P`M${mx} 47.5v-3`} stroke="#efe2c8" strokeWidth="1.2" />);
        out.push(<path key="mcap" d={P`M${mx - 3} 44.8a3 2.4 0 0 1 6 0Z`} fill="#c8452a" />);
      }
    } else if (hab === 'grassland') {
      let g = '';
      for (let i = 0; i < 12; i++) {
        const x = rand() * 120;
        g += P`M${x} 49l-1 -4M${x + 1} 49l0.6 -5M${x + 2} 49l1.4 -3.6`;
      }
      out.push(<path key="tufts" d={g} stroke="#6f7a2a" strokeWidth="0.7" />);
    } else {
      let pb = '';
      for (let i = 0; i < 5; i++) pb += P`M${rand() * 120} ${50 + rand() * 4}h0.01`;
      out.push(<path key="peb" d={pb} stroke="#a89878" strokeWidth="2.2" strokeLinecap="round" />);
    }
  } else if (pose === 'rock') {
    out.push(<rect key="sea" y="44" width="120" height="12" fill="url(#ws-water)" opacity="0.8" />);
    out.push(<path key="rock" d="M28 57L35 46Q48 41.5 62 44.6Q79 42.5 88 48L95 57Z" fill={night ? '#3a3e44' : '#7d8288'} />);
    out.push(<path key="rockh" d="M36 46.2Q48 42 62 44.8Q79 42.7 87.4 47.8" stroke="#a8adb3" strokeWidth="0.8" fill="none" />);
  } else if (pose === 'cling') {
    // Tree trunk on the beak side; drawn in sceneFront once the tip is known.
  } else if (pose === 'fly' || pose === 'hover') {
    // Open sky; habitat strip already drawn.
  }
  return out;
}

function sceneFront(o: SceneOpts, tipX: number, tipY: number): ReactNode[] {
  const out: ReactNode[] = [];
  const { hab, pose, rand } = o;
  if (pose === 'wade') {
    out.push(<rect key="wv" y="44" width="120" height="12" fill="url(#ws-water)" opacity="0.8" />);
    out.push(<path key="wr" d="M44 45.2q16 2.6 32 0M50 48q10 1.6 20 0" stroke="#e8f6fb" strokeWidth="0.6" fill="none" opacity="0.8" />);
    if (hab !== 'wetland' || rand() < 0.7) {
      const r = reeds(4, 4, 56, rand);
      out.push(<path key="rd" d={r.stems} stroke="#5f7f36" strokeWidth="1.1" fill="none" />);
      out.push(<path key="rh" d={r.heads} stroke="#7a4a2a" strokeWidth="2.3" strokeLinecap="round" />);
    }
  } else if (pose === 'float') {
    out.push(<rect key="wv" y="41" width="120" height="15" fill={o.night ? 'url(#ws-water-night)' : 'url(#ws-water)'} opacity="0.94" />);
    out.push(<path key="wr" d="M36 42q24 3 50 0M44 45.5q18 2 36 0M30 50h12M78 51h14" stroke="#e8f6fb" strokeWidth="0.6" fill="none" opacity="0.8" />);
    if (rand() < 0.5) {
      out.push(<path key="lily" d="M98 49a5 2.2 0 1 0 0.1 0Z" fill="#4f8a3f" />);
    }
  } else if (pose === 'cling') {
    const edge = tipX + 0.8;
    const top = Math.min(edge, 52);
    out.push(<path key="trunk" d={P`M-2 0H${top}Q${edge + 2} 28 ${top - 1} 56H-2Z`} fill="#6a4a30" />);
    out.push(<path key="bark" d={P`M${top - 6} 2q-2 10 0 20t0 22M${top - 13} 8q2 12 0 24t1 18M${top - 20} 0q-1 14 1 30`} stroke="#4a3220" strokeWidth="0.8" fill="none" />);
    out.push(<path key="lit" d={P`M${top - 1} 0Q${edge + 1} 28 ${top - 2} 56`} stroke="#8a6644" strokeWidth="1.2" fill="none" />);
    if (o.cavity) out.push(<ellipse key="hole" cx={r1(top - 9)} cy="40" rx="3.2" ry="4.2" fill="#24160c" stroke="#3a2618" strokeWidth="0.8" />);
  } else if (pose === 'hover') {
    const x = tipX - 1;
    const y = tipY;
    out.push(<path key="stem" d={P`M${x - 16} 57Q${x - 15} ${y + 14} ${x - 5} ${y + 3}`} stroke="#4f7a3a" strokeWidth="1.1" fill="none" />);
    out.push(<path key="leaf" d={P`M${x - 14} ${y + 20}q-6 -3 -8 -9q6 1 8 9`} fill="#5f9a4f" />);
    out.push(<path key="bloom" d={P`M${x - 6} ${y + 4}L${x} ${y - 2.6}Q${x + 1.6} ${y} ${x} ${y + 2.6}Z`} fill="#e0457b" />);
    out.push(<path key="lip" d={P`M${x} ${y - 2.6}q1.6 2.6 0 5.2`} stroke="#ffd166" strokeWidth="0.9" fill="none" />);
  } else if (pose === 'fly') {
    // Distant habitat strip so fliers still read as their habitat.
    const fill = hab === 'forest' ? '#5d8a64' : hab === 'grassland' ? '#a9a85a' : '#5d93ad';
    out.push(<path key="strip" d="M0 52Q30 49 60 51.5T120 50V56H0Z" fill={o.night ? shade(fill, -0.5) : fill} opacity="0.8" />);
  }
  if (hab === 'grassland' && pose !== 'float' && pose !== 'wade') {
    out.push(<path key="fg" d="M2 56q1 -6 -1 -10M5 56q0 -5 2 -8M114 56q-1 -7 1 -11M117 56q0 -5 -2 -9" stroke="#7a8a2a" strokeWidth="0.9" fill="none" />);
  }
  out.push(<rect key="vig" width="120" height="56" fill="url(#ws-vignette)" />);
  return out;
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

function fitScale(f: Form, sc: number, anchorY: number, crestUp: number): number {
  const rad = (f.tilt * Math.PI) / 180;
  const ext = Math.hypot(f.L * Math.sin(rad), f.H * Math.cos(rad));
  const footY = ext * 0.7 + f.leg;
  let top = Math.min(f.hy - f.hr - crestUp, -ext);
  if (f.kind === 'peacock') top = Math.min(top, -24);
  if (f.tail === 'cocked') top = Math.min(top, -f.H - f.tl * 0.9 - 2);
  return Math.min(sc, (anchorY - 2) / (footY - top));
}

export const BirdIllustration = memo(function BirdIllustration({
  cardId,
  name,
  habitats,
  wingspan,
  predator,
  beakLeft,
  nest,
  flocking,
  form: formOverride,
  palette,
}: {
  cardId: number;
  name: string;
  habitats: readonly string[];
  wingspan: number | string;
  predator?: boolean;
  beakLeft?: boolean | null;
  nest?: string;
  flocking?: boolean;
  /** Force a body plan (e.g. 'hum' for the Americas hummingbird mini-deck). */
  form?: FormKey;
  /** Override plumage keys (e.g. hummingbird group colours). */
  palette?: Partial<Look>;
}) {
  const lower = name.toLowerCase();
  const rand = seeded(hashStr(name) ^ (cardId * 2654435761));
  const key: FormKey =
    formOverride ?? FORM_RULES.find(([re]) => re.test(lower))?.[1] ?? (predator ? 'raptor' : 'song');
  const f = FORMS[key];
  const look = { ...lookFor(name, lower, f, rand), ...palette };
  const hab = habitats[0] ?? 'forest';
  const night = NIGHT.test(lower);
  const ws = typeof wingspan === 'number' ? wingspan : 40;
  let sc = Math.max(0.84, Math.min(1.12, 0.82 + ws / 600));
  if (key === 'hum') sc = 0.95;
  const crestUp = look.crest ? f.hr * 1.1 : 0;
  // Anchor the feet/waterline per pose.
  let ox = 60;
  let oy: number;
  switch (f.pose) {
    case 'perch':
    case 'upright': {
      sc = fitScale(f, sc, 40, crestUp);
      const rad = (f.tilt * Math.PI) / 180;
      oy = 40 - (Math.hypot(f.L * Math.sin(rad), f.H * Math.cos(rad)) * 0.7 + f.leg) * sc;
      break;
    }
    case 'stand':
    case 'rock':
    case 'wade': {
      const ground = f.pose === 'wade' ? 51 : f.pose === 'rock' ? 45 : 48;
      sc = fitScale(f, sc, ground, crestUp);
      const rad = (f.tilt * Math.PI) / 180;
      oy = ground - (Math.hypot(f.L * Math.sin(rad), f.H * Math.cos(rad)) * 0.7 + f.leg) * sc;
      break;
    }
    case 'float':
      sc = Math.min(sc, 36 / (f.H * 0.45 - (f.hy - f.hr)));
      oy = 41 - f.H * 0.45 * sc;
      ox = 64;
      break;
    case 'cling':
      ox = 68;
      oy = 30;
      break;
    case 'hover':
      ox = 72;
      oy = 25;
      break;
    default:
      oy = 26;
      ox = 58;
  }
  const crestKind = look.crestKind ?? (look.crest ? (f.kind === 'owl' ? 'ears' : 'point') : f.kind === 'owl' && /horned|eared|scops|screech|eagle/.test(lower) ? 'ears' : undefined);
  const scene: SceneOpts = { hab, pose: f.pose, night, rand, flocking, cavity: nest === 'cavity' };
  const back = sceneBack(scene);
  const bird = drawBird(f, look, sc, ox, oy, crestKind);
  const front = sceneFront(scene, bird.tipX, bird.tipY);
  const flip = beakLeft === false;

  return (
    <svg viewBox="0 0 120 56" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden="true" className="art-svg">
      <g transform={flip ? 'matrix(-1 0 0 1 120 0)' : undefined}>
        {back}
        {bird.node}
        {front}
      </g>
    </svg>
  );
});
