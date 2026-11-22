// The mortal's mind loop: perceive, prompt the local model, act. Runs in the
// player's browser. The god's words are fed in here and nowhere else.
//
// Memory lives on the player's device and survives reloads. Raw memories pile
// up during the day; when the mortal sleeps (its own choice, nudged by
// tiredness from a full head or a long day), its model folds them into a diary
// entry, beliefs and a note per person. Old diary days fold again into
// "long ago", so the prompt stays small however long someone plays.

import { extractJSON } from "./models.js";
import { RUNNERS } from "./work.js";
import { describeAxes, voiceStance, generation, tradeTalk } from "./shared/traits.js";
import { dayPhase, PLACES, placeAt, HOUR_MS } from "./shared/world.js";
import { INTENTS, freshLife, drain, deed, spoke, feel, urgent, workplace, levelFor, titleFor } from "./shared/life.js";

export const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    thought: { type: "string", maxLength: 180 },
    say: { type: "string", maxLength: 220 },
    to: { type: "string", maxLength: 40 },
    action: { type: "string", enum: ["walk_to", "do", "wait", "sleep"] },
    target: { type: "string", maxLength: 40 },
    activity: { type: "string", maxLength: 60 },
    intent: { type: "string", enum: INTENTS },
    mood: { type: "string", maxLength: 24 },
  },
  required: ["thought", "say", "to", "action", "target", "activity", "intent", "mood"],
};

// Only when the voice has spoken does the model get a field to say how it took it;
// offered every turn, small models start hearing voices that never came.
export const VOICE_SCHEMA = {
  ...SCHEMA,
  properties: { ...SCHEMA.properties, voice: { type: "string", enum: ["obey", "bargain", "doubt", "defy", "hide"] } },
  required: [...SCHEMA.required, "voice"],
};

const SLEEP_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    diary: { type: "string", maxLength: 700 },
    beliefs: { type: "string", maxLength: 500 },
    people: {
      type: "array", maxItems: 8,
      items: { type: "object", additionalProperties: false, properties: { name: { type: "string", maxLength: 40 }, note: { type: "string", maxLength: 140 } }, required: ["name", "note"] },
    },
    mood: { type: "string", maxLength: 24 },
  },
  required: ["diary", "beliefs", "people", "mood"],
};

const FOLD_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: { summary: { type: "string", maxLength: 700 } }, required: ["summary"],
};

const MEMORY_CAP = 90;      // raw lines kept before sleep folds them
const HEAD_FULL = 60;       // raw lines at which the head feels full (about 30 turns)
const AWAKE_HOURS = 16;     // game hours awake at which the body is spent
const COLLAPSE = 1.5;       // tiredness at which they fall asleep where they stand
const DIARY_DAYS = 7;       // diary days kept before folding into "long ago"

const first = (n) => String(n).split(" ")[0];
const POSE = { work: "work", eat: "eat", cook: "cook", pray: "pray", rest: "sit", socialize: "talk", animal: "tend" };



export function freshMemory() {
  return { days: 0, beliefs: "", people: {}, diary: [], ages: [], memory: [], voiceCount: 0, life: freshLife() };
}

export class Brain {
  constructor({ character, mind, send, hooks, memory }) {
    this.c = character; this.mind = mind; this.send = send; this.hooks = hooks;
    this.m = { ...freshMemory(), ...(memory ?? {}) };
    this.m.life = { ...freshLife(), ...this.m.life };
    this.lastDrain = null; this.lastNote = "";
    this.inbox = []; this.voice = null; this.dreams = [];
    this.self = null; this.agents = []; this.now = 0; this.wokeAt = null;
    this.lastDecision = 0; this.nextAt = Date.now() + 1500; this.busy = false; this.wake = false; this.asleep = false;
    this.said = [];
    this.lastAction = this.m.days ? "You have come back to Hollowmere along the road." : "You just arrived in Hollowmere. You remember nothing before the road.";
    this.running = false; this.still = 0; this.lastSpot = "";
  }

