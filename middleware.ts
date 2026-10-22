import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, isAuthed } from "./lib/auth";

export async function middleware(req: NextRequest) {
  if (await isAuthed(req.cookies.get(COOKIE)?.value)) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ code: "signed_out", message: "Sign in again." }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the sign-in page, the daily check (it has its own secret),
  // Next.js internals and the files a phone needs to install the app.
  matcher: [
    "/((?!login|api/login|api/cron|_next/static|_next/image|favicon.ico|icon-.*\\.png|apple-touch-icon\\.png|manifest\\.webmanifest|sw\\.js).*)",
  ],
};
