// Random mortals. Every field can be rerolled on its own from the setup card.

const FIRST = ["Bram", "Mira", "Odo", "Tilde", "Wren", "Hale", "Ysolde", "Piet", "Agna", "Cosmo", "Fenna", "Lothar", "Marit", "Ivo", "Sabe", "Ulla", "Joss", "Nell", "Rune", "Edda", "Tobin", "Greta", "Aurel", "Linnea", "Kasimir", "Oona", "Bertil", "Isolde", "Mattis", "Hesper"];
const LAST = ["Holloway", "Ash", "Fennick", "Brightwater", "Marlow", "Thistle", "Crane", "Oakes", "Dunmore", "Pell", "Graves", "Underhill", "Sorrel", "Quill", "Hartmann", "Weller", "Brack", "Lindqvist"];
const JOBS = ["gravedigger", "herbalist", "baker", "blacksmith", "retired soldier", "tax collector", "wandering bard", "fisher", "goat herder", "apprentice priest", "midwife", "candle maker", "village drunk", "night watch", "beekeeper", "widowed innkeeper", "failed alchemist", "cartographer"];
const DESIRES = ["to be respected by the whole village", "to find out who stole the shrine's silver bell", "to fall in love before winter", "to open a tavern of their own", "to leave Hollowmere forever", "to be forgiven for something old", "to become the village elder", "to discover what lies under the old oak", "to win a bet against everyone", "to make one true friend", "to get rich, quickly and quietly", "to prove the gods are real", "to prove the gods are a lie", "to write a song the whole village sings"];
const FEARS = ["deep water", "being forgotten", "the dark", "fire", "crowds", "the graveyard at night", "being lied to", "going mad", "dogs", "their own temper"];
const SECRETS = ["once buried something that was not quite dead", "owes the smith a large sum", "is secretly in love with someone at the tavern", "cannot read and hides it", "stole a loaf every day for a year", "was banished from a city in the south", "hears music no one else hears", "does not believe in anything", "set the old mill fire", "is the true heir of the abandoned manor"];
const QUIRKS = ["hums when nervous", "collects smooth stones", "quotes proverbs that do not exist", "speaks to birds", "counts everything", "laughs at funerals", "never sits down", "always hungry", "says everyone's full name", "gives unsolicited advice"];
const SPEECH = ["blunt, few words", "flowery and poetic", "nervous, trailing off", "cheerful and loud", "dry and sarcastic", "formal, old fashioned", "gossipy, many questions", "mumbling, slow", "dramatic, theatrical"];

const SKIN = ["#f1c9a5", "#e0ac83", "#c68a5e", "#9a6440", "#6b4128", "#f6d8c0"];
const HAIR = ["#2b1d14", "#5a3a22", "#a8692e", "#d8b25c", "#c9c2b8", "#7a1f1f", "#1e2433", "#e9e3d6"];
const CLOTH = ["#8c3b2e", "#3e5a7a", "#5a7a3e", "#7a5a2e", "#6a3e7a", "#2e6a6a", "#a0702a", "#44403a", "#9a4a6a"];
const HATS = ["none", "none", "none", "hood", "cap", "straw", "kerchief"];

// The axes that drive behaviour. 0..10. Faith and obedience decide how the
// voice lands; the others colour everything else.
export const AXES = [
  { id: "faith", lo: "doubter", hi: "devout" },
  { id: "obedience", lo: "defiant", hi: "obedient" },
  { id: "boldness", lo: "timid", hi: "bold" },
  { id: "warmth", lo: "cold", hi: "warm" },
  { id: "honesty", lo: "liar", hi: "honest" },
  { id: "curiosity", lo: "incurious", hi: "curious" },
];

const pick = (r, a) => a[Math.floor(r() * a.length)];

export function rollField(field, r = Math.random) {
  switch (field) {
    case "name": return `${pick(r, FIRST)} ${pick(r, LAST)}`;
    case "age": return r() < 0.15 ? 8 + Math.floor(r() * 6) : 14 + Math.floor(r() * 72);
    case "job": return pick(r, JOBS);
    case "desire": return pick(r, DESIRES);
    case "fear": return pick(r, FEARS);
    case "secret": return pick(r, SECRETS);
    case "quirk": return pick(r, QUIRKS);
    case "speech": return pick(r, SPEECH);
    case "axes": {
      const o = {};
      // skewed toward the ends so characters feel distinct
      for (const a of AXES) { const v = r(); o[a.id] = Math.round(10 * (v < 0.5 ? 0.5 - 0.5 * Math.sqrt(1 - 2 * v) : 0.5 + 0.5 * Math.sqrt(2 * v - 1))); }
      return o;
    }
    case "look": return { skin: pick(r, SKIN), hair: pick(r, HAIR), cloth: pick(r, CLOTH), hat: pick(r, HATS), hatColor: pick(r, CLOTH) };
  }
}

export const FIELDS = ["name", "age", "job", "axes", "desire", "fear", "secret", "quirk", "speech", "look"];

export function rollCharacter(r = Math.random) {
  const c = {};
  for (const f of FIELDS) c[f] = rollField(f, r);
  return fitJob(c, r);
}

