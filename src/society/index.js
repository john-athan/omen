// The society: which real work Hollowmere does, who did it, and why it was
// chosen. See docs/society.md for the plan this implements.
//
// A task is one record in the registry. Proposals are tasks that are not yet
// active. Villagers ask for a piece of work and hand it back; nothing counts
// until it is checked (agreement, check items, a verifier, cited evidence).

import COUNCIL from "../tasks.json" with { type: "json" };
import SEED from "../kb-seed.json" with { type: "json" };
import { Index } from "./kb.js";
import { ADAPTERS, USER_AGENT } from "./adapters.js";
import * as apfree from "./apfree.js";
import { DAY_MS } from "../../public/shared/world.js";

export const COUNCIL_LABELS = {
  verkehr: "traffic", umwelt: "environment", bildung: "schools", soziales: "social", kultur: "culture",
  bauen: "building", gruen_freizeit: "parks and leisure", sonstiges: "other",
};
const COUNCIL_GOLD = {
  1024122: "verkehr", 584452: "verkehr", 874453: "verkehr", 858158: "verkehr",
  1113688: "bildung", 1150985: "bildung", 645109: "umwelt", 575732: "umwelt",
  612624: "soziales", 875568: "kultur", 673511: "kultur", 626289: "gruen_freizeit", 674052: "gruen_freizeit",
};

export const CRITERIA = {
  people: "Would the answer matter to real people outside this game?",
  public: "Does it use only public data?",
  checkable: "Can the work be checked (agreement between villagers, or a verifier)?",
  used: "Is someone likely to use the result?",
};

const NEEDED = 3;           // answers per tag item, reviews per proposal
const BATCH = 6;            // tag items per shift
const LEASE_MS = 5 * 60 * 1000;
const MAX_ACTIVE = 4;        // tasks chosen by players at once; curated ones do not count
const SCHOLARS = new Set(["cartographer", "apprentice priest", "failed alchemist", "tax collector", "wandering bard", "midwife", "herbalist"]);

const clean = (s, n) => (typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n) : "");
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9äöüß]+/g, " ").trim();

export class Society {
  constructor(store, { openAt = 20, voteMin = 3, fetchFn = (...a) => fetch(...a), now = () => Date.now(), onEvent = () => {} } = {}) {
    this.store = store; this.openAt = openAt; this.voteMin = voteMin; this.fetch = fetchFn; this.now = now; this.onEvent = onEvent;
    this.tasks = new Map(); this.items = new Map(); this.answers = new Map(); this.programs = new Map(); this.records = new Map();
    this.rep = new Map(); this.seen = new Map(); this.budget = new Map(); this.log = []; this.leases = new Map();
    this.meta = { seq: 0 };
    this.ready = null;
  }

  load() { return (this.ready ??= this._load()); }
  async _load() {
    this.meta = (await this.store.get("meta")) ?? { seq: 0 };
    for (const [, t] of await this.store.list({ prefix: "task:" })) this.tasks.set(t.id, t);
    for (const [k, v] of await this.store.list({ prefix: "ans:" })) {
      const [, task, item] = k.split(":");
      if (!this.answers.has(task)) this.answers.set(task, new Map());
      this.answers.get(task).set(item, v);
    }
    for (const [k, v] of await this.store.list({ prefix: "prog:" })) this.programs.set(k.slice(5), v);
    for (const [k, v] of await this.store.list({ prefix: "rec:" })) this.records.set(k.slice(4), v);
    for (const [k, v] of await this.store.list({ prefix: "rep:" })) this.rep.set(k.slice(4), v);
    for (const [k, v] of await this.store.list({ prefix: "seen:" })) this.seen.set(k.slice(5), v);
    for (const [, v] of await this.store.list({ prefix: "log:" })) this.log.push(v);
    this.log = this.log.slice(-300);
    await this.migrate();
    await this.curate();
    this.kb = new Index([...SEED, ...[...this.tasks.values()].map(entryOf)]);
    for (const t of this.tasks.values()) if (t.status === "active" && t.kind === "tag") this.loadItems(t).catch(() => {});
  }

