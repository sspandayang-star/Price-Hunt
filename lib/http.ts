import { NextResponse } from "next/server";
import { AppError } from "./pipeline";

export function errorResponse(e: unknown) {
  if (e instanceof AppError) return NextResponse.json({ code: e.code, message: e.message }, { status: e.status });
  if (e instanceof Error && e.message === "storage_not_configured")
    return NextResponse.json({ code: "no_storage", message: "Saving needs a Redis database. See the README." }, { status: 501 });
  console.error(e);
  return NextResponse.json({ code: "server_error", message: "Something went wrong. Try again in a moment." }, { status: 500 });
}
