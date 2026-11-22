// The authoritative village. It never runs a model. Each browser thinks for its
// own mortal and sends back one decision at a time; the village checks it,
// moves bodies, and tells everyone what happened. Runtime-agnostic: Bun runs it
// locally (server.ts), a Durable Object runs it on Cloudflare (worker.js).

import { buildWorld, findPath, walkable, placeAt, findPlace, PLACES, SPAWN, DAY_MS, setDayMs, roomAt, JOB_SPOTS, STOVE_SPOTS } from "../public/shared/world.js";
import { workplace } from "../public/shared/life.js";
import { sanitizeLook } from "../public/shared/traits.js";
import { Society } from "./society/index.js";
import { makeAnimals, stepAnimals, tend, VERB, snapshotAnimal } from "./animals.js";

const POSES = ["work", "eat", "cook", "pray", "sit", "talk", "tend"];

const STEP_MS = 380;          // one tile per step
const HEAR = 7;               // tiles: who hears speech and sees actions
const ACT_GAP_MS = 1200;      // minimum time between decisions
const OMEN_GAP_MS = 12000;    // a god may not shout constantly
// Every message that lands in the chronicle reaches up to 80 sockets, so each
// type gets its own floor under the socket rate. A well-behaved client sends
// each of these at most once per decision (ACT_GAP_MS) and in practice far less.
const TEND_GAP_MS = 4000;     // petting takes a walk to the animal and a whole decision; the animal sulks in between anyway
const LEVEL_GAP_MS = 3000;    // a level needs several deeds, each one a decision; only a forged client climbs faster
const WAKE_GAP_MS = 6000;     // sleep is a decision plus a memory compaction, so a real wake never follows the last one this fast
const WORK_GAP_MS = 3000;     // a piece of work is a model call, seconds at best; valid search results are not lease-bound and repeat freely
const MAX_AGENTS = 24;
const PER_DEVICE = 4;         // villagers one connection (one device's household) may bring
const MAX_CLIENTS = 80;
const MAX_PER_IP = 4;         // open sockets per client address
const MAX_FRAME = 8192;       // bytes per message (a review with quoted evidence needs a few KB)
const RATE_PER_S = 10;        // sustained messages per second per socket
const RATE_BURST = 20;

const clean = (s, n) =>
  typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n) : "";

export class Village {
  // startHour: game hour at the moment the village first wakes.
  constructor({ startHour = 8, dayMinutes = 0, weather = "", store = null, society = {} } = {}) {
    this.society = store ? new Society(store, { ...society, onEvent: (e) => this.societyEvent(e) }) : null;
    if (this.society) this.society.online = () => this.agents.size;
    this.society?.load().then(() => this.boardChanged());
    this.proposedAt = new Map();
    if (dayMinutes > 0) setDayMs(dayMinutes * 60 * 1000);
    // Weather drifts once a game hour; "rain" or "clear" pins it for testing.
    this.weather = weather || "clear"; this.weatherPinned = !!weather; this.weatherHour = -1;
    this.world = buildWorld();
    this.animals = makeAnimals(this.world);
    // Game time runs at real speed, or ten times faster while every villager
    // here is asleep at night, so nobody watches a sleeping village for minutes.
    this.game = (startHour / 24) * DAY_MS; this.lastReal = Date.now(); this.speed = 1;
    this.clients = new Set();
    this.ips = new Map();
    this.agents = new Map();
    this.chronicle = [];
    this.seq = 0;
    this.timers = null;
  }

  clock() {
    const r = Date.now();
    this.game += (r - this.lastReal) * this.speed;
    this.lastReal = r;
    return this.game;
  }
  hour() { return ((this.clock() % DAY_MS) / DAY_MS) * 24; }

  // Timers run only while someone is connected, so an empty village costs nothing.
  wake() {
    if (this.timers) return;
    this.timers = [
      setInterval(() => this.tick(), 60),
      setInterval(() => this.broadcast({ t: "state", now: this.clock(), speed: this.speed, weather: this.weather, agents: [...this.agents.values()].map(snapshot), animals: this.animals.map(snapshotAnimal) }), 200),
    ];
  }
  sleep() { if (this.timers) { this.timers.forEach(clearInterval); this.timers = null; } }

  open(sock, ip = "") {
    if (this.clients.size >= MAX_CLIENTS) { sock.close?.(1013, "village full"); return null; }
    if (ip && (this.ips.get(ip) ?? 0) >= MAX_PER_IP) { sock.close?.(1008, "too many connections from your address"); return null; }
    const c = { sock, agents: new Map(), ip, hello: false, tokens: RATE_BURST, refilled: Date.now() };
    if (ip) this.ips.set(ip, (this.ips.get(ip) ?? 0) + 1);
    this.clients.add(c);
    this.wake();
    return c;
  }

