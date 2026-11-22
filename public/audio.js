// Sound, synthesized: no files, nothing fetched. Off until the player turns it
// on (browsers only start audio after a gesture). The listener is the centre of
// the view; everything else is panned and faded by distance from it.
//
// Three layers:
// - beds: endless loops whose level follows the surroundings (wind, leaves,
//   water, rain, crickets),
// - scattered events: birds, owl, frogs, drips, anvil, forge, tavern clinks,
// - one-shots from the village: footsteps per surface, rustles, the omen.
// Nobody speaks; voices are deliberately absent.

let ctx = null, master = null, on = false;
const beds = {};
const bufs = {};
let lastUpdate = 0;

export function setSound(v) {
  on = v;
  if (on && !ctx) {
    ctx = new AudioContext();
    master = ctx.createGain(); master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    makeBeds();
  }
  if (!ctx) return;
  if (on) ctx.resume(); else ctx.suspend();
}
export const soundOn = () => on && ctx?.state === "running";

function noise(kind) {
  if (bufs[kind]) return bufs[kind];
  const len = ctx.sampleRate * 3, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
  let last = 0, b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === "brown") { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    else if (kind === "pink") { b0 = 0.997 * b0 + 0.029591 * w; b1 = 0.985 * b1 + 0.032534 * w; b2 = 0.95 * b2 + 0.048056 * w; d[i] = (b0 + b1 + b2 + w * 0.05) * 1.8; }
    else d[i] = w;
  }
  return (bufs[kind] = b);
}

function filter(type, freq, q = 0.7) { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f; }

// A looping noise through filters into a level we can steer, with slow movement.
function bed(kind, chain, lfoHz = 0, lfoDepth = 0) {
  const src = ctx.createBufferSource(); src.buffer = noise(kind); src.loop = true;
  const level = ctx.createGain(); level.gain.value = 0;
  let node = src;
  for (const f of chain) { node.connect(f); node = f; }
  if (lfoHz) {
    const sway = ctx.createGain(); sway.gain.value = 1;
    const lfo = ctx.createOscillator(), depth = ctx.createGain();
    lfo.frequency.value = lfoHz; depth.gain.value = lfoDepth;
    lfo.connect(depth).connect(sway.gain); lfo.start();
    node.connect(sway); node = sway;
  }
  node.connect(level).connect(master);
  src.start(0, Math.random() * 2);
  return level;
}

function makeBeds() {
  beds.wind = bed("brown", [filter("lowpass", 520)], 0.07, 0.6);
  beds.leaves = bed("pink", [filter("bandpass", 2600, 0.5)], 0.23, 0.7);
  beds.water = bed("brown", [filter("bandpass", 430, 1.1)], 0.38, 0.8);
  beds.rain = bed("pink", [filter("highpass", 900), filter("lowpass", 7500)]);
  // crickets: a high tone chopped by a fast pulse, gated by a slow one
  const tone = ctx.createOscillator(); tone.frequency.value = 4400;
  const chop = ctx.createGain(); chop.gain.value = 0.5;
  const fast = ctx.createOscillator(); fast.type = "square"; fast.frequency.value = 31;
  const fastG = ctx.createGain(); fastG.gain.value = 0.5; fast.connect(fastG).connect(chop.gain);
  const gate = ctx.createGain(); gate.gain.value = 0.5;
  const slow = ctx.createOscillator(); slow.type = "square"; slow.frequency.value = 2.2;
  const slowG = ctx.createGain(); slowG.gain.value = 0.5; slow.connect(slowG).connect(gate.gain);
  beds.crickets = ctx.createGain(); beds.crickets.gain.value = 0;
  tone.connect(chop).connect(gate).connect(filter("bandpass", 4400, 4)).connect(beds.crickets).connect(master);
  for (const o of [tone, fast, slow]) o.start();
}

function steer(name, v) { beds[name]?.gain.setTargetAtTime(v, ctx.currentTime, 0.6); }

