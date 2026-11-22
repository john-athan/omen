// The village of Hollowmere. Shared by server (pathing, places) and client
// (rendering), so both sides build the identical map from the same seed.

export const W = 48;
export const OUT_H = 32;   // the village; rooms live on the grid below it
export const H = 50;

export const T = {
  GRASS: 0, FLOWERS: 1, PATH: 2, PLAZA: 3, WATER: 4, TREE: 5, WALL: 6,
  DOOR: 7, FENCE: 8, GRAVE: 9, STALL: 10, WELL: 11, DOCK: 12, OAK: 13,
  ORCHARD: 14, CROP: 15, STONE: 16, ALTAR: 17,
  // inside
  VOID: 20, FLOOR: 21, IWALL: 22, EXIT: 23, BED: 24, STOVE: 25, OVEN: 26, COUNTER: 27, TABLE: 28, CHAIR: 29,
  ANVIL: 30, FORGE: 31, BARREL: 32, SHELF: 33, DESK: 34, HEARTH: 35, RUG: 36, CHEST: 37,
};

const BLOCKED = new Set([T.WATER, T.TREE, T.WALL, T.FENCE, T.GRAVE, T.STALL, T.WELL, T.OAK, T.ORCHARD, T.STONE, T.ALTAR,
  T.VOID, T.IWALL, T.STOVE, T.OVEN, T.COUNTER, T.TABLE, T.ANVIL, T.FORGE, T.BARREL, T.SHELF, T.DESK, T.HEARTH, T.CHEST]);

// Rooms: the inside of each building, drawn as ASCII and laid out on the grid
// below the village. A building's door and its room's exit (E) are one
// doorway: pathfinding steps through it like any neighbour.
//   # wall  . floor  E exit  B bed  S stove  O oven  C counter  T table  c chair
//   A anvil  F forge  b barrel  s shelf  D desk  H hearth  r rug  K chest
const ROOM_ART = {
  tavern: [
    "############",
    "#bb.H..ss..#",
    "#..........#",
    "#CCCCC.....#",
    "#.....rr...#",
    "#.TcT..TcT.#",
    "#....rr....#",
    "######E#####",
  ],
  bakery: [
    "#########",
    "#OO.sss.#",
    "#.......#",
    "#CCCC...#",
    "#.......#",
    "#.cT....#",
    "####E####",
  ],
  smithy: [
    "#########",
    "#FF..ss.#",
    "#.......#",
    "#..A.b..#",
    "#.......#",
    "#.....b.#",
    "####E####",
  ],
  archive: [
    "#########",
    "#sssssss#",
    "#.......#",
    "#.D.D.D.#",
    "#.c.c.c.#",
    "#..rrr..#",
    "####E####",
  ],
  house1: ["########", "#B.S..K#", "#B.....#", "#..Tc..#", "#..rr..#", "###E####"],
  house2: ["########", "#K..S.B#", "#.....B#", "#.cT...#", "#.rr...#", "####E###"],
  house3: ["########", "#B.S...#", "#B...K.#", "#..Tc..#", "#......#", "###E####"],
};
const ART_TILE = { "#": T.IWALL, ".": T.FLOOR, E: T.EXIT, B: T.BED, S: T.STOVE, O: T.OVEN, C: T.COUNTER, T: T.TABLE, c: T.CHAIR,
  A: T.ANVIL, F: T.FORGE, b: T.BARREL, s: T.SHELF, D: T.DESK, H: T.HEARTH, r: T.RUG, K: T.CHEST };
const ROOM_AT = { tavern: [1, 33], bakery: [14, 33], smithy: [24, 33], archive: [34, 33], house1: [1, 42], house2: [10, 42], house3: [19, 42] };
export const ROOMS = Object.entries(ROOM_ART).map(([id, art]) => {
  const [x, y] = ROOM_AT[id];
  const ey = art.length - 1, ex = art[ey].indexOf("E");
  return { id, x, y, w: art[0].length, h: art.length, art, exit: [x + ex, y + ey] };
});
export const roomById = (id) => ROOMS.find((r) => r.id === id) ?? null;
export function roomAt(x, y) {
  if (y < OUT_H) return null;
  return ROOMS.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) ?? null;
}

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Buildings: footprint is wall, door sits on the bottom (or top) row.
export const BUILDINGS = [
  { id: "tavern", label: "The Crooked Lantern", x: 12, y: 8, w: 7, h: 4, roof: "roofRed", door: [15, 11], lamp: true },
  { id: "bakery", label: "Bakery", x: 28, y: 9, w: 5, h: 3, roof: "roofOchre", door: [30, 11], lamp: true },
  { id: "smithy", label: "Smithy", x: 28, y: 19, w: 5, h: 3, roof: "roofSlate", door: [30, 19], lamp: true, forge: true },
  { id: "house1", label: "a cottage", x: 6, y: 18, w: 4, h: 3, roof: "roofMoss", door: [7, 18], lamp: true },
  { id: "house2", label: "a cottage", x: 13, y: 19, w: 4, h: 3, roof: "roofRed", door: [14, 19], lamp: true },
  { id: "house3", label: "a cottage", x: 1, y: 10, w: 4, h: 3, roof: "roofSlate", door: [3, 12], lamp: false },
  { id: "archive", label: "The Archive", x: 33, y: 3, w: 4, h: 3, roof: "roofSlate", door: [34, 5], lamp: true },
];

