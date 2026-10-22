import { NextResponse } from "next/server";
import { hasStore, listWatches } from "@/lib/store";
import { checkWatch, notify } from "@/lib/watch";

// Runs daily from vercel.json. Vercel sends "Authorization: Bearer $CRON_SECRET".
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  if (!hasStore()) return NextResponse.json({ checked: 0, message: "No storage configured." });

  const started = Date.now();
  const watches = await listWatches();
  const alerts: string[] = [];
  const results: { id: string; ok: boolean; price?: number; error?: string }[] = [];
  for (const w of watches) {
    if (Date.now() - started > 240_000) break; // stay inside the function time limit; the rest run tomorrow
    try {
      const { watch, alert } = await checkWatch(w);
      results.push({ id: w.id, ok: true, price: watch.best?.price });
      if (alert) alerts.push(alert);
    } catch (e) {
      results.push({ id: w.id, ok: false, error: e instanceof Error ? e.message : "failed" });
    }
  }
  const notified = await notify(alerts);
  return NextResponse.json({ checked: results.length, of: watches.length, alerts, notified, results });
}