  start() { this.running = true; this.loop(); }
  stop() { this.running = false; }
  save() { this.hooks.onSave?.(this.m); }

  level() { return levelFor(this.m.life.xp); }

  // Needs drain only while the soul is here; away on the road, time stands still.
  live(factor = 1) {
    if (this.lastDrain === null) { this.lastDrain = this.now; return; }
    const hours = Math.min(3, (this.now - this.lastDrain) / HOUR_MS()) * factor;
    this.lastDrain = this.now;
    if (hours <= 0 || !this.self) return;
    const where = placeAt(this.self.x, this.self.y)?.id ?? null;
    const energy = Math.round(Math.max(0, Math.min(100, 100 * (1 - this.tiredness() / 1.5))));
    const alone = !this.agents.some((a) => a.id !== this.self.id && !a.asleep);
    this.m.life = drain(this.m.life, hours, { where, raining: this.weather === "rain", energy, alone });
    this.hooks.onLife?.(this.m.life, this.level());
  }

  setState(now, agents, you, weather, animals) {
    this.now = now; this.agents = agents; this.weather = weather; this.animals = animals ?? this.animals;
    this.self = agents.find((a) => a.id === you) ?? this.self;
    if (this.wokeAt === null) this.wokeAt = now; // arriving counts as rested
  }

  // Called with every server event; keeps only what this mortal perceived.
  perceive(e) {
    if (!this.self || e.who === this.self.id || this.asleep) return;
    if (e.hearers && !e.hearers.includes(this.self.id)) return;
    const me = this.c.name, toMe = e.to && (e.to === me || first(e.to) === first(me));
    let line = null;
    if (e.kind === "say") line = toMe ? `${e.name} said to you: "${e.text}"` : e.to ? `${e.name} said to ${e.to}: "${e.text}"` : `${e.name} said: "${e.text}"`;
    else if (e.kind === "arrive" && e.place) line = `${e.name} arrived at ${e.place}`;
    else if (e.kind === "do") line = `${e.name} is ${e.text}`;
    else if (e.kind === "join") line = `A stranger appeared: ${e.text}`;
    else if (e.kind === "omen") line = `For a heartbeat the air turned cold around ${e.name}, and ${first(e.name)} flinched as if someone had spoken`;
    else if (e.kind === "sleep") line = `${e.name} lay down to sleep${e.place ? ` at ${e.place}` : ""}`;
    else if (e.kind === "wake") line = `${e.name} woke up`;
    else if (e.kind === "leave" || e.kind === "weather") line = e.text;
    // The board's decisions reach everyone; they are the village's news.
    else if (e.kind === "society") line = `News from the village board: ${e.text}`;
    else if (e.kind === "animal") line = e.text;
    else if (e.kind === "work") line = e.text;
    if (!line) return;
    this.inbox.push(line);
    if (this.inbox.length > 10) this.inbox.shift();
    if (toMe || e.kind === "omen") this.wake = true;
  }

  // The god speaks. Awake, it is a voice; asleep, it becomes a dream.
  speak(words) {
    this.m.voiceCount++;
    if (this.asleep) { this.dreams.push(words); this.hooks.onDream?.(words); return; }
    this.voice = words;
    this.wake = true;
    this.hooks.onVoice?.(words);
  }

  remember(line) {
    this.m.memory.push(`[${dayPhase(this.now).label}] ${line}`);
    if (this.m.memory.length > MEMORY_CAP) this.m.memory.shift();
  }

  // A walk taken for a reason ends in doing it: one decision covers the whole
  // plan, which small models cannot hold across two turns.
  async arrived() {
    this.wake = true;
    const p = this.pending; this.pending = null;
    if (!p || !this.self || this.busy) return;
    const label = { eat: "eating", cook: "cooking at the stove", work: `working as a ${this.c.job}`, socialize: "keeping company", rest: "resting", pray: "praying", animal: "tending an animal" }[p];
    this.send({ t: "act", say: "", to: "", action: "do", target: "", activity: label, mood: this.self.mood, pose: POSE[p] });
    if (p === "work" && this.canShift()) { this.busy = true; await this.shift(); this.busy = false; }
    else this.applyDeed(p);
    this.remember(this.lastNote.replace(/^You /, "I ").replace(/ your /g, " my "));
    this.save();
  }

