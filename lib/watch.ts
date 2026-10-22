import "server-only";
import { runSearch } from "./pipeline";
import { bestSummary, type SearchResult, type Watch } from "./scoring";
import { putWatch, saveSearch } from "./store";

const sgd = (v: number) => "S$" + Math.round(v).toLocaleString("en-SG");

/** Re-run a watched search, record the new best trusted price, and say whether it's worth a notification. */
export async function checkWatch(w: Watch): Promise<{ watch: Watch; result: SearchResult; alert: string | null }> {
  const result = await runSearch(w.query, w.includeUsed);
  try {
    result.id = await saveSearch(result);
  } catch {}
  const b = bestSummary(result);
  const now = new Date().toISOString();
  const prev = w.best?.price ?? null;
  const next: Watch = { ...w, lastChecked: now };
  let alert: string | null = null;
  if (b) {
    next.best = b;
    next.history = [...(w.history || []), { t: now, price: b.price, store: b.store }].slice(-60);
    next.lastNote =
      prev == null
        ? null
        : b.price < prev - 0.5
          ? `Dropped ${sgd(prev - b.price)} since the last check.`
          : b.price > prev + 0.5
            ? `Up ${sgd(b.price - prev)} since the last check.`
            : "No change since the last check.";
    const dropped = prev != null && b.price <= prev * 0.98;
    const hitTarget = w.targetPrice != null && b.price <= w.targetPrice && (prev == null || prev > w.targetPrice);
    if (dropped || hitTarget) {
      alert = `${w.product || w.query}: ${sgd(b.price)} at ${b.store}` + (prev != null && b.price < prev ? ` (down ${sgd(prev - b.price)})` : "") + (hitTarget ? ", at or under your target" : "");
    }
  } else {
    next.lastNote = "No trusted offer found on this check.";
  }
  await putWatch(next);
  return { watch: next, result, alert };
}

/** Optional phone notification through ntfy.sh (free app). Set NTFY_TOPIC to a long random name. */
export async function notify(lines: string[]) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic || !lines.length) return false;
  const appUrl = process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
    method: "POST",
    headers: { Title: "Dealproof: price drop", Tags: "label", ...(appUrl ? { Click: appUrl } : {}) },
    body: lines.join("\n").slice(0, 1000),
  }).catch(() => {});
  return true;
}
