// bun test: the society's rules, with a memory store and a fake network.
import { test, expect } from "bun:test";
import { Society } from "../src/society/index.js";
import { MemoryStore } from "../src/society/store.js";
import { verify } from "../src/society/apfree.js";
import { Index } from "../src/society/kb.js";

// OpenAlex and Wikipedia, faked. `works` controls how many usable abstracts a search returns.
function net({ works = 40 } = {}) {
  const abstract = (i) => ({ Older: [0], adults: [1], in: [2], this: [3], trial: [4], received: [5], weekly: [6], phone: [7], calls: [8], to: [9], reduce: [10], loneliness: [11], over: [12], twelve: [13], months: [14], [`study${i}`]: [15], with: [16], many: [17], participants: [18], measured: [19], outcomes: [20], carefully: [21] });
  return async (url) => {
    const u = String(url);
    const json = (b) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });
    if (u.includes("api.openalex.org/works?")) {
      const page = Number(/[?&]page=(\d+)/.exec(u)[1]);
      const results = page === 1 ? Array.from({ length: works }, (_, i) => ({ id: `https://openalex.org/W${1000 + i}`, title: `Study ${i} on loneliness`, abstract_inverted_index: abstract(i), publication_year: 2020 })) : [];
      return json({ results });
    }
    if (u.includes("api.openalex.org/works/W")) return json({ title: "Phone calls against loneliness", abstract_inverted_index: { The: [0], problem: [1], was: [2], solved: [3], in: [4], "1995": [5] } });
    if (u.includes("rest_v1/page/summary/")) return json({ extract: "Fermat's Last Theorem was proved by Andrew Wiles in 1994." });
    return new Response("no", { status: 404 });
  };
}

async function society(opts = {}) {
  const s = new Society(new MemoryStore(), { openAt: 2, voteMin: 2, fetchFn: net(opts.net), ...opts });
  await s.load();
  for (const w of ["x1", "x2", "x3", "x4"]) s.touch(w); // a village big enough for three reviewers
  return s;
}

test("curated tasks are active from the start", async () => {
  const s = await society();
  const b = s.board();
  for (const id of ["council", "loneliness", "apfree-100", "apfree-200"]) expect(b.tasks.find((t) => t.id === id)?.status).toBe("active");
});

test("old council answers survive the migration", async () => {
  const store = new MemoryStore();
  await store.put("work", { answers: { 614175: [{ who: "a", topic: "gruen_freizeit", plain: "x", place: "" }] }, done: 0 });
  const s = new Society(store, { fetchFn: net() });
  await s.load();
  expect(s.answersOf("council").get("614175")[0].label).toBe("gruen_freizeit");
  expect(await store.get("work")).toBeUndefined();
});

test("tag: a lease, a check item, three answers settle an item", async () => {
  const s = await society();
  const t = s.tasks.get("council");
  const piece = s.tagPiece(t, "w1");
  expect(piece.items.length).toBe(6);
  expect(await s.done("w9", { piece: "tag", taskId: "council", answers: [] })).toBeNull(); // no lease
  const first = piece.items.find((i) => i.id === piece.ids.find((id) => !["1024122", "584452", "874453", "858158", "1113688", "1150985", "645109", "575732", "612624", "875568", "673511", "626289", "674052"].includes(id)));
  for (const w of ["w1", "w2", "w3"]) {
    s.leases.set(w, { piece: "tag", taskId: "council", ids: [first.id], until: Date.now() + 60000 });
    const r = await s.done(w, { piece: "tag", taskId: "council", answers: [{ id: first.id, label: "verkehr", plain: "Ein Satz." }, { id: first.id, label: "nonsense" }] });
    expect(r.taken).toBe(1);
  }
  expect(s.answersOf("council").get(first.id).length).toBe(3);
  expect(s.results().tasks.find((x) => x.id === "council").items.find((i) => i.id === first.id).label).toBe("verkehr");
});

test("tag: a wrong check item costs reputation", async () => {
  const s = await society();
  s.leases.set("w1", { piece: "tag", taskId: "council", ids: ["1024122"], until: Date.now() + 60000 });
  const r = await s.done("w1", { piece: "tag", taskId: "council", answers: [{ id: "1024122", label: "kultur" }] });
  expect(r.checkBad).toBe(1);
  expect(s.repOf("w1").bad).toBe(1);
});

