import { NextResponse } from "next/server";
import { COOKIE, tokenFor } from "@/lib/auth";

export async function POST(req: Request) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) {
    return NextResponse.json(
      { message: "APP_PASSWORD isn't set yet. Add it in your Vercel project's environment variables, then redeploy." },
      { status: 500 },
    );
  }
  const { password } = await req.json().catch(() => ({ password: "" }));
  if (typeof password !== "string" || password !== pw) {
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ message: "That password isn't right." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, await tokenFor(pw), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
