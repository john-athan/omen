// Runs one villager-written priority function for the "no three in a row"
// puzzle. The code may come from another player's villager, so this worker is
// served with its own policy (no network at all, eval allowed only here) and
// strips every door out of its global scope before running anything. The page
// kills it after a few seconds.

for (const k of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "indexedDB", "caches", "BroadcastChannel", "Worker", "SharedWorker", "WebTransport"]) {
  try { delete self[k]; } catch { /* not deletable */ }
  try { Object.defineProperty(self, k, { value: undefined, configurable: false }); } catch { /* already gone */ }
  // and on every prototype up the chain, where the real function lives
  for (let o = Object.getPrototypeOf(self); o; o = Object.getPrototypeOf(o)) {
    try { if (Object.prototype.hasOwnProperty.call(o, k)) Object.defineProperty(o, k, { value: undefined, configurable: false }); } catch { /* locked */ }
  }
}
// The page policy forbids every connection anyway; this is the second lock.

onmessage = ({ data: { code, N } }) => {
  try {
    const priority = new Function(`"use strict";\n${code}\n;return typeof priority === "function" ? priority : null;`)();
    if (!priority) throw new Error("no function called priority");
    const order = [];
    for (let n = 1; n <= N; n++) {
      const p = Number(priority(n, N));
      order.push([Number.isFinite(p) ? p : -Infinity, n]);
    }
    order.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    // Greedy: take a number unless it completes a progression with two already taken.
    const has = new Uint8Array(N + 2 * N + 2), set = [];
    for (const [, n] of order) {
      let bad = false;
      for (const x of set) {
        const lo = 2 * x - n, hi = 2 * n - x, mid = (x + n) / 2;
        if ((lo >= 1 && has[lo]) || (hi <= N && has[hi]) || (Number.isInteger(mid) && has[mid])) { bad = true; break; }
      }
      if (!bad) { has[n] = 1; set.push(n); }
    }
    postMessage({ set: set.sort((a, b) => a - b) });
  } catch (e) {
    postMessage({ error: String(e?.message ?? e).slice(0, 200) });
  }
};
