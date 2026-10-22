import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { bestSummary, num, watchId, type Listing, type SearchResult, type Watch } from "@/lib/scoring";
import { deleteSearch, deleteWatch, getWatch, hasStore, listSearches, listWatches, putWatch, saveSearch } from "@/lib/store";
import { checkWatch } from "@/lib/watch";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasStore()) return NextResponse.json({ storage: false, searches: [], watches: [] });
  try {
    const [searches, watches] = await Promise.all([listSearches(), listWatches()]);
    return NextResponse.json({ storage: true, searches, watches });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const id = typeof body.id === "string" ? body.id.slice(0, 120) : "";
    switch (body.action) {
      case "deleteSearch":
        await deleteSearch(id);
        return NextResponse.json({ ok: true });

      case "updateListings": {
        const searches = await listSearches();
        const s = searches.find((x) => x.id === id);
        if (!s) return NextResponse.json({ ok: false }, { status: 404 });
        s.listings = (Array.isArray(body.listings) ? body.listings : s.listings).slice(0, 15) as Listing[];
        await saveSearch(s);
        return NextResponse.json({ ok: true });
      }

      case "watch": {
        const r = body.result as SearchResult;
        const best = r && bestSummary(r);
        if (!best) return NextResponse.json({ code: "no_best", message: "There's no trusted offer to watch yet." }, { status: 400 });
        const now = new Date().toISOString();
        const w: Watch = {
          id: watchId(r.query, !!r.includeUsed),
          query: String(r.query).slice(0, 120),
          product: String(r.product || r.query).slice(0, 140),
          includeUsed: !!r.includeUsed,
          targetPrice: null,
          best,
          history: [{ t: now, price: best.price, store: best.store }],
          createdAt: now,
          lastChecked: r.at || now,
          lastNote: null,
        };
        await putWatch(w);
        return NextResponse.json({ watch: w });
      }

      case "unwatch":
        await deleteWatch(id);
        return NextResponse.json({ ok: true });

      case "target": {
        const w = await getWatch(id);
        if (!w) return NextResponse.json({ ok: false }, { status: 404 });
        const v = num(body.targetPrice);
        w.targetPrice = v != null && v > 0 ? Math.round(v * 100) / 100 : null;
        await putWatch(w);
        return NextResponse.json({ watch: w });
      }

      case "checkWatch": {
        const w = await getWatch(id);
        if (!w) return NextResponse.json({ ok: false }, { status: 404 });
        const { watch, result } = await checkWatch(w);
        return NextResponse.json({ watch, result });
      }
    }
    return NextResponse.json({ code: "bad_action", message: "Unknown action." }, { status: 400 });
  } catch (e) {
    return errorResponse(e);
  }
}
