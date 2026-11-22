// What a villager's own model does with each kind of real work. Every runner
// takes the piece the village handed out and returns the result to hand back.
// `see` reports progress for the side panel. Prompts are short and narrow on
// purpose: a 2B model can compare two things, not judge a field.

import { extractJSON } from "./models.js";

const ask = async (mind, system, user, schema) => extractJSON(await mind.complete(system, user, schema));
const str = (max) => ({ type: "string", maxLength: max });

// ---- tag: label items of a public list ----------------------------------------

async function tag(p, mind, see) {
  const keys = Object.keys(p.labels);
  const schema = { type: "object", additionalProperties: false, properties: { label: { type: "string", enum: keys }, plain: str(180), place: str(60) }, required: ["label", "plain", "place"] };
  const system = [
    p.instructions,
    `Labels:\n${keys.map((k) => `- ${k}: ${p.labels[k]}`).join("\n")}`,
    `Reply with one JSON object: {"label": one label, "plain": one short sentence in simple ${p.plainLang} saying what the item is about, "place": the street, city or region it concerns, or ""}.`,
  ].join("\n\n");
  const answers = [];
  for (const [i, it] of p.items.entries()) {
    see({ step: `${i + 1} of ${p.items.length}` });
    try {
      const j = await ask(mind, system, [`Title: ${it.title}`, it.meta && `About: ${it.meta}`, it.text && `Abstract: ${it.text.slice(0, 900)}`].filter(Boolean).join("\n"), schema);
      if (j?.label) { answers.push({ id: it.id, label: j.label, plain: String(j.plain ?? ""), place: String(j.place ?? "") }); see({ line: [p.labels[j.label] ? j.label.replace(/_/g, " ") : j.label, it.title, j.plain] }); }
    } catch { /* an item the model could not read is skipped */ }
  }
  return { piece: "tag", taskId: p.taskId, answers };
}

// ---- search: write a priority function, run it in the sandbox -------------------

function sandbox(code, N) {
  return new Promise((resolve) => {
    const w = new Worker("/sandbox-worker.js");
    const kill = setTimeout(() => { w.terminate(); resolve({ error: "took too long" }); }, 4000);
    w.onmessage = ({ data }) => { clearTimeout(kill); w.terminate(); resolve(data); };
    w.onerror = (e) => { clearTimeout(kill); w.terminate(); resolve({ error: e.message || "crashed" }); };
    w.postMessage({ code, N });
  });
}

async function search(p, mind, see) {
  const out = { piece: "search", taskId: p.taskId, set: [], code: "" };
  // First rerun someone else's unproven program: the village trusts it once it is reproduced.
  if (p.check) {
    const r = await sandbox(p.check.code, p.N);
    if (r.set) { out.check = { id: p.check.id, set: r.set }; see({ line: ["reran", "another villager's program", `${r.set.length} numbers`] }); }
  }
  const schema = { type: "object", additionalProperties: false, properties: { idea: str(160), code: str(1800) }, required: ["idea", "code"] };
  const system = `${p.instructions}\nReply with one JSON object: {"idea": what you changed, in one sentence, "code": the complete JavaScript function}.`;
  let user = [`N = ${p.N}. Best found so far: ${p.best ?? "none"}${p.known ? `; best known anywhere: ${p.known}` : ""}.`,
    ...p.examples.map((e, i) => `Example ${i + 1}${e.score ? ` (gives ${e.score})` : ""}:\n${e.code}`)].join("\n\n");
  for (let attempt = 0; attempt < 2; attempt++) {
    see({ step: `attempt ${attempt + 1}` });
    let j = null;
    try { j = await ask(mind, system, user, schema); } catch { /* try again */ }
    if (!j?.code) continue;
    const r = await sandbox(j.code, p.N);
    if (r.set) { out.set = r.set; out.code = j.code; see({ line: ["result", j.idea || "a new priority", `${r.set.length} numbers${p.best && r.set.length > p.best ? ", a record" : ""}`] }); break; }
    see({ line: ["failed", j.idea || "a new priority", r.error] });
    user += `\n\nYour last function failed: ${r.error}. Write a simpler one.`;
  }
  return out;
}

// ---- review: is a proposal new, already solved, worth doing? ------------------------

const UA = {};
async function wikipedia(q) {
  const r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=2&format=json&origin=*`, { headers: UA });
  const hits = (await r.json()).query?.search ?? [];
  const out = [];
  for (const h of hits) {
    const s = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(h.title.replace(/ /g, "_"))}`);
    if (!s.ok) continue;
    const j = await s.json();
    if (j.extract) out.push({ source: "wikipedia", url: `https://en.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, "_"))}`, title: h.title, text: j.extract });
  }
  return out;
}
async function openalex(q) {
  const r = await fetch(`https://api.openalex.org/works?search=${encodeURIComponent(q)}&filter=has_abstract:true&per_page=2&select=id,title,abstract_inverted_index`);
  const out = [];
  for (const w of (await r.json()).results ?? []) {
    const words = [];
    for (const [k, pos] of Object.entries(w.abstract_inverted_index ?? {})) for (const i of pos) words[i] = k;
    out.push({ source: "openalex", url: w.id, title: w.title, text: words.filter(Boolean).join(" ").slice(0, 1200) });
  }
  return out;
}

