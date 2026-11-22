import { buildWorld, dayPhase, placeAt, setDayMs, T, DAY_MS, roomAt } from "./shared/world.js";
import { rollCharacter, rollField, AXES, voiceStance, publicProfile, fitJob, generation } from "./shared/traits.js";
import { Renderer, portrait, TILE } from "./render.js";
import { PRESETS, OpenAIMind, BROWSER_MODELS, browserMind, forgetOldModels, ChromeMind, PuppetMind, extractJSON, shared, fullGpu } from "./models.js";
import { Brain } from "./brain.js";
import { PIECE_LABEL } from "./work.js";
import { NEEDS, levelFor, titleFor, workplace } from "./shared/life.js";
import * as audio from "./audio.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(`omen:${k}`)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`omen:${k}`, JSON.stringify(v)); } catch { /* private mode */ } },
};
const OMEN_GAP = 12000;

const world = buildWorld();
const R = new Renderer($("#village"), world);
R.scale = R.fitScale();

let ws = null, you = null, role = "watch", agents = [], places = [], weather = "clear";
let clock = { now: 0, at: performance.now() };
// A soul is a character plus the memories its mind keeps on this device.
const newSoul = () => ({ ...rollCharacter(), id: crypto.randomUUID() });
let brain = null, mind = null, character = store.get("character", null) ?? newSoul();
if (!character.id) character.id = crypto.randomUUID();
const soulMemory = () => store.get(`soul:${character.id}`, null);
let lastOmen = 0, thoughtShown = null;

// ---- the household: every villager this device brings ------------------------
// One connection, one shared model, up to four villagers. `sel` is the one
// whose panel, voice and needs are shown; `ctx` is whose hook is running, so
// the rendering helpers below write into that villager's own lists.
const household = new Map();   // soul id -> member
let sel = null, ctx = null;
const device = store.get("device", null) ?? crypto.randomUUID();
store.set("device", device);
const member = () => ctx ?? sel;
function run(M, fn) {
  const prev = [character, brain, ctx];
  character = M.character; brain = M.brain; ctx = M;
  try { return fn(); } finally { [character, brain, ctx] = prev; }
}
const isMine = (agentId) => [...household.values()].some((M) => M.id === agentId);
// The server may run the clock faster (a sleeping village at night), so the
// local estimate between updates runs at the server's speed.
const gameNow = () => clock.now + (performance.now() - clock.at) * (clock.speed ?? 1);
let animals = [];

// ---- connection --------------------------------------------------------------

function connect() {
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  ws.onopen = () => hello();
  ws.onmessage = (m) => onMessage(JSON.parse(m.data));
  ws.onclose = () => { you = null; setTimeout(connect, 2000); setState("lost", "error"); };
}
// The server takes one hello per connection, so joining after watching opens a new one.
function rejoin() { if (ws) { ws.onclose = null; ws.close(); } connect(); }
function send(m) { if (ws?.readyState === 1) ws.send(JSON.stringify(m)); }
function hello() {
  send({ t: "hello", role: role === "mortal" ? "household" : "watch", device });
  // After a reconnect the server has forgotten them: everyone steps in again.
  for (const M of household.values()) { M.id = null; joinVillage(M); }
}
function joinVillage(M) {
  const lvl = levelFor(M.brain.m.life.xp ?? 0);
  send({ t: "join", profile: publicProfile(M.character, { level: lvl, title: titleFor(lvl), returning: (M.brain.m.days ?? 0) > 0, soul: M.character.id }), mind: mind?.label });
}

const byAgent = (id) => [...household.values()].find((M) => M.id === id) ?? (household.size === 1 ? sel : null);

function onMessage(m) {
  if (m.t === "welcome") {
    places = m.places;
    setDayMs(m.dayMs);
    clock = { now: m.now, at: performance.now() };
    if (m.board) boardView(m.board);

    agents = m.agents; R.sync(agents);
    for (const e of m.chronicle) chronicle(e, false);
  } else if (m.t === "state") {
    clock = { now: m.now, at: performance.now(), speed: m.speed ?? 1 };
    agents = m.agents; R.sync(agents);
    animals = m.animals ?? []; R.syncAnimals(animals);
    weather = m.weather ?? "clear";
    for (const M of household.values()) if (M.id) M.brain.setState(m.now, agents, M.id, weather, animals);
    $("#souls").textContent = agents.length;
    $("#souls-word").textContent = agents.length === 1 ? "soul" : "souls";
  } else if (m.t === "event") {
    for (const M of household.values()) if (M.id) M.brain.perceive(m.e);
    if ((m.e.kind === "do" || m.e.kind === "sleep") && audio.soundOn()) {
      const a = agents.find((x) => x.id === m.e.who);
      if (a) { const { gain, pan } = heard(a.x, a.y); audio.interact(m.e.place, gain, pan); }
    }
    chronicle(m.e, true);
    if (m.e.kind === "omen" && !isMine(m.e.who)) audio.omen(m.e.hearers?.includes(you));
    if (m.e.kind === "animal") {
      R.react(m.e.animal, m.e.act);
      const a = animals.find((x) => x.id === m.e.animal);
      if (a && audio.soundOn()) { const { gain, pan } = heard(a.x, a.y); audio.animal(a.kind, m.e.act === "grumpy" ? "grumpy" : "happy", gain, pan); }
    }
  } else if (m.t === "joined") {
    // The server answers joins in order; the first member still waiting gets this id.
    const M = [...household.values()].find((x) => !x.id);
    if (!M) return;
    if (!m.ok) { household.delete(M.character.id); M.brain.stop(); M.innerEl.remove?.(); switcher(); return; }
    M.id = m.you;
    if (M === sel) { you = M.id; R.follow = you; $("#follow").setAttribute("aria-pressed", "true"); }
    run(M, () => setState("awake"));
    switcher();
  }
  else if (m.t === "arrived") byAgent(m.who)?.brain.arrived();
  else if (m.t === "work" || m.t === "work.paid") byAgent(m.who)?.brain.reply(m);
  else if (m.t === "board") boardView(m.board);
  else if (m.t === "voted") { const M = byAgent(m.who) ?? sel; if (!m.ok && M) run(M, () => inner(`<li class="err">${esc(m.why)}</li>`)); }
  else if (m.t === "proposed") { const st = $("#propose-status"); if (st) st.textContent = m.ok ? "It passed the clerk's check and is now under review." : `Turned away: ${m.why}`; }
  else if (m.t === "full") status("The village is full. Try again later, or only watch.", "bad");
}

// ---- the making --------------------------------------------------------------