// One-shot plumbing: a gain envelope and a panner, cleaned up by the graph.
function voice(gain, pan) {
  const g = ctx.createGain(), p = ctx.createStereoPanner();
  g.gain.value = 0; p.pan.value = Math.max(-1, Math.min(1, pan));
  g.connect(p).connect(master);
  return g;
}
function burst(kind, at, dur, chain, out, peak, attack = 0.004) {
  const s = ctx.createBufferSource(); s.buffer = noise(kind);
  const e = ctx.createGain();
  e.gain.setValueAtTime(0, at); e.gain.linearRampToValueAtTime(peak, at + attack); e.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  let node = s;
  for (const f of chain) { node.connect(f); node = f; }
  node.connect(e).connect(out);
  s.start(at, Math.random() * 2, dur + 0.05);
}
function tone(type, f0, f1, at, dur, out, peak, attack = 0.005) {
  const o = ctx.createOscillator(), e = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + dur);
  e.gain.setValueAtTime(0, at); e.gain.linearRampToValueAtTime(peak, at + attack); e.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(e).connect(out); o.start(at); o.stop(at + dur + 0.05);
}
function out(gain, pan) { const g = voice(gain, pan); g.gain.value = gain; return g; }

// Footsteps by what is underfoot.
export function step(surface, gain, pan) {
  if (!soundOn() || gain < 0.01) return;
  const t = ctx.currentTime + 0.01, o = out(gain, pan);
  if (surface === "stone") { burst("white", t, 0.03, [filter("highpass", 2200)], o, 0.35); tone("sine", 210, 110, t, 0.05, o, 0.25); }
  else if (surface === "wood") { tone("sine", 170, 105, t, 0.11, o, 0.4); burst("white", t, 0.05, [filter("bandpass", 650, 1.5)], o, 0.25); }
  else if (surface === "dirt") { burst("white", t, 0.06, [filter("bandpass", 1100, 1.2)], o, 0.3); burst("white", t + 0.012, 0.04, [filter("highpass", 3200)], o, 0.12); }
  else burst("pink", t, 0.08, [filter("bandpass", surface === "crop" ? 2300 : 1500, 0.8)], o, 0.32, 0.01);
}

// Someone doing something: cloth, and what the place itself sounds like.
export function interact(place, gain, pan) {
  if (!soundOn() || gain < 0.01) return;
  const t = ctx.currentTime + 0.02, o = out(gain, pan);
  burst("pink", t, 0.35, [filter("bandpass", 2400, 0.5)], o, 0.18, 0.08);
  if (place === "the smithy") anvil(t + 0.2, o);
  if (place === "the well") { burst("brown", t + 0.25, 0.5, [filter("lowpass", 700)], o, 0.5, 0.02); for (let i = 0; i < 4; i++) tone("sine", 1400 + i * 260, 900, t + 0.05 + i * 0.07, 0.05, o, 0.08); }
  // A low singing bowl at the shrine, soft and rare enough to mean prayer.
  if (place === "the shrine") tone("sine", 220, 219, t + 0.1, 2.2, o, 0.035, 0.08);
}

function anvil(at, o) {
  for (const [f, a] of [[523, 0.3], [1307, 0.2], [2210, 0.12], [3301, 0.07]]) tone("sine", f, f * 0.995, at, 0.7, o, a, 0.002);
  burst("white", at, 0.015, [filter("highpass", 3000)], o, 0.3, 0.001);
}
function chirp(o) {
  const t = ctx.currentTime + Math.random() * 0.2, n = 2 + Math.floor(Math.random() * 5), f = 2600 + Math.random() * 2200;
  for (let i = 0; i < n; i++) { const up = Math.random() < 0.5; tone("sine", f * (up ? 1 : 1.35), f * (up ? 1.4 : 0.95), t + i * (0.07 + Math.random() * 0.06), 0.06 + Math.random() * 0.04, o, 0.25); }
}
function owl(o) { const t = ctx.currentTime; tone("sine", 430, 380, t, 0.4, o, 0.3, 0.08); tone("sine", 410, 360, t + 0.55, 0.55, o, 0.3, 0.08); }
function croak(o) {
  const t = ctx.currentTime, s = ctx.createOscillator(), am = ctx.createOscillator(), amG = ctx.createGain(), e = ctx.createGain(), lp = filter("lowpass", 650);
  s.type = "sawtooth"; s.frequency.value = 95 + Math.random() * 40; am.frequency.value = 28; amG.gain.value = 0.5;
  e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(0.25, t + 0.03); e.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
  am.connect(amG).connect(e.gain); s.connect(lp).connect(e).connect(o);
  s.start(t); am.start(t); s.stop(t + 0.3); am.stop(t + 0.3);
}
// A mug set down on a wooden table: a low knock, not a bell.
function knock(o) { const t = ctx.currentTime; tone("sine", 190, 120, t, 0.09, o, 0.35, 0.002); burst("white", t, 0.04, [filter("bandpass", 900, 1.4)], o, 0.18, 0.001); }

