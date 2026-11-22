// Minds. Every adapter answers one question: given a system prompt, a user
// prompt and a JSON schema, return the model's text. All inference happens in
// this browser or on this machine; nothing goes through the game server.

export const PRESETS = {
  lmstudio: { label: "LM Studio", base: "http://localhost:1234/v1", hint: "Developer tab: start the server and switch on Enable CORS. Or run lms server start --cors" },
  ollama: { label: "Ollama", base: "http://localhost:11434/v1", hint: "Quit Ollama, then start it with OLLAMA_ORIGINS=* ollama serve" },
  llamacpp: { label: "llama.cpp", base: "http://localhost:8080/v1", hint: "llama-server already allows browser requests" },
  custom: { label: "Other (OpenAI-compatible)", base: "http://localhost:8000/v1", hint: "Any server speaking /v1/chat/completions with CORS enabled" },
};

const WLLAMA = "https://cdn.jsdelivr.net/npm/@wllama/wllama@3.8.1/esm";

// What runs inside the tab: llama.cpp compiled to WebAssembly (wllama) on
// WebGPU. Chosen by measuring the game's own prompts (in-character turns,
// valid JSON, diary) among small models that fit a phone and wllama's 2 GB
// per-file limit. Apache 2.0 both. First is the default.
export const BROWSER_MODELS = [
  { id: "minicpm5-2b", label: "MiniCPM5 2B", by: "OpenBMB", gb: 1.6,
    url: "https://huggingface.co/openbmb/MiniCPM5-2B-GGUF/resolve/main/MiniCPM5-2B-Q4_K_M.gguf" },
  { id: "minicpm5-1b", label: "MiniCPM5 1B", by: "OpenBMB", gb: 0.7, note: "for older phones",
    url: "https://huggingface.co/openbmb/MiniCPM5-1B-GGUF/resolve/main/MiniCPM5-1B-Q4_K_M.gguf" },
];

// wllama's WebGPU backend aborts on a GPU without shader-f16, subgroups or
// 1024 threads per workgroup: most phones, and any GPU Brave reports at the
// spec minimum. Those run the model on the CPU.
export function fullGpu(a) {
  return !!a?.features.has("shader-f16") && a.features.has("subgroups") && a.limits.maxComputeInvocationsPerWorkgroup >= 1024;
}

export function browserMind(id) {
  return new WllamaMind(BROWSER_MODELS.find((x) => x.id === id) ?? BROWSER_MODELS[0]);
}

// A GGUF model in this tab. wllama keeps the download in its own browser cache,
// so it happens once per browser.
export class WllamaMind {
  constructor(m) { this.m = m; this.label = `${m.label} in this tab`; }
  async load(onProgress) {
    if (!navigator.gpu) throw new Error("This browser has no WebGPU.");
    const gpu = fullGpu(await navigator.gpu.requestAdapter());
    const { Wllama } = await import(`${WLLAMA}/index.js`);
    this.w = new Wllama({ default: `${WLLAMA}/wasm/wllama.wasm` }, { suppressNativeLog: true });
    await crashed(this.m, this.w.loadModelFromUrl(this.m.url, {
      n_ctx: 6144, n_gpu_layers: gpu ? 999 : 0, reasoning: false,
      progressCallback: ({ loaded, total }) => onProgress?.(total ? loaded / total : 0, `Downloading ${this.m.label}: ${(loaded / 1e9).toFixed(2)} of ${(total / 1e9).toFixed(2)} GB, once`),
    }));
    try { localStorage.setItem(`omen:have:${this.m.id}`, "1"); } catch { /* private mode */ }
  }
  async complete(system, user, schema) {
    const r = await crashed(this.m, this.w.createChatCompletion({
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.9, max_tokens: 420,
      response_format: { type: "json_schema", json_schema: { name: "turn", strict: true, schema } },
    }));
    return r.choices?.[0]?.message?.content ?? "";
  }
}

// wllama reports a llama.cpp crash as a bare "(ABORT)". Say what it means.
async function crashed(m, work) {
  try { return await work; } catch (err) {
    if (!/^\(ABORT\)/.test(String(err?.message ?? err))) throw err;
    throw new Error(`${m.label} crashed in this tab. Reload and try again, or pick another mind.`);
  }
}