function renderCharacter() {
  const c = character;
  $("#c-name").textContent = c.name;
  $("#c-age").textContent = `${c.age} (${generation(c.age).name.replace(/^an? /, "").replace(/ \(.*\)| adult| young adult/g, "")}),`;
  $("#c-job").textContent = c.job;
  const lived = soulMemory()?.days ?? 0;
  $("#c-lived").hidden = !lived;
  $("#c-lived").textContent = `Has lived ${lived} ${lived === 1 ? "day" : "days"} in Hollowmere and remembers them. Rolling a new soul starts over.`;
  for (const f of ["desire", "fear", "secret", "quirk", "speech"]) $(`#c-${f}`).textContent = c[f];
  $("#c-stance").textContent = voiceStance(c);
  $("#axes").innerHTML = AXES.map((a) => {
    const v = c.axes[a.id];
    const pips = Array.from({ length: 11 }, (_, i) => `<i class="${i <= v ? "on" : ""}"></i>`).join("");
    return `<div class="axis ${a.id === "faith" || a.id === "obedience" ? "key" : ""}" title="${a.id}: ${v} of 10">
      <span class="lo ${v <= 3 ? "lit" : ""}">${a.lo}</span><span class="pips">${pips}</span><span class="hi ${v >= 7 ? "lit" : ""}">${a.hi}</span></div>`;
  }).join("");
  portrait($("#portrait"), c.look);
  store.set("character", c);
  $("#begin").textContent = adding ? `Add ${first(c.name)} to the household` : soulMemory() ? `Return as ${first(c.name)}` : `Breathe life into ${first(c.name)}`;
  soulList();
}
const first = (n) => String(n).split(" ")[0];

document.addEventListener("click", (e) => {
  const d = e.target.closest("[data-roll]");
  if (!d || (role === "mortal" && !adding)) return;
  if (soulMemory()) character = { ...character, id: crypto.randomUUID() }; // a lived soul stays as it was
  character[d.dataset.roll] = rollField(d.dataset.roll);
  fitJob(character);
  renderCharacter();
});
$("#reroll").onclick = () => { character = newSoul(); renderCharacter(); };

// `picked` is only ever what the player chose. Until they choose, nothing on
// their machine is contacted (a localhost probe makes Chrome ask for network access).
const mindPref = store.get("mind", { bases: {}, model: "", webllm: "" });
function mindKind() { return document.querySelector('input[name="mind"]:checked').value; }
function showMindPane(byPlayer = false) {
  const k = mindKind(), server = k in PRESETS;
  document.querySelectorAll(".mind-pane").forEach((p) => (p.hidden = p.dataset.for !== (server ? "server" : k)));
  if (server) {
    $("#base").value = mindPref.bases[k] ?? PRESETS[k].base;
    $("#server-hint").textContent = PRESETS[k].hint;
    scan();
  }
  if (k === "webllm") loadTabModels();
  if (k === "chrome") ChromeMind.available().then((a) => {
    $("#chrome-hint").textContent = a === "available" ? "Gemini Nano is ready in this browser." :
      a === "downloadable" || a === "downloading" ? "Chrome will download Gemini Nano first (about 2 GB)." :
      "Not available here. Needs desktop Chrome with the Prompt API turned on.";
  });
  status("");
  if (byPlayer) { mindPref.picked = k; store.set("mind", mindPref); }
}
let pickedNow = false;
document.querySelectorAll('input[name="mind"]').forEach((r) => (r.onchange = () => { pickedNow = true; showMindPane(true); }));

// Best mind that needs nothing installed: a model in the tab on WebGPU, then
// Chrome's built-in one, then the puppet.
async function bestMind() {
  try { if (navigator.gpu && (await navigator.gpu.requestAdapter())) return "webllm"; } catch { /* no GPU */ }
  if ((await ChromeMind.available()) !== "unavailable") return "chrome";
  return "puppet";
}
async function chooseMind() {
  const k = mindPref.picked ?? (await bestMind());
  if (pickedNow) return; // the player chose while we were looking
  const r = document.querySelector(`input[name="mind"][value="${k}"]`);
  if (r) r.checked = true;
  showMindPane();
}

let scanSeq = 0;
async function scan() {
  const k = mindKind(), base = $("#base").value.trim(), seq = ++scanSeq;
  mindPref.bases[k] = base; store.set("mind", mindPref);
  status("Looking…");
  try {
    const ids = await OpenAIMind.listModels(base, $("#key").value.trim());
    if (seq !== scanSeq) return;
    $("#model").innerHTML = ids.length ? ids.map((id) => `<option ${id === mindPref.model ? "selected" : ""}>${esc(id)}</option>`).join("") : `<option value="">no models loaded</option>`;
    status(ids.length ? `Found ${ids.length} model${ids.length > 1 ? "s" : ""}.` : "The server answered, but no model is loaded.", ids.length ? "ok" : "bad");
  } catch (err) {
    if (seq !== scanSeq) return;
    $("#model").innerHTML = `<option value="">none found</option>`;
    status(`Could not reach ${base}. Is it running, with CORS allowed? ${PRESETS[k].hint}.`, "bad");
  }
}
$("#scan").onclick = scan;
$("#base").onchange = scan;
$("#model").onchange = () => { mindPref.model = $("#model").value; store.set("mind", mindPref); };

let webllmListed = false;
async function loadTabModels() {
  if (webllmListed) return;
  let gpu = null;
  try { gpu = await navigator.gpu?.requestAdapter(); } catch { /* none */ }
  if (!gpu) { $("#webllm-model").innerHTML = "<option value=''>No usable GPU in this browser</option>"; return; }
  // Models already loaded once in this browser need no download.
  const have = (id) => { try { return !!localStorage.getItem(`omen:have:${id}`); } catch { return false; } };
  // On the CPU the 2B model needs about 2 GB of tab memory, more than Android gives.
  const rec = fullGpu(gpu) ? 0 : BROWSER_MODELS.length - 1;
  $("#webllm-model").innerHTML = BROWSER_MODELS.map((m, i) =>
    `<option value="${esc(m.id)}">${esc(m.label)} · ${esc(m.by)} · ${have(m.id) ? "downloaded" : `${m.gb.toFixed(1)} GB`}${i === rec ? " · recommended" : m.note ? ` · ${esc(m.note)}` : ""}</option>`).join("");
  $("#webllm-model").value = BROWSER_MODELS.some((m) => m.id === mindPref.webllm) ? mindPref.webllm : BROWSER_MODELS[rec].id;
  webllmListed = true;
}
$("#webllm-model").onchange = () => { mindPref.webllm = $("#webllm-model").value; store.set("mind", mindPref); };

function status(text, cls = "") { const s = $("#mind-status"); s.className = `status ${cls}`; s.textContent = text; }
function progress(p, text) { $("#mind-status").className = "status"; $("#mind-status").innerHTML = `${esc(text ?? "")}<br><progress max="1" value="${p}"></progress>`; }

