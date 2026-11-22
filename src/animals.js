// Hollowmere's animals. The server moves them so every player sees the same
// cat in the same place; clients draw them and give them voices. They wander
// inside a home range, sleep at night, and react when a villager tends them.

import { walkable, T } from "../public/shared/world.js";

// Home ranges in tiles: [x0, y0, x1, y1]. Ducks live on the water only.
const HERDS = [
  { kind: "chicken", n: 4, home: [5, 15, 13, 19], names: ["Henrike", "Grete", "Pecks", "Old Sophie"] },
  { kind: "goat", n: 3, home: [19, 24, 28, 29], names: ["Barnabas", "Liesl", "Horn"] },
  { kind: "duck", n: 3, home: [3, 23, 14, 29], names: ["Quill", "Puddle", "Admiral"], water: true },
  { kind: "cat", n: 1, home: [10, 12, 28, 20], names: ["Mitzi"] },
  { kind: "dog", n: 1, home: [16, 13, 32, 22], names: ["Brumm"] },
];

const STEP_MS = { chicken: 520, goat: 900, duck: 700, cat: 640, dog: 420 };

export function makeAnimals(world) {
  const out = [];
  for (const h of HERDS) for (let i = 0; i < h.n; i++) {
    const a = { id: `${h.kind}${i}`, kind: h.kind, name: h.names[i], home: h.home, water: !!h.water, x: 0, y: 0, dir: 0, act: "idle", movedAt: 0, until: 0, follow: null, mood: 0 };
    place(world, a);
    out.push(a);
  }
  return out;
}

function ok(world, a, x, y) {
  const [x0, y0, x1, y1] = a.home;
  if (!a.follow && (x < x0 || y < y0 || x > x1 || y > y1)) return false;
  const tile = world.tiles[y * world.w + x];
  return a.water ? tile === T.WATER : walkable(world, x, y);
}

function place(world, a) {
  const [x0, y0, x1, y1] = a.home;
  for (let i = 0; i < 400; i++) {
    const x = x0 + Math.floor(Math.random() * (x1 - x0 + 1)), y = y0 + Math.floor(Math.random() * (y1 - y0 + 1));
    if (ok(world, a, x, y)) { a.x = x; a.y = y; return; }
  }
}

// One tick: rest, peck, wander a step, follow someone, or sleep at night.
export function stepAnimals(world, animals, { now, hour, agents }) {
  const night = hour >= 21 || hour < 5;
  for (const a of animals) {
    if (now < a.until && a.act !== "walk") continue;
    if (now - a.movedAt < STEP_MS[a.kind]) continue;
    if (night && a.kind !== "duck") { a.act = "sleep"; a.follow = null; a.until = now + 4000; continue; }
    if (a.act === "sleep") a.act = "idle";
    // A dog that has been petted trots after that villager for a while.
    if (a.follow) {
      const v = agents.get(a.follow);
      if (!v || now > a.followUntil) { a.follow = null; }
      else {
        const dx = Math.sign(v.x - a.x), dy = Math.sign(v.y - a.y);
        if (Math.max(Math.abs(v.x - a.x), Math.abs(v.y - a.y)) > 1) {
          for (const [nx, ny] of [[a.x + dx, a.y], [a.x, a.y + dy], [a.x + dx, a.y + dy]]) if ((nx !== a.x || ny !== a.y) && ok(world, a, nx, ny)) { move(a, nx, ny, now); break; }
        } else { a.act = "sit"; a.movedAt = now; }
        continue;
      }
    }
    const r = Math.random();
    if (r < 0.45) { a.act = a.kind === "chicken" || a.kind === "goat" ? "graze" : "idle"; a.until = now + 1500 + Math.random() * 4000; a.movedAt = now; continue; }
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].sort(() => Math.random() - 0.5);
    for (const [ox, oy] of dirs) if (ok(world, a, a.x + ox, a.y + oy)) { move(a, a.x + ox, a.y + oy, now); break; }
  }
}

function move(a, nx, ny, now) {
  a.dir = nx > a.x ? 1 : nx < a.x ? 3 : ny > a.y ? 0 : 2;
  a.x = nx; a.y = ny; a.movedAt = now; a.act = "walk";
}

// A villager tends the nearest animal within two tiles. Returns what happened.
export function tend(animals, v, now) {
  let best = null, bd = 3;
  for (const a of animals) {
    const d = Math.max(Math.abs(a.x - v.x), Math.abs(a.y - v.y));
    if (d < bd) { bd = d; best = a; }
  }
  if (!best) return null;
  best.act = "happy"; best.until = now + 2500; best.mood = now;
  if (best.kind === "dog") { best.follow = v.id; best.followUntil = now + 60000; }
  if (best.kind === "cat" && Math.random() < 0.3) { best.act = "grumpy"; }
  return best;
}

export const VERB = { chicken: "fed the chickens", goat: "scratched a goat behind the horns", duck: "threw crumbs to the ducks", cat: "stroked", dog: "played with" };

export function snapshotAnimal(a) { return { id: a.id, kind: a.kind, name: a.name, x: a.x, y: a.y, dir: a.dir, act: a.act, follow: a.follow }; }
