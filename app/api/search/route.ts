import { NextResponse } from "next/server";
import { runSearch } from "@/lib/pipeline";
import { hasStore, saveSearch } from "@/lib/store";
import { errorResponse } from "@/lib/http";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { query, includeUsed } = await req.json();
    const result = await runSearch(String(query || ""), !!includeUsed);
    if (hasStore()) {
      try {
        result.id = await saveSearch(result);
      } catch (e) {
        console.error("save failed", e);
      }
    }
    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
