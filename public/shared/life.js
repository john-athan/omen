// The body and the livelihood: needs that drain with game time, what each kind
// of deed does to them, trade experience and its titles. Pure functions over a
// plain state object, so the rules read in one place and could later be checked
// on the server. The state lives in the player's browser with the soul.

export const NEEDS = [
  { id: "hunger", label: "fed", low: "hungry", empty: "starving" },
  { id: "energy", label: "rested", low: "tired", empty: "exhausted" },
  { id: "social", label: "company", low: "lonely", empty: "desperately lonely" },
  { id: "comfort", label: "comfort", low: "uncomfortable", empty: "miserable" },
  { id: "purpose", label: "purpose", low: "aimless", empty: "lost" },
];

// What a villager can mean by a deed. The model names one with every "do".
export const INTENTS = ["work", "eat", "cook", "socialize", "rest", "pray", "animal", "explore", "other"];

// Where each trade earns its living.
const WORKPLACE = {
  gravedigger: "graveyard", herbalist: "orchard", baker: "bakery", blacksmith: "smithy",
  "retired soldier": "well", "tax collector": "market", "wandering bard": "tavern", fisher: "pond",
  "goat herder": "fields", "apprentice priest": "shrine", midwife: "cottages", "candle maker": "market",
  "village drunk": "tavern", "night watch": "well", beekeeper: "orchard", "widowed innkeeper": "tavern",
  "failed alchemist": "oak", cartographer: "archive",
  "errand runner": "market", "shepherd's helper": "fields", "baker's apprentice": "bakery", "village child": "well",
};
export const workplace = (job) => WORKPLACE[job] ?? "fields";

// Food: where, what it costs, what it gives.
const FOOD = {
  bakery: { cost: 2, hunger: 40, what: "a loaf from the bakery" },
  tavern: { cost: 3, hunger: 50, social: 8, what: "stew and ale at the tavern" },
  orchard: { cost: 0, hunger: 15, what: "an apple from the orchard", dayOnly: true },
  market: { cost: 1, hunger: 20, what: "something cheap from a stall" },
  well: { cost: 0, hunger: 3, what: "a drink of well water" },
};
const SHELTER = new Set(["tavern", "cottages", "bakery", "smithy"]);

export const TITLES = ["novice", "apprentice", "journeyman", "master", "grandmaster"];
const TITLE_AT = [1, 3, 5, 8, 12];
export const levelFor = (xp) => { let l = 1; while (xp >= 40 * l ** 1.5) xp -= 40 * l ** 1.5, l++; return l; };
export const titleFor = (level) => TITLES[TITLE_AT.filter((t) => level >= t).length - 1];

export function freshLife() {
  return { hunger: 80, energy: 100, social: 60, comfort: 70, purpose: 60, health: 100, coins: 10, xp: 0, ill: false, years: 0 };
}

const clamp = (v) => Math.max(0, Math.min(100, v));

// Drain over game hours. `where` is the place id or null; energy is driven by
// the brain's tiredness and passed in as 0..100.
export function drain(life, hours, { where, raining, energy, alone }) {
  const l = { ...life };
  l.energy = energy;
  l.hunger = clamp(l.hunger - 6 * hours);
  // With nobody else in the village, loneliness creeps rather than bites.
  l.social = clamp(l.social - (alone ? 1.5 : 4) * hours);
  l.purpose = clamp(l.purpose - 3 * hours);
  const sheltered = SHELTER.has(where);
  l.comfort = clamp(l.comfort + (raining && !sheltered ? -10 : sheltered ? 4 : -2) * hours);
  // Health follows the body: neglect wears it down, care brings it back.
  const starving = l.hunger <= 0, wrecked = l.comfort <= 0 || l.energy <= 5;
  const cared = NEEDS.every((n) => l[n.id] >= 30);
  l.health = clamp(l.health + (starving ? -8 : wrecked ? -4 : cared ? 3 : 0) * hours);
  return l;
}