// Places an agent can walk to. Anchor is where they stand; radius lets
// several people gather without stacking on one tile.
// Indoor places sit inside their room; walking there goes through the door.
// `spots` are exact tiles to stand on (and the way to face), handed out first.
const IN = (room, dx, dy) => { const [x, y] = ROOM_AT[room]; return [x + dx, y + dy]; };
export const PLACES = [
  { id: "shrine", name: "the shrine", desc: "a mossy stone shrine to a god nobody has heard from in years", at: [23, 8], r: 2 },
  { id: "tavern", name: "the tavern", desc: "inside The Crooked Lantern: a long counter where stew and ale are sold, tables by a crackling hearth, warm and loud", at: IN("tavern", 3, 4), r: 2, room: "tavern" },
  { id: "well", name: "the well", desc: "the old well in the middle of the square, where gossip collects", at: [23, 17], r: 2 },
  { id: "market", name: "the market", desc: "three stalls under striped awnings", at: [36, 15], r: 2 },
  { id: "bakery", name: "the bakery", desc: "inside the bakery: a hot oven, a counter with fresh loaves, the smell of bread", at: IN("bakery", 2, 4), r: 1, room: "bakery" },
  { id: "smithy", name: "the smithy", desc: "inside the smithy: a roaring forge, the anvil, a quenching barrel, soot everywhere", at: IN("smithy", 4, 4), r: 1, room: "smithy" },
  { id: "graveyard", name: "the graveyard", desc: "crooked headstones behind a low fence", at: [41, 8], r: 2 },
  { id: "orchard", name: "the orchard", desc: "rows of apple trees, quiet", at: [39, 23], r: 2 },
  { id: "pond", name: "the pond", desc: "a still dark pond with a little wooden jetty", at: [15, 26], r: 2 },
  { id: "oak", name: "the old oak", desc: "an enormous ancient oak on the hill, older than the village", at: [6, 6], r: 2 },
  { id: "fields", name: "the fields", desc: "rows of turnips and barley", at: [22, 26], r: 2 },
  { id: "archive", name: "the archive", desc: "inside the archive: shelves of ledgers, writing desks, where the village keeps its proposals and decisions", at: IN("archive", 4, 5), r: 1, room: "archive" },
  { id: "cottages", name: "the cottages", desc: "inside a small cottage: a straw bed, an iron stove for cooking, a table and a chest", at: IN("house1", 3, 4), r: 1, room: "house1",
    // the beds of all three cottages: walking "to the cottages" to sleep finds a free one
    spots: [[...IN("house1", 1, 2), 0, "bed"], [...IN("house2", 6, 2), 0, "bed"], [...IN("house3", 1, 2), 0, "bed"]] },
];

export const SPAWN = [23, 21];

// Where each trade actually does its work, and which way it faces there
// (0 down, 1 right, 2 up, 3 left): the fisher at the end of the jetty, the
// smith at the anvil, the baker at the oven, traders behind their stall.
export const JOB_SPOTS = {
  fisher: [[11, 26, 3], [12, 26, 3]],
  gravedigger: [[40, 5, 1], [42, 5, 3], [40, 7, 1]],
  herbalist: [[38, 23, 2], [42, 23, 2]], beekeeper: [[36, 23, 2], [43, 23, 2]],
  "goat herder": [[21, 27, 0], [26, 27, 0]], "shepherd's helper": [[22, 28, 0], [25, 28, 0]],
  "tax collector": [[33, 12, 0]], "candle maker": [[36, 12, 0]], "errand runner": [[39, 12, 0]],
  "apprentice priest": [[23, 5, 2], [24, 5, 2]],
  "retired soldier": [[21, 17, 0]], "night watch": [[26, 17, 0]], "village child": [[25, 18, 2]],
  "failed alchemist": [[7, 5, 3]], cartographer: [[...IN("archive", 2, 4), 2], [...IN("archive", 4, 4), 2], [...IN("archive", 6, 4), 2]],
  blacksmith: [[...IN("smithy", 2, 3), 1]], baker: [[...IN("bakery", 1, 2), 2]], "baker's apprentice": [[...IN("bakery", 2, 2), 2]],
  "widowed innkeeper": [[...IN("tavern", 2, 2), 0]], "village drunk": [[...IN("tavern", 3, 5), 2]], "wandering bard": [[...IN("tavern", 9, 4), 0]],
  midwife: [[...IN("house2", 5, 2), 1]],
};
// The stoves, for cooking at home.
export const STOVE_SPOTS = [[...IN("house1", 3, 2), 2], [...IN("house2", 4, 2), 2], [...IN("house3", 3, 2), 2]];