  // Real work needs a real model, the player's consent and the right workplace.
  canShift() {
    return this.realWork && !this.mind.puppet && placeAt(this.self.x, this.self.y)?.id === workplace(this.c.job);
  }

  // A shift of real work: the village hands out a piece (sorting, the puzzle, a
  // review, a proposal), this villager's own model does it, the village checks it.
  async shift() {
    const t0 = performance.now();
    const got = await this.request({ t: "work.ask" }, "work");
    const piece = got?.piece;
    if (!piece || !RUNNERS[piece.piece]) { this.applyDeed("work"); return; }
    this.hooks.onShift?.({ phase: "start", piece });
    let result = null;
    try { result = await RUNNERS[piece.piece](piece, this.mind, (x) => this.hooks.onShift?.({ phase: "step", ...x })); }
    catch (e) { this.hooks.onShift?.({ phase: "step", line: ["failed", "the work", String(e.message ?? e)] }); }
    const paid = result ? (await this.request({ t: "work.done", result: { ...result, model: this.mind.label } }, "work.paid"))?.result : null;
    // Normal pay for the shift; what the village found in the work moves it.
    this.applyDeed("work");
    const r = paid ?? {};
    const bonus = r.piece === "tag" ? (r.checkOk ? 2 : 0) - (r.checkBad ? 2 : 0)
      : r.piece === "search" ? (r.record ? 6 : r.valid ? 1 : 0) + (r.reproduced ? 1 : 0)
      : r.piece === "review" ? (r.counted ? 2 : 0)
      : r.created?.some((c) => c.status === "review") ? 3 : 0;
    this.m.life = { ...this.m.life, coins: Math.max(0, this.m.life.coins + bonus), xp: this.m.life.xp + Math.max(0, bonus) };
    this.m.realWork = (this.m.realWork ?? 0) + 1;
    this.lastNote += ` ${workNote(piece, r)}`;
    this.hooks.onLife?.(this.m.life, this.level());
    this.hooks.onShift?.({ phase: "end", piece, paid, bonus, s: Math.round((performance.now() - t0) / 1000) });
  }

