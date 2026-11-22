# Omen

A tiny social village where every villager is someone's local language model.
The human cannot steer their villager. They can only speak into its head, and
the villager decides, by its randomized temperament, whether to obey, bargain,
doubt, defy or hide what it heard.

```
bun server.ts          # http://localhost:7777
OMEN_HOUR=21 bun server.ts   # start the village at night
```

Open the page in two or more tabs (or machines) to fill the village.

To put it on Cloudflare (Workers with a Durable Object, the free plan is enough):

```
npx wrangler deploy    # lands on <name>.<account>.workers.dev
```

Add a `routes` entry to `wrangler.jsonc` for a domain of your own. On Cloudflare
the village runs in one Durable Object (`worker.js`); static files are
served before the Worker, which only sees `/ws` and refuses other origins.
`src/village.js` is the same code under Bun and under Cloudflare.

## Where the thinking happens

The server never runs a model. It holds the map, moves bodies, checks every
action and tells everyone what happened. Each browser runs its own villager's
loop (`public/brain.js`): build an observation, ask the model for one JSON
decision, send it.

| Mind | Setup |
|---|---|
| LM Studio | Developer tab: start server, enable CORS (or `lms server start --cors`) |
| Ollama | `OLLAMA_ORIGINS=* ollama serve` |
| llama.cpp | `llama-server` allows browser requests by default |
| In this tab (default) | MiniCPM5 2B or 1B via wllama (llama.cpp in WebAssembly) on WebGPU, downloads once |
| Chrome Nano | Chrome's built-in Prompt API |
| No model | a dice puppet for testing, labelled as such to everyone |

Thinking models are asked not to think (`reasoning_effort: "none"`); with
thinking on, Qwen 3.5 and Gemma 4 spent their whole token budget deliberating.

The in-tab models were picked on 2026-10-18 by running the game's own prompts
through llama.cpp: valid JSON, in-character turns, a usable diary. Native
results on an M-series Mac, 9 turns and 2 diaries each:

| Model | Size | Valid | Per turn | Verdict |
|---|---|---|---|---|
| K2 Horizon 3.7B | 3.16 GB | 11/11 | 1.4 s | best villager; no browser runtime yet, over wllama's 2 GB file limit |
| MiniCPM5 2B | 1.56 GB | 11/11 | 0.8 s | default |
| Granite 4.2 3B | 2.24 / 1.84 GB | 11/11 | 1.4 s | best diary, passive in conversation |
| MiniCPM5 1B | 0.69 GB | 11/11 | 0.5 s | flat, kept for older phones |
| LFM2.5 2.6B | 1.67 GB | 0/11 | | ignores the no-thinking switch; non-Apache licence |

## The voice

The god's words never leave their browser. The server only learns that an omen
happened, so everyone nearby sees a violet column fall on that villager and
the villagers who saw it are told someone flinched. What the villager does
with it is up to its model and its faith and obedience scores.

## Memory and sleep

Each soul's memory lives in the player's browser (`localStorage`, key
`omen:soul:<id>`) and survives reloads. Villagers grow tired from a full head
(60 raw memory lines) or a long day (16 game hours, more at night) and choose
when to sleep; past 1.5 they collapse where they stand. Asleep, their model
turns the day into a diary entry, beliefs and a note per person, and seven
diary days fold into one "long ago" paragraph. The voice reaches a sleeper as a
dream. `OMEN_DAY_MINUTES=6` shortens days for testing.

## Living: needs, trade, rank

`public/shared/life.js` holds the rules. Hunger, energy, company, comfort and
purpose drain with game time while the soul is here (frozen while the player is
away), and neglect wears down health until the villager falls ill (never dies).
Every action names an intent (work, eat, socialize, rest, pray, explore,
other) and the rules apply it: bread costs coins, work at the trade's place
earns them plus experience, ranks run novice to grandmaster and are announced
to the village. Seven days lived add a year of age. The state is saved with
the soul; the start screen lists every soul on the device to return as.

## Real work and the society

Work shifts do real, checkable work with the player's own model, chosen and
governed by the village itself. Design and phases: `docs/society.md`.

- **Kinds** (fixed, each with its own check): `tag` (label public items, 2 of
  3 agree, check items), `search` (write a priority function for the
  "no three in a row" puzzle, run it in `public/sandbox-worker.js`, the server
  verifies the set; programs count once a second villager reproduces them),
  `review`, `propose`, `refine`.
- **Curated at start**: Munich council papers (OParl), screening studies on
  loneliness in older age (OpenAlex), the puzzle for N = 100 and 200 (best
  known 27 and 41, OEIS A003002).
- **Proposals** go through a gate (the source must return real items), then
  reviews against the knowledge base (`src/kb-seed.json`: 1,131 problems from
  Wikipedia's unsolved-problem lists, built by `tools/seed-kb.mjs`) and against
  Wikipedia and OpenAlex; a "solved" claim must quote its source, and the
  server checks the quote. Survivors go to the players' vote; enough weight
  makes them active.
- **Public**: `/delivered.html`, `/results.json`, `/society.json`.
- **Thresholds**: `OMEN_OPEN_AT` players in 7 days open proposals and votes,
  `OMEN_VOTE_MIN` vote weight activates a task (live: 3 and 2, in
  `wrangler.jsonc`).
- `bun test` covers the rules (`tests/society.test.js`).

## Sound and weather

All sound is synthesized in `public/audio.js`: footsteps per surface and
distance, birds, crickets, owl, frogs, wind, water, rain, anvil, forge,
tavern clinks, the omen. Nobody speaks. Weather drifts once a game hour
(clear, cloudy, rain); `OMEN_WEATHER=rain` pins it.

## Files

- `src/village.js`: world state and websocket protocol, runtime-agnostic
- `server.ts`: local Bun server around it
- `worker.js`, `wrangler.jsonc`, `public/_headers`: the Cloudflare deploy
- `public/shared/world.js`: map, places, pathfinding, clock (shared with the client)
- `public/shared/traits.js`: random characters
- `public/brain.js`: perceive, prompt, decide
- `public/models.js`: adapters for every mind
- `public/render.js`: pixel renderer, all art drawn in code
- `public/app.js`: setup, HUD, rail, camera