$("#begin").onclick = async () => {
  // Adding to a household that already has a mind: no model to load.
  if (adding) { addMember(character); closeAdd(); return; }
  const k = mindKind(), btn = $("#begin");
  btn.disabled = true;
  try {
    if (k in PRESETS) {
      const model = $("#model").value;
      if (!model) throw new Error("Pick a model first. Load one in your server, then press Look for models.");
      mind = new OpenAIMind({ base: $("#base").value.trim(), model, key: $("#key").value.trim(), preset: k });
    } else if (k === "webllm") {
      const id = $("#webllm-model").value;
      if (!id) throw new Error("This browser cannot run a model in the tab.");
      mind = browserMind(id);
      await mind.load(progress);
    } else if (k === "chrome") {
      if ((await ChromeMind.available()) === "unavailable") throw new Error("Chrome's built-in model is not available in this browser.");
      mind = new ChromeMind();
      await mind.load(progress);
    } else mind = new PuppetMind();

    status(`Waking ${first(character.name)}…`);
    const t0 = performance.now();
    const probe = k === "puppet" ? '{"ok":true}' : await mind.complete("Reply with JSON only.", 'Reply exactly {"ok": true}', { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] });
    if (!extractJSON(probe)) throw new Error(`The model answered, but not in JSON: ${String(probe).slice(0, 80)}`);
    status(`Awake. First answer took ${((performance.now() - t0) / 1000).toFixed(1)} s.`, "ok");
    // One model for the whole household, taken in turns.
    mind = shared(mind, k in PRESETS ? 2 : 1);
    const before = store.get("household", []);
    enterGame();
    // The villagers who lived here with this one come back with them.
    for (const id of before) {
      if (household.size >= 4 || household.has(id)) continue;
      const rec = store.get(`soul:${id}`, null);
      if (rec?.character) addMember(rec.character);
    }
  } catch (err) {
    status(String(err.message ?? err).replace(/^Failed to fetch$/, "The model server refused the browser. Allow CORS, see the hint above."), "bad");
  } finally { btn.disabled = false; }
};

$("#watch").onclick = () => {
  if (adding) { closeAdd(); return; }
  $("#making").hidden = true;
  $("#watch-rail").hidden = false;
  document.body.classList.add("playing");
  $("#panel").hidden = false;
  R.resize();
};
$("#join-late").onclick = () => { $("#making").hidden = false; $("#watch-rail").hidden = true; document.body.classList.remove("playing"); R.resize(); };

// ---- playing -----------------------------------------------------------------

function enterGame() {
  role = "mortal";
  $("#making").hidden = true; $("#watch-rail").hidden = true; $("#rail").hidden = false;
  document.body.classList.add("playing");
  $("#panel").hidden = false;
  R.resize(); R.scale = R.fitScale();
  rejoin();
  addMember(character);
}

// One villager joins the household: its own brain, lists and memory.
function addMember(ch) {
  if (household.has(ch.id) || household.size >= 4) return;
  const M = { character: ch, id: null, innerEl: listLike("#inner"), diaryEl: listLike("#diary"), state: ["idle", ""], peek: "Nothing yet.", asleep: false, lastOmen: 0, thought: null, shiftEl: null };
  household.set(ch.id, M);
  const memory = store.get(`soul:${ch.id}`, null);
  const hook = (fn) => (...a) => run(M, () => fn(...a));
  M.brain = run(M, () => makeBrain(ch, memory, hook, M));
  if (!sel) select(M); else switcher();
  run(M, () => {
    diary(M.brain.m);
    inner(memory?.days
      ? `<li class="belief"><b>Returned</b>${esc(ch.name)} comes back along the road, remembering ${memory.days} ${memory.days === 1 ? "day" : "days"} in Hollowmere.</li>`
      : `<li class="belief"><b>Born</b>${esc(ch.name)} opens their eyes on the road into Hollowmere. They remember nothing before it.</li>`);
  });
  if (ws?.readyState === 1) joinVillage(M);
  store.set("household", [...household.keys()]);
}
// A fresh, detached copy of a panel list; it replaces the shown one when its villager is selected.
const LIST_TEMPLATE = { "#inner": $("#inner").cloneNode(false), "#diary": $("#diary").cloneNode(false) };
function listLike(which) { const o = LIST_TEMPLATE[which].cloneNode(false); o.removeAttribute("id"); o.hidden = which !== "#inner"; return o; }

function makeBrain(ch, memory, hook, M) {
  const character = ch, name = first(ch.name);
  const b = new Brain({
    character, mind, memory, send: (msg) => { if (M.id) send({ ...msg, who: M.id }); },
    hooks: Object.fromEntries(Object.entries({
      onShift: shiftView,
      onThinking: (on) => setState(on ? "thinking" : "awake", on ? "thinking" : ""),
      onDecision: decision,
      onError: (msg) => { setState("confused", "error"); inner(`<li class="err">${esc(msg)}</li>`); },
      onPrompt: (s, u) => { M.peek = `SYSTEM\n${s}\n\nNOW\n${u}`; if (M === sel) $("#peek").textContent = M.peek; },
      onSave: (m) => { store.set(`soul:${character.id}`, { ...m, character }); indexSoul(m); diary(m); },
      onLife: (life, lvl) => lifePanel(life, lvl),
      onLevel: (lvl, title, promoted) => inner(`<li class="belief level"><b>${promoted ? "New rank" : "Better at the trade"}</b>${esc(name)} ${promoted ? `is now a ${esc(title)} ${esc(character.job)}` : `grows better at being a ${esc(character.job)}`} (level ${lvl}).</li>`),
      onSleep: (how) => {
        setState("asleep", "asleep"); voiceLabel(true);
        const said = { collapsed: ["Collapsed", "could not keep their eyes open and sank down where they stood"], ill: ["Ill", "has fallen ill from neglect and lies feverish"] }[how] ?? ["Asleep", "lies down to sleep"];
        inner(`<li class="belief sleep"><b>${said[0]}</b>${esc(name)} ${said[1]}. The day is settling into memory.</li>`);
      },
      onDiary: (d) => inner(`<li class="belief diary"><b>Diary, day ${d.day}</b>${esc(d.text)}</li>`),
      onDream: (w) => inner(`<li class="turn voiced"><p class="heard">${esc(w)}</p><p class="did">reaches ${esc(name)} as a dream</p></li>`),
      onWake: () => { setState("awake"); voiceLabel(false); inner(`<li class="belief"><b>Awake</b>${esc(name)} wakes up.</li>`); },
    }).map(([k, fn]) => [k, hook(fn)])),
  });
  b.realWork = $("#realwork").checked;
  b.start();
  return b;
}

