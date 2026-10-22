import { NextResponse } from "next/server";
import { AppError, recheckListing } from "@/lib/pipeline";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { url, product, note } = await req.json();
    return NextResponse.json(await recheckListing(String(url || ""), String(product || "this item"), note ? String(note) : null));
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ code: e.code, message: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ code: "server_error", message: "Couldn't re-check that page." }, { status: 500 });
  }
}
