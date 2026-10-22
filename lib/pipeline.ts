import "server-only";
import { TYPE, num, type Listing, type SearchResult } from "./scoring";

const PARALLEL = "https://api.parallel.ai/v1";
const ANTHROPIC = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const QUICK_MODEL = process.env.ANTHROPIC_QUICK_MODEL || "claude-haiku-5-5";

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 500,
  ) {
    super(message);
  }
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new AppError("missing_key", `${name} is not set. Add it in your Vercel project settings.`, 500);
  return v;
}

const safeUrl = (u: unknown): string | null => {
  try {
    const x = new URL(String(u));
    return /^https?:$/.test(x.protocol) ? x.href : null;
  } catch {
    return null;
  }
};
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

interface ParallelResult {
  url: string;
  title?: string;
  publish_date?: string | null;
  excerpts?: string[];
}

async function parallelSearch(objective: string, queries: string[], signal?: AbortSignal): Promise<ParallelResult[]> {
  const res = await fetch(`${PARALLEL}/search`, {
    method: "POST",
    headers: { "x-api-key": need("PARALLEL_API_KEY"), "content-type": "application/json" },
    body: JSON.stringify({
      objective,
      search_queries: queries,
      mode: "fast",
      advanced_settings: { max_results: 10, location: "SG" },
    }),
    signal,
  });
  if (res.status === 401 || res.status === 403) throw new AppError("search_auth", "The Parallel API key was rejected. Check PARALLEL_API_KEY.");
  if (!res.ok) throw new AppError("search_failed", `Web search failed (${res.status}).`, 502);
  const body = await res.json();
  return Array.isArray(body?.results) ? body.results : [];
}

async function parallelExtract(url: string, objective: string): Promise<ParallelResult | null> {
  const res = await fetch(`${PARALLEL}/extract`, {
    method: "POST",
    headers: { "x-api-key": need("PARALLEL_API_KEY"), "content-type": "application/json" },
    body: JSON.stringify({ urls: [url], objective }),
  });
  if (!res.ok) throw new AppError("fetch_failed", `Couldn't read that page (${res.status}).`, 502);
  const body = await res.json();
  return Array.isArray(body?.results) && body.results[0] ? body.results[0] : null;
}

