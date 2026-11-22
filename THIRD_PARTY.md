# Third-party material in Omen

Omen is MIT licensed and its source was written for this project. This file
records what it loads from elsewhere at runtime and the one library it ships.

## Loaded by the browser

| What | From | Licence |
|---|---|---|
| MiniCPM5 2B and 1B, GGUF weights | `huggingface.co/openbmb` | the model card's licence |

The weights are downloaded only when a player picks the in-tab mind, once per
browser.

## Vendored

| What | Where | Licence |
|---|---|---|
| wllama 3.8.1 (llama.cpp in WebAssembly), unmodified | `public/vendor/wllama/` | MIT, see its `LICENCE` |

Source, checksums and how to update it: `public/vendor/wllama/README.md`.

## Data

- `src/kb-seed.json` is built by `tools/seed-kb.mjs` from Wikipedia's lists of
  unsolved problems (CC BY-SA 4.0).
- `src/tasks.json` holds public Munich council papers (titles and links from
  muenchen-transparent.de), built by `tools/fetch-tasks.mjs`. Work shifts also
  fetch from OpenAlex and cite OEIS at runtime.