// Show one villager: their name, lists, needs, voice and camera.
function select(M) {
  const prev = sel;
  sel = M; character = M.character; brain = M.brain; you = M.id;
  for (const [old, nu] of [[prev?.innerEl ?? $("#inner"), M.innerEl], [prev?.diaryEl ?? $("#diary"), M.diaryEl]]) {
    if (old === nu) continue;
    nu.hidden = old.hidden;
    old.replaceWith(nu);
  }
  $("#r-name").textContent = M.character.name;
  portrait($("#rail-portrait"), M.character.look);
  const s = $("#r-state"); s.textContent = M.state[0]; s.className = `state ${M.state[1]}`;
  $("#peek").textContent = M.peek;
  lifeKey = ""; lifePanel(M.brain.m.life, M.brain.level());
  voiceLabel(M.asleep);
  if (M.id) { R.follow = M.id; $("#follow").setAttribute("aria-pressed", "true"); }
  store.set("character", M.character);
  switcher();
}

// Portraits of the household at the top of the panel, plus a way to add one.
function switcher() {
  const el = $("#household");
  if (!el) return;
  el.innerHTML = [...household.values()].map((M) => `<button class="who ${M === sel ? "on" : ""}" data-member="${esc(M.character.id)}" title="${esc(M.character.name)}${M.asleep ? ", asleep" : ""}"><canvas width="32" height="32"></canvas><span>${esc(first(M.character.name))}</span></button>`).join("")
    + (household.size < 4 ? `<button class="who add" id="add-member" title="Add a villager to this device">+</button>` : "");
  el.querySelectorAll("[data-member]").forEach((b) => portrait(b.querySelector("canvas"), household.get(b.dataset.member).character.look));
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-member]");
  if (b) { const M = household.get(b.dataset.member); if (M && M !== sel) select(M); return; }
  if (e.target.closest("#add-member")) openAdd();
});

// Adding: the making screen again, without the model choice (the household shares one).
let adding = false;
function openAdd() {
  adding = true;
  character = newSoul();
  for (const id of store.get("souls", []).map((s) => s.id)) if (!household.has(id) && store.get(`soul:${id}`, null)?.character) { character = store.get(`soul:${id}`).character; break; }
  renderCharacter();
  document.body.classList.add("adding");
  $("#making").hidden = false;
  $("#begin").textContent = `Add ${first(character.name)} to the household`;
  $("#watch").textContent = "Cancel";
}
function closeAdd() {
  adding = false;
  document.body.classList.remove("adding");
  $("#making").hidden = true;
  $("#watch").textContent = "Only watch";
  character = sel.character;
}

function voiceLabel(asleep) {
  const M = member();
  if (M) M.asleep = asleep;
  if (M && M !== sel) { switcher(); return; }
  $("#v-label").textContent = asleep ? "Send a dream" : "Speak into";
  $("#v-name").textContent = asleep ? `to ${first(character.name)}` : `${first(character.name)}'s`;
  $("#v-tail").textContent = asleep ? "" : " head";
}

// The Diary tab: what this soul keeps on this device, newest first.
// Needs, purse and rank in the side panel. The god's only instrument panel.
let lifeKey = "";
// 16 px pictograms in currentColor for the needs overlay.
const ICON = {
  hunger: '<path d="M3 7a5 4 0 0 1 10 0v5H3z" fill="currentColor"/><path d="M6 6v4M10 6v4" stroke="var(--color-tag)" stroke-width="1.2"/>',
  energy: '<path d="M10 2a6 6 0 1 0 4 10A5 5 0 0 1 10 2z" fill="currentColor"/>',
  social: '<circle cx="5" cy="5" r="2.2" fill="currentColor"/><circle cx="11" cy="5" r="2.2" fill="currentColor"/><path d="M1 13a4 4 0 0 1 8 0zM7 13a4 4 0 0 1 8 0z" fill="currentColor"/>',
  comfort: '<path d="M2 8l6-5 6 5v6H2z" fill="currentColor"/><path d="M7 14v-4h2v4" fill="var(--color-tag)"/>',
  purpose: '<path d="M8 1l2 5h5l-4 3 2 5-5-3-5 3 2-5-4-3h5z" fill="currentColor"/>',
  health: '<path d="M8 14S1 9.5 1 5.5A3.5 3.5 0 0 1 8 4a3.5 3.5 0 0 1 7 1.5C15 9.5 8 14 8 14z" fill="currentColor"/>',
  coin: '<circle cx="8" cy="8" r="6" fill="currentColor"/><circle cx="8" cy="8" r="3.5" fill="none" stroke="var(--color-tag)" stroke-width="1"/>',
};
function lifePanel(life, lvl) {
  if (member() && member() !== sel) return;
  const el = $("#life");
  const key = [...NEEDS.map((n) => Math.round(life[n.id])), Math.round(life.health), life.coins, lvl, life.years].join();
  if (!el || key === lifeKey) return;
  lifeKey = key;
  el.hidden = false;
  const bars = [...NEEDS.map((n) => [n.id, n.label, life[n.id]]), ["health", "health", life.health]].map(([id, label, v]) =>
    `<div class="need ${v <= 15 ? "crit" : v <= 35 ? "low" : ""}" title="${label}: ${Math.round(v)} of 100"><svg viewBox="0 0 16 16" aria-hidden="true">${ICON[id]}</svg><span class="sr">${label}</span><i><b style-w="${Math.round(v)}"></b></i></div>`).join("");
  el.innerHTML = `<div class="rank" title="${esc(titleFor(lvl))} ${esc(character.job)}, level ${lvl}. Works at the ${esc(workplace(character.job))}."><b>${lvl}</b><span>${esc(titleFor(lvl))} ${esc(character.job)}</span><em title="coins"><svg viewBox="0 0 16 16" aria-hidden="true">${ICON.coin}</svg>${life.coins}</em></div>${bars}`;
  // Widths go through the CSSOM: the page policy forbids style attributes.
  el.querySelectorAll("b[style-w]").forEach((b) => (b.style.width = `${b.getAttribute("style-w")}%`));
  $("#r-meta").textContent = `${character.age + (life.years ?? 0)}, ${character.job} · ${mind?.label ?? ""}`;
}

// Every soul ever made on this device, newest first, for the Return list.
function indexSoul(m) {
  const lvl = levelFor(m.life?.xp ?? 0);
  const list = store.get("souls", []).filter((s) => s.id !== character.id);
  list.unshift({ id: character.id, name: character.name, job: character.job, look: character.look, days: m.days, level: lvl, title: titleFor(lvl), seen: Date.now() });
  store.set("souls", list.slice(0, 12));
}
function soulList() {
  const souls = store.get("souls", []).filter((s) => store.get(`soul:${s.id}`, null));
  $("#souls-list").hidden = !souls.length;
  $("#souls-cards").innerHTML = souls.map((s) => `<li><canvas width="48" height="48" data-soul="${esc(s.id)}"></canvas>
    <div><b>${esc(s.name)}</b><span>${esc(s.title)} ${esc(s.job)} · level ${s.level} · ${s.days} ${s.days === 1 ? "day" : "days"} lived</span></div>
    <button class="ghost" data-return="${esc(s.id)}" ${household.has(s.id) ? "disabled" : ""}>${household.has(s.id) ? "Here now" : s.id === character.id ? "Selected" : "Return"}</button></li>`).join("");
  souls.forEach((s) => portrait($(`canvas[data-soul="${CSS.escape(s.id)}"]`), s.look));
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-return]");
  if (!b || (role === "mortal" && !adding) || household.has(b.dataset.return)) return;
  const rec = store.get(`soul:${b.dataset.return}`, null);
  if (!rec?.character) return;
  character = rec.character;
  renderCharacter();
  $("#begin").scrollIntoView({ block: "center", behavior: "smooth" });
});