async function claudeJSON<T>(prompt: string, model: string, maxTokens: number): Promise<T> {
  const res = await fetch(ANTHROPIC, {
    method: "POST",
    headers: {
      "x-api-key": need("ANTHROPIC_API_KEY"),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
  });
  if (res.status === 401) throw new AppError("claude_auth", "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.");
  if (res.status === 429) throw new AppError("rate_limited", "Claude's API rate limit was reached. Try again in a minute.", 429);
  if (!res.ok) throw new AppError("claude_failed", `Claude's API returned an error (${res.status}).`, 502);
  const body = await res.json();
  const text: string = (body?.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
  return parseJSON<T>(text);
}

function parseJSON<T>(text: string): T {
  const tries: string[] = [text.trim()];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) tries.push(fence[1]);
  const a = text.search(/[{[]/);
  const z = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (a >= 0 && z > a) tries.push(text.slice(a, z + 1));
  for (const t of tries) {
    try {
      return JSON.parse(t) as T;
    } catch {}
  }
  throw new AppError("bad_json", "The listings came back in a form I couldn't read. Search again.", 502);
}

function buildPrompt(q: string, used: boolean, pages: { url: string; title: string; date: string | null; text: string }[]) {
  const today = new Date().toLocaleDateString("en-SG", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Singapore" });
  return `You are checking shopping offers for a buyer in Singapore. Today is ${today}.
Item the buyer wants: "${q}"
Include used and refurbished offers: ${used ? "yes" : "no"}

Below are web search results (title, URL, date, page excerpt). Extract every concrete purchase offer for this exact item that a buyer in Singapore can buy, priced in SGD.

Rules:
- Use only facts that appear in the excerpts. Never invent prices, ratings or policies; use null when something isn't stated.
- Same product only: same model, generation and storage/size if the buyer named one. Skip accessories, cases, spare parts, other models and other generations. If the item name is ambiguous, pick the most likely meaning and explain it in "assumption"; otherwise "assumption" is null.
- ${used ? "Include used, second-hand and refurbished offers and set their condition." : "Skip used, second-hand, refurbished and open-box offers."}
- An offer needs a price from a specific store or seller. Price-comparison sites, reviews and blog posts are not offers; use their typical price ranges for "marketRef" instead. A price-comparison page may still name a specific store and seller with a price; that counts as an offer, using that store's name.
- Skip prices not in SGD unless the page is clearly a Singapore store charging SGD (prices shown as $ on .sg stores are SGD).
- If one page shows several prices (colours, options), use the standard variant's price and mention the variant in "note".
- sellerType: "official" = the brand's own store or its official store on a marketplace (e.g. "Sony Store" on Shopee, a LazMall brand store), or fulfilled by the brand; "authorized" = described as an authorised reseller or distributor; "major_retailer" = established Singapore retailer (Challenger, Courts, Harvey Norman, Best Denki, Gain City, Amazon.sg sold by Amazon, iShopChangi, Apple Premium Reseller and similar); "mall_seller" = Shopee Mall, LazMall or Preferred store that is not the brand; "marketplace_seller" = ordinary third-party seller; "grey_import" = parallel import, overseas set, or international warranty; "unknown".
- warranty: "local" (Singapore or local manufacturer warranty stated), "international", "none" (stated as no warranty), "unknown".
- buyerProtection: true for Shopee/Lazada/Amazon orders (platform guarantee) or when a refund policy is stated.
- priceDate: the page date if given, else null. Prices on pages older than 4 months deserve a warning in "warnings".
- note: one short sentence a buyer should know (variant, collection only, bundle, pre-order, condition details). Under 120 characters, or null.
- warnings: up to 3 short sentences about risks or gaps, such as many fakes reported, prices only from old pages, or no official store found. Empty list if none.

Reply with only JSON in exactly this shape:
{"product": string, "assumption": string|null,
 "listings": [{"store": string, "seller": string|null, "title": string, "url": string, "price": number, "originalPrice": number|null, "shipping": number|null, "condition": "new"|"used"|"refurbished", "sellerType": "official"|"authorized"|"major_retailer"|"mall_seller"|"marketplace_seller"|"grey_import"|"unknown", "rating": number|null, "reviewCount": number|null, "soldCount": number|null, "warranty": "local"|"international"|"none"|"unknown", "warrantyNote": string|null, "returns": string|null, "buyerProtection": boolean, "inStock": boolean|null, "priceDate": string|null, "note": string|null}],
 "marketRef": {"low": number, "high": number, "source": string}|null,
 "warnings": [string]}
At most 15 listings, lowest price first. "url" must be one of the URLs below. "returns" is a short phrase like "15-day free returns" or null.

SEARCH RESULTS
${pages.map((d, i) => `[${i + 1}] ${d.title}\nURL: ${d.url}\nDate: ${d.date || "unknown"}\n${d.text}`).join("\n\n")}`;
}

export async function runSearch(qRaw: string, used: boolean): Promise<SearchResult> {
  const q = String(qRaw || "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (q.length < 2) throw new AppError("bad_query", "Type the item you want to buy.", 400);

  const groups = [
    {
      label: "marketplaces",
      objective: `Singapore marketplace listings with SGD prices for "${q}" on Shopee, Lazada, Amazon.sg and Qoo10, with seller name, store rating, units sold, warranty and returns`,
      queries: [`${q} Shopee Singapore`, `${q} Lazada Singapore`, `${q} Amazon.sg price`],
    },
    {
      label: "official and retail stores",
      objective: `Official brand store and established retailer prices in Singapore (SGD) for "${q}", such as the brand's own website, Challenger, Courts, Harvey Norman, Best Denki, Gain City or iShopChangi, with warranty and return policy`,
      queries: [`${q} price Singapore official store`, `${q} Challenger Courts Harvey Norman`, `${q} price Singapore warranty`],
    },
  ];
  if (used)
    groups.push({
      label: "used and refurbished",
      objective: `Used, second-hand or refurbished offers in Singapore with SGD prices for "${q}" on Carousell, eBay or refurbishers, with condition and seller feedback`,
      queries: [`${q} Carousell`, `${q} refurbished Singapore`, `${q} used price Singapore`],
    });

  const settled = await Promise.allSettled(groups.map((g) => parallelSearch(g.objective, g.queries)));
  const ok = settled.filter((s): s is PromiseFulfilledResult<ParallelResult[]> => s.status === "fulfilled");
  if (!ok.length) {
    const r = (settled[0] as PromiseRejectedResult).reason;
    throw r instanceof AppError ? r : new AppError("search_failed", "The search service didn't answer. Try again in a minute.", 502);
  }
  const failed = groups.filter((_, i) => settled[i].status !== "fulfilled").map((g) => g.label);

  const seen = new Set<string>();
  const docs: { url: string; title: string; date: string | null; text: string }[] = [];
  for (const s of ok)
    for (const r of s.value) {
      const u = safeUrl(r.url);
      if (!u || seen.has(u)) continue;
      seen.add(u);
      const text = (Array.isArray(r.excerpts) ? r.excerpts.join("\n…\n") : "")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{2,}/g, "\n")
        .slice(0, 2400);
      docs.push({ url: u, title: String(r.title || "").trim().slice(0, 200), date: r.publish_date || null, text });
    }
  if (!docs.length) throw new AppError("nothing_found", `The search didn't turn up any pages for that. Try the brand and model name, for example "Dyson V15 Detect".`, 404);
  const pages = docs.slice(0, 30);

  type Out = {
    product?: string;
    assumption?: string | null;
    listings?: Record<string, unknown>[];
    marketRef?: { low?: unknown; high?: unknown; source?: unknown } | null;
    warnings?: unknown[];
  };
  const out = await claudeJSON<Out>(buildPrompt(q, used, pages), MODEL, 8000);

  const S = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
  const listings: Listing[] = (Array.isArray(out?.listings) ? out.listings : [])
    .map((l): Listing | null => {
      const url = safeUrl(l?.url);
      const price = num(l?.price);
      if (!url || !price || price <= 0) return null;
      const cond = ["new", "used", "refurbished"].includes(l.condition as string) ? (l.condition as Listing["condition"]) : "new";
      return {
        store: S(l.store, 80) || host(url),
        seller: S(l.seller, 80),
        title: S(l.title, 200) || "",
        url,
        price,
        originalPrice: num(l.originalPrice),
        shipping: num(l.shipping),
        condition: cond,
        sellerType: (l.sellerType as string) in TYPE ? (l.sellerType as Listing["sellerType"]) : "unknown",
        rating: num(l.rating),
        reviewCount: num(l.reviewCount),
        soldCount: num(l.soldCount),
        warranty: ["local", "international", "none"].includes(l.warranty as string) ? (l.warranty as Listing["warranty"]) : "unknown",
        warrantyNote: S(l.warrantyNote, 60),
        returns: S(l.returns, 60),
        buyerProtection: !!l.buyerProtection,
        inStock: typeof l.inStock === "boolean" ? l.inStock : null,
        priceDate: S(l.priceDate, 20),
        note: S(l.note, 160),
      };
    })
    .filter((l): l is Listing => !!l)
    .filter((l) => used || l.condition === "new")
    .slice(0, 15);

  const mr = out?.marketRef;
  const lo = num(mr?.low);
  const hi = num(mr?.high);
  const marketRef = lo && hi ? { low: lo, high: hi, source: S(mr?.source, 160) || "" } : null;
  const warnings = (Array.isArray(out?.warnings) ? out.warnings : []).map((w) => S(w, 200)).filter((w): w is string => !!w).slice(0, 3);
  if (failed.length) warnings.push(`The search for ${failed.join(" and ")} didn't answer, so those stores may be missing.`);
  if (!listings.length)
    throw new AppError("no_offers", "I found pages about this item but none showed a Singapore price. Try a more specific model name, or include used offers.", 404);

  return {
    query: q,
    includeUsed: used,
    at: new Date().toISOString(),
    product: S(out?.product, 140) || q,
    assumption: S(out?.assumption, 200),
    listings,
    marketRef,
    warnings,
    pages: pages.length,
  };
}

export async function recheckListing(url: string, product: string, note: string | null) {
  const u = safeUrl(url);
  if (!u) throw new AppError("bad_url", "That listing has no valid link.", 400);
  const page = await parallelExtract(u, `Current SGD price, stock and seller for ${product}`);
  const text = page && Array.isArray(page.excerpts) ? page.excerpts.join("\n").slice(0, 6000) : "";
  if (!text) return { price: null, inStock: null, note: "That page couldn't be read just now. Open it to check the price." };
  const out = await claudeJSON<{ price?: unknown; inStock?: unknown; note?: unknown }>(
    `From this store page excerpt, find the current price in SGD for "${product}"${note ? ` (earlier note: ${note})` : ""}. Use the standard variant. Reply with only JSON: {"price": number|null, "inStock": boolean|null, "note": string|null}. "note" is under 80 characters (e.g. "price for black colour", "sold out online"). Use null when the page doesn't show it.\n\nPAGE: ${page?.title || ""}\n${text}`,
    QUICK_MODEL,
    300,
  );
  const price = num(out?.price);
  return {
    price: price && price > 0 ? price : null,
    inStock: typeof out?.inStock === "boolean" ? out.inStock : null,
    note: typeof out?.note === "string" ? out.note.slice(0, 80) : null,
  };
}
