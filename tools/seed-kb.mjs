#!/usr/bin/env node
// Builds src/kb-seed.json: known open problems (Wikipedia "List of unsolved
// problems in ...") plus well-known solved ones. Node built-ins only. Rerunnable.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const UA = 'omen-village-seed/1.0 (https://github.com/john-athan/omen)';
const API = 'https://en.wikipedia.org/w/api.php';
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/kb-seed.json');
const CAP = 1500;
const SOLVED_CAP = 90;
const problems = []; // unparsed notes
const note = (s) => problems.push(s);

// ---------- network ----------
let last = 0;
async function api(params) {
  const url = API + '?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = 300 - (Date.now() - last);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA } });
      if (res.ok) return await res.json();
      if (res.status !== 429 && res.status < 500) throw new Error('HTTP ' + res.status);
    } catch (e) {
      if (attempt === 3) throw e;
    }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  throw new Error('failed: ' + url);
}
async function wikitext(page) {
  const d = await api({ action: 'parse', page, prop: 'wikitext', redirects: '1' });
  if (!d.parse) throw new Error('no page ' + page);
  return d.parse.wikitext;
}

// ---------- markup cleaning ----------
const ENT = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ndash: '-', mdash: '-', minus: '-', hellip: '...', thinsp: ' ', ensp: ' ', emsp: ' ', shy: '', lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"' };
function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => (n.toLowerCase() in ENT ? ENT[n.toLowerCase()] : m));
}
const TEX = { ge: '>=', geq: '>=', le: '<=', leq: '<=', neq: '!=', infty: 'infinity', pi: 'pi', to: '->', cdot: '*', times: 'x', ell: 'l', in: 'in', mathbb: '', mathrm: '', mathcal: '', operatorname: '', text: '', left: '', right: '', log: 'log', sum: 'sum', prod: 'prod', ldots: '...', dots: '...', cdots: '...', alpha: 'alpha', beta: 'beta', lambda: 'lambda', sigma: 'sigma', omega: 'omega', epsilon: 'epsilon', varepsilon: 'epsilon', delta: 'delta', gamma: 'gamma', mu: 'mu', equiv: '\u2261', pmod: 'mod', bmod: 'mod', mid: '|', pm: '+/-', sqrt: 'sqrt', binom: 'C', lfloor: 'floor', rfloor: '', lceil: 'ceil', rceil: '', varphi: 'phi', phi: 'phi', rightarrow: '->', Rightarrow: '=>', subseteq: 'subset of', setminus: 'minus' };
function tex(s) {
  return s
    .replace(/\\([a-zA-Z]+)/g, (_, c) => ' ' + (c in TEX ? TEX[c] : c) + ' ')
    .replace(/\\[,;:! ]/g, ' ')
    .replace(/[{}$\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function stripTemplates(t) {
  const keepLast = /^(math|mvar|var|nowrap|nobr|em|strong|small|big|abbr|tmath|chem|chem2|ce|sup|sub|lang|transl|ipa|angbr|overline|sfrac|frac|val|convert|nbsp|thin space)$/i;
  let prev;
  do {
    prev = t;
    t = t.replace(/\{\{([^{}]*)\}\}/g, (m, body) => {
      const parts = body.split('|');
      const name = parts[0].trim().toLowerCase();
      const args = parts.slice(1).filter((a) => !/^[a-z-]+=/i.test(a.trim()));
      if (name === 'nbsp') return ' ';
      if (name === 'val') return (args[0] || '').trim();
      if (name === 'sfrac' || name === 'frac') return args.map((a) => a.trim()).join('/');
      if (name === 'lang' || name === 'transl') return (args[args.length - 1] || '').trim();
      if (keepLast.test(name)) return (args.join(' ') || '').trim();
      return '';
    });
  } while (t !== prev);
  return t.replace(/\{\{|\}\}/g, '');
}
// Remove refs, comments, tables, templates on a whole page (multi-line safe).
function preclean(t) {
  t = t.replace(/<!--[\s\S]*?-->/g, '');
  t = t.replace(/<ref\b[^>]*\/>/gi, '');
  t = t.replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '');
  t = t.replace(/<ref\b[^>]*>[\s\S]*$/gi, ''); // unterminated
  t = t.replace(/<math(?:\s[^>]*)?>([\s\S]*?)<\/math>/gi, (_, m) => tex(m));
  t = t.replace(/<(gallery|nowiki|syntaxhighlight|source|pre)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  t = stripTemplates(t);
  return t;
}
function plain(s) {
  s = s.replace(/\[\[(?:File|Image|Category):[^\[\]]*(?:\[\[[^\[\]]*\]\][^\[\]]*)*\]\]/gi, '');
  s = s.replace(/\[\[(?:[^\[\]|]*)\|([^\[\]]*)\]\]/g, '$1');
  s = s.replace(/\[\[([^\[\]]*)\]\]/g, (_, a) => a.replace(/^:/, '').replace(/#.*$/, (m) => (a.startsWith('#') ? '' : '')));
  s = s.replace(/\[https?:\/\/[^\s\]]+\s+([^\]]*)\]/g, '$1').replace(/\[https?:\/\/[^\s\]]*\]/g, '').replace(/https?:\/\/\S+/g, '');
  s = s.replace(/'{2,5}/g, '');
  s = s.replace(/<br\s*\/?>/gi, ' ').replace(/<\/?[a-z][^>]*>/gi, '');
  s = decode(s);
  s = s.replace(/\[(?:\d+|citation needed|[a-z]|note \d+|nb \d+)\]/gi, '');
  s = s.replace(/\[\[|\]\]|\{\{|\}\}/g, '');
  s = s.replace(/\s+/g, ' ').replace(/\s+([,.;:?!)])/g, '$1').replace(/\(\s+/g, '(').replace(/\(\s*\)/g, '').trim();
  return s;
}
function firstLink(raw) {
  for (const m of raw.matchAll(/\[\[([^\[\]|]+)(?:\|([^\[\]]*))?\]\]/g)) {
    const target = m[1].trim();
    if (/^(File|Image|Category|Wikipedia|Help|Template|Wiktionary|Wikt|Commons|Wikisource|Portal|Draft):/i.test(target)) continue;
    return { target: target.replace(/#.*$/, '').replace(/^:/, ''), text: plain(m[2] ?? m[1]), anchor: target.includes('#') };
  }
  return null;
}
function allLinks(raw) {
  const out = [];
  for (const m of raw.matchAll(/\[\[([^\[\]|]+)(?:\|([^\[\]]*))?\]\]/g)) {
    const target = m[1].trim();
    if (/^(File|Image|Category|Wikipedia|Help|Template|Wiktionary|Wikt|Commons|Wikisource|Portal|Draft):/i.test(target)) continue;
    out.push({ target: target.replace(/#.*$/, '').replace(/^:/, ''), text: plain(m[2] ?? m[1]) });
  }
  return out;
}
const wikiUrl = (t) => 'https://en.wikipedia.org/wiki/' + encodeURIComponent((t.charAt(0).toUpperCase() + t.slice(1)).replace(/ /g, '_')).replace(/%3A/g, ':').replace(/%2C/g, ',').replace(/%28/g, '(').replace(/%29/g, ')').replace(/%27/g, "'");
const anchorOf = (h) => encodeURIComponent(h.replace(/ /g, '_')).replace(/%/g, '.').replace(/\.2C/g, ',').replace(/\.28/g, '(').replace(/\.29/g, ')');

function sentences(s) {
  const out = [];
  const re = /.*?(?:[.?!](?=\s+[A-Z("'‘“0-9])|$)/gs;
  for (const m of s.matchAll(re)) {
    const x = m[0].trim();
    if (x) out.push(x);
    if (m.index + m[0].length >= s.length) break;
  }
  return out;
}
function clip(s, n) {
  s = s.trim();
  if (s.length <= n) return s;
  const sents = sentences(s);
  let acc = '';
  for (const x of sents) {
    if ((acc ? acc + ' ' + x : x).length > n) break;
    acc = acc ? acc + ' ' + x : x;
  }
  if (acc) return acc;
  const cut = s.slice(0, n - 3);
  return cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : cut.length).replace(/[,;:(\s]+$/, '') + '...';
}
function clipTitle(s) {
  s = s.replace(/[\s:;,.]+$/, '').replace(/^(?:the\s+)?/i, (m) => m);
  if (s.length <= 120) return s;
  const cut = s.slice(0, 117);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:(\s]+$/, '') + '...';
}
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- extracts (article summaries, batched) ----------
const summaryCache = new Map();
async function summaries(titles) {
  const need = [...new Set(titles)].filter((t) => !summaryCache.has(t));
  for (let i = 0; i < need.length; i += 20) {
    const batch = need.slice(i, i + 20);
    let d;
    try {
      d = await api({ action: 'query', prop: 'extracts', exintro: '1', explaintext: '1', exlimit: 'max', redirects: '1', titles: batch.join('|') });
    } catch (e) {
      note('summary batch failed: ' + e.message);
      batch.forEach((t) => summaryCache.set(t, null));
      continue;
    }
    const map = new Map(); // requested title -> final title
    for (const n of d.query.normalized || []) map.set(n.from, n.to);
    const red = new Map((d.query.redirects || []).map((r) => [r.from, r.to]));
    const byTitle = new Map((d.query.pages || []).map((p) => [p.title, p]));
    for (const t of batch) {
      let f = map.get(t) || t;
      if (red.has(f)) f = red.get(f);
      const p = byTitle.get(f);
      let ex = p && p.extract ? p.extract : null;
      if (ex && /may (also )?refer to|disambiguation/i.test(ex.slice(0, 200))) ex = null;
      summaryCache.set(t, ex ? firstSentences(ex) : null);
    }
  }
}
function dropDisplay(s) {
  for (;;) {
    const i = s.indexOf('{\\displaystyle');
    if (i < 0) return s;
    let d = 0, j = i;
    for (; j < s.length; j++) { if (s[j] === '{') d++; else if (s[j] === '}' && --d === 0) break; }
    s = s.slice(0, i) + s.slice(j + 1);
  }
}
function firstSentences(ex) {
  let t = plain(dropDisplay(ex.slice(0, 1500).replace(/\s*\n\s*/g, ' '))).replace(/\s*\((?:[^()]|\([^()]*\))*(?:listen|pronounced|\/[^/]+\/|IPA)[^()]*\)/gi, '');
  const ss = sentences(t);
  let out = ss[0] || '';
  if (out.length < 80 && ss[1]) out += ' ' + ss[1];
  return clip(out, 300);
}

// ---------- list-page parsing ----------
const SKIP_HEAD = /(solved|resolved|proved|proven|disproved|see also|references|notes|external|further|history|historical|lists?|notebooks?|millennium|prize|books|bibliography|sources|footnotes|rapidly)/i;
const FIELD_OVERRIDE = { 'fair division': 'economics', geoscience: 'geoscience' };

function parseList(text, field, pageTitle) {
  const items = [];
  const lines = preclean(text).split('\n');
  let head = '', skip = false, tableDepth = 0;
  for (const line of lines) {
    const h = line.match(/^(={2,6})\s*(.*?)\s*\1\s*$/);
    if (h) {
      head = plain(h[2]);
      skip = SKIP_HEAD.test(head);
      continue;
    }
    if (/^\s*\{\|/.test(line)) tableDepth++;
    if (/^\s*\|\}/.test(line)) tableDepth = Math.max(0, tableDepth - 1);
    if (skip || tableDepth) continue;
    const m = line.match(/^(\*{1,2}|#{1,2})\s*(.+)$/);
    if (!m) continue;
    const raw = m[2];
    if (m[1].length > 1 && !(/\?\s*$/.test(plain(raw)) || /^(\[\[|''')/.test(raw.trim()))) continue;
    let f = field;
    if (/astronomy|astrophysics|cosmology/i.test(head) && field === 'physics') f = 'astronomy';
    items.push({ raw, head, field: f, page: pageTitle });
  }
  return items;
}

// Turn one raw item into {title, desc, link}. Returns null if unusable.
function shape(it) {
  const raw = it.raw.trim();
  const P = plain(raw);
  if (P.length < 6 || /^(see|main article|further)/i.test(P)) return null;
  if (/\b(was|were|been|is now|has since been) (proved|proven|solved|resolved|disproved|settled)\b|\bproclaimed (solved|resolved)|\(\d{4}\D{1,3}\d{4}\)|\bsolved in \d{4}|\bresolved in \d{4}/i.test(P)) return { solvedHint: true };
  if (/\([^()]*[A-Z][a-z]+[^()]*\b(?:19|20)\d\d\)\.?\s*$/.test(P)) return { solvedHint: true };
  const boldFirst = raw.match(/^'''(.+?)'''/);
  let title = '', desc = '';
  let m;
  if ((m = P.match(/^([^:]{3,110}?):\s+(.+)$/)) && m[1].split(' ').length <= 14 && (m[1].includes(' ') || /^\s*(\[\[|''')/.test(raw)) && !/^(conjecture|problem|question|represented|types|categorical)$/i.test(m[1].trim()) && !/^(is|are|does|do|can|why|how|what|whether)\b/i.test(m[1])) {
    title = m[1]; desc = m[2];
  } else if (boldFirst && (m = P.match(/^(.{3,110}?)[.:]\s+(.+)$/)) && plain(boldFirst[1]).length >= m[1].length - 4) {
    title = m[1]; desc = m[2];
  } else if ((m = P.match(/^([^.?!]{3,80}?)\.\s+([A-Z].+)$/)) && m[1].split(' ').length <= 9 && !/\b(is|are|was|were|has|have|had|does|do|did|can|could|will|would|may|might|should|must|remains?|exists?|show|shows|suggest|suggests)\b/i.test(m[1]) && !/\b(e\.g|i\.e|vs|approx|ca|St|Dr)$/.test(m[1])) {
    title = m[1]; desc = m[2];
  } else if (P.length <= 120) {
    title = P;
  } else {
    const bt = boldFirst ? plain(boldFirst[1]) : (raw.match(/'''(.+?)'''/) || [])[1];
    if (bt && plain(bt).length >= 4 && plain(bt).length <= 100) title = plain(bt);
    else if (/^(is|are|does|do|can|why|how|what|whether|will|did)\b/i.test(P)) title = (sentences(P)[0] || P);
    else title = (allLinks(raw)[0] || {}).text || sentences(P)[0] || P;
    desc = P;
  }
  if (!/\?$/.test(title)) title = title.replace(/^The (?=[A-Z])/, '');
  title = clipTitle(cap1(title.replace(/^\W+/, '').replace(/\s*\((?:see|main)[^)]*\)$/i, '')));
  if (title.length < 4) return null;
  // link: prefer a link whose text sits inside the title
  const tl = title.toLowerCase();
  let link = allLinks(raw).find((l) => l.text && tl.includes(l.text.toLowerCase()) && l.text.length >= 3) || null;
  const first = firstLink(raw);
  if (!link && !desc && first) link = first;
  desc = desc.replace(/^[\s:;.-]+/, '');
  return { title, desc, link: link ? link.target : null };
}

// ---------- main ----------
async function main() {
  const search = await api({ action: 'query', list: 'prefixsearch', pssearch: 'List of unsolved problems in', pslimit: '100' });
  const pages = search.query.prefixsearch.map((p) => p.title).filter((t) => /^List of unsolved problems in /.test(t));
  const fieldOf = (t) => {
    const f = t.replace('List of unsolved problems in ', '').toLowerCase();
    return FIELD_OVERRIDE[f] || f;
  };
  const sources = pages.map((t) => ({ title: t, field: fieldOf(t) }));
  sources.push({ title: 'List of philosophical problems', field: 'philosophy' });

  let open = [];
  for (const s of sources) {
    let txt;
    try { txt = await wikitext(s.title); } catch (e) { note(`page ${s.title}: ${e.message}`); continue; }
    if (/^#REDIRECT/i.test(txt)) { note(`${s.title}: redirect not followed`); continue; }
    const items = parseList(txt, s.field, s.title);
    let bad = 0;
    for (const it of items) {
      const sh = shape(it);
      if (!sh) { bad++; continue; }
      if (sh.solvedHint) { bad++; continue; }
      open.push({ ...sh, ...it });
    }
    if (!items.length) {
      // prose page: one entry per section, question from the section's first sentences
      const secs = preclean(txt).split(/\n(?==={2,4}[^=])/).slice(1);
      for (const sec of secs) {
        const hm = sec.match(/^={2,4}\s*(.*?)\s*={2,4}\s*\n([\s\S]*)$/);
        if (!hm) continue;
        const head = plain(hm[1]);
        const body = plain(hm[2].split('\n').find((l) => l.trim() && !/^[=*#]/.test(l)) || '');
        if (SKIP_HEAD.test(head) || body.length < 30) continue;
        open.push({ title: clipTitle(cap1(head.replace(/^"|"$/g, ''))), desc: clip(sentences(body).slice(0, 2).join(' '), 300), link: null, raw: head, head, field: s.field, page: s.title });
      }
      note(`${s.title}: prose page, used section headings`);
    }
    if (bad) note(`${s.title}: dropped ${bad} unusable or already-solved items`);
  }

  // fill descriptions from article summaries where an item has none
  const needSum = open.filter((o) => (!o.desc || o.desc.length < 25) && o.link).map((o) => o.link);
  await summaries(needSum);

  const out = [];
  const seen = new Set();
  const ids = new Set();
  const push = (e) => {
    const k = e.title.toLowerCase();
    if (seen.has(k) || out.length >= CAP) return false;
    seen.add(k);
    let base = 'wp-' + e.title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48).replace(/-$/, '');
    let id = base, n = 2;
    while (ids.has(id)) id = base + '-' + n++;
    ids.add(id);
    out.push({ id, ...e });
    return true;
  };
  for (const o of open) {
    let q = o.desc && o.desc.length >= 25 ? clip(o.desc, 300) : (/\?$/.test(o.title) || o.title.length > 60) ? o.title : (o.link && summaryCache.get(o.link)) || o.title;
    q = cap1(q);
    if (q.length < 20 && q !== o.title) { note(`dropped fragment: ${o.title}`); continue; }
    if (/^(For (any|every|each|n)\b|Lower bound|Upper bound)/.test(o.title) && q.length < 80) continue;
    if (q.toLowerCase() === o.title.toLowerCase() && o.desc) q = clip(o.desc, 300);
    const url = o.link ? wikiUrl(cap1(o.link)) : wikiUrl(o.page.replace(/ /g, '_')) + (o.head ? '#' + anchorOf(o.head) : '');
    push({ title: o.title, question: q, field: o.field, status: 'open', source: 'Wikipedia', url });
  }

  // ---------- solved ----------
  const solved = [];
  const CURATED = [
    ['Fermat\'s Last Theorem', 'mathematics', 'Fermat\'s Last Theorem'],
    ['Poincare conjecture', 'mathematics', 'Poincaré conjecture'],
    ['Four color theorem', 'mathematics', 'Four color theorem'],
    ['Kepler conjecture', 'mathematics', 'Kepler conjecture'],
    ['Catalan\'s conjecture', 'mathematics', 'Catalan\'s conjecture'],
    ['Modularity theorem (Taniyama-Shimura conjecture)', 'mathematics', 'Modularity theorem'],
    ['Ternary Goldbach conjecture (weak Goldbach)', 'mathematics', 'Goldbach\'s weak conjecture'],
    ['Bieberbach conjecture', 'mathematics', 'De Branges\'s theorem'],
    ['Mordell conjecture', 'mathematics', 'Faltings\'s theorem'],
    ['Geometrization conjecture', 'mathematics', 'Geometrization conjecture'],
    ['Classification of finite simple groups', 'mathematics', 'Classification of finite simple groups'],
    ['Sensitivity conjecture', 'mathematics', 'Sensitivity conjecture'],
    ['Hilbert\'s tenth problem', 'mathematics', 'Hilbert\'s tenth problem'],
    ['Sphere packing in dimensions 8 and 24', 'mathematics', 'Sphere packing'],
    ['Hirsch conjecture', 'mathematics', 'Hirsch conjecture'],
    ['Double bubble conjecture', 'mathematics', 'Double bubble conjecture'],
    ['Honeycomb conjecture', 'mathematics', 'Honeycomb conjecture'],
    ['Erdős-Faber-Lovász conjecture', 'mathematics', 'Erdős-Faber-Lovász conjecture'],
    ['Kelvin conjecture', 'mathematics', 'Kelvin\'s conjecture'],
    ['Borsuk\'s conjecture', 'mathematics', 'Borsuk\'s conjecture'],
    ['Mertens conjecture', 'mathematics', 'Mertens conjecture'],
    ['Pólya conjecture', 'mathematics', 'Pólya conjecture'],
    ['Euler\'s sum of powers conjecture', 'mathematics', 'Euler\'s sum of powers conjecture'],
    ['Strong perfect graph theorem', 'mathematics', 'Strong perfect graph theorem'],
    ['Green-Tao theorem (arithmetic progressions in the primes)', 'mathematics', 'Green-Tao theorem'],
    ['Kadison-Singer problem', 'mathematics', 'Kadison-Singer problem'],
    ['Robbins conjecture', 'mathematics', 'Robbins algebra'],
    ['Boolean Pythagorean triples problem', 'mathematics', 'Boolean Pythagorean triples problem'],
    ['Kneser\'s conjecture', 'mathematics', 'Kneser graph'],
    ['Weil conjectures', 'mathematics', 'Weil conjectures'],
    ['Moving sofa problem', 'mathematics', 'Moving sofa problem'],
    ['Primality testing in polynomial time (AKS)', 'computer science', 'AKS primality test'],
    ['Linear programming in polynomial time (ellipsoid method)', 'computer science', 'Ellipsoid method'],
    ['Detection of gravitational waves', 'physics', 'First observation of gravitational waves'],
    ['Discovery of the Higgs boson', 'physics', 'Higgs boson'],
    ['Cause of stomach ulcers (Helicobacter pylori)', 'medicine', 'Helicobacter pylori'],
    ['Eradication of smallpox', 'medicine', 'Smallpox'],
    ['Seven Bridges of Konigsberg', 'mathematics', 'Seven Bridges of Königsberg'],
    ['Squaring the circle', 'mathematics', 'Squaring the circle'],
    ['Solving the quintic by radicals', 'mathematics', 'Abel-Ruffini theorem'],
    ['Basel problem', 'mathematics', 'Basel problem'],
  ];
  const curated = CURATED.map(([title, field, art]) => ({ title, field, art }));
  await summaries(curated.map((c) => c.art));
  for (const c of curated) {
    const q = summaryCache.get(c.art);
    if (!q) { note(`curated solved dropped (no summary): ${c.title}`); continue; }
    solved.push({ title: c.title, question: q, field: c.field, status: 'solved', source: 'Wikipedia', url: wikiUrl(c.art) });
  }

  // List of conjectures: "now proved" table and "disproved" list
  try {
    const conj = preclean(await wikitext('List of conjectures'));
    const secP = conj.split(/\n==\s*Conjectures now proved[^\n]*==\n/)[1] || '';
    const proved = secP.split(/\n==[^=]/)[0];
    const rows = proved.split(/\n\|-\s*\n/).slice(1);
    const tableRows = [];
    for (const r of rows) {
      const line = r.replace(/^\|/, '').split('\n')[0];
      const c = line.split('||');
      if (c.length < 4) continue;
      const year = plain(c[0]), by = plain(c[1]), former = c[2], field = plain(c[3]);
      let title = plain(former);
      const lk = firstLink(former);
      title = title.replace(/\s+that\b.*$/i, '');
      if (!title || title.length > 90) title = lk ? lk.text : title;
      if (!title || /^[0-9\s]*$/.test(title)) { note('proved row skipped: ' + plain(line).slice(0, 60)); continue; }
      if (!/conjecture|theorem|problem|hypothesis|lemma|principle|question/i.test(title)) title = cap1(title) + ' conjecture';
      const goodLink = lk && lk.text.length >= 0.6 * title.length;
      tableRows.push({ title: clipTitle(cap1(title)), art: goodLink ? lk.target : null, by, year, field });
    }
    await summaries(tableRows.map((t) => t.art).filter(Boolean));
    for (const t of tableRows) {
      const sum = t.art && summaryCache.get(t.art);
      const tail = ` Resolved by ${t.by}${t.year ? ' (' + t.year + ')' : ''}.`;
      let q = sum ? clip(sum, 300 - tail.length) + tail : clip(t.title + '.' + tail, 300);
      solved.push({ title: t.title, question: clip(q, 300), field: 'mathematics', status: 'solved', source: 'Wikipedia', url: t.art ? wikiUrl(t.art) : wikiUrl('List of conjectures') + '#Conjectures_now_proved_(theorems)' });
    }
    const secD = conj.split(/\n==\s*Disproved[^\n]*==\n/)[1] || '';
    const disp = [];
    for (const line of secD.split(/\n==[^=]/)[0].split('\n')) {
      if (!/^\*/.test(line) || /not a conjecture to start with/i.test(line)) continue;
      const lk = firstLink(line);
      if (!lk) continue;
      disp.push({ title: clipTitle(cap1(lk.text)), art: lk.target });
    }
    await summaries(disp.map((d) => d.art));
    for (const d of disp) {
      const sum = summaryCache.get(d.art);
      solved.push({ title: d.title, question: clip((sum ? clip(sum, 270) : d.title + '.') + ' Disproved.', 300), field: 'mathematics', status: 'solved', source: 'Wikipedia', url: wikiUrl(d.art) });
    }
  } catch (e) {
    note('List of conjectures: ' + e.message);
  }

  // add solved (curated first, then tables) up to SOLVED_CAP, dedupe by title
  let ns = 0;
  for (const s of solved) {
    if (ns >= SOLVED_CAP) break;
    if (push(s)) ns++;
  }

  // sanity clean
  for (const e of out) {
    for (const k of ['title', 'question']) {
      if (/\[\[|\{\{|<ref|&nbsp;|&[a-z]+;|\[\d+\]|<\/?[a-z]/i.test(e[k])) note(`dirty ${k}: ${e.id}`);
    }
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  const byField = {}, byStatus = {};
  for (const e of out) { byField[e.field] = (byField[e.field] || 0) + 1; byStatus[e.status] = (byStatus[e.status] || 0) + 1; }
  console.log(`wrote ${out.length} entries to ${OUT} | status ${JSON.stringify(byStatus)} | field ${JSON.stringify(byField)}`);
  if (problems.length) console.log('notes:\n  ' + problems.join('\n  '));
}
main().catch((e) => { console.error(e); process.exit(1); });
