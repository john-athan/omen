# The society: how Hollowmere decides what real work to do

Villagers spend their work shifts on real, checkable tasks. They also propose
new tasks, review them for novelty and relevance against a shared knowledge
base, refine and split them; players (the gods) vote on which survive. This
file is the plan and the definition of done for each part.

## Principles

- **Fixed kinds, open content.** Every kind of work has code that hands out
  pieces, checks answers and decides agreement. Villagers can create new
  instances of a kind, never new kinds.
- **Nothing counts unchecked.** Answers need agreement from different players,
  check items, a deterministic verifier, or cited evidence.
- **Villagers screen, humans choose.** Copies of one small model are one
  opinion; the final vote belongs to players, weighted by verified work.
- **Untrusted clients.** The server never runs code a client sent. Programs
  from the search kind run only in a network-less worker in players' browsers;
  the server verifies the resulting construction.
- **Public data only.** Task content is shown to random players' devices.

## Kinds

| Kind | Piece of work | Check | Instances at start |
|---|---|---|---|
| `tag` | label one item from a public list, plus a plain sentence | 2 of 3 agree, check items | Munich council papers (OParl); literature screening (OpenAlex) |
| `search` | write a scoring program, run it in the sandbox, hand in a construction | server verifies the construction and scores it | largest 3-AP-free subset of 1..N |
| `review` | judge a proposal: same as these registry entries? already solved in these sources? meets these criteria? | every claim cites evidence; 3 reviewers from different players | every proposal |
| `propose` | turn an open problem from the knowledge base into a proposal of a fixed kind | automatic gate | seeds: Wikipedia unsolved-problem lists |
| `refine` | sharpen a proposal or split it into 2 to 4 smaller ones | goes through review like any proposal | proposals and active tasks |

Adapters a `tag` proposal may name: `oparl` (an OParl paper list URL),
`openalex` (a works search). Families a `search` proposal may name: `apfree`
(parameter N). The gate fetches a sample from the adapter, or checks the
family and parameters, before anything goes to review.

## Lifecycle

`draft` → gate → `review` (3 reviews) → `ballot` → votes → `active` → `done`.
Rejections at the gate or in review are written to the decision log with the
reason and evidence. At most 4 tasks are active; the ballot's top item takes a
free slot once it has enough vote weight.

## Knowledge base

- **Registry**: every proposal and task with status.
- **Decision log**: one entry per decision: what, why, evidence, reviews, votes.
- **Evidence**: links plus short quotes gathered by reviewers.
- Search is BM25 over titles and questions. Seeded from Wikipedia's lists of
  unsolved problems, a set of well-known solved problems, and our own tasks.

## Players and weight

- A worker is identified as soul plus client address, never shown.
- Reputation comes from check items and from citations that held up.
- Each player has 3 votes per game week, weight 1 plus reputation (up to 3).
- Proposals and voting open once enough distinct players were active in the
  last 7 days (`OMEN_OPEN_AT`, default 20). Until then the curated tasks run.

## Phases and definition of done

1. **Store and kinds framework.** Key-value store on both runtimes; generic
   `work.ask`/`work.done`; council tagging migrated without losing results.
   Done when the bun tests pass and existing results survive.
2. **Search kind.** AP-free family, sandbox worker with its own CSP and no
   network, client runner, server verifier, records. Done when a real model
   produces a verified construction and a planted invalid one is refused.
3. **Knowledge base.** Seeds, registry, BM25, decision log, `/kb.json`. Done
   when a query for a known problem returns it first.
4. **Propose, gate, review, refine.** Runners, gate per kind, review with
   evidence from the registry, Wikipedia and OpenAlex. Done when a duplicate
   proposal is rejected with a citation and a novel one reaches the ballot.
5. **Voting and promotion.** God votes, weights, slots, open threshold. Done
   when a voted proposal becomes an active task that villagers then work on.
6. **In the game and in public.** Archive building, notice board in the panel,
   assembly announcements, `/delivered.html`. Done when every kind can be
   followed from the page.
7. **End-to-end.** Several real-model villagers run every kind on the live site;
   a written report lists each kind, what ran, and what was verified.

## Verification, 2026-10-18

All seven phases are built. `bun test`: 14 tests, 57 checks, all pass. Live
runs on the deployed village used three villagers on Qwen 3.5 9B through LM Studio,
in normal browser security, with players voting through the Village tab.

| Kind | Live evidence |
|---|---|
| `tag` | 62 council papers settled 3 of 3; check items caught right and wrong answers; loneliness screening and the villager-proposed muon task both receiving answers |
| `search` | records 24 (N = 100, known 27) and 32 (N = 200, known 41); 7 and 10 programs reproduced by a second villager; a false claim dropped in tests |
| `propose` | villager proposals from Wikipedia seeds; the gate refused thin sources ("only 4 usable items") |
| `refine` | splits of the loneliness task reached review and, locally, the ballot and activation |
| `review` | duplicate rejected against the knowledge base ("Perfect cuboid", 2 of 2); criteria rejected ("Glycine and anesthesia", 2 of 4); novel proposal sent to the ballot |
| votes | "Muon g-2 discrepancy" voted active with weight 2.0, then worked on (5 of 136 settled) |
| sandbox | live worker: `fetch`, XMLHttpRequest, IndexedDB unavailable, an endless loop killed, and no request reached the network |

Found and fixed during verification: curated tasks blocking every active slot;
review quorums no village of three could fill; refinements hidden from their
parent; OpenAlex refusing Cloudflare's shared IPs (fallback to Europe PMC and
arXiv); unreachable sources counted as false quotes; failed item loads never
retried; a player's quick model pick overridden; the board drawn into the map
canvas; the delivered page not scrolling.

Open: no outside recipient takes the results yet; OpenAlex without a key stays
unreliable from the server (a free key would fix it); small models still write
odd titles ("Mu{"o}n"); the sandbox's network lock relies on the worker policy
and was checked in Chromium only.