export function buildWorld() {
  const t = new Uint8Array(W * H).fill(T.VOID);
  const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < W && y < H) t[y * W + x] = v; };
  const get = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? T.TREE : t[y * W + x]);
  const r = rng(1337);

  // grass with flower patches
  for (let y = 0; y < OUT_H; y++) for (let x = 0; x < W; x++) set(x, y, hash2(x, y) > 0.93 ? T.FLOWERS : T.GRASS);

  // pond (ellipse) and dock
  for (let y = 0; y < OUT_H; y++) for (let x = 0; x < W; x++) {
    const dx = (x - 8.5) / 6.2, dy = (y - 26) / 3.6;
    if (dx * dx + dy * dy < 1 + (hash2(x, y) - 0.5) * 0.25) set(x, y, T.WATER);
  }

  // roads
  const hline = (x0, x1, y) => { for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) set(x, y, T.PATH); };
  const vline = (x, y0, y1) => { for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) set(x, y, T.PATH); };
  hline(0, 47, 15); hline(0, 47, 16);
  vline(23, 7, 31); vline(24, 7, 31);

  // plaza with well
  for (let y = 13; y <= 18; y++) for (let x = 20; x <= 27; x++) set(x, y, T.PLAZA);
  set(23, 15, T.WELL); set(24, 15, T.WELL);

  // shrine on the north end: stones + altar
  for (let y = 3; y <= 7; y++) for (let x = 20; x <= 27; x++) set(x, y, T.PLAZA);
  [[20, 3], [27, 3], [20, 6], [27, 6], [21, 3], [26, 3]].forEach(([x, y]) => set(x, y, T.STONE));
  set(23, 4, T.ALTAR); set(24, 4, T.ALTAR);

  // buildings
  for (const b of BUILDINGS) {
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) set(x, y, T.WALL);
    set(b.door[0], b.door[1], T.DOOR);
    // connect door to the main road
    const [dx, dy] = b.door;
    const step = dy >= b.y + b.h - 1 ? 1 : -1;
    let y = dy + step;
    while (y >= 0 && y < OUT_H && get(dx, y) !== T.PATH && get(dx, y) !== T.PLAZA) { set(dx, y, T.PATH); y += step; }
  }

  // market stalls east of the square
  for (const x of [33, 36, 39]) set(x, 13, T.STALL);
  hline(28, 41, 14);

  // graveyard: fence ring, graves, gate
  for (let x = 37; x <= 45; x++) { set(x, 2, T.FENCE); set(x, 9, T.FENCE); }
  for (let y = 2; y <= 9; y++) { set(37, y, T.FENCE); set(45, y, T.FENCE); }
  for (let y = 3; y <= 8; y++) for (let x = 38; x <= 44; x++) set(x, y, T.GRASS);
  for (let y = 4; y <= 7; y += 2) for (let x = 39; x <= 43; x += 2) set(x, y, T.GRAVE);
  set(41, 9, T.PATH); vline(41, 9, 14);

  // orchard grid
  for (let y = 20; y <= 28; y += 2) for (let x = 34; x <= 45; x += 2) set(x, y, T.ORCHARD);
  hline(34, 45, 23);
  for (let x = 34; x <= 45; x += 2) set(x, 22, T.ORCHARD);
  vline(39, 17, 23);

  // fields south of the square
  for (let y = 24; y <= 29; y++) for (let x = 19; x <= 28; x++) if (x !== 23 && x !== 24) set(x, y, y % 2 ? T.CROP : T.GRASS);

  // old oak on the hill + path
  set(5, 4, T.OAK); set(6, 4, T.OAK); set(5, 5, T.OAK); set(6, 5, T.OAK);
  vline(6, 6, 14);

  // dock into the pond
  for (let x = 12; x <= 14; x++) set(x, 26, T.DOCK);
  set(11, 26, T.DOCK); hline(15, 22, 26);

  // forest border and scattered trees on plain grass
  for (let y = 0; y < OUT_H; y++) for (let x = 0; x < W; x++) {
    const v = get(x, y);
    if (v !== T.GRASS && v !== T.FLOWERS) continue;
    const edge = Math.min(x, y, W - 1 - x, OUT_H - 1 - y);
    const p = edge === 0 ? 0.85 : edge === 1 ? 0.45 : 0.035;
    if (r() < p && !nearAnchor(x, y) && !nearPath(x, y)) set(x, y, T.TREE);
  }

  function nearAnchor(x, y) {
    return PLACES.some((p) => !p.room && Math.abs(p.at[0] - x) <= p.r + 1 && Math.abs(p.at[1] - y) <= p.r + 1) ||
      (Math.abs(x - SPAWN[0]) < 3 && Math.abs(y - SPAWN[1]) < 3);
  }
  function nearPath(x, y) {
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = get(x + ox, y + oy);
      if (n === T.PATH || n === T.DOOR || n === T.PLAZA || n === T.DOCK) return true;
    }
    return false;
  }

  // rooms, and the doorways joining each building door to its room's exit
  const portals = new Map();
  for (const r of ROOMS) {
    r.art.forEach((row, dy) => [...row].forEach((ch, dx) => set(r.x + dx, r.y + dy, ART_TILE[ch])));
    const b = BUILDINGS.find((x) => x.id === r.id);
    const outside = b.door[1] * W + b.door[0], inside = r.exit[1] * W + r.exit[0];
    portals.set(outside, inside); portals.set(inside, outside);
  }

  return { w: W, h: H, tiles: t, portals };
}

