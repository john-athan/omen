// Search family "apfree": the largest subset of 1..N with no three terms in
// arithmetic progression (a, a+d, a+2d). Known optima for small N are in OEIS
// A003002, so the village can tell when it has matched the best known.
//
// Villagers never send code to be run on the server. Their program runs in a
// network-less worker in a player's browser and yields a set; the server only
// verifies the set, which is cheap and exact.

export const KNOWN_BEST = { 100: 27, 200: 41 };

export function verify(N, set) {
  if (!Array.isArray(set) || set.length > N) return { ok: false, why: "not a list" };
  if (set.length < 3) return { ok: false, why: "fewer than three numbers" };
  const s = new Set();
  for (const x of set) {
    if (!Number.isInteger(x) || x < 1 || x > N) return { ok: false, why: `out of range: ${x}` };
    if (s.has(x)) return { ok: false, why: `repeated: ${x}` };
    s.add(x);
  }
  const a = [...s].sort((p, q) => p - q);
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) {
    if (s.has(2 * a[j] - a[i])) return { ok: false, why: `progression ${a[i]}, ${a[j]}, ${2 * a[j] - a[i]}` };
  }
  return { ok: true, score: a.length, set: a };
}

// The program every search starts from: prefer numbers with no digit 2 in base 3
// (the classic construction), break ties by size.
export const SEED_PROGRAM = `function priority(n, N) {
  let x = n - 1, twos = 0;
  while (x > 0) { if (x % 3 === 2) twos++; x = Math.floor(x / 3); }
  return -twos * 1000 - n;
}`;

export const INSTRUCTIONS = [
  "We want a large set of numbers from 1 to N with no three numbers a, b, c such that b - a = c - b.",
  "Numbers are added greedily in order of your priority (highest first); a number is skipped if it would complete such a progression.",
  "Write a JavaScript function priority(n, N) that returns a number. Make it different from the examples: change one idea, not everything.",
  "Plain JavaScript only: Math is allowed, nothing else. At most 25 lines.",
].join("\n");

export const MAX_CODE = 2000;