  // The first version kept council answers in one value called "work".
  async migrate() {
    const old = await this.store.get("work");
    if (!old?.answers) return;
    const m = this.answersOf("council");
    for (const [id, list] of Object.entries(old.answers)) {
      const v = list.map((a) => ({ who: a.who, label: a.topic, plain: a.plain, place: a.place }));
      m.set(id, v); await this.store.put(`ans:council:${id}`, v);
    }
    await this.store.delete("work");
  }

  // The work that runs before players can propose anything.
  async curate() {
    const seed = [
      { id: "council", kind: "tag", title: "Sort Munich council papers by topic", question: "Which topic does each of 2,432 Munich council and district committee papers concern? München Transparent's OParl data has no keywords.",
        params: { adapter: "bundled", labels: COUNCIL_LABELS, instructions: "Pick the topic of this council paper and say in one short sentence of simple German what it asks for.", plainLang: "German" } },
      { id: "loneliness", kind: "tag", title: "Screen studies on loneliness in older age", question: "Which published studies test an intervention against loneliness or social isolation in people over 60? A first screening pass for a literature review.",
        params: { adapter: "openalex", query: "loneliness social isolation older adults intervention trial", labels: { relevant: "tests an intervention for loneliness or isolation in people over 60", not_relevant: "does not", unclear: "cannot tell from the abstract" }, instructions: "Read the abstract. Does this study test an intervention that aims to reduce loneliness or social isolation in people over 60?", plainLang: "English" } },
      { id: "apfree-100", kind: "search", title: "No three in a row, up to 100", question: "How large can a set of numbers from 1 to 100 be without three of them evenly spaced? The best known is 27.", params: { family: "apfree", N: 100 } },
      { id: "apfree-200", kind: "search", title: "No three in a row, up to 200", question: "How large can a set of numbers from 1 to 200 be without three of them evenly spaced? The best known is 41.", params: { family: "apfree", N: 200 } },
    ];
    for (const s of seed) {
      if (this.tasks.has(s.id)) continue;
      const t = { ...s, status: "active", origin: "curated", proposer: null, parent: null, created: this.now(), reviews: [], votes: {}, weight: 0 };
      this.tasks.set(t.id, t); await this.saveTask(t);
      this.decide(t, "active", "Curated so the village has work before players can propose any.");
    }
  }

  // ---- registry and log ------------------------------------------------------

  async saveTask(t) { await this.store.put(`task:${t.id}`, t); }
  answersOf(id) { if (!this.answers.has(id)) this.answers.set(id, new Map()); return this.answers.get(id); }

  decide(t, status, reason, evidence = []) {
    const e = { seq: ++this.meta.seq, at: this.now(), task: t.id, title: t.title, from: t.status, to: status, reason, evidence };
    t.status = status; t.decided = reason;
    this.log.push(e); if (this.log.length > 300) this.log.shift();
    this.store.put(`log:${String(e.seq).padStart(8, "0")}`, e); this.store.put("meta", this.meta);
    this.saveTask(t);
    this.kb?.add(entryOf(t));
    this.onEvent({ kind: "society", text: `${t.title}: ${status}`, task: t.id, status });
    return e;
  }

  // ---- players ---------------------------------------------------------------

  touch(who) {
    const day = Math.floor(this.now() / 86400000);
    if (this.seen.get(who) !== day) { this.seen.set(who, day); this.store.put(`seen:${who}`, day); }
  }
  players() { const today = Math.floor(this.now() / 86400000); return [...this.seen.values()].filter((d) => today - d < 7).length; }
  isOpen() { return this.players() >= this.openAt; }
  // Three reviewers other than the proposer; a village with three players online can only offer two.
  // The village tells us who is online; without it, the week's players count.
  reviewsNeeded() { const n = this.online?.() ?? this.players(); return Math.min(NEEDED, Math.max(2, n - 1)); }
  repOf(who) { return this.rep.get(who) ?? { ok: 0, bad: 0 }; }
  weightOf(who) { const r = this.repOf(who); return 1 + Math.max(0, Math.min(2, (r.ok - 2 * r.bad) / 10)); }
  credit(who, good, n = 1) {
    const r = { ...this.repOf(who) };
    if (good) r.ok += n; else r.bad += n;
    this.rep.set(who, r); this.store.put(`rep:${who}`, r);
  }