function diary(m) {
  const days = [...m.diary].reverse().map((d) => `<li class="entry"><b>Day ${d.day}</b><p>${esc(d.text)}</p></li>`).join("");
  const ages = [...m.ages].reverse().map((a) => `<li class="entry ages"><b>Days ${a.from} to ${a.to}</b><p>${esc(a.text)}</p></li>`).join("");
  const people = Object.entries(m.people).map(([n, note]) => `<li><b>${esc(n)}</b> ${esc(note)}</li>`).join("");
  (member()?.diaryEl ?? $("#diary")).innerHTML = (days || ages || people || m.beliefs)
    ? `${m.beliefs ? `<li class="entry beliefs"><b>Believes</b><p>${esc(m.beliefs)}</p></li>` : ""}${days}${ages}${people ? `<li class="entry"><b>People</b><ul class="people">${people}</ul></li>` : ""}`
    : `<li class="hint">Nothing yet. The diary is written in sleep: when ${esc(first(character.name))} grows tired and lies down, the day becomes an entry here. ${m.memory.length} memories from today are waiting.</li>`;
}

// A shift of real work, live in Inner life: every step as the model takes it.
let shiftEl = null;
function shiftView(s) {
  if (s.phase === "start") {
    setState("working", "thinking");
    const p = s.piece, what = p.piece === "review" ? `reviewing "${p.proposal.title}"` : p.piece === "propose" ? `drafting a proposal from "${p.seed.title}"` : p.piece === "refine" ? `refining "${p.target.title}"` : p.title;
    inner(`<li class="turn shift"><div class="when"><span>real work · ${esc(PIECE_LABEL[p.piece])}</span><span class="n"></span></div><p class="task">${esc(what)}</p><ol class="papers"></ol></li>`);
    shiftEl = member().innerEl.firstElementChild;
  } else if (s.phase === "step" && shiftEl) {
    if (s.step) shiftEl.querySelector(".n").textContent = s.step;
    if (s.line) {
      const li = document.createElement("li");
      const [tag, title, note] = s.line;
      li.innerHTML = `<b>${esc(tag)}</b><span>${esc(title ?? "")}</span>${note ? `<em>${esc(note)}</em>` : ""}`;
      shiftEl.querySelector(".papers").append(li);
    }
  } else if (s.phase === "end" && shiftEl) {
    const r = s.paid;
    shiftEl.querySelector(".n").textContent = `${s.s} s`;
    const said = !r ? "Nobody at the archive took the work in; the shift was paid as usual."
      : r.piece === "tag" ? `${r.taken} items handed in${r.checkOk ? ", a check item right" : r.checkBad ? ", a check item wrong" : ""}. ${r.done} of ${r.total} settled by three villagers.`
      : r.piece === "search" ? (r.valid ? `Verified: ${r.score} numbers${r.record ? ", a new record" : ""}. Best ${r.best}${r.known ? ` of a known ${r.known}` : ""}.${r.reproduced === true ? " Reproduced someone else's program." : r.reproduced === false ? " Someone else's program did not hold up." : ""}` : `Not accepted: ${r.why ?? "no valid set"}.`)
      : r.piece === "review" ? `${r.counted} verdicts counted. ${r.reviews} of 3 reviews in; the proposal is now ${r.status}.`
      : r.created?.length ? r.created.map((c) => `"${c.title}": ${c.status === "review" ? "passed the gate, now under review" : c.decided}`).join(" ") : r.why ?? "No proposal came of it.";
    shiftEl.insertAdjacentHTML("beforeend", `<p class="did">${esc(said)}${s.bonus ? ` ${s.bonus > 0 ? "+" : ""}${s.bonus} coins.` : ""}</p>`);
    shiftEl = null;
    setState("awake");
  }
}

// ---- the village board: what work exists, what is proposed, what was decided ----

let board = null;
const STATUS = { review: "under review", ballot: "on the ballot", active: "being worked on", done: "done", rejected: "turned away", draft: "draft" };
function boardView(b) {
  board = b;
  const el = $("#board");
  if (!el || !b) return;
  const live = b.tasks.filter((t) => t.status === "active"), ballot = b.tasks.filter((t) => t.status === "ballot"), review = b.tasks.filter((t) => t.status === "review");
  const progress = (t) => t.progress ? `${t.progress.done} of ${t.progress.total} settled` : t.record ? `best ${t.record.best ?? "none"}${t.record.known ? ` of a known ${t.record.known}` : ""}` : "";
  const card = (t, extra = "") => `<li class="task ${t.status}"><b>${esc(t.title)}</b><span>${esc(t.question)}</span><small>${esc(STATUS[t.status])}${progress(t) ? ` · ${esc(progress(t))}` : ""}${t.origin !== "curated" ? ` · proposed by ${t.origin === "player" ? "a player" : "a villager"}` : ""}</small>${extra}</li>`;
  el.innerHTML = `
    <p class="hint">${b.open ? `Proposals and votes are open: ${b.players} players this week.` : `Proposals and votes open when ${b.openAt} players were here this week (now ${b.players}). Until then the village works on curated tasks.`} <a href="/delivered.html" target="_blank" rel="noopener">What the village delivered</a></p>
    <h3>Being worked on</h3><ol class="tasks">${live.map((t) => card(t)).join("") || "<li class='hint'>Nothing yet.</li>"}</ol>
    <h3>On the ballot</h3><ol class="tasks">${ballot.map((t) => card(t, `<button class="ghost vote" data-vote="${esc(t.id)}" ${b.open && role === "mortal" ? "" : "disabled"}>Vote · ${t.weight} of ${b.voteMin}</button>`)).join("") || "<li class='hint'>Nothing on the ballot.</li>"}</ol>
    <h3>Under review</h3><ol class="tasks">${review.map((t) => card(t, `<small>${t.reviews} of 3 reviews</small>`)).join("") || "<li class='hint'>Nothing under review.</li>"}</ol>
    ${b.open && role === "mortal" ? `<details class="propose"><summary>Propose a task</summary>
      <form id="propose-form"><label>Title<input name="title" maxlength="110" required></label>
      <label>The question it answers<textarea name="question" maxlength="380" rows="2" required></textarea></label>
      <label>Search words for papers (OpenAlex)<input name="query" maxlength="140" required></label>
      <label>Labels, comma separated<input name="labels" maxlength="120" value="relevant, not relevant, unclear" required></label>
      <label>How to label one abstract<textarea name="instructions" maxlength="380" rows="2" required></textarea></label>
      <button class="ghost" type="submit">Nail it to the board</button><p class="hint" id="propose-status"></p></form></details>` : ""}
    <h3>Decisions</h3><ol class="decisions">${b.log.slice(0, 20).map((e) => `<li><b>${esc(e.title)}</b> <span>${esc(STATUS[e.to] ?? e.to)}</span><em>${esc(e.reason)}</em></li>`).join("")}</ol>`;
}
document.addEventListener("click", (e) => {
  const v = e.target.closest("[data-vote]");
  if (v && role === "mortal") { v.disabled = true; send({ t: "vote", id: v.dataset.vote }); }
});
document.addEventListener("submit", (e) => {
  if (e.target.id !== "propose-form") return;
  e.preventDefault();
  const f = new FormData(e.target);
  send({ t: "propose", proposal: { kind: "tag", title: f.get("title"), question: f.get("question"), params: { adapter: "openalex", query: f.get("query"), labels: String(f.get("labels")).split(",").map((x) => x.trim()).filter(Boolean), instructions: f.get("instructions") } } });
  $("#propose-status").textContent = "The clerk is checking it…";
});

