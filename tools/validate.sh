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

step "wrangler.jsonc is generic: workers.dev, no route to anyone's domain"
check node -e '
  const s = require("fs").readFileSync("wrangler.jsonc", "utf8").replace(/^\s*\/\/.*$/mg, "");
  const w = JSON.parse(s);
  if (w.routes) throw new Error("routes belong in wrangler.local.jsonc, which is git-ignored");
  if (w.workers_dev !== true) throw new Error("workers_dev must stay true");
'

step "no one's own deployment leaks into the public code"
# A deployment's domain, path or address belongs in wrangler.local.jsonc.
# LICENSE names the author on purpose.
check sh -c '! git grep --untracked -nIiE "kaleve|xn--[a-z0-9]+\.|/Users/|@gmail\.com" -- . ":!tools/validate.sh" ":!LICENSE"'

if [ "$fail" -ne 0 ]; then printf '\nvalidate: FAILED\n'; exit 1; fi
printf '\nvalidate: everything passes\n'