async function review(p, mind, see) {
  const prop = `Title: ${p.proposal.title}\nQuestion: ${p.proposal.question}`;
  const verdicts = [];
  const same = { type: "object", additionalProperties: false, properties: { judgement: { type: "string", enum: ["same", "overlap", "different"] }, why: str(160) }, required: ["judgement", "why"] };
  for (const c of p.candidates) {
    see({ step: `comparing with the archive` });
    try {
      const j = await ask(mind, `You compare two problems. "same": they ask the same question. "overlap": they share a large part. "different": otherwise. Reply with JSON {"judgement": ..., "why": one sentence}.`,
        `Problem A (new):\n${prop}\n\nProblem B (already known, ${c.status}):\nTitle: ${c.title}\nQuestion: ${c.question}`, same);
      if (j?.judgement) { verdicts.push({ source: "kb", ref: c.id, judgement: j.judgement }); see({ line: [j.judgement, c.title, j.why] }); }
    } catch { /* skip */ }
  }
  let outside = [];
  try { outside = [...await wikipedia(p.proposal.title), ...await openalex(p.proposal.title)]; } catch { /* offline sources: review without them */ }
  const solved = { type: "object", additionalProperties: false, properties: { judgement: { type: "string", enum: ["solved", "related", "unrelated"] }, quote: str(200) }, required: ["judgement", "quote"] };
  for (const o of outside.slice(0, 4)) {
    see({ step: `reading ${o.source === "wikipedia" ? "Wikipedia" : "a paper"}` });
    try {
      const j = await ask(mind, `You check whether a text already answers a question. "solved": the text clearly answers it. "related": same subject, not answered. "unrelated": otherwise. If solved or related, copy 8 to 25 words EXACTLY as they appear in the text into "quote". Reply with JSON {"judgement": ..., "quote": ...}.`,
        `Question:\n${prop}\n\nText (${o.title}):\n${o.text}`, solved);
      if (j?.judgement) { verdicts.push({ source: o.source, url: o.url, quote: String(j.quote ?? "").slice(0, 200), judgement: j.judgement }); see({ line: [j.judgement, o.title, j.quote] }); }
    } catch { /* skip */ }
  }
  see({ step: "weighing it" });
  const keys = Object.keys(p.criteria), crit = { type: "object", additionalProperties: false, properties: {}, required: keys };
  for (const k of keys) crit.properties[k] = { type: "object", additionalProperties: false, properties: { yes: { type: "boolean" }, why: str(160) }, required: ["yes", "why"] };
  let criteria = {};
  try {
    criteria = await ask(mind, `You judge whether a proposed task is worth a village's work. Answer each question honestly with yes or no and one short reason. Reply with JSON.`,
      `${prop}\nKind: ${p.proposal.kind}${p.proposal.params?.query ? `, searching papers for "${p.proposal.params.query}"` : ""}\n\nQuestions:\n${keys.map((k) => `- ${k}: ${p.criteria[k]}`).join("\n")}`, crit) ?? {};
    see({ line: ["criteria", `${keys.filter((k) => criteria[k]?.yes).length} of ${keys.length} met`, keys.map((k) => `${k}: ${criteria[k]?.yes ? "yes" : "no"}`).join(", ")] });
  } catch { /* no criteria answer */ }
  return { piece: "review", taskId: p.taskId, verdicts: verdicts.slice(0, 10), criteria };
}

// ---- propose and refine: new instances of the tag kind -------------------------------

const PROPOSAL = {
  type: "object", additionalProperties: false,
  properties: { title: str(110), question: str(380), query: str(140), labels: { type: "array", minItems: 2, maxItems: 4, items: str(30) }, instructions: str(380) },
  required: ["title", "question", "query", "labels", "instructions"],
};
const asProposal = (j) => ({ kind: "tag", title: j.title, question: j.question, params: { adapter: "openalex", query: j.query, labels: j.labels, instructions: j.instructions } });
const PROPOSE_SYSTEM = [
  "You turn an open problem into a small, useful task for volunteers: screening published research papers.",
  "Volunteers will read the abstracts of papers found with a search query and label each one.",
  'Reply with one JSON object: {"title": a short title, "question": the precise question the screening answers, "query": 3 to 8 search words in English that find relevant papers, "labels": 2 to 4 short labels such as "relevant", "not relevant", "unclear", "instructions": one or two sentences telling a volunteer how to label one abstract}.',
].join("\n");

async function propose(p, mind, see) {
  see({ step: "drafting" });
  const j = await ask(mind, PROPOSE_SYSTEM, `Open problem (${p.seed.field}): ${p.seed.title}\n${p.seed.question}`, PROPOSAL);
  if (!j?.title) return { piece: "propose", proposals: [] };
  see({ line: ["proposal", j.title, j.question] });
  return { piece: "propose", seed: p.seed.id, proposals: [asProposal(j)] };
}

async function refine(p, mind, see) {
  see({ step: "refining" });
  const schema = { type: "object", additionalProperties: false, properties: { mode: { type: "string", enum: ["refine", "split"] }, tasks: { type: "array", minItems: 1, maxItems: 3, items: PROPOSAL } }, required: ["mode", "tasks"] };
  const j = await ask(mind, `${PROPOSE_SYSTEM}\nYou improve an existing task. Either "refine" it (one sharper version) or "split" it into 2 or 3 narrower tasks, each with its own query. Reply with JSON {"mode": "refine" or "split", "tasks": [task objects as described]}.`,
    `Existing task:\nTitle: ${p.target.title}\nQuestion: ${p.target.question}\nQuery: ${p.target.params?.query}\nLabels: ${Object.keys(p.target.params?.labels ?? {}).join(", ")}`, schema);
  const tasks = (j?.tasks ?? []).filter((t) => t?.title).slice(0, 3);
  for (const t of tasks) see({ line: [j.mode, t.title, t.query] });
  return { piece: "refine", taskId: p.taskId, proposals: tasks.map(asProposal) };
}

export const RUNNERS = { tag, search, review, propose, refine };
export const PIECE_LABEL = { tag: "sorting", search: "the great puzzle", review: "reviewing a proposal", propose: "drafting a proposal", refine: "refining a task" };