test("search: the verifier refuses progressions and accepts a clean set", () => {
  expect(verify(10, [1, 2, 3]).ok).toBe(false);
  expect(verify(10, [1, 2, 4, 5, 10]).ok).toBe(true);
  expect(verify(10, [1, 11]).ok).toBe(false);
  expect(verify(10, []).ok).toBe(false);
});

test("search: records, programs, and reproduction by someone else", async () => {
  const s = await society();
  const bad = await s.done("w1", { piece: "search", taskId: "apfree-100", set: [1, 2, 3], code: "function priority(n){return n}" });
  expect(bad.valid).toBe(false);
  const good = await s.done("w1", { piece: "search", taskId: "apfree-100", set: [1, 2, 4, 5, 10, 11, 13, 14], code: "function priority(n,N){return -n}" });
  expect(good.valid && good.record).toBe(true);
  const prog = s.programs.get("apfree-100")[0];
  expect(prog.reproduced).toBe(false);
  // the author cannot reproduce their own program
  await s.done("w1", { piece: "search", taskId: "apfree-100", set: [1, 2, 4], check: { id: prog.id, set: [1, 2, 4, 5, 10, 11, 13, 14] } });
  expect(s.programs.get("apfree-100")[0].reproduced).toBe(false);
  const r = await s.done("w2", { piece: "search", taskId: "apfree-100", set: [1, 2, 4], check: { id: prog.id, set: [1, 2, 4, 5, 10, 11, 13, 14] } });
  expect(r.reproduced).toBe(true);
  expect(s.searchPiece(s.tasks.get("apfree-100")).examples[0].code).toContain("priority");
});

test("search: a program whose claim does not hold is dropped", async () => {
  const s = await society();
  await s.done("w1", { piece: "search", taskId: "apfree-200", set: [1, 2, 4, 5], code: "function priority(n,N){return 1}" });
  const prog = s.programs.get("apfree-200")[0];
  const r = await s.done("w2", { piece: "search", taskId: "apfree-200", set: [1], check: { id: prog.id, set: [1, 2, 4] } });
  expect(r.reproduced).toBe(false);
  expect(s.programs.get("apfree-200").length).toBe(0); // the false claim is gone; w2 sent no program
  expect(s.repOf("w1").bad).toBe(1);
});

const proposal = { kind: "tag", title: "Screen studies on phone calls against loneliness", question: "Which studies test regular phone calls as a way to reduce loneliness in older people?",
  params: { adapter: "openalex", query: "phone calls loneliness older adults", labels: ["relevant", "not relevant"], instructions: "Does the study test phone calls to reduce loneliness in people over 60?" } };

test("gate: too few items or bad fields are rejected with a reason", async () => {
  const s = await society({ net: { works: 5 } });
  const t = await s.propose("p1", proposal);
  expect(t.status).toBe("rejected");
  expect(t.decided).toContain("only 5 usable items");
  const t2 = await s.propose("p1", { ...proposal, params: { ...proposal.params, labels: ["only one"] } });
  expect(t2.decided).toContain("2 to 6 labels");
  const t3 = await s.propose("p1", { kind: "search", title: "No three in a row up to 100 again", question: "A second search for the same N should be refused.", params: { family: "apfree", N: 100 } });
  expect(t3.decided).toContain("already a task");
});

test("review: two 'same' verdicts make a duplicate", async () => {
  const s = await society();
  const t = await s.propose("p1", proposal);
  expect(t.status).toBe("review");
  const piece = s.reviewPiece(t);
  const ref = piece.candidates.find((c) => c.id === "loneliness")?.id;
  expect(ref).toBe("loneliness");
  for (const w of ["r1", "r2", "r3"]) await s.done(w, { piece: "review", taskId: t.id, verdicts: [{ source: "kb", ref, judgement: w === "r3" ? "different" : "same" }], criteria: { people: { yes: true }, public: { yes: true }, checkable: { yes: true }, used: { yes: true } } });
  expect(t.status).toBe("rejected");
  expect(t.decided).toContain("Duplicate");
});

