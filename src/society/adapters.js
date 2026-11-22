// Where the items of a `tag` task come from. Each adapter turns its params into
// a list of { id, title, text, url, meta } items, or throws with a reason the
// gate can write to the decision log. Only public sources.

// The one name every request from the village goes out under.
export const USER_AGENT = "omen-village/1.0 (https://github.com/john-athan/omen)";
const UA = { "User-Agent": USER_AGENT };
const clean = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
// An item's link is shown on the public record page, so only a web address
// survives: a source cannot plant a javascript: or data: link there.
const webUrl = (u) => (/^https?:\/\//i.test(String(u ?? "")) ? String(u) : "");

// OParl servers a player may name as a source. Proposals come from strangers,
// so the village fetches from known council servers only, never from any URL
// it is handed. Add your own city's server here.
export const OPARL_HOSTS = ["www.muenchen-transparent.de"];

// OpenAlex keeps abstracts as an inverted index: word -> positions.
function abstractOf(inv) {
  if (!inv) return "";
  const words = [];
  for (const [w, pos] of Object.entries(inv)) for (const p of pos) words[p] = w;
  return words.filter(Boolean).join(" ");
}

const strip = (s) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// Literature without a key: Europe PMC (medicine, health, social science) and
// arXiv (maths, physics, computer science), interleaved.
async function openPapers(q, limit, fetchFn) {
  const med = [], arx = [];
  try {
    const r = await fetchFn(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(`(${q}) AND HAS_ABSTRACT:Y`)}&format=json&resultType=core&pageSize=${Math.min(100, limit)}`, { headers: UA });
    if (r.ok) for (const w of (await r.json()).resultList?.result ?? []) {
      const text = clean(strip(w.abstractText), 1200);
      if (!w.title || text.length < 120) continue;
      med.push({ id: `epmc-${w.id}`, title: clean(strip(w.title), 240), text, url: webUrl(w.doi ? `https://doi.org/${w.doi}` : `https://europepmc.org/article/${w.source}/${w.id}`), meta: String(w.pubYear ?? "") });
    }
  } catch { /* try the other one */ }
  try {
    const terms = q.split(/\s+/).filter((w) => w.length > 2).slice(0, 6).map((w) => `all:${encodeURIComponent(w)}`).join("+AND+");
    const r = await fetchFn(`https://export.arxiv.org/api/query?search_query=${terms}&max_results=${Math.min(50, limit)}`, { headers: UA });
    if (r.ok) for (const e of (await r.text()).split("<entry>").slice(1)) {
      const title = clean(strip(/<title>([\s\S]*?)<\/title>/.exec(e)?.[1]), 240), text = clean(strip(/<summary>([\s\S]*?)<\/summary>/.exec(e)?.[1]), 1200);
      const url = /<id>([^<]+)<\/id>/.exec(e)?.[1] ?? "";
      if (title && text.length >= 120) arx.push({ id: `arxiv-${url.split("/").pop()}`, title, text, url: webUrl(url), meta: (/<published>(\d{4})/.exec(e) ?? [])[1] ?? "" });
    }
  } catch { /* nothing more to try */ }
  const out = [];
  for (let i = 0; out.length < limit && (i < med.length || i < arx.length); i++) { if (med[i]) out.push(med[i]); if (arx[i]) out.push(arx[i]); }
  if (!out.length) throw new Error("no open literature source returned papers");
  return out.slice(0, limit);
}

export const ADAPTERS = {
  // A works search: literature screening. OpenAlex first; without a key it
  // shares a tiny daily budget per IP, and Cloudflare's IPs are shared by
  // everyone, so a refusal falls back to Europe PMC and arXiv.
  async openalex({ query }, limit = 200, fetchFn = fetch) {
    const q = clean(query, 160);
    if (q.length < 4) throw new Error("the search query is too short");
    try { return await openalexOnly(q, limit, fetchFn); } catch { return openPapers(q, limit, fetchFn); }
  },
};

async function openalexOnly(q, limit, fetchFn) {
    const out = [];
    for (let page = 1; out.length < limit && page <= 4; page++) {
      const r = await fetchFn(`https://api.openalex.org/works?search=${encodeURIComponent(q)}&filter=has_abstract:true&per_page=50&page=${page}&select=id,title,abstract_inverted_index,publication_year,doi`, { headers: UA });
      if (!r.ok) throw new Error(`OpenAlex answered HTTP ${r.status}`);
      const j = await r.json();
      for (const w of j.results ?? []) {
        const text = clean(abstractOf(w.abstract_inverted_index), 1200);
        if (!w.title || text.length < 120) continue;
        out.push({ id: w.id.split("/").pop(), title: clean(w.title, 240), text, url: webUrl(w.doi ?? w.id), meta: String(w.publication_year ?? "") });
      }
      if (!j.results?.length) break;
    }
    if (!out.length) throw new Error("OpenAlex returned nothing");
    return out.slice(0, limit);
}

Object.assign(ADAPTERS, {
  // An OParl paper list (council papers), e.g. München Transparent.
  async oparl({ url }, limit = 3000, fetchFn = fetch) {
    let host;
    try { const u = new URL(url); if (u.protocol !== "https:") throw 0; host = u.host; } catch { throw new Error("not an https URL"); }
    if (!OPARL_HOSTS.includes(host)) throw new Error(`not a known OParl server (${OPARL_HOSTS.join(", ")})`);
    const out = [];
    let next = url;
    for (let page = 0; next && out.length < limit && page < 30; page++) {
      // The server's own paging links must stay on that server.
      if (new URL(next, url).host !== host) break;
      const r = await fetchFn(next, { headers: UA });
      if (!r.ok) throw new Error(`the OParl server answered HTTP ${r.status}`);
      const j = await r.json();
      for (const p of j.data ?? []) {
        if (!p.name || p.name.length < 12) continue;
        out.push({ id: String(p.id).split("/").pop(), title: clean(p.name, 240), text: "", url: webUrl(p.web ?? p.id), meta: clean(p.paperType, 60) });
      }
      next = j.links?.next;
    }
    return out.slice(0, limit);
  },
});
