// On Cloudflare, static assets are served by Cloudflare before this code runs;
// only /ws reaches the Worker, which hands it to the one Durable Object that
// holds the village. One village for everyone, so one object by name.

import { DurableObject } from "cloudflare:workers";
import { Village } from "./src/village.js";

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      if (req.headers.get("Upgrade") !== "websocket") return new Response("expected a websocket", { status: 426 });
      // Only our own page may open the village; other sites cannot puppet it.
      if (req.headers.get("Origin") !== url.origin) return new Response("forbidden", { status: 403 });
      // Upgrades per address are throttled before they reach the village.
      const ip = req.headers.get("CF-Connecting-IP") ?? "";
      if (!(await env.WS_LIMIT.limit({ key: ip || "unknown" })).success) return new Response("slow down", { status: 429 });
      // The object learns the address from this header only; ours replaces any the client sent.
      const fwd = new Request(req);
      fwd.headers.set("X-Client-IP", ip);
      return env.VILLAGE.get(env.VILLAGE.idFromName("hollowmere")).fetch(fwd);
    }
    if (url.pathname === "/results.json" || url.pathname === "/society.json") return env.VILLAGE.get(env.VILLAGE.idFromName("hollowmere")).fetch(req);
    return env.ASSETS.fetch(req);
  },
};

// Non-hibernating sockets on purpose: the village ticks every 60 ms while anyone
// is connected, and stops its timers when the last one leaves.
export class VillageObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const society = { openAt: Number(env.OMEN_OPEN_AT ?? 20), voteMin: Number(env.OMEN_VOTE_MIN ?? 3) };
    this.village = new Village({ startHour: 8, store: ctx.storage, society });
  }
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/results.json" || path === "/society.json") {
      await this.village.society?.load();
      const body = path === "/results.json" ? this.village.results() : this.village.board();
      return new Response(JSON.stringify(body ?? {}), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "max-age=30", "access-control-allow-origin": "*" } });
    }
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const c = this.village.open(server, req.headers.get("X-Client-IP") ?? "");
    server.addEventListener("message", (e) => this.village.message(c, e.data));
    const bye = () => this.village.close(c);
    server.addEventListener("close", bye);
    server.addEventListener("error", bye);
    return new Response(null, { status: 101, webSocket: client });
  }
}
