// Trust scoring and ranking. Pure functions shared by the browser and the server.

export type Condition = "new" | "used" | "refurbished";
export type SellerType =
  | "official"
  | "authorized"
  | "major_retailer"
  | "mall_seller"
  | "marketplace_seller"
  | "grey_import"
  | "unknown";
export type Warranty = "local" | "international" | "none" | "unknown";

export interface Listing {
  store: string;
  seller: string | null;
  title: string;
  url: string;
  price: number;
  originalPrice: number | null;
  shipping: number | null;
  condition: Condition;
  sellerType: SellerType;
  rating: number | null;
  reviewCount: number | null;
  soldCount: number | null;
  warranty: Warranty;
  warrantyNote: string | null;
  returns: string | null;
  buyerProtection: boolean;
  inStock: boolean | null;
  priceDate: string | null;
  note: string | null;
  checkedAt?: string;
  checkNote?: string;
}

export interface SearchResult {
  id?: string;
  example?: boolean;
  query: string;
  includeUsed: boolean;
  at: string;
  product: string;
  assumption: string | null;
  listings: Listing[];
  marketRef: { low: number; high: number; source: string } | null;
  warnings: string[];
  pages?: number;
}

export interface BestSummary {
  price: number;
  store: string;
  url: string;
  trust: number;
}

export interface Watch {
  id: string;
  query: string;
  product: string;
  includeUsed: boolean;
  targetPrice: number | null;
  best: BestSummary | null;
  history: { t: string; price: number; store: string }[];
  createdAt: string;
  lastChecked: string;
  lastNote: string | null;
}

export type ChipKind = "good" | "warn" | "bad" | "";
export interface Chip {
  label: string;
  k: ChipKind;
}
export type Band = "high" | "fair" | "low";
export interface ScoredListing extends Listing {
  i: number;
  total: number;
  score: number;
  band: Band;
  chips: Chip[];
  tooCheap: boolean;
}

export const TYPE: Record<SellerType, { pts: number; label: string; k: ChipKind }> = {
  official: { pts: 40, label: "Brand's own store", k: "good" },
  authorized: { pts: 35, label: "Authorized seller", k: "good" },
  major_retailer: { pts: 31, label: "Established retailer", k: "good" },
  mall_seller: { pts: 27, label: "Mall / verified store", k: "good" },
  marketplace_seller: { pts: 14, label: "Marketplace seller", k: "" },
  grey_import: { pts: 8, label: "Parallel import", k: "warn" },
  unknown: { pts: 8, label: "Seller not verified", k: "warn" },
};

export const num = (v: unknown): number | null =>
  typeof v === "number" && isFinite(v)
    ? v
    : typeof v === "string" && v.trim() !== "" && isFinite(+v)
      ? +v
      : null;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