  // ---- asking for work ---------------------------------------------------------

  // `who` is the device (agreement, votes, reviews); `slot` the villager, so
  // two villagers of one household can each hold a piece of work at once.
  async ask(who, { trade = "", slot = "" } = {}) {
    const key = slot ? `${who}#${slot}` : who;
    await this.load();
    this.touch(who);
    const scholar = SCHOLARS.has(trade);
    // A proposal that already has enough reviews (the village shrank) is decided now.
    for (const t of this.tasks.values()) if (t.status === "review" && t.reviews.length >= this.reviewsNeeded()) this.conclude(t);
    const review = [...this.tasks.values()].find((t) => t.status === "review" && t.reviews.length < this.reviewsNeeded() && t.proposer !== who && !t.reviews.some((r) => r.who === who));
    if (review && (scholar || Math.random() < 0.5)) return this.reviewPiece(review);
    // New proposals only while the reviewers keep up.
    const backlog = [...this.tasks.values()].filter((t) => t.status === "review").length;
    if (this.isOpen() && backlog < 3 && Math.random() < (scholar ? 0.25 : 0.1)) {
      const target = [...this.tasks.values()].filter((t) => ["ballot", "active"].includes(t.status) && t.kind === "tag" && t.params.adapter === "openalex");
      if (target.length && Math.random() < 0.35) return this.refinePiece(target[Math.floor(Math.random() * target.length)]);
      return this.proposePiece();
    }
    // An active list whose items failed to load (a source was down) tries again every ten minutes.
    for (const t of this.tasks.values()) if (t.status === "active" && t.kind === "tag" && !this.items.has(t.id) && !(this.retry?.get(t.id) > this.now())) {
      (this.retry ??= new Map()).set(t.id, this.now() + 600000);
      this.loadItems(t).catch(() => {});
    }
    const active = [...this.tasks.values()].filter((t) => t.status === "active" && (t.kind === "search" || this.items.get(t.id)?.length));
    if (!active.length) return null;
    const searches = active.filter((t) => t.kind === "search"), tags = active.filter((t) => t.kind === "tag");
    const pickSearch = searches.length && (!tags.length || Math.random() < (scholar ? 0.6 : 0.25));
    const t = pickSearch ? searches[Math.floor(Math.random() * searches.length)] : tags[Math.floor(Math.random() * tags.length)];
    return t.kind === "search" ? this.searchPiece(t) : this.tagPiece(t, who, key);
  }

  lease(who, piece) { this.leases.set(who, { ...piece, until: this.now() + LEASE_MS }); return piece; }

  tagPiece(t, who, key = who) {
    const now = this.now();
    for (const [k, l] of this.leases) if (l.until < now) this.leases.delete(k);
    const leased = new Set([...this.leases.values()].filter((l) => l.taskId === t.id).flatMap((l) => l.ids ?? []));
    const ans = this.answersOf(t.id), gold = t.id === "council" ? COUNCIL_GOLD : {};
    const ids = [];
    for (const it of this.items.get(t.id)) {
      if (ids.length >= BATCH - 1) break;
      const list = ans.get(it.id) ?? [];
      if (list.length < NEEDED && !gold[it.id] && !leased.has(it.id) && !list.some((a) => a.who === who)) ids.push(it.id);
    }
    if (!ids.length) { this.finish(t); return null; }
    const checks = Object.keys(gold).filter((id) => !(ans.get(id) ?? []).some((a) => a.who === who));
    if (checks.length) ids.splice(Math.floor(Math.random() * (ids.length + 1)), 0, checks[Math.floor(Math.random() * checks.length)]);
    const byId = new Map(this.items.get(t.id).map((i) => [i.id, i]));
    return this.lease(key, { piece: "tag", taskId: t.id, ids, title: t.title, labels: t.params.labels, instructions: t.params.instructions, plainLang: t.params.plainLang ?? "English",
      items: ids.map((id) => { const i = byId.get(id); return { id, title: i.title, text: i.text, meta: i.meta }; }) });
  }