test("review: the proposer cannot review, and a fake quote costs reputation", async () => {
  const s = await society();
  const t = await s.propose("p1", proposal);
  expect(await s.done("p1", { piece: "review", taskId: t.id, verdicts: [], criteria: {} })).toBeNull();
  await s.done("r1", { piece: "review", taskId: t.id, verdicts: [{ source: "wikipedia", url: "https://en.wikipedia.org/wiki/Fermat%27s_Last_Theorem", quote: "was disproved by a cat in 2001", judgement: "solved" }], criteria: {} });
  expect(t.reviews[0].verdicts[0].verified).toBe(false);
  expect(s.repOf("r1").bad).toBe(1);
  await s.done("r2", { piece: "review", taskId: t.id, verdicts: [{ source: "wikipedia", url: "https://en.wikipedia.org/wiki/Fermat%27s_Last_Theorem", quote: "proved by Andrew Wiles in 1994", judgement: "solved" }], criteria: {} });
  expect(t.reviews[1].verdicts[0].verified).toBe(true);
});

test("review: two verified 'solved' quotes reject; novel and relevant goes to the ballot", async () => {
  const s = await society();
  const solved = await s.propose("p1", { ...proposal, title: "Prove Fermat's last theorem for all exponents", question: "Show that no three positive integers satisfy a^n + b^n = c^n for n above 2." });
  for (const w of ["r1", "r2", "r3"]) await s.done(w, { piece: "review", taskId: solved.id, verdicts: [{ source: "wikipedia", url: "https://en.wikipedia.org/wiki/Fermat%27s_Last_Theorem", quote: "proved by Andrew Wiles", judgement: "solved" }], criteria: {} });
  expect(solved.status).toBe("rejected");
  expect(solved.decided).toContain("Already answered");
  const fresh = await s.propose("p2", { ...proposal, title: "Screen studies on choirs for isolated older people", question: "Which studies test community choirs as a way to reduce social isolation in people over 60?" });
  const yes = { people: { yes: true }, public: { yes: true }, checkable: { yes: true }, used: { yes: false } };
  for (const w of ["r1", "r2", "r3"]) await s.done(w, { piece: "review", taskId: fresh.id, verdicts: [], criteria: yes });
  expect(fresh.status).toBe("ballot");
});

test("votes: closed until enough players, a budget, and promotion to active", async () => {
  const s = new Society(new MemoryStore(), { openAt: 2, voteMin: 2, fetchFn: net() });
  await s.load();
  const t = await s.propose("p2", { ...proposal, title: "Screen studies on choirs for isolated older people", question: "Which studies test community choirs as a way to reduce social isolation in people over 60?" });
  t.status = "ballot";
  expect((await s.vote("v1", t.id)).ok).toBe(false); // only one player seen so far... actually zero
  s.touch("v1"); s.touch("v2");
  expect((await s.vote("v1", t.id)).ok).toBe(true);
  expect((await s.vote("v1", t.id)).ok).toBe(false); // twice
  expect(t.status).toBe("ballot");
  expect((await s.vote("v2", t.id)).ok).toBe(true);
  expect(t.status).toBe("active");
  expect(s.items.get(t.id).length).toBeGreaterThanOrEqual(15);
  expect(s.tagPiece(t, "w1").items.length).toBe(5);
});

test("knowledge base: a known problem comes first", () => {
  const ix = new Index([{ id: "a", title: "Riemann hypothesis", question: "Do all nontrivial zeros of the zeta function lie on the critical line?" }, { id: "b", title: "Goldbach's conjecture", question: "Is every even number above 2 the sum of two primes?" }]);
  expect(ix.search("zeros of the Riemann zeta function")[0].id).toBe("a");
  expect(ix.search("even numbers as sums of two primes")[0].id).toBe("b");
});

test("small village: two reviewers suffice, and a refinement equal to its parent is refused", async () => {
  const s = new Society(new MemoryStore(), { openAt: 2, voteMin: 2, fetchFn: net() });
  await s.load();
  for (const w of ["a", "b", "c"]) s.touch(w);
  expect(s.reviewsNeeded()).toBe(2);
  const child = await s.propose("a", { ...proposal, title: "Screen studies on loneliness in older age again", question: "Which published studies test an intervention against loneliness in people over 60?" }, { origin: "villager", parent: "loneliness" });
  const piece = s.reviewPiece(child);
  expect(piece.candidates.some((c) => c.id === "loneliness")).toBe(true);
  for (const w of ["b", "c"]) await s.done(w, { piece: "review", taskId: child.id, verdicts: [{ source: "kb", ref: "loneliness", judgement: "same" }], criteria: {} });
  expect(child.status).toBe("rejected");
  expect(child.decided).toContain("No real change");
});

