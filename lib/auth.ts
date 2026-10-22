// Single-user password gate. The cookie holds a hash of the password, so
// changing APP_PASSWORD signs every device out.
export const COOKIE = "dealproof_auth";

export async function tokenFor(password: string): Promise<string> {
  const data = new TextEncoder().encode("dealproof:v1:" + password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function isAuthed(cookieValue: string | undefined): Promise<boolean> {
  const pw = process.env.APP_PASSWORD;
  if (!pw || !cookieValue) return false;
  return cookieValue === (await tokenFor(pw));
}