export function walkable(world, x, y) {
  if (x < 0 || y < 0 || x >= world.w || y >= world.h) return false;
  return !BLOCKED.has(world.tiles[y * world.w + x]);
}

// BFS on the tile grid. Small map, a few dozen agents: plenty fast.
export function findPath(world, from, to) {
  const [sx, sy] = from, [tx, ty] = to;
  if (sx === tx && sy === ty) return [];
  const prev = new Int32Array(world.w * world.h).fill(-1);
  const start = sy * world.w + sx, goal = ty * world.w + tx;
  const q = [start];
  prev[start] = start;
  for (let i = 0; i < q.length; i++) {
    const c = q[i];
    if (c === goal) break;
    const cx = c % world.w, cy = (c / world.w) | 0;
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + ox, ny = cy + oy, n = ny * world.w + nx;
      if (!walkable(world, nx, ny) || prev[n] !== -1) continue;
      prev[n] = c;
      q.push(n);
    }
    // through a doorway: the step after a door is the other side of it
    const p = world.portals?.get(c);
    if (p !== undefined && prev[p] === -1) { prev[p] = c; q.push(p); }
  }
  if (prev[goal] === -1) return null;
  const path = [];
  for (let c = goal; c !== start; c = prev[c]) path.push([c % world.w, (c / world.w) | 0]);
  return path.reverse();
}

export function placeAt(x, y) {
  const room = roomAt(x, y);
  if (room) return PLACES.find((p) => p.room === room.id || (p.spots ?? []).some(([sx, sy]) => roomAt(sx, sy) === room)) ?? null;
  let best = null, bd = Infinity;
  for (const p of PLACES) {
    if (p.room) continue;
    const d = Math.max(Math.abs(p.at[0] - x), Math.abs(p.at[1] - y));
    if (d <= p.r + 2 && d < bd) { best = p; bd = d; }
  }
  return best;
}

export function findPlace(text) {
  if (!text) return null;
  const s = String(text).toLowerCase().replace(/^the\s+/, "").trim();
  return PLACES.find((p) => p.id === s || p.name.replace(/^the\s+/, "") === s || s.includes(p.id) || (p.id === "oak" && s.includes("oak"))) || null;
}

// Game clock: one day is 24 real minutes. The server may run shorter days for
// testing and tells every client in its welcome, hence a settable binding.
export let DAY_MS = 24 * 60 * 1000;
export function setDayMs(ms) { if (ms > 0) DAY_MS = ms; }
export const HOUR_MS = () => DAY_MS / 24;
export function dayPhase(ms) {
  const f = (ms % DAY_MS) / DAY_MS; // 0 = midnight
  const hour = f * 24;
  const label = hour < 5 ? "deep night" : hour < 7 ? "dawn" : hour < 11 ? "morning" : hour < 14 ? "midday" : hour < 18 ? "afternoon" : hour < 20 ? "dusk" : "night";
  return { f, hour, label };
}
