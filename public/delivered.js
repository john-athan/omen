// The public record: each task with what is settled, each search with its
// record curve, and the decision log.
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function curve(history, known) {
  if (!history.length) return "";
  const W = 320, H = 80, max = Math.max(known ?? 0, ...history.map((h) => h.score)), t0 = history[0].at, t1 = Math.max(history.at(-1).at, t0 + 1);
  const x = (t) => 8 + ((t - t0) / (t1 - t0)) * (W - 16), y = (v) => H - 8 - (v / max) * (H - 16);
  const pts = history.map((h) => `${x(h.at).toFixed(1)},${y(h.score).toFixed(1)}`).join(" ");
  return `<svg class="curve" viewBox="0 0 ${W} ${H}" role="img" aria-label="Record over time">
    ${known ? `<line x1="8" x2="${W - 8}" y1="${y(known)}" y2="${y(known)}" class="known"><title>Best known: ${known}</title></line>` : ""}
    <polyline points="${pts}" class="line"/>
    ${history.map((h) => `<circle cx="${x(h.at)}" cy="${y(h.score)}" r="3"><title>${h.score} on ${new Date(h.at).toLocaleString()}</title></circle>`).join("")}</svg>`;
}

const r = await (await fetch("/results.json")).json();
const out = [];
for (const t of r.tasks ?? []) {
  if (t.kind === "tag") {
    const pct = t.total ? Math.round((100 * t.done) / t.total) : 0;
    const agreed = t.items.filter((i) => i.label);
    out.push(`<article class="task"><h2>${esc(t.title)}</h2><p>${esc(t.question)}</p>
      <div class="bar" title="${t.done} of ${t.total} settled"><b data-w="${pct}"></b></div><p class="hint">${t.done} of ${t.total} settled by three villagers · ${esc(t.status)}</p>
      <ul class="items">${agreed.slice(-12).reverse().map((i) => `<li><b>${esc(String(i.label).replace(/_/g, " "))}</b> <a href="${esc(i.url)}" rel="noopener">${esc(i.title)}</a>${i.plain ? `<em>${esc(i.plain)}</em>` : ""}<small>${esc(i.agreement)}</small></li>`).join("")}</ul></article>`);
  } else {
    out.push(`<article class="task"><h2>${esc(t.title)}</h2><p>${esc(t.question)}</p>
      <p class="big">${t.best ?? "none yet"}${t.known ? `<small> of a known ${t.known}</small>` : ""}</p>${curve(t.history ?? [], t.known)}
      ${t.set ? `<p class="hint">The set: ${esc(t.set.join(", "))}</p>` : ""}
      <p class="hint">${(t.programs ?? []).filter((p) => p.reproduced).length} of ${(t.programs ?? []).length} programs reproduced by a second villager · ${esc(t.status)}</p></article>`);
  }
}
document.querySelector("#tasks").innerHTML = out.join("") || "<p class='hint'>Nothing yet.</p>";
document.querySelectorAll(".bar b").forEach((b) => (b.style.width = `${b.dataset.w}%`));
document.querySelector("#log").innerHTML = (r.log ?? []).slice(0, 60).map((e) => `<li><time>${new Date(e.at).toLocaleString()}</time><b>${esc(e.title)}</b> → ${esc(e.to)}<em>${esc(e.reason)}</em></li>`).join("");