  searchPiece(t) {
    const progs = this.programs.get(t.id) ?? [];
    const proven = progs.filter((p) => p.reproduced).sort((a, b) => b.score - a.score);
    const examples = (proven.length ? proven.slice(0, 2) : [{ code: apfree.SEED_PROGRAM, score: null }]).map((p) => ({ code: p.code, score: p.score }));
    const unproven = progs.filter((p) => !p.reproduced);
    const check = unproven.length ? unproven[Math.floor(Math.random() * unproven.length)] : null;
    const rec = this.records.get(t.id);
    return { piece: "search", taskId: t.id, title: t.title, family: t.params.family, N: t.params.N, instructions: apfree.INSTRUCTIONS, examples,
      check: check ? { id: check.id, code: check.code } : null, best: rec?.score ?? null, known: apfree.KNOWN_BEST[t.params.N] ?? null };
  }

  reviewPiece(t) {
    // A refinement is compared with its parent too: "the same as before" is not a refinement.
    const family = new Set([t.id, ...[...this.tasks.values()].filter((x) => t.parent && x.parent === t.parent && x.id !== t.id).map((x) => x.id)]);
    const candidates = this.kb.search(`${t.title} ${t.question}`, 5, (e) => family.has(e.id)).map(({ id, title, question, status }) => ({ id, title, question, status }));
    return { piece: "review", taskId: t.id, proposal: publicTask(t), candidates, criteria: CRITERIA };
  }

  proposePiece() {
    const used = new Set([...this.tasks.values()].map((t) => t.seed).filter(Boolean));
    const open = SEED.filter((e) => e.status === "open" && !used.has(e.id));
    if (!open.length) return null;
    const seed = open[Math.floor(Math.random() * open.length)];
    return { piece: "propose", seed: { id: seed.id, title: seed.title, question: seed.question, field: seed.field, url: seed.url } };
  }

  refinePiece(t) { return { piece: "refine", taskId: t.id, target: publicTask(t) }; }

  // ---- handing work in ---------------------------------------------------------

  async done(who, m, slot = "") {
    await this.load();
    if (m?.piece === "tag") return this.doneTag(who, m, slot ? `${who}#${slot}` : who);
    if (m?.piece === "search") return this.doneSearch(who, m);
    if (m?.piece === "review") return this.doneReview(who, m);
    if (m?.piece === "propose" || m?.piece === "refine") return this.doneProposals(who, m);
    return null;
  }

  doneTag(who, m, key = who) {
    const lease = this.leases.get(key);
    if (!lease || lease.piece !== "tag" || lease.taskId !== m.taskId || !Array.isArray(m.answers)) return null;
    this.leases.delete(key);
    const t = this.tasks.get(m.taskId), ans = this.answersOf(t.id), gold = t.id === "council" ? COUNCIL_GOLD : {};
    let taken = 0, checkOk = 0, checkBad = 0;
    for (const a of m.answers.slice(0, BATCH)) {
      const id = String(a?.id ?? "");
      if (!lease.ids.includes(id) || !(a.label in t.params.labels)) continue;
      if (gold[id]) { const ok = gold[id] === a.label; ok ? checkOk++ : checkBad++; this.credit(who, ok); }
      const list = ans.get(id) ?? [];
      if (list.length >= NEEDED || list.some((x) => x.who === who)) continue;
      list.push({ who, label: a.label, plain: clean(a.plain, 200), place: clean(a.place, 60) });
      ans.set(id, list); this.store.put(`ans:${t.id}:${id}`, list); taken++;
    }
    const p = this.progress(t);
    if (p.done >= p.total) this.finish(t);
    return { piece: "tag", taskId: t.id, taken, checkOk, checkBad, ...p };
  }