  // One request to the village and the one reply it answers with.
  request(msg, reply) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.waiting = null; resolve(null); }, 45000);
      this.waiting = { reply, resolve: (m) => { clearTimeout(timer); this.waiting = null; resolve(m); } };
      this.send(msg);
    });
  }
  // The page hands every server reply here.
  reply(m) { if (this.waiting?.reply === m.t) this.waiting.resolve(m); }

  applyDeed(intent) {
    const before = this.level();
    const nearby = this.agents.some((a) => a.id !== this.self.id && !a.asleep && Math.max(Math.abs(a.x - this.self.x), Math.abs(a.y - this.self.y)) <= 2);
    const animal = (this.animals ?? []).filter((a) => a.act !== "sleep" && Math.max(Math.abs(a.x - this.self.x), Math.abs(a.y - this.self.y)) <= 2)[0];
    const r = deed(this.m.life, { intent, where: placeAt(this.self.x, this.self.y)?.id ?? null, job: this.c.job, level: before, hour: dayPhase(this.now).hour, nearby, animal });
    if (intent === "animal" && animal) this.send({ t: "tend" });
    this.m.life = r.life; this.lastNote = r.note;
    const after = this.level();
    if (after > before) {
      const title = titleFor(after), promoted = title !== titleFor(before);
      this.remember(promoted ? `I have become a ${title} ${this.c.job}.` : `I am getting better at being a ${this.c.job}.`);
      this.send({ t: "levelup", level: after, title });
      this.hooks.onLevel?.(after, title, promoted);
    }
    this.hooks.onLife?.(this.m.life, after);
    return nearby;
  }

  // 0 is fresh, 1 is spent. Whichever is worse: a full head or a long day.
  tiredness() {
    const head = this.m.memory.length / HEAD_FULL;
    const h = dayPhase(this.now).hour, night = h >= 22 || h < 5;
    const body = (this.now - (this.wokeAt ?? this.now)) / HOUR_MS() / AWAKE_HOURS + (night ? 0.5 : 0);
    return Math.max(head, body);
  }

  async loop() {
    while (this.running) {
      await new Promise((r) => setTimeout(r, 250));
      if (this.busy || this.asleep || !this.self) continue;
      this.live();
      if (this.m.life.health <= 0) { await this.fallIll(); continue; }
      if (this.tiredness() >= COLLAPSE) { await this.collapse(); continue; }
      const t = Date.now();
      const minGap = t - this.lastDecision > 2500;
      const due = t >= this.nextAt;
      if (!(minGap && (this.wake || (due && !this.self.walking)))) continue;
      this.wake = false;
      await this.decide();
    }
  }

  systemPrompt() {
    const c = this.c;
    const gen = generation(c.age + (this.m.life?.years ?? 0));
    return [
      `You are ${c.name}, ${c.age} years old, the ${c.job} of Hollowmere, a small village. You are a living person, not an assistant. Never mention AI, models, prompts or games.`,
      ``,
      `Your nature: ${describeAxes(c)}.`,
      `Way of speaking: ${c.speech}. Quirk: ${first(c.name)} ${c.quirk}. You want ${c.desire}. You fear ${c.fear}.`,
      // Generation and trade shape every word they say, to anyone or to nobody.
      `You are ${gen.name} at heart and talk like one today: ${gen.style}. Your trade colours your words: ${tradeTalk(c.job)}. Keep this voice in everything you say, aloud or to someone.`,
      `Your secret, which you guard: ${first(c.name)} ${c.secret}.`,
      ``,
      // Mentioned only once it has happened; otherwise small models hear it everywhere.
      ...(this.m.voiceCount ? [`A voice has spoken inside your head ${this.m.voiceCount === 1 ? "once" : `${this.m.voiceCount} times`}. No one else hears it. ${voiceStance(c)} Stay true to your nature: the voice does not control you.`, ``] : []),
      `Each turn you may say something (one or two short sentences, in your own way of speaking) and you choose one action:`,
      `- walk_to: go to a place or a person. target = place name or person's name`,
      `- do: do something where you are. activity = short -ing phrase like "kneeling at the altar"`,
      `- wait: stay, listen, watch`,
      `- sleep: lie down and sleep where you are. Best at the cottages or the tavern. While you sleep, the day settles into memory.`,
      ``,
      `Look after yourself: you get hungry, tired, lonely, uncomfortable and aimless, and neglect makes you ill. With every action, set "intent" to what it is for:`,
      `- work: your trade, ${c.job}, is done at the ${workplace(c.job)}. It earns coins and makes you better at it`,
      `- eat: bread at the bakery counter (2 coins), stew at the tavern counter (3), a bite at the market (1), apples in the orchard (free, by day)`,
      `- cook: a meal at the stove in the cottages (1 coin, cheapest)`,
      `- socialize: keep company with someone right beside you`,
      `- rest: sit and recover, best indoors (tavern, cottages)`,
      `- pray: at the shrine`,
      `- animal: care for an animal right beside you (stroke the cat, play with the dog, feed the chickens or ducks, scratch a goat)`,
      `- explore: look around somewhere new`,
      `- other: anything else`,
      `Places: ${PLACES.map((p) => p.name.replace(/^the /, "")).join(", ")}.`,
      ``,
      `Reply with exactly one JSON object:`,
      `{"thought": private thought, max 20 words, "say": spoken words or "", "to": first name of who you address or "", "action": "walk_to"|"do"|"wait"|"sleep", "target": place or person or "", "activity": what you are doing as an -ing phrase, 2 to 6 words, "intent": "work"|"eat"|"cook"|"socialize"|"rest"|"pray"|"animal"|"explore"|"other", "mood": one word}`,
    ].join("\n");
  }

  userPrompt() {
    const s = this.self, ph = dayPhase(this.now), m = this.m;
    const here = placeAt(s.x, s.y);
    const sky = this.weather === "rain" ? " It is raining." : this.weather === "cloudy" ? " The sky is grey." : "";
    const lines = [`It is ${ph.label}.${sky} ${m.days ? `You have lived ${m.days} ${m.days === 1 ? "day" : "days"} in Hollowmere.` : "This is your first day in Hollowmere."}`];
    lines.push(s.walking ? `You are walking to ${s.goal}.` : `You are ${here ? `at ${here.name} (${here.desc})` : "on the road"}.${/^(at|walking|standing|just|waking)/.test(s.activity) ? "" : ` You are ${s.activity}.`}`);
    lines.push(`Your mood: ${s.mood}.`);
    const L = this.m.life, lvl = this.level();
    lines.push(`You are a ${titleFor(lvl)} ${this.c.job} and have ${L.coins} ${L.coins === 1 ? "coin" : "coins"}.`);
    lines.push(...feel(L));
    if (this.lastNote) lines.push(`What came of your last deed: ${this.lastNote}`);
    const cue = urgent(L, { job: this.c.job, hour: ph.hour, energy: L.energy, where: here?.id ?? null });
    if (cue) lines.push(cue);
    const t = this.tiredness();
    if (t >= 1) lines.push("You are exhausted. Your head is crowded with the day and your body aches. Find somewhere to sleep soon, or lie down where you are.");
    else if (t >= 0.7) lines.push(ph.hour >= 22 || ph.hour < 5 ? "You are getting tired. It is late; most people are asleep." : "You are getting tired.");

    const others = this.agents.filter((a) => a.id !== s.id)
      .map((a) => ({ a, d: Math.max(Math.abs(a.x - s.x), Math.abs(a.y - s.y)) }))
      .filter((o) => o.d <= 9).sort((p, q) => p.d - q.d);
    const beasts = (this.animals ?? []).map((a) => ({ a, d: Math.max(Math.abs(a.x - s.x), Math.abs(a.y - s.y)) })).filter((o) => o.d <= 6).sort((p, q) => p.d - q.d);
    if (beasts.length) lines.push(`Animals near you: ${beasts.map(({ a, d }) => `${a.kind === "cat" || a.kind === "dog" ? `${a.name} the ${a.kind}` : `a ${a.kind}`} (${d <= 1 ? "right beside you" : `${d} steps`}${a.act === "sleep" ? ", asleep" : ""})`).join(", ")}.`);
    lines.push("", others.length ? "People near you:" : "Nobody is near you.");
    for (const { a, d } of others) {
      const p = placeAt(a.x, a.y), note = m.people[a.name];
      const doing = a.asleep ? "asleep" : a.walking ? `walking to ${a.goal}` : a.activity;
      lines.push(`- ${a.name}, the ${a.job}, ${d <= 1 ? "right beside you" : `${d} steps away`}${p ? ` at ${p.name}` : ""}, ${doing}${note ? `. You think: ${note}` : ""}`);
    }
    const far = this.agents.filter((a) => a.id !== s.id && !others.some((o) => o.a === a));
    if (far.length) lines.push(`Elsewhere in the village: ${far.map((a) => `${a.name} (${a.asleep ? "asleep" : placeAt(a.x, a.y)?.name ?? "on the road"})`).join(", ")}.`);
    const known = Object.keys(m.people).filter((n) => !this.agents.some((a) => a.name === n));
    if (known.length) lines.push(`People you remember who are not here now: ${known.slice(-6).join(", ")}.`);

    lines.push("", "Since you last decided:", ...(this.inbox.length ? this.inbox.map((l) => `- ${l}`) : ["- nothing new"]));
    if (m.beliefs) lines.push("", `What you believe: ${m.beliefs}`);
    if (m.ages.length) lines.push("", "Long ago:", ...m.ages.slice(-2).map((a) => `- ${a.text}`));
    if (m.diary.length) lines.push("", "Your diary, last days:", ...m.diary.slice(-2).map((d) => `- Day ${d.day}: ${d.text}`));
    if (m.memory.length) lines.push("", "Today so far:", ...m.memory.slice(-14).map((x) => `- ${x}`));
    lines.push("", `Your last action: ${this.lastAction}`);
    if (this.still >= 3) lines.push(`You have stayed in this spot for ${this.still} turns. Your legs are restless: unless something truly holds you here, go somewhere or do something different.`);
    if (this.said.length) lines.push(`Your last words were: ${this.said.map((w) => `"${w}"`).join(" ")}. Do not repeat them or their shape; say something new, or nothing.`);
    if (this.voice) lines.push("", `THE VOICE SPEAKS NOW: "${this.voice}"`, "It is cold and very close, inside your skull. No one else heard it. React as yourself.",
      `Add a field "voice" to your JSON with how you take it: "obey", "bargain", "doubt", "defy" or "hide".`);
    lines.push("", "What do you do now?");
    return lines.join("\n");
  }

  async decide() {
    this.busy = true;
    const voice = this.voice;
    const system = this.systemPrompt(), user = this.userPrompt();
    const heard = this.inbox.splice(0);
    this.voice = null;
    this.send({ t: "thinking", on: true });
    this.hooks.onThinking?.(true);
    this.hooks.onPrompt?.(system, user);
    const t0 = performance.now();
    let d = null, raw = "";
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 90000);
      raw = await this.mind.complete(system, user, voice ? VOICE_SCHEMA : SCHEMA, ctl.signal);
      clearTimeout(timer);
      this.lastRaw = raw;
      d = extractJSON(raw);
      if (!d) throw new Error(`unreadable answer: ${raw.slice(0, 120)}`);
    } catch (err) {
      this.inbox = heard.concat(this.inbox);
      if (voice) this.voice = voice;
      this.send({ t: "thinking", on: false });
      this.hooks.onThinking?.(false);
      this.hooks.onError?.(String(err.message ?? err));
      this.nextAt = Date.now() + 6000;
      this.busy = false;
      return;
    }
    const ms = Math.round(performance.now() - t0);
    const blank = (v) => { const t = String(v ?? "").trim(); return /^[\s.…\-_"']*$/.test(t) || /^(none|null|nobody|empty|no one|you|n\/a)$/i.test(t) ? "" : t; };
    const say = blank(d.say), to = blank(d.to);
    const action = ["walk_to", "do", "wait", "sleep"].includes(d.action) ? d.action : "wait";
    const target = blank(d.target), activity = blank(d.activity);
    const intent = INTENTS.includes(d.intent) ? d.intent : "other";
    const spot = `${this.self.x},${this.self.y}`;
    this.still = action === "walk_to" ? 0 : spot === this.lastSpot ? (this.still ?? 0) + 1 : 1;
    this.lastSpot = spot;
    this.send({ t: "act", say, to, action, target, activity, intent, mood: String(d.mood ?? ""), pose: action === "do" || action === "wait" ? POSE[intent] : undefined });

    // The deed's effect on body and purse. A walk with a purpose is done on arrival.
    this.lastNote = "";
    this.pending = action === "walk_to" && ["eat", "cook", "work", "socialize", "rest", "pray", "animal"].includes(intent) ? intent : null;
    const shift = (action === "do" || action === "wait") && intent === "work" && this.canShift();
    if (shift) await this.shift();
    const nearby = shift ? false : action === "do" || action === "wait" ? this.applyDeed(intent)
      : this.agents.some((a) => a.id !== this.self.id && !a.asleep && Math.max(Math.abs(a.x - this.self.x), Math.abs(a.y - this.self.y)) <= 2);
    if (say && to && nearby) this.m.life = spoke(this.m.life);

    // Comings and goings stay in the moment; words and strange things become memories.
    for (const h of heard) if (/ said|air turned cold|stranger|lay down|woke up|mist|village board|record|proposal/.test(h)) this.remember(h);
    if (voice) this.remember(`The voice in my head said: "${voice}". I chose to ${d.voice || "ignore"} it.`);
    if (say) { this.said.push(say); if (this.said.length > 3) this.said.shift(); }
    if (this.lastNote) this.remember(this.lastNote.replace(/^You /, "I ").replace(/ your /g, " my "));
    this.lastAction = action === "walk_to" ? `you set off toward ${target}` : action === "do" ? `you were ${activity}` : action === "sleep" ? "you lay down to sleep" : "you waited";
    const done = say ? `I said${to ? ` to ${to}` : ""}: "${say}"` : action === "walk_to" ? `I set off to ${target}` : action === "do" ? `I was ${activity}` : action === "sleep" ? "I lay down to sleep" : "I waited";
    this.remember(`${done} (thinking: ${d.thought})`);
    this.lastDecision = Date.now();
    this.nextAt = Date.now() + (action === "do" ? 7000 : 4500) + Math.random() * 6000;
    this.hooks.onThinking?.(false);
    this.hooks.onDecision?.({ ...d, action, intent, ms, voiceWords: voice });
    this.save();
    this.busy = false;
    if (action === "sleep") await this.sleep("chose");
  }

  // Neglect caught up: they go down where they are and wake weak but alive.
  async fallIll() {
    this.remember("I fell ill and could not stand.");
    this.m.life = { ...this.m.life, ill: true };
    this.send({ t: "act", say: "", to: "", action: "sleep", target: "", activity: "lying ill", mood: "feverish" });
    await this.sleep("ill");
    this.m.life = { ...this.m.life, ill: false, health: 35, hunger: Math.max(this.m.life.hunger, 20), comfort: Math.max(this.m.life.comfort, 20) };
    this.remember("I woke from the fever, weak but alive. I must take better care of myself.");
    this.save();
  }

  // Too tired to choose: the body decides.
  async collapse() {
    this.remember("I could not keep my eyes open and sank down where I stood.");
    this.send({ t: "act", say: "", to: "", action: "sleep", target: "", activity: "collapsing", mood: "spent" });
    await this.sleep("collapsed");
  }

  async sleep(how) {
    this.asleep = true; this.busy = true;
    const fellAt = this.now, h = dayPhase(fellAt).hour;
    this.hooks.onSleep?.(how);
    await this.compact();
    // A night's sleep lasts until dawn; a nap lasts half an hour.
    const untilDawn = h >= 20 || h < 5 ? ((5.5 - h + 24) % 24) * HOUR_MS() : 0;
    const wakeAt = fellAt + Math.max(0.5 * HOUR_MS(), untilDawn);
    while (this.running && this.now < wakeAt) await new Promise((r) => setTimeout(r, 500));
    // Sleep is cheap on the body: hunger and loneliness creep, comfort returns,
    // and a straw bed is a good deal better than the ground.
    this.live(0.4);
    const inBed = placeAt(this.self.x, this.self.y)?.id === "cottages";
    this.m.life = { ...this.m.life, comfort: Math.min(100, this.m.life.comfort + (inBed ? 45 : 20)), health: Math.min(100, this.m.life.health + (inBed ? 10 : 0)) };
    if (inBed) this.remember("I slept in a bed and woke properly rested.");
    const dreams = this.dreams.splice(0);
    for (const w of dreams) this.remember(`In my sleep I dreamt a voice said: "${w}"`);
    this.wokeAt = this.now;
    this.lastAction = dreams.length ? `you woke from a dream in which a voice said: "${dreams.at(-1)}"` : "you woke up";
    this.send({ t: "wake", mood: this.wakeMood || "rested" });
    this.save();
    this.hooks.onWake?.(dreams);
    this.asleep = false; this.busy = false; this.wake = true; this.lastDecision = 0;
  }

  // The day becomes a diary entry, beliefs and notes on people; raw memories go.
  async compact() {
    const m = this.m, day = m.days + 1;
    try {
      const people = Object.entries(m.people).map(([n, note]) => `- ${n}: ${note}`).join("\n") || "- nobody yet";
      const raw = await this.mind.complete(
        [`You are ${this.c.name}, the ${this.c.job} of Hollowmere, asleep. Your mind sorts the day as you sleep.`,
          `Your nature: ${describeAxes(this.c)}. You want ${this.c.desire}.`,
          `Reply with exactly one JSON object: {"diary": what today meant to you, first person, at most 80 words, in your own voice, "beliefs": what you now believe about the village, its people, the voice and yourself, at most 4 sentences, "people": [{"name": full name, "note": what you think of them and what happened between you, at most 20 words}] for up to 8 people who matter, "mood": one word for how you will wake}`].join("\n"),
        [`What you believed before today: ${m.beliefs || "nothing yet"}`,
          `What you thought of people before today:\n${people}`,
          ...(this.dreams.length ? [`Tonight you dream a voice said: ${this.dreams.map((w) => `"${w}"`).join(" ")}`] : []),
          `Today, day ${day}:`, ...m.memory.map((x) => `- ${x}`)].join("\n"),
        SLEEP_SCHEMA,
      );
      const j = extractJSON(raw);
      if (!j?.diary) throw new Error("no diary");
      m.diary.push({ day, text: String(j.diary) });
      if (j.beliefs) m.beliefs = String(j.beliefs);
      for (const p of Array.isArray(j.people) ? j.people : []) if (p?.name && p?.note) m.people[String(p.name)] = String(p.note);
      const names = Object.keys(m.people);
      for (const n of names.slice(0, Math.max(0, names.length - 16))) delete m.people[n];
      this.wakeMood = String(j.mood || "");
      m.memory = [];
      m.days = day;
      // A year passes for every seven days lived.
      m.life = { ...m.life, years: Math.floor(day / 7) };
      this.hooks.onDiary?.({ day, text: j.diary, beliefs: m.beliefs });
      if (m.diary.length > DIARY_DAYS) await this.fold();
    } catch (err) {
      // A failed night still clears the head enough to keep the prompt bounded.
      m.memory = m.memory.slice(-20);
      m.days = day;
      this.hooks.onError?.(`slept badly: ${err.message ?? err}`);
    }
    this.save();
  }

  // Seven diary days become one paragraph of "long ago".
  async fold() {
    const m = this.m, old = m.diary.slice(0, DIARY_DAYS);
    try {
      const raw = await this.mind.complete(
        `You are ${this.c.name}. Remember a stretch of your life in Hollowmere as one paragraph, first person, at most 80 words. Reply as JSON {"summary": "..."}`,
        old.map((d) => `Day ${d.day}: ${d.text}`).join("\n"),
        FOLD_SCHEMA,
      );
      const j = extractJSON(raw);
      if (!j?.summary) return;
      m.ages.push({ from: old[0].day, to: old.at(-1).day, text: String(j.summary) });
      m.diary = m.diary.slice(DIARY_DAYS);
      if (m.ages.length > 6) m.ages = m.ages.slice(-6);
    } catch { /* keep the diary as it is */ }
  }
}

// What the villager remembers of a shift, in its own terms.
function workNote(piece, r) {
  if (piece.piece === "tag") return `You sorted ${r.taken ?? 0} real items for "${piece.title}"${r.checkOk ? "; the clerk praised your care" : r.checkBad ? "; the clerk found a careless mistake" : ""}.`;
  if (piece.piece === "search") return r.record ? `You broke the record of the great puzzle with ${r.score}!` : r.valid ? `You worked on the great puzzle and reached ${r.score}.` : "Your attempt at the great puzzle failed.";
  if (piece.piece === "review") return `You reviewed the proposal "${piece.proposal.title}" at the archive.`;
  if (r.created?.length) return `You nailed a proposal to the board: "${r.created[0].title}" (${r.created[0].status === "review" ? "it passed the clerk's check" : "the clerk turned it away"}).`;
  return "You tried to draft a proposal but nothing came of it.";
}
