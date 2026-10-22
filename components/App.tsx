"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { EXAMPLE } from "@/lib/example";
import {
  enrich,
  pickBest,
  sortItems,
  watchId,
  num,
  type Band,
  type Chip,
  type ScoredListing,
  type SearchResult,
  type SortKey,
  type Watch,
} from "@/lib/scoring";

const MAX_SAVED = 25;
const BAND_LABEL: Record<Band, string> = { high: "High trust", fair: "Fair", low: "Low trust" };
const BAND_COLOR: Record<Band, string> = { high: "var(--good)", fair: "var(--warn)", low: "var(--bad)" };

const money = (v: number | null | undefined) =>
  v == null ? "–" : "S$" + Number(v).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = (v: number | null | undefined) => (v == null ? "–" : "S$" + Math.round(v).toLocaleString("en-SG"));
const safeUrl = (u: string) => {
  try {
    const x = new URL(u);
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
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
function ago(iso?: string | null) {
  const t = iso ? Date.parse(iso) : NaN;
  if (!t) return "";
  const m = Math.round((Date.now() - t) / 60000);
  const date = () => new Date(t).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" });
  if (m < 1 && m > -5) return "just now";
  if (m < 0) return date();
  if (m < 60) return m + " min ago";
  const h = Math.round(m / 60);
  if (h < 24) return h + " h ago";
  const d = Math.round(h / 24);
  if (d < 8) return d + (d === 1 ? " day ago" : " days ago");
  return date();
}

type ApiError = { code?: string; message?: string };
class RequestError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      cache: "no-store",
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new RequestError("cancelled", "Stopped.");
    throw new RequestError("offline", "Couldn't reach Price Hunt. Check your connection and try again.");
  }
  if (res.status === 401) {
    window.location.href = "/login";
    throw new RequestError("signed_out", "Sign in again.");
  }
  const data = (await res.json().catch(() => ({}))) as T & ApiError;
  if (!res.ok) throw new RequestError(data.code || "server_error", data.message || "Something went wrong. Try again in a moment.");
  return data;
}

function Chips({ chips }: { chips: Chip[] }) {
  return (
    <div className="chips">
      {chips.map((c, i) => (
        <span key={i} className={"chip " + c.k}>
          {c.label}
        </span>
      ))}
    </div>
  );
}

