// bun test: the village's per-type gaps, driven through message() with fake sockets.
import { test, expect, afterEach } from "bun:test";
import { Village } from "../src/village.js";

const realNow = Date.now;
let clock = realNow.call(Date), villages = [];
Date.now = () => clock;
afterEach(() => { for (const v of villages) v.sleep(); villages = []; });

function join(name = "Ada") {
  const v = new Village({ startHour: 12 });
  villages.push(v);
  const frames = [];
  const sock = { send: (s) => frames.push(JSON.parse(s)), close() {} };
  const c = v.open(sock, "1.1.1.1");
  v.message(c, JSON.stringify({ t: "hello", role: "mortal", device: "d1", profile: { name, job: "farmer" } }));
  const a = [...v.agents.values()][0];
  const send = (m) => v.message(c, JSON.stringify(m));
  const events = (kind) => frames.filter((f) => f.t === "event" && f.e.kind === kind).length;
  return { v, c, a, send, events };
}

// The token bucket is 10 per second, so each step moves the clock past a refill.
const later = (ms) => { clock += ms; };

test("a second tend inside the gap is dropped, one after it is heard", () => {
  const { v, a, send, events } = join();
  v.animals.length = 0; v.animals.push({ id: "c1", kind: "cat", name: "Tom", x: a.x, y: a.y, act: "idle", path: [] });
  send({ t: "tend" });
  expect(events("animal")).toBe(1);
  later(1000); send({ t: "tend" });
  expect(events("animal")).toBe(1);
  later(4000); send({ t: "tend" });
  expect(events("animal")).toBe(2);
});

test("levelup: a change inside the gap is dropped, one after it is heard", () => {
  const { a, send, events } = join();
  send({ t: "levelup", level: 2, title: "novice" });
  expect(events("level")).toBe(1);
  later(1000); send({ t: "levelup", level: 3, title: "novice" });
  expect(events("level")).toBe(1);
  expect(a.level).toBe(2);
  later(3000); send({ t: "levelup", level: 3, title: "novice" });
  expect(events("level")).toBe(2);
  expect(a.level).toBe(3);
});

test("wake: the villager always wakes, the chronicle line is rationed", () => {
  const { a, send, events } = join();
  for (const gap of [0, 1000, 6000]) {
    later(gap);
    a.asleep = true; send({ t: "wake", mood: "rested" });
    expect(a.asleep).toBe(false);
  }
  expect(events("wake")).toBe(2);
});