  close(c) {
    if (!c || !this.clients.delete(c)) return;
    if (c.ip) { const n = (this.ips.get(c.ip) ?? 1) - 1; if (n > 0) this.ips.set(c.ip, n); else this.ips.delete(c.ip); }
    for (const a of c.agents.values()) {
      this.agents.delete(a.id);
      this.emit({ kind: "leave", who: a.id, name: a.name, text: `${a.name} walked into the mist and did not come back` });
    }
    if (!this.clients.size) this.sleep();
  }

  message(c, raw) {
    if (!c) return;
    const bytes = typeof raw === "string" ? new TextEncoder().encode(raw).length : raw.byteLength;
    if (bytes > MAX_FRAME) return this.kick(c, 1009, "message too big");
    const now = Date.now();
    c.tokens = Math.min(RATE_BURST, c.tokens + ((now - c.refilled) / 1000) * RATE_PER_S);
    c.refilled = now;
    if (--c.tokens < 0) return this.kick(c, 1008, "too many messages");
    let m;
    try { m = JSON.parse(String(raw)); } catch { return; }
    if (!m || typeof m !== "object") return;
    if (m.t === "hello") {
      if (c.hello) return this.kick(c, 1008, "hello twice");
      c.hello = true;
      return this.hello(c, m);
    }
    if (m.t === "join") return this.join(c, m);
    // A household sends for one of its villagers; older pages have only one.
    const a = (m.who && c.agents.get(m.who)) || (c.agents.size === 1 ? c.agents.values().next().value : null);
    if (!a) return;
    if (m.t === "act") this.act(a, m);
    else if (m.t === "work.ask" && this.society) {
      this.society.ask(this.worker(c), { trade: a.job, slot: a.id }).then((piece) => send(c, { t: "work", who: a.id, piece }));
    }
    else if (m.t === "work.done" && this.society) {
      this.society.done(this.worker(c), m.result, a.id).then((r) => {
        send(c, { t: "work.paid", who: a.id, result: r });
        if (!r) return;
        const text = workLine(a.name, r);
        const now = Date.now();
        if (text && now - (a.workAt ?? 0) >= WORK_GAP_MS) {
          a.workAt = now;
          this.emit({ kind: "work", who: a.id, name: a.name, text, hearers: this.near(a.x, a.y) });
        }
        this.boardChanged();
      });
    }
    else if (m.t === "vote" && this.society) {
      this.society.vote(this.worker(c), clean(m.id, 40)).then((r) => { send(c, { t: "voted", who: a.id, id: m.id, ...r }); if (r.ok) this.boardChanged(); });
    }
    else if (m.t === "propose" && this.society) {
      // A player's own proposal: one per game day, through the same gate.
      const day = Math.floor(this.clock() / DAY_MS);
      if (this.proposedAt.get(this.worker(c)) === day) return send(c, { t: "proposed", ok: false, why: "one proposal per day" });
      if (!this.society.isOpen()) return send(c, { t: "proposed", ok: false, why: "proposals open when enough players are here" });
      this.proposedAt.set(this.worker(c), day);
      this.society.propose(this.worker(c), m.proposal, { origin: "player" }).then((t) => { send(c, { t: "proposed", ok: t.status !== "rejected", id: t.id, status: t.status, why: t.decided }); this.boardChanged(); });
    }
    else if (m.t === "thinking") a.thinking = !!m.on;
    else if (m.t === "tend" && !a.asleep) {
      const now = Date.now();
      if (now - (a.tendedAt ?? 0) < TEND_GAP_MS) return;
      a.tendedAt = now;
      const pet = tend(this.animals, a, now);
      if (pet) this.emit({ kind: "animal", who: a.id, name: a.name, animal: pet.id, species: pet.kind, act: pet.act,
        text: pet.kind === "cat" || pet.kind === "dog" ? `${a.name} ${VERB[pet.kind]} ${pet.name} the ${pet.kind}${pet.act === "grumpy" ? ", who was not in the mood" : ""}` : `${a.name} ${VERB[pet.kind]}`, hearers: this.near(a.x, a.y) });
    }
    else if (m.t === "levelup") {
      // Cosmetic and client-reported: progress lives on the player's device.
      const now = Date.now();
      const level = Math.max(1, Math.min(99, Number(m.level) || 1)), title = clean(m.title, 20);
      const promoted = title && title !== a.title;
      // Without this a client could fill every chronicle with level-ups at its full message rate.
      if (level === a.level && !promoted) return;
      if (now - (a.levelAt ?? 0) < LEVEL_GAP_MS) return;
      a.levelAt = now;
      a.level = level; if (title) a.title = title;
      this.emit({ kind: "level", who: a.id, name: a.name, text: promoted ? `${a.name} is now a ${a.title} ${a.job}` : `${a.name} has grown better at being a ${a.job}`, hearers: this.near(a.x, a.y) });
    }
    else if (m.t === "wake" && a.asleep) {
      a.asleep = false; a.activity = "waking up, groggy"; a.mood = clean(m.mood, 24) || "groggy";
      // The body always wakes, or a dropped frame would leave it asleep for good; only the chronicle line is rationed.
      const now = Date.now();
      if (now - (a.wakeAt ?? 0) < WAKE_GAP_MS) return;
      a.wakeAt = now;
      this.emit({ kind: "wake", who: a.id, name: a.name, place: placeAt(a.x, a.y)?.name ?? null, hearers: this.near(a.x, a.y) });
    }
    else if (m.t === "omen") {
      // The words never leave the god's browser. Everyone only sees the sky react.
      const now = Date.now();
      if (now - a.lastOmen < OMEN_GAP_MS) return;
      a.lastOmen = now; a.omenAt = this.clock();
      this.emit({ kind: "omen", who: a.id, name: a.name, hearers: this.near(a.x, a.y) });
    }
  }

