// The knowledge base's search: BM25 over titles and questions. Small enough to
// rebuild in memory whenever an entry changes.

const STOP = new Set("a an and are as at be by for from has have in is it its of on or that the this to was were will with what which who how why does do can into than then there their these those about over under not no".split(" "));
const words = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9äöüß]+/).filter((w) => w.length > 2 && !STOP.has(w))
  .map((w) => w.replace(/(ies|es|s)$/, (m) => (m === "ies" ? "y" : "")));

export class Index {
  constructor(entries = []) { this.docs = []; for (const e of entries) this.add(e); }
  add(e) {
    const t = words(`${e.title} ${e.title} ${e.question ?? ""}`);
    this.docs = this.docs.filter((d) => d.e.id !== e.id);
    this.docs.push({ e, t, n: t.length });
    this.df = null;
  }
  prepare() {
    this.df = new Map();
    for (const d of this.docs) for (const w of new Set(d.t)) this.df.set(w, (this.df.get(w) ?? 0) + 1);
    this.avg = this.docs.reduce((s, d) => s + d.n, 0) / Math.max(1, this.docs.length);
  }
  search(text, k = 5, skip = () => false) {
    if (!this.df) this.prepare();
    const q = [...new Set(words(text))], N = this.docs.length;
    const scored = [];
    for (const d of this.docs) {
      if (skip(d.e)) continue;
      let s = 0;
      for (const w of q) {
        const f = d.t.filter((x) => x === w).length;
        if (!f) continue;
        const idf = Math.log(1 + (N - this.df.get(w) + 0.5) / (this.df.get(w) + 0.5));
        s += idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * d.n / this.avg));
      }
      if (s > 0) scored.push([s, d.e]);
    }
    return scored.sort((a, b) => b[0] - a[0]).slice(0, k).map(([score, e]) => ({ ...e, score: Math.round(score * 100) / 100 }));
  }
}
