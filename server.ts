// Local server: static files plus the village over a websocket.
// On Cloudflare the same Village runs in a Durable Object (worker.js).

import { Village } from "./src/village.js";
import { dayPhase } from "./public/shared/world.js";
import { join, normalize } from "node:path";

import { bunStore } from "./src/society/store.js";

// Local stand-in for Durable Object storage: one SQLite file beside the code.
const store = await bunStore(join(import.meta.dir, process.env.OMEN_DB ?? ".society-local.sqlite"));
const society = { openAt: Number(process.env.OMEN_OPEN_AT ?? 20), voteMin: Number(process.env.OMEN_VOTE_MIN ?? 3) };

const PORT = Number(process.env.PORT ?? 7777);
const PUBLIC = join(import.meta.dir, "public");
const village = new Village({ startHour: Number(process.env.OMEN_HOUR ?? 8), dayMinutes: Number(process.env.OMEN_DAY_MINUTES ?? 0), weather: process.env.OMEN_WEATHER ?? "", store, society });

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".ico": "image/x-icon",
};

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      // Only our own page may open the village; other sites cannot puppet it.
      if (req.headers.get("Origin") !== url.origin) return new Response("forbidden", { status: 403 });
      return server.upgrade(req, { data: { ip: server.requestIP(req)?.address ?? "" } }) ? undefined : new Response("upgrade failed", { status: 400 });
    }
    if (url.pathname === "/results.json") { await village.society?.load(); return Response.json(village.results() ?? {}); }
    if (url.pathname === "/society.json") { await village.society?.load(); return Response.json(village.board() ?? {}); }
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    const path = join(PUBLIC, rel === "/" ? "index.html" : rel);
    if (!path.startsWith(PUBLIC)) return new Response("no", { status: 403 });
    const f = Bun.file(path);
    if (!(await f.exists())) return new Response("not found", { status: 404 });
    const ext = path.slice(path.lastIndexOf("."));
    return new Response(f, { headers: { "content-type": TYPES[ext] ?? "application/octet-stream", "cache-control": "no-cache" } });
  },
  websocket: {
    open(ws) { (ws as any).c = village.open(ws, (ws.data as any).ip); },
    message(ws, raw) { village.message((ws as any).c, raw); },
    close(ws) { village.close((ws as any).c); },
  },
});

console.log(`Omen: Hollowmere is awake at http://localhost:${PORT} (${dayPhase(village.clock()).label})`);