function setState(text, cls = "") {
  const M = member();
  if (M) M.state = [text, cls];
  if (M && M !== sel) return;
  const s = $("#r-state"); s.textContent = text; s.className = `state ${cls}`;
}

function inner(html) {
  const list = member()?.innerEl ?? $("#inner");
  list.insertAdjacentHTML("afterbegin", html);
  while (list.children.length > 60) list.lastElementChild.remove();
}

function decision(d) {
  const ph = dayPhase(gameNow()).label;
  const why = { eat: "to eat", work: "to work", socialize: "for company", rest: "to rest", pray: "to pray" }[d.intent];
  const did = d.action === "walk_to" ? `walks to ${esc(d.target)}${why ? ` ${why}` : ""}` : d.action === "do" ? esc(d.activity) : d.action === "sleep" ? "lies down to sleep" : "waits";
  inner(`<li class="turn ${d.voiceWords ? "voiced" : ""}">
    <div class="when"><span>${esc(ph)} · ${esc(d.mood)}</span><span>${(d.ms / 1000).toFixed(1)} s</span></div>
    ${d.voiceWords ? `<p class="heard">${esc(d.voiceWords)}</p>` : ""}
    <div class="part think"><b>thinks</b><p class="thought">${esc(d.thought)}</p></div>
    ${d.say ? `<div class="part say"><b>says${d.to ? ` to ${esc(d.to)}` : " aloud"}</b><p class="said">${esc(d.say)}</p></div>` : ""}
    <div class="part do"><b>does</b><p class="did">${did}</p></div>
    ${d.voiceWords ? `<span class="verdict ${esc(d.voice)}">${esc({ obey: "obeys", bargain: "bargains", doubt: "doubts", defy: "defies", hide: "hides it", none: "ignores it" }[d.voice] ?? d.voice)}</span>` : ""}
  </li>`);
  if (!d.say && d.thought) member().thought = { text: d.thought, until: performance.now() + 5000 };
}

const KIND_TIME = (e) => {
  const h = Math.floor(dayPhase(e.at).hour), m = Math.floor((dayPhase(e.at).hour % 1) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};
const seenSeq = new Set();
function chronicle(e, live) {
  if (seenSeq.has(e.seq)) return;
  seenSeq.add(e.seq);
  let html = "";
  if (e.kind === "say") html = `<b>${esc(first(e.name))}</b>${e.to ? ` to ${esc(e.to)}` : ""}: <q>${esc(e.text)}</q>`;
  else if (e.kind === "do") html = `${esc(first(e.name))} is ${esc(e.text)}`;
  else if (e.kind === "arrive") { if (!e.place) return; html = `${esc(first(e.name))} reached ${esc(e.place)}`; }
  else if (e.kind === "omen") html = `The air went cold around ${esc(e.name)}`;
  else if (["weather", "level", "work", "society", "animal", "time"].includes(e.kind)) html = esc(e.text);
  else if (e.kind === "sleep") html = `${esc(first(e.name))} lay down to sleep${e.place ? ` at ${esc(e.place)}` : ""}`;
  else if (e.kind === "wake") html = `${esc(first(e.name))} woke up`;
  else html = esc(e.text);
  const li = `<li class="${e.kind}"><time>${KIND_TIME(e)}</time><span>${html}</span></li>`;
  for (const id of ["#chron", "#chron-watch"]) {
    const list = $(id);
    list.insertAdjacentHTML("afterbegin", li);
    while (list.children.length > 120) list.lastElementChild.remove();
  }
}

document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => {
  document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
  document.querySelectorAll("#rail [data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== b.dataset.tab));
}));

// the voice
$("#voice").onsubmit = (e) => {
  e.preventDefault();
  const text = $("#voice-text").value.trim();
  if (!text || !sel || performance.now() - sel.lastOmen < OMEN_GAP) return;
  sel.lastOmen = performance.now();
  sel.brain.speak(text);
  send({ t: "omen", who: sel.id });
  $("#voice-text").value = "";
  const w = $("#voice-words");
  w.textContent = text; w.classList.remove("on"); void w.offsetWidth; w.classList.add("on");
  setTimeout(() => w.classList.remove("on"), 4700);
  document.body.classList.remove("omen-flash"); void document.body.offsetWidth; document.body.classList.add("omen-flash");
  setTimeout(() => document.body.classList.remove("omen-flash"), 4100);
  audio.omen(true);
};
$("#voice-text").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#voice").requestSubmit(); } });

$("#sound").onclick = () => {
  const on = $("#sound").getAttribute("aria-pressed") !== "true";
  $("#sound").setAttribute("aria-pressed", String(on));
  $("#sound").textContent = on ? "Sound on" : "Sound off";
  audio.setSound(on);
};

// ---- side panel: resizable, hideable, remembered ---------------------------

