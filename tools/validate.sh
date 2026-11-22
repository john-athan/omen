#!/bin/sh
# Every check Omen has. Run it directly, through `oss check omen`, or from CI,
# which calls this file and nothing else.
set -eu
cd "$(dirname "$0")/.."

fail=0
step() { printf '\n== %s\n' "$1"; }
check() { if "$@"; then echo "ok"; else echo "FAILED: $*"; fail=1; fi; }

step "the village's rules (bun test)"
check bun test

step "every script parses"
for f in worker.js public/*.js public/shared/*.js src/*.js src/society/*.js tools/*.mjs; do
  node --check "$f" || { echo "FAILED: $f"; fail=1; }
done
echo "ok"

step "vendored wllama is exactly what public/vendor/wllama/README.md says"
check sh -c 'cd public/vendor/wllama && for f in index.js wllama.wasm; do
  want=$(grep -E "^\| $f \|" README.md | awk "{print \$4}")
  have=$(shasum -a 256 "$f" | cut -d" " -f1)
  [ -n "$want" ] && [ "$want" = "$have" ] || { echo "$f: $have, README says ${want:-nothing}"; exit 1; }
done'

step "wrangler.jsonc is generic: workers.dev, no route to anyone's domain"
check node -e '
  const s = require("fs").readFileSync("wrangler.jsonc", "utf8").replace(/^\s*\/\/.*$/mg, "");
  const w = JSON.parse(s);
  if (w.routes) throw new Error("routes belong in wrangler.local.jsonc, which is git-ignored");
  if (w.workers_dev !== true) throw new Error("workers_dev must stay true");
  if (w.preview_urls !== false) throw new Error("preview_urls must stay false");
'

step "the pages carry no inline script or style, so their 'self' policy is the whole policy"
# public/_headers allows only 'self' for scripts and styles. An inline block or
# a style= attribute would be refused by the browser without a word, so catch it
# here rather than in a blank page. (scripts/csp is for pages that need inline code.)
check node -e '
  for (const f of require("fs").readdirSync("public").filter((n) => n.endsWith(".html"))) {
    const h = require("fs").readFileSync("public/" + f, "utf8");
    const inline = [...h.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].filter((m) => m[1].trim());
    if (inline.length || /<style\b|\sstyle=/.test(h)) throw new Error(f + " has inline script or style");
  }
'

step "no one's own deployment leaks into the public code"
# A deployment's domain, path or address belongs in wrangler.local.jsonc.
# LICENSE names the author on purpose.
check sh -c '! git grep --untracked -nIiE "kaleve|xn--[a-z0-9]+\.|/Users/|@gmail\.com" -- . ":!tools/validate.sh" ":!LICENSE"'

if [ "$fail" -ne 0 ]; then printf '\nvalidate: FAILED\n'; exit 1; fi
printf '\nvalidate: everything passes\n'
