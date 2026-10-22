import "server-only";
import type { SearchResult, Watch } from "./scoring";

// Upstash Redis over its REST API. Vercel's Upstash (Redis) integration sets
// KV_REST_API_URL / KV_REST_API_TOKEN; a direct Upstash database gives
// UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN. Either pair works.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
export const hasStore = () => !!(URL_ && TOKEN);

const SEARCHES = "dealproof:searches";
const WATCHES = "dealproof:watches";
export const MAX_SAVED = 25;

async function redis<T = unknown>(...cmd: (string | number)[]): Promise<T> {
  if (!hasStore()) throw new Error("storage_not_configured");
  const res = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(cmd),
    cache: "no-store",
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(body.error || `redis ${res.status}`);
  return body.result as T;
}

async function getAll<T>(key: string): Promise<T[]> {
  const flat = (await redis<string[]>("HGETALL", key)) || [];
  const out: T[] = [];
  for (let i = 0; i < flat.length; i += 2) {
    try {
      out.push({ ...JSON.parse(flat[i + 1]), id: flat[i] });
    } catch {}
  }
  return out;
}

export async function listSearches(): Promise<SearchResult[]> {
  return (await getAll<SearchResult>(SEARCHES)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
export async function listWatches(): Promise<Watch[]> {
  return (await getAll<Watch>(WATCHES)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export async function saveSearch(res: SearchResult): Promise<string> {
  const id = res.id || "s_" + Date.now();
  const { id: _drop, example: _ex, ...body } = res;
  await redis("HSET", SEARCHES, id, JSON.stringify(body));
  const all = await listSearches();
  for (const old of all.slice(MAX_SAVED)) await redis("HDEL", SEARCHES, old.id!);
  return id;
}
export async function deleteSearch(id: string) {
  await redis("HDEL", SEARCHES, id);
}

export async function getWatch(id: string): Promise<Watch | null> {
  const raw = await redis<string | null>("HGET", WATCHES, id);
  return raw ? { ...JSON.parse(raw), id } : null;
}
export async function putWatch(w: Watch) {
  const { id, ...body } = w;
  await redis("HSET", WATCHES, id, JSON.stringify(body));
}
export async function deleteWatch(id: string) {
  await redis("HDEL", WATCHES, id);
}