function railWidth(w) {
  const px = Math.round(Math.max(280, Math.min(innerWidth * 0.6, w)));
  document.documentElement.style.setProperty("--rail-w", `${px}px`);
  store.set("rail", px);
  R.resize();
}
function railShown(show) {
  document.body.classList.toggle("rail-off", !show);
  $("#panel").setAttribute("aria-pressed", String(show));
  $("#panel").textContent = show ? "Hide panel" : "Show panel";
  store.set("railShown", show);
  R.resize();
}
if (store.get("rail", 0)) railWidth(store.get("rail", 380));
railShown(store.get("railShown", true));
$("#panel").onclick = () => railShown(document.body.classList.contains("rail-off"));
addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "p" && !e.metaKey && !e.ctrlKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) && !$("#panel").hidden) $("#panel").click();
});
document.querySelectorAll(".grip").forEach((grip) => {
  grip.addEventListener("pointerdown", (e) => {
    grip.setPointerCapture(e.pointerId);
    document.body.classList.add("resizing");
    const move = (ev) => railWidth(innerWidth - ev.clientX);
    const up = () => { grip.removeEventListener("pointermove", move); document.body.classList.remove("resizing"); };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up, { once: true });
  });
  grip.addEventListener("keydown", (e) => {
    const w = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--rail-w")) || 380;
    if (e.key === "ArrowLeft") railWidth(w + 24); else if (e.key === "ArrowRight") railWidth(w - 24);
  });
});
addEventListener("resize", () => { const w = store.get("rail", 0); if (w) railWidth(w); });

// ---- sound: what the listener (centre of the view) is near ------------------

const SURFACE = { [T.PLAZA]: "stone", [T.WELL]: "stone", [T.ALTAR]: "stone", [T.STONE]: "stone", [T.PATH]: "dirt", [T.DOOR]: "dirt", [T.DOCK]: "wood", [T.CROP]: "crop" };
const tileAt = (x, y) => world.tiles[Math.max(0, Math.min(world.h - 1, y)) * world.w + Math.max(0, Math.min(world.w - 1, x))];
function heard(x, y) {
  // Walls between: nothing from another room, only a murmur from outside.
  const here = R.viewRoom ?? null, there = roomAt(x, y);
  if (there !== here && there) return { gain: 0, pan: 0 };
  const lx = R.cam.x / TILE, ly = R.cam.y / TILE, d = Math.hypot(x + 0.5 - lx, y + 0.5 - ly);
  if (there !== here) return { gain: 0, pan: 0 };
  return { gain: Math.max(0, 1 - d / 16) ** 1.6, pan: Math.max(-1, Math.min(1, (x + 0.5 - lx) / 12)) };
}
R.onStep = (a) => {
  if (!audio.soundOn()) return;
  const { gain, pan } = heard(a.x, a.y);
  audio.step(SURFACE[tileAt(a.x, a.y)] ?? "grass", gain * (isMine(a.id) ? 1 : 0.8), pan);
};
let lastEnv = 0;
function soundscape() {
  const t = performance.now();
  if (t - lastEnv < 250 || !audio.soundOn()) return;
  lastEnv = t;
  const lx = R.cam.x / TILE, ly = R.cam.y / TILE;
  let tree = 0, water = 0, grass = 0, sum = 0;
  for (let y = Math.floor(ly) - 7; y <= ly + 7; y++) for (let x = Math.floor(lx) - 9; x <= lx + 9; x++) {
    const w = 1 / (1 + Math.hypot(x - lx, y - ly) / 3), v = tileAt(x, y);
    sum += w;
    if (v === T.TREE || v === T.ORCHARD || v === T.OAK) tree += w;
    else if (v === T.WATER || v === T.DOCK) water += w;
    else if (v === T.GRASS || v === T.FLOWERS || v === T.CROP) grass += w;
  }
  const h = dayPhase(gameNow()).hour;
  const night = h < 5 || h >= 21 ? 1 : h < 7 ? 1 - (h - 5) / 2 : h >= 19 ? (h - 19) / 2 : 0;
  const muffle = R.viewRoom ? 0.2 : 1;
  audio.update({
    tree: Math.min(1, (tree / sum) * 2.2) * muffle, water: Math.min(1, (water / sum) * 3) * muffle, grass: Math.min(1, (grass / sum) * 1.4) * muffle,
    night, rain: weather === "rain" ? (R.viewRoom ? 0.3 : 1) : 0, hour: h,
    // Workshop sounds only when someone is really there: a hammer you cannot
    // see striking was the "ding" nobody could place.
    // inside the building: right there; outside: from its walls; in another room: nothing
    smithy: agents.some((v) => v.pose === "work" && placeAt(v.x, v.y)?.id === "smithy") ? (R.viewRoom?.id === "smithy" ? 2 : R.viewRoom ? Infinity : Math.hypot(30 - lx, 20 - ly) + 2) : Infinity,
    tavern: agents.some((v) => !v.asleep && placeAt(v.x, v.y)?.id === "tavern") ? (R.viewRoom?.id === "tavern" ? 2 : R.viewRoom ? Infinity : Math.hypot(15 - lx, 12 - ly) + 2) : Infinity,
    animals: R.viewRoom ? [] : animals.map((x) => ({ kind: x.kind, act: x.act, ...heard(x.x, x.y) })),
    day: gameNow() / DAY_MS,
  });
}

// ---- camera ------------------------------------------------------------------

const ZOOMS = [1, 1.5, 2, 2.5, 3, 4, 5];
function zoom(dir) {
  const i = ZOOMS.findIndex((z) => z >= R.scale - 0.01);
  R.scale = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? ZOOMS.length - 1 : i) + dir))];
}
$("#zoom-in").onclick = () => zoom(1);
$("#zoom-out").onclick = () => zoom(-1);
$("#follow").onclick = () => { R.follow = you; $("#follow").setAttribute("aria-pressed", String(!!you)); };
$("#village").addEventListener("wheel", (e) => { e.preventDefault(); zoom(e.deltaY < 0 ? 1 : -1); }, { passive: false });

let drag = null;
// One finger or the mouse pans, two fingers pinch (the wheel's job on a desktop).
const fingers = new Map();
let pinch = null;
const cv = $("#village");
const SLOP = (e) => (e.pointerType === "mouse" ? 4 : 10);
function stopFollow() { R.follow = null; $("#follow").setAttribute("aria-pressed", "false"); }
cv.addEventListener("pointerdown", (e) => {
  fingers.set(e.pointerId, [e.clientX, e.clientY]);
  cv.setPointerCapture(e.pointerId);
  if (fingers.size === 2) {
    const [a, b] = [...fingers.values()];
    pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, s: R.scale };
    drag = null; stopFollow();
  } else if (fingers.size === 1) drag = { x: e.clientX, y: e.clientY, cx: R.cam.x, cy: R.cam.y, moved: false };
});
cv.addEventListener("pointermove", (e) => {
  if (fingers.has(e.pointerId)) fingers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pinch && fingers.size === 2) {
    const [a, b] = [...fingers.values()], r = cv.getBoundingClientRect();
    const mx = (a[0] + b[0]) / 2 - r.left, my = (a[1] + b[1]) / 2 - r.top;
    const [wx, wy] = R.toWorld(mx, my);
    R.scale = Math.max(1, Math.min(5, pinch.s * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d));
    R.cam.x = wx - (mx - R.vw / 2) / R.scale; R.cam.y = wy - (my - R.vh / 2) / R.scale; // the point between the fingers stays put
    return;
  }
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.hypot(dx, dy) > SLOP(e)) { drag.moved = true; stopFollow(); cv.classList.add("dragging"); }
  if (drag.moved) { R.cam.x = drag.cx - dx / R.scale; R.cam.y = drag.cy - dy / R.scale; }
});
const lift = (e) => {
  fingers.delete(e.pointerId);
  if (fingers.size < 2) pinch = null;
  if (!fingers.size) cv.classList.remove("dragging");
};
cv.addEventListener("pointerup", (e) => {
  if (drag && !drag.moved) pickVillager(e.clientX, e.clientY);
  drag = null; lift(e);
});
cv.addEventListener("pointercancel", (e) => { drag = null; lift(e); });