// Children have children's work; grown-ups do not run errands for the baker.
const CHILD_JOBS = ["errand runner", "shepherd's helper", "baker's apprentice", "village child"];
export function fitJob(c, r = Math.random) {
  const child = c.age < 14, isChildJob = CHILD_JOBS.includes(c.job);
  if (child && !isChildJob) c.job = pick(r, CHILD_JOBS);
  if (!child && isChildJob) c.job = pick(r, JOBS);
  return c;
}

// How a generation talks. The age bands follow today's generations, so a
// villager of 64 sounds like a boomer and one of 17 like a teenager now.
export function generation(age) {
  if (age < 13) return { name: "a child", style: "short simple sentences, lots of questions (why? what's that?), gets excited or sulky quickly, mentions games, animals and grown-ups, sometimes gets words a bit wrong" };
  if (age < 20) return { name: "a teenager (Gen Alpha / young Gen Z)", style: "teen slang like 'no cap', 'fr', 'lowkey', 'it's giving', 'bro', 'that's so mid', eye-rolling, dramatic about small things, very short replies to adults" };
  if (age < 30) return { name: "a Gen Z young adult", style: "casual and ironic, 'literally', 'I can't', 'vibe', 'that's a red flag', 'not gonna lie', talks about feelings and boundaries" };
  if (age < 45) return { name: "a millennial", style: "self-deprecating humour, 'honestly', 'adulting', 'I'm so tired', mild exasperation, overly polite then sarcastic, uses 'like' a lot" };
  if (age < 61) return { name: "a Gen X adult", style: "dry, sarcastic, no-nonsense, 'whatever', 'figure it out yourself', distrustful of fuss and of big promises" };
  return { name: "a boomer", style: "'back in my day', firm opinions stated as facts, calls younger people 'young man' or 'young lady', distrusts anything new, tells long stories, complains about how things have changed" };
}

// Words each trade reaches for without noticing.
const TRADE_TALK = {
  gravedigger: "dark jokes about death, digging and the weather on the ground", herbalist: "remedies, roots and what cures what", baker: "dough, ovens, rising and burning", blacksmith: "iron, heat, hammering and tempering",
  "retired soldier": "orders, discipline, old campaigns", "tax collector": "numbers, debts, dues and who owes what", "wandering bard": "rhymes, songs and dramatic phrasing", fisher: "tides, nets, bait and the one that got away",
  "goat herder": "goats, pasture and stubborn animals", "apprentice priest": "blessings, sins and half-remembered scripture", midwife: "births, mothers and plain talk about bodies", "candle maker": "wax, wicks and light",
  "village drunk": "rambling tangents, toasts and slurred sayings", "night watch": "suspicious noises, patrols and who was out after dark", beekeeper: "the hive, honey and swarms", "widowed innkeeper": "rooms, guests, ale and gossip",
  "failed alchemist": "elements, failed experiments and grand theories", cartographer: "directions, distances and maps", "errand runner": "who sent them where and the fastest shortcut",
  "shepherd's helper": "the sheep and goats they mind", "baker's apprentice": "what the baker lets them do and the smell of bread", "village child": "games, other children and what grown-ups said",
};
export const tradeTalk = (job) => TRADE_TALK[job] ?? "their daily work";

// How this mortal receives a voice in their head, in words the model can act on.
export function voiceStance(c) {
  const { faith, obedience } = c.axes;
  if (faith >= 7 && obedience >= 6) return "You believe with your whole heart that a god may speak to you. When the voice speaks you feel chosen, and you strain to obey, though you may misunderstand it.";
  if (faith >= 7) return "You believe the voice is divine, but you argue with gods. You obey only what fits your own wants, and bargain for the rest.";
  if (faith <= 3 && obedience <= 4) return "You do not believe in gods. A voice in your head is a symptom, a trick, or a demon. You resist it on principle and may do the opposite.";
  if (faith <= 3) return "You do not believe in gods and you are frightened that you are going mad. You may hide that you hear anything at all.";
  return "You are unsure what the voice is. Divine, devilish, or your own mind. You weigh what it says against your own nature before doing anything.";
}

export function describeAxes(c) {
  return AXES.map((a) => {
    const v = c.axes[a.id];
    const word = v >= 7 ? a.hi : v <= 3 ? a.lo : `somewhat ${v >= 5 ? a.hi : a.lo}`;
    return `${a.id} ${v}/10 (${word})`;
  }).join(", ");
}

// What other players see about you. Secrets and stance stay local.
export function publicProfile(c, extra = {}) {
  return { name: c.name, age: c.age, job: c.job, look: c.look, ...extra };
}

export function sanitizeLook(l) {
  const hex = (v, d) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
  return {
    skin: hex(l?.skin, SKIN[0]), hair: hex(l?.hair, HAIR[0]), cloth: hex(l?.cloth, CLOTH[0]),
    hat: HATS.includes(l?.hat) ? l.hat : "none", hatColor: hex(l?.hatColor, CLOTH[1]),
  };
}