// ---- animals ----------------------------------------------------------------

function cluck(o, n = 3) {
  const t = ctx.currentTime;
  for (let i = 0; i < n; i++) { const at = t + i * 0.13 + Math.random() * 0.04; tone("square", 520 + Math.random() * 120, 380, at, 0.06, o, 0.05, 0.004); burst("white", at, 0.05, [filter("bandpass", 1300, 2)], o, 0.08, 0.004); }
}
function crow(o) {
  const t = ctx.currentTime;
  [[480, 640, 0.12], [640, 700, 0.14], [700, 820, 0.18], [820, 520, 0.55]].reduce((at, [f0, f1, d]) => { tone("sawtooth", f0, f1, at, d, o, 0.045, 0.02); return at + d * 0.9; }, t);
}
function bleat(o) {
  const t = ctx.currentTime, s = ctx.createOscillator(), vib = ctx.createOscillator(), vg = ctx.createGain(), e = ctx.createGain(), bp = filter("bandpass", 900, 1.2);
  s.type = "sawtooth"; s.frequency.value = 330 + Math.random() * 60; vib.frequency.value = 7; vg.gain.value = 18;
  vib.connect(vg).connect(s.frequency);
  e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(0.09, t + 0.05); e.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
  s.connect(bp).connect(e).connect(o); s.start(t); vib.start(t); s.stop(t + 0.65); vib.stop(t + 0.65);
}
function quack(o) {
  const t = ctx.currentTime;
  for (let i = 0; i < 2; i++) { const at = t + i * 0.2; const bp = filter("bandpass", 1100, 3); bp.connect(o); tone("square", 420, 300, at, 0.14, bp, 0.12, 0.01); }
}
function meow(o) {
  const t = ctx.currentTime, s = ctx.createOscillator(), e = ctx.createGain(), bp = filter("bandpass", 1400, 2);
  s.type = "sawtooth"; s.frequency.setValueAtTime(520, t); s.frequency.linearRampToValueAtTime(820, t + 0.18); s.frequency.linearRampToValueAtTime(460, t + 0.5);
  bp.frequency.setValueAtTime(900, t); bp.frequency.linearRampToValueAtTime(1800, t + 0.2); bp.frequency.linearRampToValueAtTime(700, t + 0.5);
  e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(0.08, t + 0.05); e.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
  s.connect(bp).connect(e).connect(o); s.start(t); s.stop(t + 0.6);
}
function purr(o) {
  const t = ctx.currentTime, n = ctx.createBufferSource(), am = ctx.createOscillator(), ag = ctx.createGain(), e = ctx.createGain();
  n.buffer = noise("brown"); am.frequency.value = 24; ag.gain.value = 0.5; e.gain.value = 0;
  am.connect(ag).connect(e.gain);
  const lp = filter("lowpass", 260);
  const env = ctx.createGain(); env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(0.5, t + 0.3); env.gain.linearRampToValueAtTime(0, t + 1.8);
  n.connect(lp).connect(e).connect(env).connect(o); n.start(t, 0, 2); am.start(t); am.stop(t + 2);
}
function hiss(o) { burst("white", ctx.currentTime, 0.5, [filter("highpass", 3000)], o, 0.12, 0.05); }
function bark(o, n = 2) {
  const t = ctx.currentTime;
  for (let i = 0; i < n; i++) { const at = t + i * 0.22; tone("sawtooth", 320, 180, at, 0.1, o, 0.12, 0.004); burst("white", at, 0.08, [filter("bandpass", 700, 1.5)], o, 0.18, 0.004); }
}
const VOICE = { chicken: cluck, goat: bleat, duck: quack, cat: meow, dog: bark };

// A villager tended an animal: its answer.
export function animal(kind, mood, gain, pan) {
  if (!soundOn() || gain < 0.01) return;
  const o = out(Math.min(1, gain * 1.4), pan);
  if (kind === "cat") (mood === "grumpy" ? hiss : (x) => { purr(x); meow(x); })(o);
  else if (kind === "dog") bark(o, 3);
  else VOICE[kind]?.(o);
}
function crackle(o) { burst("white", ctx.currentTime + Math.random() * 0.1, 0.01, [filter("highpass", 1600)], o, 0.4, 0.001); }
function drip(o) { const f = 1700 + Math.random() * 1600; tone("sine", f, f * 0.55, ctx.currentTime + Math.random() * 0.2, 0.03, o, 0.18, 0.001); }

