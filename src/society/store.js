// The society keeps many small values rather than one big one, so a Durable
// Object's per-value limit is never near. Every store offers the same four
// calls as Durable Object storage: get, put, delete, list({ prefix }).

// In memory: tests, and the fallback when nothing else is given.
export class MemoryStore {
  constructor() { this.m = new Map(); }
  async get(k) { const v = this.m.get(k); return v === undefined ? undefined : structuredClone(v); }
  async put(k, v) { this.m.set(k, structuredClone(v)); }
  async delete(k) { this.m.delete(k); }
  async list({ prefix = "" } = {}) {
    const out = new Map();
    for (const k of [...this.m.keys()].sort()) if (k.startsWith(prefix)) out.set(k, structuredClone(this.m.get(k)));
    return out;
  }
}

// Bun locally: one SQLite file beside the code.
export async function bunStore(path) {
  const { Database } = await import("bun:sqlite");
  const db = new Database(path);
  db.run("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
  const get = db.query("SELECT v FROM kv WHERE k = ?"), put = db.query("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)");
  const del = db.query("DELETE FROM kv WHERE k = ?"), list = db.query("SELECT k, v FROM kv WHERE k >= ? AND k < ? ORDER BY k");
  return {
    async get(k) { const r = get.get(k); return r ? JSON.parse(r.v) : undefined; },
    async put(k, v) { put.run(k, JSON.stringify(v)); },
    async delete(k) { del.run(k); },
    async list({ prefix = "" } = {}) { return new Map(list.all(prefix, prefix + "￿").map((r) => [r.k, JSON.parse(r.v)])); },
  };
}
