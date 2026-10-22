# Price Hunt

Find the cheapest offer you can trust for any item in Singapore.

Type what you want to buy. Price Hunt searches Shopee, Lazada, Amazon.sg, brand stores and big retailers (Challenger, Courts, Harvey Norman, Best Denki, Gain City, iShopChangi), reads each listing with Claude, gives every seller a trust score out of 100, and picks the cheapest offer that scores high.

- **Trust score:** who sells it (brand store, authorized seller, retailer, mall store, marketplace seller, parallel import), store rating, sales volume, Singapore warranty, and returns or buyer protection. Prices more than 30% under the typical price are flagged and never picked.
- **Used & refurbished:** optional for each search.
- **Saved searches:** the latest 25 are kept automatically.
- **Price watch:** watch a best buy and set a target. A daily check at 8:40am Singapore time records the price and can send a phone notification when it drops.
- **Re-check:** reads one listing's page live, because search results can be a few days old.
- **Installable:** add it to your phone's home screen and it opens like an app.

It's a single-user app behind a password, built with Next.js for Vercel.

## Set it up (about 15 minutes, all doable from a phone)

### 1. Get two API keys

| Key | Where | Used for |
|---|---|---|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) → API keys | Reading listings and scoring sellers |
| `PARALLEL_API_KEY` | [platform.parallel.ai](https://platform.parallel.ai) → API keys | Web search |

Both bill per use. Each search makes 2 to 3 web searches and one Claude call; a re-check makes one page read and one small Claude call. Set a monthly spending limit in both consoles.

### 2. Deploy on Vercel

1. Sign in at [vercel.com](https://vercel.com) with GitHub.
2. **Add New → Project**, import `sspandayang-star/Price-Hunt`. Vercel detects Next.js.
3. Under **Environment Variables** add:
   - `APP_PASSWORD`: the password you'll type to open the app
   - `ANTHROPIC_API_KEY`
   - `PARALLEL_API_KEY`
   - `CRON_SECRET`: any long random string (it protects the daily check)
4. **Deploy.**

### 3. Turn on saving and price watching

1. In the Vercel project, open **Storage → Create Database → Upstash (Redis)**, pick the free plan, and connect it to this project. That adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` for you.
2. **Deployments → ⋯ → Redeploy** so the app picks them up.

Without this step searching still works; the Saved and Watching tabs say saving isn't set up.

### 4. Install it on your phone

Open your Vercel URL (e.g. `price-hunt-xxxx.vercel.app`) and sign in.

- **Android (Chrome):** menu ⋮ → **Add to Home screen** or **Install app**.
- **iPhone (Safari):** Share → **Add to Home Screen**.

### 5. Optional: price-drop notifications

1. Install the free **ntfy** app ([ntfy.sh](https://ntfy.sh)).
2. Subscribe to a topic with a long, hard-to-guess name, e.g. `price-hunt-7f3k29xq`.
3. Add `NTFY_TOPIC` with that name in Vercel and redeploy.

The daily check sends one notification listing every watched item whose trusted price fell at least 2% or reached your target.

## Run it locally

```bash
cp .env.example .env.local   # fill in the keys
npm install
npm run dev                  # http://localhost:3000
```

To trigger the daily check by hand:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron
```

## How it works

| Path | What it does |
|---|---|
| `lib/pipeline.ts` | Runs the Parallel searches, sends the pages to Claude, and cleans the offers it returns |
| `lib/scoring.ts` | Trust score, typical price, best-buy pick and sorting (shared by the page and the server) |
| `lib/store.ts` | Saved searches and watches in Upstash Redis |
| `lib/watch.ts` | Re-checks a watch and sends the ntfy notification |
| `app/api/search` | Runs a search and saves it |
| `app/api/recheck` | Reads one listing's page now |
| `app/api/data` | Saved searches and watches: list, remove, watch, set target, check now |
| `app/api/cron` | Daily check, scheduled in `vercel.json` (00:40 UTC = 8:40 SGT) |
| `middleware.ts` | Password gate on every page and API route except sign-in and the cron |

Models default to `claude-sonnet-5-5` for reading listings and `claude-haiku-5-5` for re-checks. Override with `ANTHROPIC_MODEL` and `ANTHROPIC_QUICK_MODEL`.

Prices come from store pages found by web search. Always confirm the final total at checkout.