// One deed. Returns the new life plus a note in the villager's own terms, which
// goes into its memory so it learns what things cost and give.
export function deed(life, { intent, where, job, level, hour, nearby, animal }) {
  const l = { ...life };
  let note = "", xp = 0;
  if (intent === "eat") {
    const f = FOOD[where];
    // A full belly turns food away, so coins are not spent for nothing.
    if (l.hunger >= 75) note = "You are not hungry; you leave the food and keep your coins.";
    else if (!f) note = "There is nothing to eat here. Food is at the bakery, the tavern, the market, or apples in the orchard by day.";
    else if (f.dayOnly && (hour < 6 || hour >= 20)) note = "It is too dark to find apples.";
    else if (l.coins < f.cost) note = `You cannot afford ${f.what}: it costs ${f.cost} coins and you have ${l.coins}.`;
    else {
      l.coins -= f.cost; l.hunger = clamp(l.hunger + f.hunger); if (f.social) l.social = clamp(l.social + f.social);
      note = `You had ${f.what}${f.cost ? ` for ${f.cost} coins` : ""}.`;
    }
  } else if (intent === "work") {
    if (where !== workplace(job)) note = `You cannot do your work here. A ${job} works at the ${workplace(job)}.`;
    else {
      const pay = Math.round(5 * (1 + (level - 1) * 0.25));
      l.coins += pay; l.purpose = clamp(l.purpose + 15); l.hunger = clamp(l.hunger - 3); xp = 10;
      note = `You worked as a ${job} and earned ${pay} coins.`;
    }
  } else if (intent === "socialize") {
    if (nearby) { l.social = clamp(l.social + 12); xp = 2; note = "Company does you good."; }
    // The tavern is never empty: regulars, the innkeeper, a dog by the fire.
    else if (where === "tavern") { l.social = clamp(l.social + 10); note = "The regulars at the tavern keep you company."; }
    else note = "There is nobody close enough to keep you company. The tavern always has someone."
  } else if (intent === "rest") {
    const sheltered = SHELTER.has(where);
    l.comfort = clamp(l.comfort + (sheltered ? 20 : 8));
    note = sheltered ? "You rest somewhere warm and dry." : "You rest a while in the open.";
  } else if (intent === "pray") {
    if (where !== "shrine") note = "Prayer feels hollow away from the shrine.";
    else { l.purpose = clamp(l.purpose + 10); l.comfort = clamp(l.comfort + 5); note = "Praying at the shrine steadies you."; }
  } else if (intent === "cook") {
    // A meal at a cottage stove: cheaper than buying one, and it fills you.
    if (where !== "cottages") note = "You need a stove to cook: there is one in each cottage.";
    else if (l.hunger >= 75) note = "You are not hungry; you leave the stove cold.";
    else if (l.coins < 1) note = "You have no coin for flour and turnips.";
    else { l.coins -= 1; l.hunger = clamp(l.hunger + 35); l.comfort = clamp(l.comfort + 5); note = "You cooked a simple meal on the stove for 1 coin."; }
  } else if (intent === "animal") {
    // A warm animal comforts; feeding the flock gives a small sense of use.
    if (!animal) note = "There is no animal close enough. Chickens live by the cottages, goats in the fields, ducks on the pond; the cat and the dog roam the square.";
    else if (animal.kind === "cat" || animal.kind === "dog") { l.comfort = clamp(l.comfort + 8); l.social = clamp(l.social + 6); note = `${animal.name} the ${animal.kind} keeps you company for a while.`; }
    else { l.comfort = clamp(l.comfort + 4); l.purpose = clamp(l.purpose + 5); note = `Tending the ${animal.kind}s calms you.`; }
  } else if (intent === "explore") {
    l.purpose = clamp(l.purpose + 4); note = "";
  }
  l.xp += xp;
  return { life: l, note, worked: xp >= 10 };
}

// The one thing the villager should do next, in plain words a small model can
// follow. Night means bed; otherwise the lowest need under 40 wins.
export function urgent(life, { job, hour, energy, where }) {
  if ((hour >= 22 || hour < 5) && energy < 85) return where === "cottages" ? "Lie down in your bed and sleep (action sleep)." : "It is late. Walk to the cottages to your bed (walk_to cottages, intent rest), then sleep.";
  const cure = {
    hunger: life.coins >= 3 ? "Eat: walk to the tavern or the bakery with intent eat." : life.coins >= 1 ? "Cook at home: walk to the cottages with intent cook (1 coin)." : hour >= 6 && hour < 20 ? "Eat: walk to the orchard with intent eat, apples are free." : "You have no coins: work first, or pick apples in the orchard by day.",
    purpose: `Work: walk to the ${workplace(job)} with intent work.`,
    social: "Find company: walk to the tavern with intent socialize, or go to someone and talk.",
    comfort: "Rest somewhere warm: walk to the tavern or the cottages with intent rest.",
    energy: "Rest or sleep: walk to the cottages with intent rest.",
  };
  const worst = ["hunger", "purpose", "social", "comfort", "energy"].map((k) => [k, life[k]]).sort((a, b) => a[1] - b[1])[0];
  if (worst[1] >= 40) return life.coins < 4 ? cure.purpose.replace("Work:", "Earn some coins:") : "";
  return `Most urgent for you now: ${cure[worst[0]]}`;
}

// Speaking to someone who is there counts as a little company.
export function spoke(life) { return { ...life, social: clamp(life.social + 6) }; }

// The state of the body in words, for the prompt.
export function feel(life) {
  const out = [];
  for (const n of NEEDS) {
    const v = life[n.id];
    if (v <= 10) out.push(`You are ${n.empty}.`);
    else if (v <= 35) out.push(`You are ${n.low}.`);
  }
  if (life.health <= 30) out.push("You feel ill and weak.");
  return out;
}