// Called a few times a second with what is around the listener.
// env: { tree, water, grass: 0..1 nearby, night: 0..1, rain: 0..1, hour,
//        smithy, tavern: distance in tiles from the listener }
export function update(env) {
  if (!soundOn()) return;
  const now = ctx.currentTime, dt = lastUpdate ? Math.min(1, now - lastUpdate) : 0.25;
  lastUpdate = now;
  const day = 1 - env.night, dry = 1 - env.rain;
  steer("wind", 0.05 + 0.12 * env.tree + 0.08 * env.rain);
  steer("leaves", 0.08 * env.tree * (0.5 + 0.5 * dry));
  steer("water", 0.22 * env.water);
  steer("rain", 0.12 * env.rain);
  steer("crickets", 0.03 * env.night * env.grass * dry);
  const chance = (perSecond) => Math.random() < perSecond * dt;
  const near = (d, r) => Math.max(0, 1 - d / r) ** 1.5;
  const pan = () => Math.random() * 1.6 - 0.8;
  if (chance(day * dry * (0.4 * env.grass + 1.1 * env.tree))) chirp(out(0.05 + Math.random() * 0.08, pan()));
  if (chance(env.night * env.tree * 0.05)) owl(out(0.06, pan()));
  if (chance(env.night * env.water * 0.5)) croak(out(0.08 * env.water, pan()));
  if (chance(env.rain * 7)) drip(out(0.05, pan()));
  const smithy = near(env.smithy, 12);
  if (smithy > 0 && chance(0.35)) anvil(ctx.currentTime, out(0.2 * smithy, 0));
  if (near(env.smithy, 6) > 0 && chance(3)) crackle(out(0.12 * near(env.smithy, 6), 0));
  const tavern = near(env.tavern, 10);
  if (tavern > 0 && chance(0.15)) knock(out(0.3 * tavern, Math.random() * 0.4 - 0.2));
  // Animals speak now and then, from where they stand. The rooster crows at dawn.
  const RATE = { chicken: 0.12, goat: 0.05, duck: 0.08, cat: 0.015, dog: 0.025 };
  for (const a of env.animals ?? []) {
    if (a.act === "sleep" || a.gain < 0.02) continue;
    if (chance(RATE[a.kind] ?? 0)) VOICE[a.kind](out(a.gain * 0.8, a.pan), 1);
  }
  const dawn = Math.floor(env.day ?? 0);
  if (env.hour >= 5 && env.hour < 5.4 && update.crowed !== dawn) {
    update.crowed = dawn;
    const hen = (env.animals ?? []).find((a) => a.kind === "chicken");
    if (hen) crow(out(Math.max(0.15, hen.gain), hen.pan));
  }
}

// The omen: a low swell, a cracked bell, wind.
export function omen(near = true) {
  if (!soundOn()) return;
  const t = ctx.currentTime, gain = near ? 0.32 : 0.08;
  const o = ctx.createGain();
  o.gain.setValueAtTime(0, t); o.gain.linearRampToValueAtTime(gain, t + 0.6); o.gain.exponentialRampToValueAtTime(0.0001, t + 5);
  o.connect(master);
  const lp = filter("lowpass", 900); lp.frequency.exponentialRampToValueAtTime(120, t + 4.5); lp.connect(o);
  for (const f of [46, 46.6, 69.2]) { const s = ctx.createOscillator(); s.type = "sawtooth"; s.frequency.value = f; s.connect(lp); s.start(t); s.stop(t + 5); }
  const bell = out(1, 0);
  for (const [f, a] of [[220, 0.5], [331, 0.3], [529, 0.18], [811, 0.08]]) tone("sine", f, f, t + 0.15, 3.4, bell, a * gain, 0.003);
  burst("white", t, 3, [filter("bandpass", 1200, 1.6)], bell, gain * 0.5, 0.8);
}

// For tests: how loud the mix is right now.
export function level() {
  if (!ctx) return 0;
  if (!level.an) { level.an = ctx.createAnalyser(); master.connect(level.an); }
  const a = new Float32Array(level.an.fftSize); level.an.getFloatTimeDomainData(a);
  return Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
}