test("household: two villagers of one device hold separate leases but count as one", async () => {
  const s = await society();
  const t = s.tasks.get("council");
  const a = s.tagPiece(t, "dev1", "dev1#a"), b = s.tagPiece(t, "dev1", "dev1#b");
  const shared = a.ids.filter((id) => b.ids.includes(id) && !["1024122", "584452", "874453", "858158", "1113688", "1150985", "645109", "575732", "612624", "875568", "673511", "626289", "674052"].includes(id));
  expect(shared.length).toBe(0); // no paper handed to both at once
  const id = a.ids.find((x) => !b.ids.includes(x) && x.length > 3 && !["1024122","584452","874453","858158","1113688","1150985","645109","575732","612624","875568","673511","626289","674052"].includes(x));
  expect((await s.done("dev1", { piece: "tag", taskId: "council", answers: [{ id, label: "verkehr" }] }, "a")).taken).toBe(1);
  // the same device cannot answer that paper again through its second villager
  s.leases.set("dev1#b", { piece: "tag", taskId: "council", ids: [id], until: Date.now() + 60000 });
  expect((await s.done("dev1", { piece: "tag", taskId: "council", answers: [{ id, label: "verkehr" }] }, "b")).taken).toBe(0);
});

// A proposal comes from a stranger, so its source must not turn the village into
// a fetcher of any URL, nor plant a script link on the public record page.
test("an OParl source is fetched from known council servers only, and only web links survive", async () => {
  const { ADAPTERS, OPARL_HOSTS } = await import("../src/society/adapters.js");
  const asked = [];
  const page = (next) => ({ ok: true, json: async () => ({ data: [
    { id: "https://www.muenchen-transparent.de/p/1", name: "A council paper with a long title", web: "javascript:alert(1)" },
    { id: "https://www.muenchen-transparent.de/p/2", name: "Another council paper, also long", web: "https://www.muenchen-transparent.de/antraege/2" },
  ], links: { next } }) });
  const fetchFn = async (u) => { asked.push(String(u)); return page(asked.length === 1 ? "https://elsewhere.example/oparl/page2" : null); };

  await expect(ADAPTERS.oparl({ url: "https://evil.example/oparl/papers" }, 20, fetchFn)).rejects.toThrow("not a known OParl server");
  await expect(ADAPTERS.oparl({ url: "http://www.muenchen-transparent.de/oparl/v1.0/paper" }, 20, fetchFn)).rejects.toThrow("not an https URL");
  expect(asked).toEqual([]);

  const items = await ADAPTERS.oparl({ url: `https://${OPARL_HOSTS[0]}/oparl/v1.0/paper` }, 20, fetchFn);
  expect(asked).toHaveLength(1); // the paging link pointed at another host and was not followed
  expect(items.map((i) => i.url)).toEqual(["", "https://www.muenchen-transparent.de/antraege/2"]);
});

test("the page keeps a link only when it is a web address", async () => {
  const { href, esc } = await import("../public/shared/text.js");
  expect(href("javascript:alert(1)")).toBe("#");
  expect(href("data:text/html,<b>")).toBe("#");
  expect(href('https://example.org/?a="b"')).toBe("https://example.org/?a=&quot;b&quot;");
  expect(esc("<img onerror=x>")).toBe("&lt;img onerror=x&gt;");
});

test("a label must be one of the task's own labels, not a prototype name or an array", async () => {
  const s = new Society(new MemoryStore(), { now: () => Date.now() });
  await s.load(); await s.loadItems(s.tasks.get("council"));
  const piece = s.tagPiece(s.tasks.get("council"), "w1");
  const id = piece.ids.find((x) => !s.answersOf("council").has(x));
  s.leases.set("w1", { piece: "tag", taskId: "council", ids: [id], until: Date.now() + 60000 });
  const r = await s.done("w1", { piece: "tag", taskId: "council", answers: [{ id, label: "constructor" }, { id, label: "toString" }, { id, label: ["verkehr"] }] });
  expect(r.taken).toBe(0);
});