export const compact = (n: number) =>
  n >= 1e6
    ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "m"
    : n >= 1e3
      ? (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k"
      : String(n);

function median(arr: number[]): number | null {
  const a = arr.slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Typical price: median of new offers when there are enough, else the market range midpoint. */
export function refPrice(res: SearchResult): number | null {
  const news = (res.listings || []).filter((l) => l.condition === "new").map((l) => l.price);
  if (news.length >= 4) return median(news);
  const lo = num(res.marketRef?.low);
  const hi = num(res.marketRef?.high);
  if (lo && hi) return (lo + hi) / 2;
  if (news.length) return median(news);
  return null;
}

export function scoreListing(l: Listing, ref: number | null) {
  const t = TYPE[l.sellerType] || TYPE.unknown;
  let raw = t.pts;
  const chips: Chip[] = [{ label: t.label, k: t.k }];
  let r = num(l.rating);
  if (r != null && r > 5 && r <= 100) r = clamp(4 + (r - 95) / 5, 0, 5); // percent-positive feedback
  const reviews = num(l.reviewCount) || 0;
  const sold = num(l.soldCount) || 0;
  const vol = reviews + sold;
  if (r != null && r > 0) {
    raw += clamp(r - 4, 0, 1) * 14;
    chips.push({
      label: r.toFixed(1) + "★" + (reviews ? " · " + compact(reviews) + " ratings" : ""),
      k: r >= 4.7 ? "good" : r < 4.3 ? "warn" : "",
    });
  } else if (reviews) chips.push({ label: compact(reviews) + " ratings", k: "" });
  if (sold) chips.push({ label: compact(sold) + " sold", k: "" });
  if (vol > 0) raw += clamp(Math.log10(vol) / 4, 0, 1) * 11;
  if (l.warranty === "local") {
    raw += 15;
    chips.push({ label: "SG warranty" + (l.warrantyNote ? " · " + trunc(l.warrantyNote, 32) : ""), k: "good" });
  } else if (l.warranty === "international") {
    raw += 6;
    chips.push({ label: "International warranty", k: "warn" });
  } else if (l.warranty === "none") chips.push({ label: "No warranty", k: "bad" });
  else chips.push({ label: "Warranty not stated", k: "" });
  if (l.returns) {
    raw += 8;
    chips.push({ label: trunc(l.returns, 40), k: "good" });
  } else if (l.buyerProtection) {
    raw += 6;
    chips.push({ label: "Buyer protection", k: "good" });
  }
  if (l.condition === "used") {
    raw -= 6;
    chips.push({ label: "Used", k: "warn" });
  } else if (l.condition === "refurbished") {
    raw -= 3;
    chips.push({ label: "Refurbished", k: "warn" });
  }
  let tooCheap = false;
  if (ref) {
    const lim = l.condition === "new" ? 0.7 : 0.45;
    if (l.price < ref * lim) {
      tooCheap = true;
      raw -= 25;
      chips.unshift({ label: Math.round((1 - l.price / ref) * 100) + "% under typical price", k: "bad" });
    }
  }
  if (l.inStock === false) chips.push({ label: "Out of stock", k: "bad" });
  const score = Math.round(clamp((raw / 88) * 100, 0, 100));
  const band: Band = tooCheap ? "low" : score >= 70 ? "high" : score >= 45 ? "fair" : "low";
  return { score, band, chips, tooCheap };
}

export function enrich(res: SearchResult): { ref: number | null; items: ScoredListing[] } {
  const ref = refPrice(res);
  const items = (res.listings || []).map((l, i) => ({
    ...l,
    i,
    total: l.price + (num(l.shipping) || 0),
    ...scoreListing(l, ref),
  }));
  return { ref, items };
}

/** Cheapest in-stock offer with high trust, else fair trust. Too-cheap offers never win. */
export function pickBest(items: ScoredListing[]): { item: ScoredListing; rule: Band } | null {
  const ok = items.filter((x) => x.inStock !== false && !x.tooCheap);
  for (const b of ["high", "fair"] as Band[]) {
    const c = ok.filter((x) => x.band === b).sort((a, z) => a.total - z.total);
    if (c.length) return { item: c[0], rule: b };
  }
  return null;
}

const BAND_RANK: Record<Band, number> = { high: 0, fair: 1, low: 2 };
export type SortKey = "value" | "cheapest" | "trusted";
export function sortItems(items: ScoredListing[], how: SortKey): ScoredListing[] {
  const a = items.slice();
  if (how === "cheapest") a.sort((x, y) => x.total - y.total);
  else if (how === "trusted") a.sort((x, y) => y.score - x.score || x.total - y.total);
  else
    a.sort(
      (x, y) =>
        BAND_RANK[x.band] - BAND_RANK[y.band] ||
        Number(x.inStock === false) - Number(y.inStock === false) ||
        x.total - y.total,
    );
  return a;
}

export function bestSummary(res: SearchResult): BestSummary | null {
  const b = pickBest(enrich(res).items);
  if (!b) return null;
  return {
    price: b.item.total,
    store: b.item.store + (b.item.seller ? " · " + b.item.seller : ""),
    url: b.item.url,
    trust: b.item.score,
  };
}

export const watchId = (query: string, includeUsed: boolean) =>
  "w_" +
  (String(query)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "item") +
  (includeUsed ? "_u" : "");
