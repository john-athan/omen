// Pulls council paper titles from München Transparent's OParl API (Code for
// Munich) into src/tasks.json. Run: node tools/fetch-tasks.mjs
// Their `keyword` field is empty, so tagging by topic is real, missing work.
import { writeFileSync } from "node:fs";
const B = "https://www.muenchen-transparent.de/oparl/v1.0";
const bodies = (await (await fetch(`${B}/list/body`)).json()).data;
const out = [];
for (const b of bodies) {
  try {
    const r = await fetch(b.paper);
    if (!r.ok) continue;
    for (const p of (await r.json()).data ?? []) {
      if (!p.name || p.name.length < 12) continue;
      out.push({ id: p.id.split("/").pop(), title: p.name.replace(/\s+/g, " ").trim(), kind: p.paperType ?? "", body: b.name, url: p.web });
    }
  } catch { /* skip a body that fails */ }
  await new Promise((r) => setTimeout(r, 400)); // be gentle with a volunteer project
}
const seen = new Set();
const tasks = out.filter((t) => !seen.has(t.title) && seen.add(t.title));
writeFileSync(new URL("../src/tasks.json", import.meta.url), JSON.stringify(tasks, null, 0));
console.log(`${tasks.length} papers from ${bodies.length} bodies`);