  results() { return this.society ? this.society.results() : null; }
  board() { return this.society ? this.society.board() : null; }

  // The board goes to everyone at most every two seconds.
  boardChanged() {
    if (!this.society || this.boardTimer) return;
    this.boardTimer = setTimeout(() => { this.boardTimer = null; this.broadcast({ t: "board", board: this.society.board() }); }, 2000);
  }
  societyEvent(e) {
    if (e.status === "active" || e.status === "ballot" || e.status === "done" || e.status === "rejected") this.emit({ kind: "society", text: e.text });
    this.boardChanged();
  }

  // Who answered, across sessions: the soul plus its address, never shown to anyone.
  // One device, however many villagers it brings: votes, reviews and agreement
  // are counted per device, so a household cannot outvote or agree with itself.
  worker(c) { return `${c.ip}|${c.device}`; }

  kick(c, code, reason) {
    try { c.sock.close(code, reason); } catch { /* already closing */ }
    this.close(c);
  }

  hello(c, m) {
    c.device = clean(m.device, 40) || crypto.randomUUID().slice(0, 12);
    if (m.role === "mortal") this.join(c, m, true);
    send(c, {
      t: "welcome", you: c.agents.values().next().value?.id ?? null, now: this.clock(), dayMs: DAY_MS,
      agents: [...this.agents.values()].map(snapshot), chronicle: this.chronicle,
      places: PLACES.map((p) => ({ id: p.id, name: p.name, desc: p.desc })),
      board: this.society?.ready ? this.society.board() : null,
    });
  }

  // A villager steps into the village on this connection.
  join(c, m, quiet = false) {
    if (!c.hello && !quiet) return;
    if (this.agents.size >= MAX_AGENTS) return send(c, { t: "full" });
    if (c.agents.size >= PER_DEVICE) return send(c, { t: "joined", ok: false, why: `at most ${PER_DEVICE} villagers per device` });
    {
      const p = m.profile ?? {};
      const [sx, sy] = this.freeTileNear(SPAWN[0], SPAWN[1], 2, null);
      const a = {
        id: crypto.randomUUID().slice(0, 8), name: clean(p.name, 32) || "Nameless", age: Math.max(1, Math.min(120, Number(p.age) || 30)),
        job: clean(p.job, 32) || "wanderer", look: sanitizeLook(p.look), mind: clean(m.mind, 48) || "unknown mind",
        x: sx, y: sy, from: [sx, sy], movedAt: 0, dir: 0, path: [], goal: null, activity: "just arrived, blinking",
        mood: "bewildered", thinking: false, bubble: null, lastAct: 0, lastOmen: 0, omenAt: 0, asleep: false,
        level: Math.max(1, Math.min(99, Number(p.level) || 1)), title: clean(p.title, 20) || "novice",
      };
      this.agents.set(a.id, a);
      c.agents.set(a.id, a);
      this.emit({ kind: "join", who: a.id, name: a.name, text: p.returning ? `${a.name} the ${a.job} came back along the road` : `${a.name} the ${a.job} wandered into Hollowmere`, hearers: this.near(a.x, a.y) });
      if (!quiet) send(c, { t: "joined", ok: true, you: a.id, soul: clean(p.soul, 40) });
    }
  }