  async doneSearch(who, m) {
    const t = this.tasks.get(m.taskId);
    if (!t || t.kind !== "search" || t.status !== "active") return null;
    const out = { piece: "search", taskId: t.id, valid: false };
    // A rerun of someone else's program: does it give what its author claimed?
    if (m.check?.id) {
      const progs = this.programs.get(t.id) ?? [], p = progs.find((x) => x.id === m.check.id);
      if (p && !p.reproduced && p.who !== who) {
        const v = apfree.verify(t.params.N, m.check.set);
        if (v.ok && v.score === p.score) { p.reproduced = true; this.credit(p.who, true, 2); out.reproduced = true; }
        else { progs.splice(progs.indexOf(p), 1); this.credit(p.who, false); out.reproduced = false; }
        this.store.put(`prog:${t.id}`, progs);
      }
    }
    const v = apfree.verify(t.params.N, m.set);
    if (!v.ok) { out.why = v.why; return out; }
    out.valid = true; out.score = v.score;
    const code = clean(String(m.code ?? "").replace(/\s+/g, " "), apfree.MAX_CODE);
    if (code.includes("priority")) {
      const progs = this.programs.get(t.id) ?? [];
      if (!progs.some((p) => p.code === code)) {
        progs.push({ id: `${this.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, code: String(m.code).slice(0, apfree.MAX_CODE), score: v.score, who, reproduced: false });
        progs.sort((a, b) => b.score - a.score || (b.reproduced - a.reproduced));
        this.programs.set(t.id, progs.slice(0, 12)); this.store.put(`prog:${t.id}`, this.programs.get(t.id));
      }
    }
    const rec = this.records.get(t.id);
    if (!rec || v.score > rec.score) {
      const r = { score: v.score, set: v.set, who, at: this.now(), history: [...(rec?.history ?? []), { score: v.score, at: this.now() }].slice(-50) };
      this.records.set(t.id, r); this.store.put(`rec:${t.id}`, r);
      out.record = true;
      const known = apfree.KNOWN_BEST[t.params.N];
      this.decide(t, known && v.score >= known ? "done" : "active", `New record ${v.score}${known ? ` (best known: ${known})` : ""}.`, [{ set: v.set.join(" ") }]);
    }
    out.best = this.records.get(t.id).score; out.known = apfree.KNOWN_BEST[t.params.N] ?? null;
    return out;
  }

  // Reviews: every claim must point at evidence. External quotes are fetched
  // and checked here; a quote that is not in its source costs reputation.
  async doneReview(who, m) {
    const t = this.tasks.get(m.taskId);
    if (!t || t.status !== "review" || t.proposer === who || t.reviews.some((r) => r.who === who) || t.reviews.length >= this.reviewsNeeded()) return null;
    const piece = this.reviewPiece(t), allowed = new Set(piece.candidates.map((c) => c.id));
    const verdicts = [];
    for (const v of (Array.isArray(m.verdicts) ? m.verdicts : []).slice(0, 10)) {
      const judgement = clean(v?.judgement, 12);
      if (v?.source === "kb") {
        if (!allowed.has(v.ref) || !["same", "overlap", "different"].includes(judgement)) continue;
        verdicts.push({ source: "kb", ref: v.ref, judgement });
      } else if (v?.source === "wikipedia" || v?.source === "openalex") {
        if (!["solved", "related", "unrelated"].includes(judgement)) continue;
        const url = clean(v.url, 300), quote = clean(v.quote, 240);
        // Only "solved" decides anything, so only its quote is checked (and can cost reputation).
        const verified = judgement === "solved" ? await this.checkQuote(v.source, url, quote) : null;
        if (verified !== null) this.credit(who, verified);
        verdicts.push({ source: v.source, url, quote, judgement, verified });
      }
    }
    const criteria = {};
    for (const k of Object.keys(CRITERIA)) criteria[k] = { yes: !!m.criteria?.[k]?.yes, why: clean(m.criteria?.[k]?.why, 200) };
    t.reviews.push({ who, at: this.now(), verdicts, criteria, model: clean(m.model, 48) });
    await this.saveTask(t);
    if (t.reviews.length >= this.reviewsNeeded()) this.conclude(t);
    return { piece: "review", taskId: t.id, counted: verdicts.length, reviews: t.reviews.length, status: t.status };
  }

  async checkQuote(source, url, quote) {
    if (quote.length < 12) return false;
    try {
      let text = "";
      if (source === "wikipedia") {
        const title = decodeURIComponent((/^https:\/\/en\.wikipedia\.org\/wiki\/([^#?]+)/.exec(url) ?? [])[1] ?? "");
        if (!title) return false;
        const r = await this.fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { headers: { "User-Agent": USER_AGENT } });
        if (r.status === 404) return false;
        if (!r.ok) return null; // could not check: neither true nor false
        text = (await r.json()).extract ?? "";
      } else {
        const id = (/openalex\.org\/(W\d+)/.exec(url) ?? [])[1];
        if (!id) return false;
        const r = await this.fetch(`https://api.openalex.org/works/${id}?select=title,abstract_inverted_index`, { headers: { "User-Agent": USER_AGENT } });
        if (r.status === 404) return false;
        if (!r.ok) return null;
        const w = await r.json(), words = [];
        for (const [k, pos] of Object.entries(w.abstract_inverted_index ?? {})) for (const p of pos) words[p] = k;
        text = `${w.title} ${words.filter(Boolean).join(" ")}`;
      }
      return norm(text).includes(norm(quote));
    } catch { return null; }
  }

  // Three reviews in: duplicate, already solved, failing the criteria, or on to the ballot.
  conclude(t) {
    const R = t.reviews;
    const sameVotes = {};
    for (const r of R) for (const v of r.verdicts) if (v.source === "kb" && v.judgement === "same") sameVotes[v.ref] = (sameVotes[v.ref] ?? 0) + 1;
    const half = Math.ceil(R.length / 2 + 0.01);
    const dup = Object.entries(sameVotes).find(([, n]) => n >= Math.min(2, half));
    if (dup) { const e = this.tasks.get(dup[0]) ?? SEED.find((s) => s.id === dup[0]); return this.decide(t, "rejected", `${dup[0] === t.parent ? "No real change from" : "Duplicate of"} "${e?.title ?? dup[0]}" (${dup[1]} of ${R.length} reviewers).`, [{ ref: dup[0], url: e?.url }]); }
    const solvedBy = R.filter((r) => r.verdicts.some((v) => v.judgement === "solved" && v.verified));
    if (solvedBy.length >= 2) {
      const ev = solvedBy.flatMap((r) => r.verdicts.filter((v) => v.judgement === "solved" && v.verified)).map(({ url, quote }) => ({ url, quote }));
      return this.decide(t, "rejected", `Already answered elsewhere, with checked quotes from ${solvedBy.length} reviewers.`, ev);
    }
    const passed = Object.keys(CRITERIA).filter((k) => R.filter((r) => r.criteria[k]?.yes).length >= Math.min(2, R.length));
    if (passed.length < 3) return this.decide(t, "rejected", `Meets only ${passed.length} of 4 criteria (${passed.join(", ") || "none"}).`, R.map((r) => ({ criteria: r.criteria })));
    return this.decide(t, "ballot", `Novel by ${R.length} reviews, meets ${passed.length} of 4 criteria. Now up for the players' vote.`);
  }

  async doneProposals(who, m) {
    const list = (Array.isArray(m.proposals) ? m.proposals : [m.proposal]).filter(Boolean).slice(0, 4);
    const parent = m.piece === "refine" ? this.tasks.get(m.taskId) : null;
    if (m.piece === "refine" && !parent) return null;
    if (!this.isOpen() && !parent) return { piece: m.piece, created: [], why: "proposals are not open yet" };
    const created = [];
    for (const p of list) created.push(await this.propose(who, p, { origin: "villager", parent: parent?.id ?? null, seed: m.seed ?? null }));
    return { piece: m.piece, created: created.map((t) => ({ id: t.id, title: t.title, status: t.status, decided: t.decided })) };
  }

  // ---- proposals and the gate --------------------------------------------------

  async propose(who, p, { origin = "player", parent = null, seed = null } = {}) {
    const t = {
      id: `p${(++this.meta.seq).toString(36)}`, kind: p?.kind === "search" ? "search" : "tag", title: clean(p?.title, 120), question: clean(p?.question, 400),
      params: {}, status: "draft", origin, proposer: who, parent, seed: clean(seed, 60) || null, created: this.now(), reviews: [], votes: {}, weight: 0,
    };
    await this.store.put("meta", this.meta);
    const why = await this.gate(t, p ?? {});
    this.tasks.set(t.id, t);
    if (why) this.decide(t, "rejected", `Gate: ${why}`);
    else this.decide(t, "review", `Passed the gate${parent ? ` as a ${origin === "villager" ? "refinement" : "variant"} of ${parent}` : ""}. Needs ${this.reviewsNeeded()} reviews.`);
    return t;
  }

  async gate(t, p) {
    if (t.title.length < 8) return "the title is too short";
    if (t.question.length < 20) return "the question is too short";
    if (t.kind === "search") {
      const N = Number(p.params?.N);
      if (p.params?.family !== "apfree") return "the only search family is apfree";
      if (!Number.isInteger(N) || N < 50 || N > 2000) return "N must be a whole number from 50 to 2000";
      if ([...this.tasks.values()].some((x) => x.kind === "search" && x.params.N === N && x.status !== "rejected")) return `N = ${N} is already a task`;
      t.params = { family: "apfree", N };
      return null;
    }
    const raw = p.params?.labels ?? {};
    const labels = {};
    for (const [k, v] of Array.isArray(raw) ? raw.map((x) => [x, x]) : Object.entries(raw)) {
      const key = norm(k).replace(/ /g, "_").slice(0, 30);
      if (key) labels[key] = clean(String(v), 120) || key;
    }
    const n = Object.keys(labels).length;
    if (n < 2 || n > 6) return "a tag task needs 2 to 6 labels";
    const instructions = clean(p.params?.instructions, 400);
    if (instructions.length < 20) return "the instructions are too short";
    const adapter = p.params?.adapter;
    if (!["openalex", "oparl"].includes(adapter)) return "the source must be openalex or oparl";
    const params = adapter === "openalex" ? { query: clean(p.params?.query, 160) } : { url: clean(p.params?.url, 300) };
    try {
      const sample = await ADAPTERS[adapter](params, 20, this.fetch);
      if (sample.length < 15) return `the source returned only ${sample.length} usable items`;
    } catch (e) { return `the source failed: ${e.message}`; }
    t.params = { adapter, ...params, labels, instructions, plainLang: "English" };
    return null;
  }

  // ---- votes and promotion -----------------------------------------------------

  async vote(who, id) {
    await this.load();
    const t = this.tasks.get(id);
    if (!this.isOpen()) return { ok: false, why: "voting opens when enough players are here" };
    if (!t || t.status !== "ballot") return { ok: false, why: "not on the ballot" };
    if (t.votes[who]) return { ok: false, why: "already voted for this" };
    const week = Math.floor(this.now() / (7 * DAY_MS)), b = this.budget.get(who);
    const used = b?.week === week ? b.used : 0;
    if (used >= 3) return { ok: false, why: "no votes left this week" };
    this.budget.set(who, { week, used: used + 1 });
    t.votes[who] = this.weightOf(who);
    t.weight = Object.values(t.votes).reduce((s, w) => s + w, 0);
    await this.saveTask(t);
    await this.promote();
    return { ok: true, weight: t.weight, left: 2 - used };
  }

  async promote() {
    const active = [...this.tasks.values()].filter((t) => t.status === "active" && t.origin !== "curated").length;
    if (active >= MAX_ACTIVE) return;
    const top = [...this.tasks.values()].filter((t) => t.status === "ballot" && t.weight >= this.voteMin).sort((a, b) => b.weight - a.weight)[0];
    if (!top) return;
    this.decide(top, "active", `Chosen by the players with vote weight ${top.weight.toFixed(1)}.`);
    if (top.kind === "tag") await this.loadItems(top).catch((e) => this.decide(top, "rejected", `Could not fetch its items: ${e.message}`));
  }

  async loadItems(t) {
    if (this.items.has(t.id)) return;
    if (t.params.adapter === "bundled") { this.items.set(t.id, COUNCIL.map((c) => ({ id: c.id, title: c.title, text: "", meta: `${c.kind}, ${c.body}`, url: c.url }))); return; }
    const cached = await this.store.get(`items:${t.id}`);
    const items = cached ?? await ADAPTERS[t.params.adapter](t.params, 200, this.fetch);
    if (!cached) await this.store.put(`items:${t.id}`, items);
    this.items.set(t.id, items);
  }

  progress(t) {
    const total = this.items.get(t.id)?.length ?? 0, ans = this.answersOf(t.id);
    let done = 0;
    for (const [, l] of ans) if (l.length >= NEEDED) done++;
    return { done, total };
  }
  finish(t) { if (t.status === "active") this.decide(t, "done", "Every item has three answers."); }

  // ---- what people see -------------------------------------------------------------

  board() {
    const list = [...this.tasks.values()].sort((a, b) => b.created - a.created).map((t) => ({
      ...publicTask(t), status: t.status, origin: t.origin, decided: t.decided ?? "", reviews: t.reviews.length, weight: Math.round(t.weight * 10) / 10,
      progress: t.kind === "tag" ? this.progress(t) : null,
      record: t.kind === "search" ? { best: this.records.get(t.id)?.score ?? null, known: apfree.KNOWN_BEST[t.params.N] ?? null, programs: (this.programs.get(t.id) ?? []).length } : null,
    }));
    return { open: this.isOpen(), players: this.players(), openAt: this.openAt, voteMin: this.voteMin, tasks: list.slice(0, 60), log: this.log.slice(-40).reverse() };
  }

  results() {
    const tasks = [];
    for (const t of this.tasks.values()) {
      if (t.kind === "tag" && this.items.has(t.id)) {
        const byId = new Map(this.items.get(t.id).map((i) => [i.id, i])), out = [];
        for (const [id, l] of this.answersOf(t.id)) {
          if (l.length < NEEDED || (t.id === "council" && COUNCIL_GOLD[id])) continue;
          const votes = {};
          for (const a of l) votes[a.label] = (votes[a.label] ?? 0) + 1;
          const [label, n] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
          const i = byId.get(id);
          out.push({ id, title: i?.title, url: i?.url, label: n >= 2 ? label : null, agreement: `${n}/${NEEDED}`, plain: l.find((a) => a.label === label && a.plain)?.plain ?? "" });
        }
        tasks.push({ id: t.id, kind: "tag", title: t.title, question: t.question, labels: t.params.labels, status: t.status, ...this.progress(t), items: out });
      } else if (t.kind === "search") {
        const r = this.records.get(t.id);
        tasks.push({ id: t.id, kind: "search", title: t.title, question: t.question, status: t.status, N: t.params.N, best: r?.score ?? null, known: apfree.KNOWN_BEST[t.params.N] ?? null, set: r?.set ?? null, history: r?.history ?? [], programs: (this.programs.get(t.id) ?? []).map(({ code, score, reproduced }) => ({ code, score, reproduced })) });
      }
    }
    return { sources: { council: "München Transparent OParl (Code for Munich)", openalex: "OpenAlex", kb: "Wikipedia lists of unsolved problems (CC BY-SA)" }, tasks, log: this.log.slice().reverse() };
  }
}

function publicTask(t) { return { id: t.id, kind: t.kind, title: t.title, question: t.question, params: t.kind === "tag" ? { adapter: t.params.adapter, query: t.params.query, labels: t.params.labels, instructions: t.params.instructions } : t.params, parent: t.parent }; }
function entryOf(t) { return { id: t.id, title: t.title, question: t.question, status: t.status === "done" ? "solved" : t.status === "rejected" ? "rejected" : "open", field: "village", url: "" }; }