function Spark({ hist }: { hist: Watch["history"] }) {
  const pts = (hist || []).filter((p) => num(p.price) != null).slice(-30);
  if (pts.length < 2) return null;
  const W = 260, H = 36, pad = 4;
  const ys = pts.map((p) => p.price);
  const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
  const xy = pts.map((p, i) => [pad + (i * (W - 2 * pad)) / (pts.length - 1), pad + (1 - (p.price - lo) / span) * (H - 2 * pad)]);
  const last = xy[xy.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Price history from ${money0(ys[0])} to ${money0(ys[ys.length - 1])}`}>
      <polyline points={xy.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ")} />
      <circle cx={last[0].toFixed(1)} cy={last[1].toFixed(1)} r="3.5" />
    </svg>
  );
}

export default function App() {
  const [tab, setTab] = useState<"results" | "saved" | "watch">("results");
  const [current, setCurrent] = useState<SearchResult>(EXAMPLE);
  const [sort, setSort] = useState<SortKey>("value");
  const [saved, setSaved] = useState<SearchResult[]>([]);
  const [watches, setWatches] = useState<Watch[]>([]);
  const [storage, setStorage] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState<{ title: string; text: string; bad?: boolean } | null>(null);
  const [rechecking, setRechecking] = useState<Set<number>>(new Set());
  const [watchBusy, setWatchBusy] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [used, setUsed] = useState(false);
  const ctlRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    try {
      const d = await api<{ storage: boolean; searches: SearchResult[]; watches: Watch[] }>("/api/data");
      setStorage(d.storage);
      setSaved(d.searches);
      setWatches(d.watches);
    } catch {
      setStorage(false);
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [busy]);

  const showError = (e: unknown) => {
    const err = e as RequestError;
    if (err.code === "cancelled" || err.code === "signed_out") return;
    const titles: Record<string, string> = {
      nothing_found: "Nothing found",
      no_offers: "No offers found",
      missing_key: "Setup isn't finished",
      search_auth: "Search key rejected",
      claude_auth: "Anthropic key rejected",
      rate_limited: "Too many requests",
      offline: "You're offline",
      no_storage: "Saving isn't set up",
    };
    setNotice({ title: titles[err.code] || "Something went wrong", text: err.message, bad: true });
  };

  async function doSearch(q: string, includeUsed: boolean) {
    q = q.trim().replace(/\s+/g, " ").slice(0, 120);
    if (q.length < 2 || busy) return;
    setNotice(null);
    setTab("results");
    setSort("value");
    const ctl = new AbortController();
    ctlRef.current = ctl;
    setBusy(true);
    try {
      const res = await api<SearchResult>("/api/search", { query: q, includeUsed }, ctl.signal);
      setCurrent(res);
      if (res.id) refresh();
    } catch (e) {
      showError(e);
    } finally {
      ctlRef.current = null;
      setBusy(false);
    }
  }

  async function recheck(i: number) {
    const l = current.listings[i];
    if (!l || rechecking.has(i)) return;
    setRechecking((s) => new Set(s).add(i));
    let patch: Partial<typeof l> = {};
    try {
      const r = await api<{ price: number | null; inStock: boolean | null; note: string | null }>("/api/recheck", {
        url: l.url,
        product: current.product || current.query,
        note: l.note,
      });
      patch = {
        ...(r.price ? { price: r.price } : {}),
        ...(typeof r.inStock === "boolean" ? { inStock: r.inStock } : {}),
        checkedAt: new Date().toISOString(),
        checkNote: r.price ? `${money(r.price)}${r.note ? ", " + r.note : ""}` : r.note || "no price shown on the page",
      };
    } catch (e) {
      patch = { checkedAt: new Date().toISOString(), checkNote: (e as Error).message };
    }
    const listings = current.listings.map((x, j) => (j === i ? { ...x, ...patch } : x));
    const next = { ...current, listings };
    setCurrent(next);
    setRechecking((s) => {
      const n = new Set(s);
      n.delete(i);
      return n;
    });
    if (next.id && storage) api("/api/data", { action: "updateListings", id: next.id, listings }).then(refresh).catch(() => {});
  }

  async function addWatch() {
    const id = watchId(current.query, current.includeUsed);
    setWatchBusy((s) => new Set(s).add(id));
    try {
      await api("/api/data", { action: "watch", result: current });
      await refresh();
    } catch (e) {
      showError(e);
    }
    setWatchBusy((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
  }

  async function checkWatch(id: string) {
    if (busy) return;
    setNotice(null);
    setWatchBusy((s) => new Set(s).add(id));
    setBusy(true);
    try {
      const r = await api<{ watch: Watch; result: SearchResult }>("/api/data", { action: "checkWatch", id });
      setCurrent(r.result);
      await refresh();
    } catch (e) {
      showError(e);
    }
    setBusy(false);
    setWatchBusy((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
  }

  async function act(body: Record<string, unknown>) {
    try {
      await api("/api/data", body);
    } catch (e) {
      showError(e);
    }
    await refresh();
  }

  async function signOut() {
    await fetch("/api/login", { method: "DELETE" }).catch(() => {});
    window.location.href = "/login";
  }

  // ---------- results ----------
  const { ref, items } = enrich(current);
  const best = pickBest(items);
  const isWatching = watches.some((w) => w.id === watchId(current.query, current.includeUsed));
  const newCount = current.listings.filter((l) => l.condition === "new").length;

  const results = (
    <div className="stack">
      {current.example && <div className="example-flag">Example result from a real search on 23 Oct 2026. Search for anything to replace it.</div>}
      <div className="res-head">
        <h2>{current.product || current.query}</h2>
        <p className="meta">
          {ref ? (
            <>
              Typical price <b>{money0(ref)}</b> ·{" "}
            </>
          ) : null}
          {items.length} offer{items.length === 1 ? "" : "s"} found · {current.includeUsed ? "new and used" : "new only"} · searched{" "}
          {current.example ? "23 Oct 2026" : ago(current.at)}
        </p>
        {current.assumption && <p className="assume">Assumed: {current.assumption}</p>}
      </div>

      {best ? (
        <BestCard
          b={best.item}
          rule={best.rule}
          ref_={ref}
          watching={isWatching}
          canWatch={!!storage && !current.example}
          busy={watchBusy.has(watchId(current.query, current.includeUsed))}
          onWatch={addWatch}
        />
      ) : (
        <section className="tag none">
          <div className="tag-label">No safe pick</div>
          <p className="note">
            None of the in-stock offers reached fair trust, or the cheap ones look too good to be true. Compare the offers below with care, or try a more specific search.
          </p>
        </section>
      )}

      {items.length > 0 && (
        <>
          <div className="sortbar">
            <span>Sort</span>
            {(
              [
                ["value", "Best value"],
                ["cheapest", "Cheapest"],
                ["trusted", "Most trusted"],
              ] as [SortKey, string][]
            ).map(([k, l]) => (
              <button key={k} type="button" className="seg" aria-pressed={sort === k} onClick={() => setSort(k)}>
                {l}
              </button>
            ))}
          </div>
          <div className="ledger">
            {sortItems(items, sort).map((x) => (
              <Row key={x.i + x.url} x={x} canRecheck={!current.example} busy={rechecking.has(x.i)} onRecheck={() => recheck(x.i)} />
            ))}
          </div>
        </>
      )}
      {current.warnings?.length > 0 && (
        <ul className="warnings">
          {current.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {ref && current.marketRef?.source && (
        <p className="fine">
          Typical price uses {newCount >= 4 ? "the median of new offers found" : "the range from " + trunc(current.marketRef.source, 120)}.
        </p>
      )}
    </div>
  );

  // ---------- saved ----------
  const savedView =
    storage === false ? (
      <div className="empty">
        <h3>Saving isn&apos;t set up yet</h3>
        <p>Connect an Upstash Redis database in Vercel (see the README) and every search you run is kept here.</p>
      </div>
    ) : !saved.length ? (
      <div className="empty">
        <h3>No saved searches yet</h3>
        <p>Every search you run is saved here automatically, so you can come back to the results. The latest {MAX_SAVED} are kept.</p>
      </div>
    ) : (
      <div className="list">
        {saved.map((s) => {
          const b = pickBest(enrich(s).items);
          const conf = confirm === s.id;
          return (
            <div className="item" key={s.id}>
              <div className="item-head">
                <h3>{s.product || s.query}</h3>
                <span className="price">{b ? money(b.item.total) : "–"}</span>
              </div>
              <p className="item-meta">
                {b ? b.item.store + " · " : ""}
                {s.listings.length} offers · {s.includeUsed ? "new and used" : "new only"} · {ago(s.at)}
              </p>
              <div className="item-actions">
                <button
                  className="btn small primary"
                  type="button"
                  onClick={() => {
                    setCurrent(s);
                    setSort("value");
                    setTab("results");
                    setConfirm(null);
                  }}
                >
                  View results
                </button>
                <button
                  className="btn small"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setQuery(s.query);
                    setUsed(!!s.includeUsed);
                    doSearch(s.query, !!s.includeUsed);
                  }}
                >
                  Search again
                </button>
                <button
                  className={"btn small " + (conf ? "danger" : "ghost")}
                  type="button"
                  onClick={() => {
                    if (!conf) return setConfirm(s.id!);
                    setConfirm(null);
                    act({ action: "deleteSearch", id: s.id });
                  }}
                >
                  {conf ? "Tap again to remove" : "Remove"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );

  // ---------- watching ----------
  const watchView =
    storage === false ? (
      <div className="empty">
        <h3>Price watching isn&apos;t set up yet</h3>
        <p>Connect an Upstash Redis database in Vercel (see the README) to watch prices.</p>
      </div>
    ) : (
      <>
        <p className="watch-intro">Checked every morning at 8:40 (Singapore time). Set NTFY_TOPIC to get a phone notification when a trusted price drops or reaches your target.</p>
        {!watches.length ? (
          <div className="empty">
            <h3>Nothing watched yet</h3>
            <p>Run a search and tap Watch price on the best buy. Set a target price and Price Hunt will tell you when a trusted seller hits it.</p>
          </div>
        ) : (
          <div className="list">
            {watches.map((w) => (
              <WatchItem
                key={w.id}
                w={w}
                busy={watchBusy.has(w.id)}
                disabled={busy}
                confirming={confirm === w.id}
                onCheck={() => checkWatch(w.id)}
                onTarget={(v) => act({ action: "target", id: w.id, targetPrice: v })}
                onStop={() => {
                  if (confirm !== w.id) return setConfirm(w.id);
                  setConfirm(null);
                  act({ action: "unwatch", id: w.id });
                }}
              />
            ))}
          </div>
        )}
      </>
    );

  return (
    <div className="wrap">
      <header className="mast">
        <div>
          <h1>
            Price <span>Hunt</span>
          </h1>
          <p className="sub">The cheapest price you can trust, across Singapore stores and marketplaces. Prices in SGD.</p>
        </div>
        <button className="linkbtn" type="button" onClick={signOut}>
          Sign out
        </button>
      </header>

      <form
        className="search"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          doSearch(query, used);
        }}
      >
        <label htmlFor="q" className="vh">
          What are you buying?
        </label>
        <div className="field">
          <input
            id="q"
            type="search"
            enterKeyHint="search"
            placeholder="e.g. Dyson V15 Detect, iPhone 17 256GB, Sony WH-1000XM5"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn primary" type="submit" disabled={busy || query.trim().length < 2}>
            {busy ? "Searching…" : "Find the best deal"}
          </button>
        </div>
        <label className="switch" htmlFor="used">
          <input id="used" type="checkbox" checked={used} onChange={(e) => setUsed(e.target.checked)} /> Include used &amp; refurbished
        </label>
      </form>

      {notice && (
        <div className={"notice" + (notice.bad ? " bad" : "")} role="alert">
          <strong>{notice.title}</strong>
          {notice.text}
        </div>
      )}

      <nav className="tabs" role="tablist" aria-label="Views">
        {(
          [
            ["results", "Results", null],
            ["saved", "Saved", saved.length],
            ["watch", "Watching", watches.length],
          ] as const
        ).map(([k, l, c]) => (
          <button
            key={k}
            className="tab"
            role="tab"
            aria-selected={tab === k}
            onClick={() => {
              setTab(k);
              setConfirm(null);
            }}
          >
            {l} {c != null && <span className="count">{c}</span>}
          </button>
        ))}
      </nav>

      {busy && (
        <div className="status">
          <ol className="steps">
            <li className="active">Searching stores and checking each seller</li>
          </ol>
          <div className="status-foot">
            <span>
              Usually 30 to 90 seconds. <span className="elapsed">{elapsed}s</span>
            </span>
            {ctlRef.current && (
              <button className="btn small" type="button" onClick={() => ctlRef.current?.abort()}>
                Stop
              </button>
            )}
          </div>
        </div>
      )}

      <section role="tabpanel">{tab === "results" ? results : tab === "saved" ? savedView : watchView}</section>

      <details className="how">
        <summary>How the trust score works</summary>
        <table>
          <tbody>
            <tr>
              <td>Who sells it: brand&apos;s own store / authorized seller / established retailer / mall store / ordinary marketplace seller / parallel import or unverified</td>
              <td>40 / 35 / 31 / 27 / 14 / 8</td>
            </tr>
            <tr>
              <td>Store rating (4.0★ earns nothing, 5.0★ the full amount)</td>
              <td>up to 14</td>
            </tr>
            <tr>
              <td>Track record: number of ratings or units sold (10,000+ earns the full amount)</td>
              <td>up to 11</td>
            </tr>
            <tr>
              <td>Warranty: Singapore warranty / international warranty</td>
              <td>15 / 6</td>
            </tr>
            <tr>
              <td>Stated returns window, or marketplace buyer protection</td>
              <td>8 / 6</td>
            </tr>
            <tr>
              <td>Used / refurbished</td>
              <td>−6 / −3</td>
            </tr>
            <tr>
              <td>Priced more than 30% under the typical price (55% for used)</td>
              <td>−25</td>
            </tr>
          </tbody>
        </table>
        <p>
          Points are scaled to 100. High trust is 70 and up, fair is 45 to 69, low is under 45. The best buy is the cheapest in-stock offer with high trust, or fair trust
          if nothing scores high. Offers priced far under typical never become the best buy.
        </p>
        <p>Prices come from store pages found by web search and can lag by a few days. Tap Re-check on an offer to read its page now, and confirm the total at checkout.</p>
      </details>
    </div>
  );
}

function BestCard(props: {
  b: ScoredListing;
  rule: Band;
  ref_: number | null;
  watching: boolean;
  canWatch: boolean;
  busy: boolean;
  onWatch: () => void;
}) {
  const { b, rule, ref_, watching, canWatch, busy, onWatch } = props;
  const url = safeUrl(b.url);
  return (
    <section className="tag" aria-label="Best buy">
      <div className="tag-label">
        {rule === "high" ? "Best buy · cheapest high-trust offer" : "Best available · no high-trust offer found, this is the cheapest fair one"}
      </div>
      <div className="tag-price">
        <span className="amt">
          <mark>{money(b.total)}</mark>
        </span>
        {ref_ && b.total < ref_ - 1 && <span className="save">{money0(ref_ - b.total)} under typical</span>}
      </div>
      <div className="tag-store">
        {b.store}
        {b.seller && <small> · {b.seller}</small>}
      </div>
      <div className="meter">
        <div className="meter-bar">
          <i style={{ width: b.score + "%", background: BAND_COLOR[b.band] }} />
        </div>
        <span>
          Trust <b>{b.score}</b>/100
        </span>
      </div>
      <Chips chips={b.chips} />
      {b.note && <p className="note">{b.note}</p>}
      <div className="tag-actions">
        {url && (
          <a className="btn primary" href={url} target="_blank" rel="noopener noreferrer">
            Open at {host(url)}
          </a>
        )}
        <button className="btn" type="button" disabled={watching || !canWatch || busy} onClick={onWatch}>
          {watching ? "Watching this price" : busy ? "Adding…" : "Watch price"}
        </button>
      </div>
    </section>
  );
}

function Row({ x, canRecheck, busy, onRecheck }: { x: ScoredListing; canRecheck: boolean; busy: boolean; onRecheck: () => void }) {
  const url = safeUrl(x.url);
  return (
    <article className="row">
      <div className="row-head">
        <div className="row-left">
          <div className="price">
            {money(x.total)}
            {x.originalPrice && x.originalPrice > x.price ? <s>{money0(x.originalPrice)}</s> : null}
            {num(x.shipping) ? <span className="ship">incl. {money(x.shipping)} delivery</span> : null}
          </div>
          <div className="store">
            {x.store}
            {x.seller && <small> · {x.seller}</small>}
          </div>
          {x.title && <div className="title">{trunc(x.title, 140)}</div>}
        </div>
        <div className={"score band-" + x.band}>
          <b>{x.score}</b>
          <span>{BAND_LABEL[x.band]}</span>
        </div>
      </div>
      <Chips chips={x.chips} />
      {x.note && <p className="note">{x.note}</p>}
      {x.checkedAt ? (
        <p className="checked">
          Re-checked {ago(x.checkedAt)}
          {x.checkNote ? ": " + x.checkNote : ""}
        </p>
      ) : x.priceDate ? (
        <p className="checked">Page dated {x.priceDate}</p>
      ) : null}
      <div className="row-actions">
        {url && (
          <a className="btn small" href={url} target="_blank" rel="noopener noreferrer">
            Open {host(url)}
          </a>
        )}
        {url && canRecheck && (
          <button className="btn small ghost" type="button" disabled={busy} onClick={onRecheck}>
            {busy ? "Checking…" : "Re-check price"}
          </button>
        )}
      </div>
    </article>
  );
}

function WatchItem(props: {
  w: Watch;
  busy: boolean;
  disabled: boolean;
  confirming: boolean;
  onCheck: () => void;
  onTarget: (v: number | null) => void;
  onStop: () => void;
}) {
  const { w, busy, disabled, confirming, onCheck, onTarget, onStop } = props;
  const [target, setTarget] = useState(w.targetPrice != null ? String(w.targetPrice) : "");
  useEffect(() => setTarget(w.targetPrice != null ? String(w.targetPrice) : ""), [w.targetPrice]);
  const b = w.best;
  const first = w.history?.length ? w.history[0].price : null;
  const diff = first != null && b ? b.price - first : 0;
  const hit = w.targetPrice != null && b != null && b.price <= w.targetPrice;
  const url = b ? safeUrl(b.url) : null;
  const commit = () => {
    const v = target.trim() === "" ? null : num(target);
    if ((v ?? null) !== (w.targetPrice ?? null)) onTarget(v);
  };
  return (
    <div className="item">
      <div className="item-head">
        <h3>{w.product || w.query}</h3>
        <span className="price">{money(b?.price)}</span>
      </div>
      <p className="item-meta">
        {b ? `${b.store} · trust ${b.trust} · ` : ""}checked {ago(w.lastChecked)}
        {diff < -0.5 && <span className="drop"> · down {money0(-diff)} since you started watching</span>}
        {hit && <span className="drop"> · at or under your target</span>}
      </p>
      {w.lastNote && <p className="item-meta">{w.lastNote}</p>}
      <Spark hist={w.history} />
      <div className="item-actions">
        <label className="target" htmlFor={"tg-" + w.id}>
          Target S$
          <input
            id={"tg-" + w.id}
            type="number"
            inputMode="decimal"
            min="0"
            step="1"
            placeholder="optional"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          />
        </label>
        {url && (
          <a className="btn small" href={url} target="_blank" rel="noopener noreferrer">
            Open
          </a>
        )}
        <button className="btn small" type="button" disabled={busy || disabled} onClick={onCheck}>
          {busy ? "Checking…" : "Check now"}
        </button>
        <button className={"btn small " + (confirming ? "danger" : "ghost")} type="button" onClick={onStop}>
          {confirming ? "Tap again to stop" : "Stop watching"}
        </button>
      </div>
    </div>
  );
}