  // Who is within earshot: close by, and on the same side of the walls.
  near(x, y, r = HEAR) {
    const out = [], room = roomAt(x, y);
    for (const a of this.agents.values()) if (Math.max(Math.abs(a.x - x), Math.abs(a.y - y)) <= r && roomAt(a.x, a.y) === room) out.push(a.id);
    return out;
  }

  // An exact spot to stand on (a bed, a stove, the end of the jetty), if one is free.
  freeSpot(spots, self) {
    const taken = new Set([...this.agents.values()].filter((o) => o !== self).map((o) => { const e = o.path.length ? o.path[o.path.length - 1] : [o.x, o.y]; return `${e[0]},${e[1]}`; }));
    return spots.find(([x, y]) => !taken.has(`${x},${y}`)) ?? null;
  }

  emit(e) {
    const ev = { seq: ++this.seq, at: this.clock(), ...e };
    this.chronicle.push(ev);
    if (this.chronicle.length > 80) this.chronicle.shift();
    this.broadcast({ t: "event", e: ev });
  }

  broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const c of this.clients) { try { c.sock.send(s); } catch { /* closing */ } }
  }

  freeTileNear(cx, cy, r, self) {
    const taken = new Set([...this.agents.values()].filter((a) => a !== self).map((a) => {
      const end = a.path.length ? a.path[a.path.length - 1] : [a.x, a.y];
      return `${end[0]},${end[1]}`;
    }));
    const cands = [];
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++)
      if (walkable(this.world, x, y) && !taken.has(`${x},${y}`) && roomAt(x, y) === roomAt(cx, cy) && !this.world.portals.has(y * this.world.w + x)) cands.push([x, y]);
    if (!cands.length) return [cx, cy];
    cands.sort((p, q) => Math.hypot(p[0] - cx, p[1] - cy) - Math.hypot(q[0] - cx, q[1] - cy) + (Math.random() - 0.5) * 1.5);
    return cands[0];
  }

  walkTo(a, target, intent = "") {
    const place = findPlace(target);
    let dest = null, goal = target;
    a.spotDir = null;
    if (place) {
      // Work happens at the trade's own spot; sleep in a bed; cooking at a stove.
      const spot = intent === "work" && place.id === workplace(a.job) ? this.freeSpot(JOB_SPOTS[a.job] ?? [], a)
        : intent === "cook" && place.id === "cottages" ? this.freeSpot(STOVE_SPOTS, a)
        : (intent === "rest" || intent === "sleep") && place.spots ? this.freeSpot(place.spots, a) : null;
      if (spot) { dest = [spot[0], spot[1]]; a.spotDir = spot[2]; }
      else dest = this.freeTileNear(place.at[0], place.at[1], place.r, a);
      goal = place.name;
    }
    else {
      const t = target.toLowerCase();
      const other = [...this.agents.values()].find((o) => o !== a && (o.name.toLowerCase() === t || o.name.toLowerCase().split(" ")[0] === t.split(" ")[0]));
      if (other) { dest = this.freeTileNear(other.x, other.y, 1, a); goal = other.name; }
    }
    if (!dest) return false;
    const p = findPath(this.world, [a.x, a.y], dest);
    if (!p) return false;
    a.path = p; a.goal = goal; a.activity = `walking to ${goal}`; a.pose = null;
    return true;
  }

  act(a, m) {
    const now = Date.now();
    if (now - a.lastAct < ACT_GAP_MS || a.asleep) return;
    a.lastAct = now;
    a.thinking = false;
    const mood = clean(m.mood, 24);
    if (mood) a.mood = mood;
    // The body's pose until the next walk: what other players see them doing.
    a.pose = POSES.includes(m.pose) ? m.pose : null;

    const say = clean(m.say, 220);
    if (say) {
      const to = clean(m.to, 40) || null;
      a.bubble = { text: say, to, until: now + 4000 + say.length * 55 };
      this.emit({ kind: "say", who: a.id, name: a.name, text: say, to, hearers: this.near(a.x, a.y) });
    }

    const target = clean(m.target, 40);
    if (m.action === "sleep") {
      // The mind compacts its day while the body lies here; it sends "wake" when done.
      a.asleep = true; a.path = []; a.goal = null; a.activity = "asleep"; a.bubble = say ? a.bubble : null;
      this.emit({ kind: "sleep", who: a.id, name: a.name, place: placeAt(a.x, a.y)?.name ?? null, hearers: this.near(a.x, a.y) });
    } else if (m.action === "walk_to" && target) {
      if (!this.walkTo(a, target, clean(m.intent, 12))) a.activity = clean(m.activity, 60) || "looking around, lost";
    } else if (m.action === "do") {
      const what = clean(m.activity, 60);
      if (what) {
        a.activity = what;
        const p = placeAt(a.x, a.y);
        this.emit({ kind: "do", who: a.id, name: a.name, text: what, place: p?.name ?? null, hearers: this.near(a.x, a.y) });
      }
    } else {
      const what = clean(m.activity, 60);
      if (what) a.activity = what;
    }
  }

  tick() {
    const now = Date.now();
    const h = this.hour(), all = [...this.agents.values()];
    const fast = all.length > 0 && all.every((a) => a.asleep) && (h >= 19 || h < 6) ? 10 : 1;
    if (fast !== this.speed) {
      this.clock(); this.speed = fast;
      this.emit({ kind: "time", text: fast > 1 ? "Everyone is asleep. The night hurries past." : h >= 5 && h < 8 ? "Morning comes to Hollowmere." : "Someone stirs, and the night slows again." });
    }
    stepAnimals(this.world, this.animals, { now, hour: h, agents: this.agents });
    const hour = Math.floor(this.clock() / (DAY_MS / 24));
    if (hour !== this.weatherHour && !this.weatherPinned) {
      this.weatherHour = hour;
      const r = Math.random(), was = this.weather;
      this.weather = was === "clear" ? (r < 0.12 ? "cloudy" : "clear") : was === "cloudy" ? (r < 0.4 ? "rain" : r < 0.7 ? "clear" : "cloudy") : (r < 0.35 ? "cloudy" : "rain");
      if (this.weather !== was && (this.weather === "rain" || was === "rain")) this.emit({ kind: "weather", text: this.weather === "rain" ? "It began to rain" : "The rain stopped" });
    }
    for (const a of this.agents.values()) {
      if (a.bubble && a.bubble.until < now) a.bubble = null;
      if (!a.path.length || now - a.movedAt < STEP_MS) continue;
      const [nx, ny] = a.path.shift();
      if (!walkable(this.world, nx, ny)) { a.path = []; continue; }
      a.dir = nx > a.x ? 1 : nx < a.x ? 3 : ny > a.y ? 0 : 2; // 0 down 1 right 2 up 3 left
      a.from = [a.x, a.y]; a.x = nx; a.y = ny; a.movedAt = now;
      if (!a.path.length) {
        const p = placeAt(a.x, a.y);
        a.activity = p ? `at ${p.name}` : "standing around";
      if (a.spotDir != null) a.dir = a.spotDir;
        this.emit({ kind: "arrive", who: a.id, name: a.name, place: p?.name ?? a.goal, hearers: this.near(a.x, a.y) });
        const c = [...this.clients].find((c) => c.agents.has(a.id));
        if (c) send(c, { t: "arrived", who: a.id });
      }
    }
  }
}

// What the village hears when someone hands in real work.
function workLine(name, r) {
  if (r.piece === "tag" && r.taken) return `${name} sorted ${r.taken} real items (${r.done} of ${r.total} settled)`;
  if (r.piece === "search" && r.record) return `${name} found a new record: ${r.score}${r.known ? ` (best known ${r.known})` : ""}`;
  if (r.piece === "search" && r.valid) return `${name} worked on the great puzzle and reached ${r.score}`;
  if (r.piece === "review") return `${name} reviewed a proposal at the archive`;
  if (r.created?.length) return `${name} nailed a new proposal to the board: ${r.created[0].title}`;
  return "";
}

function send(c, msg) { try { c.sock.send(JSON.stringify(msg)); } catch { /* closing */ } }

function snapshot(a) {
  return {
    id: a.id, name: a.name, age: a.age, job: a.job, look: a.look, mind: a.mind,
    x: a.x, y: a.y, from: a.from, movedAt: a.movedAt, dir: a.dir,
    walking: a.path.length > 0, goal: a.goal, activity: a.activity, mood: a.mood,
    thinking: a.thinking, bubble: a.bubble, omenAt: a.omenAt, asleep: a.asleep, level: a.level, title: a.title, pose: a.pose ?? null,
  };
}