// Earlier versions ran Gemma 4 and Qwen 3.5 in the tab (2 to 6 GB each).
// Give that space back to anyone who tried them.
export async function forgetOldModels() {
  try {
    const dir = await navigator.storage.getDirectory();
    for await (const name of dir.keys()) if (/\.litertlm(\.part)?$/.test(name)) await dir.removeEntry(name);
  } catch { /* no OPFS */ }
  try { for (const k of await caches.keys()) if (/webllm/i.test(k)) await caches.delete(k); } catch { /* no Cache API */ }
}

// One loaded model, several villagers: they take turns. A local server can
// answer two at once; a model in the tab is one GPU and goes one at a time.
export function shared(mind, at = 1) {
  if (mind.puppet) return mind;
  let busy = 0;
  const waiting = [];
  const next = () => { if (busy < at && waiting.length) { busy++; waiting.shift()(); } };
  const wrapped = Object.create(mind);
  wrapped.complete = async (...args) => {
    await new Promise((go) => { waiting.push(go); next(); });
    try { return await mind.complete(...args); } finally { busy--; next(); }
  };
  return wrapped;
}

export function extractJSON(text) {
  if (!text) return null;
  const s = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; } }
  }
  return null;
}

// LM Studio, Ollama, llama.cpp and friends.
export class OpenAIMind {
  constructor({ base, model, key, preset }) {
    this.base = base.replace(/\/+$/, "");
    this.model = model; this.key = key; this.preset = preset;
    this.useSchema = true; this.noThink = true;
    this.label = `${model.split("/").pop()} via ${PRESETS[preset]?.label ?? "local server"}`;
  }
  headers() {
    const h = { "content-type": "application/json" };
    if (this.key) h.authorization = `Bearer ${this.key}`;
    return h;
  }
  static async listModels(base, key) {
    const r = await fetch(base.replace(/\/+$/, "") + "/models", { headers: key ? { authorization: `Bearer ${key}` } : {} });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    return (j.data ?? []).map((m) => m.id).filter((id) => !/embed/i.test(id));
  }
  async complete(system, user, schema, signal) {
    const body = {
      model: this.model, temperature: 0.9, max_tokens: 380,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    };
    // Thinking models spend the whole budget deliberating; a villager should just act.
    if (this.noThink) body.reasoning_effort = "none";
    if (this.useSchema) body.response_format = { type: "json_schema", json_schema: { name: "turn", strict: true, schema } };
    const r = await fetch(this.base + "/chat/completions", { method: "POST", headers: this.headers(), body: JSON.stringify(body), signal });
    if (r.status === 400 && (this.useSchema || this.noThink)) {
      // Some servers reject one of the extras. Drop the schema first, then the thinking switch.
      if (this.useSchema) this.useSchema = false; else this.noThink = false;
      return this.complete(system, user, schema, signal);
    }
    if (!r.ok) throw new Error(`${PRESETS[this.preset]?.label ?? "Server"} said HTTP ${r.status}: ${(await r.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 140)}`);
    const j = await r.json();
    const msg = j.choices?.[0]?.message ?? {};
    return msg.content || msg.reasoning_content || "";
  }
}


// Chrome's built-in Gemini Nano (Prompt API).
export class ChromeMind {
  static async available() {
    if (!("LanguageModel" in globalThis)) return "unavailable";
    // Some Chromes expose the API but never answer; two seconds is plenty.
    const late = new Promise((r) => setTimeout(() => r("unavailable"), 2000));
    try { return await Promise.race([globalThis.LanguageModel.availability(), late]); } catch { return "unavailable"; }
  }
  constructor() { this.label = "Gemini Nano in Chrome"; }
  async load(onProgress) {
    this.base = await globalThis.LanguageModel.create({
      monitor(m) { m.addEventListener("downloadprogress", (e) => onProgress?.(e.loaded, "Downloading Gemini Nano")); },
    });
  }
  async complete(system, user, schema) {
    const s = await globalThis.LanguageModel.create({ initialPrompts: [{ role: "system", content: system }] });
    try { return await s.prompt(user, { responseConstraint: schema }); } finally { s.destroy?.(); }
  }
}