function pickVillager(sx, sy) {
  const r = $("#village").getBoundingClientRect();
  const [wx, wy] = R.toWorld(sx - r.left, sy - r.top);
  let hit = null;
  for (const b of R.bodies.values()) if (wx >= b.x && wx <= b.x + TILE && wy >= b.y - 4 && wy <= b.y + TILE) hit = b;
  const card = $("#card");
  if (!hit) { card.hidden = true; return; }
  const a = hit.a, p = placeAt(a.x, a.y);
  card.innerHTML = `<h3>${esc(a.name)}</h3><p>${esc(a.age)}, ${esc(a.job)} · thinks with ${esc(a.mind)}</p>
    <p class="now">${esc(a.walking ? `walking to ${a.goal}` : a.activity)}${p ? ` · ${esc(p.name)}` : ""}. Feels ${esc(a.mood)}.</p>`;
  card.style.left = `${Math.max(8, Math.min(innerWidth - 256, sx + 12))}px`;
  card.style.top = `${Math.max(8, Math.min(innerHeight - 140, sy + 12))}px`;
  card.hidden = false;
}

// ---- per frame ---------------------------------------------------------------

const els = new Map();
function overlay() {
  const r = $("#village").getBoundingClientRect(), now = performance.now();
  const live = new Set();
  for (const b of R.bodies.values()) {
    const a = b.a; live.add(a.id);
    let el = els.get(a.id);
    if (!el) {
      el = document.createElement("div"); el.className = "v";
      el.innerHTML = `<div class="tag"></div><div class="top"></div>`;
      $("#overlay").appendChild(el); els.set(a.id, el); el._k = "";
    }
    el.classList.toggle("mine", isMine(a.id));
    el.classList.toggle("chosen", a.id === you);
    // Only people in the room on screen (or outside, when the village is on screen).
    if (roomAt(a.x, a.y) !== (R.viewRoom ?? null)) { el.style.display = "none"; continue; }
    const [x, y] = R.toScreen(b.x + 8, b.y);
    if (x < -200 || y < -200 || x > r.width + 200 || y > r.height + 200) { el.style.display = "none"; continue; }
    el.style.display = "";
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    const tag = el.firstChild;
    tag.style.top = `${13 * R.scale}px`;
    const puppet = a.mind.includes("puppet"), lvl = a.level ?? 1, tagText = `${first(a.name)}\u0000${lvl}${puppet ? "\u0000puppet" : ""}`;
    if (tag._t !== tagText) {
      tag.textContent = first(a.name);
      const l = document.createElement("i"); l.textContent = `${lvl}`; l.className = "lvl"; tag.append(" ", l);
      if (puppet) { const i = document.createElement("i"); i.textContent = "puppet"; tag.append(" ", i); }
      tag._t = tagText;
    }
    const top = el.lastChild;
    top.style.position = "absolute"; top.style.bottom = `${2 * R.scale + 6}px`; top.style.left = "0";
    let k = "", html = "";
    if (a.bubble) { k = `b${a.bubble.text}`; html = `<div class="bubble">${a.bubble.to ? `<b>to ${esc(a.bubble.to)}</b>` : ""}${esc(a.bubble.text)}</div>`; }
    else if (a.asleep) { k = "zz"; html = `<div class="zz"><span>z</span><span>z</span><span>z</span></div>`; }
    else if (a.thinking) { k = "dots"; html = `<div class="dots"><span></span><span></span><span></span></div>`; }
    else if (isMine(a.id) && byAgent(a.id)?.thought?.until > now) { const th = byAgent(a.id).thought; k = `t${th.text}`; html = `<div class="bubble thought">${esc(th.text)}</div>`; }
    if (el._k !== k) { top.innerHTML = html; el._k = k; }
  }
  for (const [id, el] of els) if (!live.has(id)) { el.remove(); els.delete(id); }
}

function hud() {
  const ph = dayPhase(gameNow());
  $("#phase").textContent = ph.label;
  const a = ph.f * Math.PI * 2;
  $("#sun").setAttribute("cx", (12 - 9 * Math.sin(a)).toFixed(2));
  $("#sun").setAttribute("cy", (12 + 9 * Math.cos(a)).toFixed(2));
  const left = Math.max(0, OMEN_GAP - (performance.now() - (sel?.lastOmen ?? 0)));
  $("#cool-bar").style.width = `${(left / OMEN_GAP) * 100}%`;
  $("#voice-send").disabled = left > 0;
}

function loop() {
  R.frame(gameNow(), gameNow(), weather);
  overlay();
  hud();
  soundscape();
  requestAnimationFrame(loop);
}

if (new URLSearchParams(location.search).has("debug")) window.omen = { get brain() { return sel?.brain; }, get household() { return household; }, R, audio };

renderCharacter();
chooseMind();
forgetOldModels();
connect();
requestAnimationFrame(loop);

// ---- phone keyboard ----------------------------------------------------------
// The on-screen keyboard covers the bottom of the layout viewport. While a text
// field has focus and the visible area has shrunk, the side panel and the
// making sheet are sized to exactly what is visible (CSS reads --vvh and --vvt).
{
  const vv = window.visualViewport, root = document.documentElement;
  let tallest = innerHeight;
  const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "") && document.activeElement.type !== "checkbox" && document.activeElement.type !== "radio";
  const fit = () => {
    if (!vv) return;
    if (!typing()) tallest = Math.max(innerHeight, vv.height);
    const up = typing() && vv.height < tallest - 120;
    root.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
    root.style.setProperty("--vvt", `${Math.round(vv.offsetTop)}px`);
    if (document.body.classList.contains("kb") !== up) {
      document.body.classList.toggle("kb", up);
      if (up) setTimeout(() => document.activeElement?.scrollIntoView?.({ block: "nearest" }), 50);
      setTimeout(() => R.resize(), 0);
    }
  };
  vv?.addEventListener("resize", fit); vv?.addEventListener("scroll", fit);
  addEventListener("focusin", () => setTimeout(fit, 350)); addEventListener("focusout", () => setTimeout(fit, 350));
  addEventListener("orientationchange", () => { tallest = 0; setTimeout(fit, 400); });
}