// No model at all. A little rule-based soul, so the village can be tested
// without a GPU. Labelled as such to everyone.
export class PuppetMind {
  constructor() { this.label = "puppet (no model)"; this.puppet = true; }
  async complete(system, user) {
    await new Promise((r) => setTimeout(r, 900 + Math.random() * 1600));
    if (/asleep\. Your mind sorts the day/.test(system)) {
      const met = [...new Set([...user.matchAll(/([A-Z][a-z]+ [A-Z][a-z]+) said/g)].map((m) => m[1]))].slice(0, 4);
      return JSON.stringify({ diary: `A day of walking about. ${met.length ? `Spoke with ${met.join(", ")}.` : "Spoke with nobody."} My feet hurt.`, beliefs: "The village is small and the days are long.", people: met.map((name) => ({ name, note: "talks a lot" })), mood: "rested" });
    }
    if (/^You are exhausted/m.test(user)) return JSON.stringify({ thought: "So tired.", say: "", to: "", action: "sleep", target: "", activity: "lying down", intent: "rest", mood: "sleepy" });
    // Look after the body first: food when hungry, work when aimless or broke.
    const at = /You are at the ([a-z ]+?) \(/.exec(user)?.[1];
    const coins = Number(/have (\d+) coins?/.exec(user)?.[1] ?? 0);
    const work = /is done at the ([a-z ]+?)\./.exec(system)?.[1];
    if (/You are (hungry|starving)/.test(user)) {
      const food = coins >= 2 ? "bakery" : "orchard";
      return JSON.stringify(at === food ? { thought: "Food.", say: "", to: "", action: "do", target: "", activity: "eating", intent: "eat", mood: "hungry" }
        : { thought: "I need to eat.", say: "", to: "", action: "walk_to", target: food, activity: "", intent: "eat", mood: "hungry" });
    }
    if (work && (coins < 4 || /You are (aimless|lost)/.test(user) || Math.random() < 0.3)) {
      return JSON.stringify(at === work ? { thought: "Back to work.", say: "", to: "", action: "do", target: "", activity: "working", intent: "work", mood: "busy" }
        : { thought: "Work.", say: "", to: "", action: "walk_to", target: work, activity: "", intent: "work", mood: "dutiful" });
    }
    const faith = Number(/faith (\d+)/.exec(system)?.[1] ?? 5);
    const voice = /THE VOICE SPEAKS NOW: "([^"]*)"/.exec(user)?.[1];
    const places = ["the tavern", "the well", "the shrine", "the market", "the pond", "the old oak", "the orchard", "the graveyard", "the bakery"];
    const people = [...user.matchAll(/^- ([A-Z][a-z]+ [A-Z][a-z]+)/gm)].map((m) => m[1]);
    const lastHeard = /^- ([A-Z][a-z]+) [A-Z][a-z]+ said[^"]*"([^"]+)"/m.exec(user);
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    if (voice) {
      const obey = Math.random() * 10 < faith;
      const place = places.find((p) => voice.toLowerCase().includes(p.replace("the ", "")));
      return JSON.stringify({
        thought: obey ? "The voice. It chose me. I must." : "Voices again. I will not listen.",
        say: obey ? "I have been told something. I cannot say by whom." : "Did anyone else hear that? No? Good.",
        to: "", action: obey && place ? "walk_to" : "do", target: obey && place ? place : "",
        activity: obey ? "trembling with purpose" : "shaking their head hard", intent: "other", mood: obey ? "awed" : "rattled",
        voice: obey ? "obey" : "defy",
      });
    }
    if (lastHeard && Math.random() < 0.6) {
      return JSON.stringify({ thought: `${lastHeard[1]} is talking to me.`, say: pick(["Is that so?", "Hm. Tell me more.", "I heard the same thing.", "Not today, friend."]), to: lastHeard[1], action: "wait", target: "", activity: "listening", intent: "socialize", mood: "curious" });
    }
    if (people.length && Math.random() < 0.4) {
      return JSON.stringify({ thought: "Someone to talk to.", say: pick(["Good day.", "Strange weather.", "Have you been to the shrine lately?", "The bread was burnt again."]), to: people[0].split(" ")[0], action: "wait", target: "", activity: "chatting", intent: "socialize", mood: "chatty" });
    }
    return JSON.stringify({ thought: "Time to move.", say: "", to: "", action: "walk_to", target: pick(places), activity: "", intent: "explore", mood: pick(["restless", "content", "bored"]) });
  }
}
