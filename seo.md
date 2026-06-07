# Dexetera SEO Strategy — Organic Growth Plan

**Last Updated:** Jun 5, 2026
**Status:** P0 (technical foundation) implemented — P1/P2 pending
**Owner:** Growth + Eng
**Production domain:** `https://dexetera.org`

---

## Project Context

Dexetera is a decentralized trading platform for permissionless futures markets on
any measurable metric. The viral/share layer (OG images, referral tracking, points,
leaderboard — see `gtm.md`) is well developed. The **organic discovery layer (search)
is essentially unbuilt**. This doc is the plan to capture organic search demand and
feed it into the existing referral/points funnel.

**Core thesis:** Every market is already its own page (`/token/[symbol]`). With the
right technical foundation, this becomes a programmatic-SEO engine that auto-publishes
a rankable page for every market we list — at the same rate we create markets.

---

## Current State Assessment

### What's already strong
- **Dynamic OG images** per market: `src/app/api/og/market/[symbol]/route.tsx`
- **Per-market metadata** with OpenGraph + Twitter cards:
  - `src/app/token/[symbol]/layout.tsx` (`generateMetadata`)
  - `src/app/s/[symbol]/page.tsx` (short share route)
- **Referral + points growth system** (Phases 1–3) to attribute and convert traffic.
- **Next.js 15 App Router** — first-class support for `sitemap.ts`, `robots.ts`,
  `generateMetadata`, and server components (all the tools we need).

### Gaps (prioritized)
| Gap | File / Area | Impact |
|-----|-------------|--------|
| No `sitemap.ts` | `src/app/sitemap.ts` (missing) | Crawlers can't discover market pages at scale |
| No `robots.ts` | `src/app/robots.ts` (missing) | No crawl rules; debug pages crawlable |
| Thin root metadata | `src/app/layout.tsx` (2 lines) | No `metadataBase`, canonical, defaults, title template |
| No structured data | everywhere | No rich results; weaker entity understanding |
| Client-only key pages | `page.tsx`, `/markets`, `/explore` are `'use client'` | No server-rendered text/metadata to index |
| Debug routes indexable | `src/app/debug/*`, `*-test` | Index pollution |
| No editorial content | (none) | Zero top-of-funnel informational ranking |

---

## The Strategy: 4 Pillars

### Pillar 1 — Technical Foundation (do first)
The plumbing that lets search engines find, crawl, and trust the site. Low effort,
high impact, low risk (additive — no behavior changes).

1. **`src/app/robots.ts`**
   - Allow `/`; disallow `/debug`, `/api`, `/config-test`, `/deposit-test`,
     `/notifications`, `/settings`.
   - Reference the sitemap URL.

2. **`src/app/sitemap.ts`** (the big unlock)
   - Static routes: `/`, `/markets`, `/explore`, `/leaderboard`, `/learn`, `/terms`,
     `/privacy`, `/support`.
   - Dynamic: query Supabase `markets` (`is_active = true`) → one `/token/[symbol]`
     entry each, with `lastModified` from market `updated_at`/settlement.
   - Use the existing service-role pattern already used in
     `src/app/token/[symbol]/layout.tsx`.

3. **Enrich root metadata** — `src/app/layout.tsx`
   - `metadataBase: new URL('https://dexetera.org')`
   - `title: { default: 'Dexetera — Trade Any Metric', template: '%s | Dexetera' }`
   - Stronger default `description` (target "trade any metric", "permissionless
     futures", "prediction-style markets").
   - Default `openGraph` + `twitter` (so non-market pages unfurl well).
   - `robots: { index: true, follow: true, googleBot: { 'max-image-preview': 'large' } }`
   - `alternates: { canonical: '/' }`
   - `keywords`, `applicationName`, `creator`/`publisher`.

4. **`src/app/manifest.ts`** + **Google Search Console verification**
   - PWA manifest (name, icons from `/Dexicon`, theme `#00D4FF`, bg `#0A0A0A`).
   - Add GSC verification (meta tag or DNS) — this is the measurement scoreboard.

5. **Noindex debug/test routes**
   - Add `robots: { index: false }` metadata to `/debug/*`, `/config-test`,
     `/deposit-test` layouts (belt-and-suspenders with `robots.ts`).

**Acceptance:** `dexetera.org/robots.txt` and `/sitemap.xml` resolve; GSC verified;
debug routes return `noindex`; homepage `<head>` has full default OG/Twitter tags.

---

### Pillar 2 — Programmatic SEO on Market Pages (highest ceiling)
Turn each auto-generated market page into a rankable, server-rendered asset.

1. **Server-render core market facts**
   - The `/token/[symbol]` page is interactive/client, but the page should emit a
     server-rendered block of crawlable text: market name, current price, settlement
     date, volume, category, and a 1–2 sentence description of what the market tracks
     and how it settles. Today crawlers see almost no indexable body text.
   - Implementation: render a server component (within the existing `layout.tsx` or a
     server wrapper) with this content; the interactive chart/trading UI stays client.

2. **JSON-LD structured data per market**
   - `FinancialProduct` (or `Dataset`) + `BreadcrumbList`.
   - Inject via a `<script type="application/ld+json">` in the server layer.
   - Improves entity understanding and rich-result eligibility.

3. **Target long-tail intent in copy + metadata**
   - "trade [metric] futures", "[metric] prediction market",
     "[X] settlement odds", "[X] price [period]".
   - Tune the `generateMetadata` description templates to include these phrasings.

4. **Server-rendered category / index pages**
   - `/markets` (and per-category views) should server-render a list of markets with
     internal links to every `/token/[symbol]`. This distributes crawl equity and
     gives the sitemap real internal-link support (orphan pages rank poorly).
   - Currently `/markets` is client-only — needs a server-rendered list (can hydrate
     into the interactive version).

5. **Canonical / URL hygiene**
   - Canonicalize `/token/[symbol]` as the one true URL.
   - Ensure `/s/[symbol]`, `?ref=`, `?variant=` variants don't fragment ranking
     signals (canonical tag → clean `/token/[symbol]`).

**Acceptance:** view-source on a market page shows real body text + JSON-LD; Rich
Results Test passes; `/markets` links to every active market server-side.

---

### Pillar 3 — Editorial Content (capture informational demand)
Rank for the questions future users ask before they know Dexetera exists. This is the
top-of-funnel the share system structurally cannot reach.

- **`/learn` (or `/blog`) surface** — MDX-based, server-rendered.
- **Seed articles:**
  - "What is a permissionless futures market?"
  - "How do metric/prediction markets settle?"
  - Per-category explainers: commodities, crypto, sports, economic metrics.
  - "How to trade [popular metric] on Dexetera" (bridges info → product).
- **Internal linking:** every article links to relevant live markets → funnels readers
  into the product and the referral loop.
- **Compounding asset:** content keeps earning traffic long after publish; pairs with
  the programmatic market pages for a full-funnel organic strategy.

**Acceptance:** `/learn` indexed; each article server-rendered with metadata + JSON-LD
`Article`; internal links to ≥1 live market.

---

### Pillar 4 — Authority & Off-Page
- **Aggregator/directory listings:** DefiLlama, DappRadar, CoinGecko, DeFi directories
  — high-authority backlinks + qualified referral traffic.
- **Link-worthy assets:** the public leaderboard and category pages are shareable and
  citable; promote them.
- **Social signals:** the existing OG share layer already maximizes unfurl quality on
  X/Telegram/Discord — keep feeding it.

---

## Prioritized Roadmap

| Priority | Item | Effort | Impact | Files | Status |
|----------|------|--------|--------|-------|--------|
| P0 | `robots.ts` | Low | High | `src/app/robots.ts` | ✅ done |
| P0 | Dynamic `sitemap.ts` | Low | High | `src/app/sitemap.ts` | ✅ done |
| P0 | Enrich root metadata | Low | High | `src/app/layout.tsx` | ✅ done |
| P0 | Noindex debug/test routes | Low | Med | `src/app/{debug,config-test,deposit-test}/layout.tsx` | ✅ done |
| P1 | Server-render market facts + JSON-LD | Med | High | `src/app/token/[symbol]/*` | ⬜ todo |
| P1 | Server-rendered `/markets` + internal links | Med | High | `src/app/markets/*` | ⬜ todo |
| P1 | `manifest.ts` + Google Search Console | Low | Med | `src/app/manifest.ts` | ⬜ todo |
| P2 | `/learn` editorial content (MDX) | High | High (compounds) | `src/app/learn/*` | ⬜ todo |
| P2 | Directory / aggregator listings | Med | Med | off-platform | ⬜ todo |

---

## Measurement

- **Google Search Console** — primary scoreboard: impressions, indexed page count,
  top queries, CTR. Watch "pages indexed" climb as the sitemap exposes every market.
- **Funnel attribution** — organic sessions → wallet connect → first trade, using the
  existing referral/points tables (`user_profiles`, `user_points`).
- **Targets (first 90 days post-launch):**
  - 100% of active markets indexed (sitemap coverage in GSC).
  - First informational `/learn` articles ranking on page 1–2 for long-tail terms.
  - Measurable organic → wallet-connect conversions in the funnel.

---

## Open Questions / Decisions Needed

1. **Domain confirmation** — code falls back to `https://dexetera.org`
   (`NEXT_PUBLIC_APP_URL`). Confirm this is the canonical production domain.
2. **Content ownership** — who writes `/learn` articles? (Eng can scaffold MDX
   pipeline; content needs an author.)
3. **Market page SSR** — converting `/markets` / market facts to server-rendered may
   touch hydration; confirm appetite for that refactor in P1.
4. **GSC access** — need someone with DNS/domain access to verify Search Console.
5. **ESP choice** — email provider for the newsletter (Resend / Buttondown / Beehiiv).
6. **`/research` specifics** — section route name, branding voice, and how aggressively
   insight pages should CTA into Dexetera markets (see the design section below).

---

## Outstanding Work (living checklist)

### P0 — Technical foundation
- [x] `src/app/robots.ts`
- [x] Dynamic `src/app/sitemap.ts`
- [x] Enrich root metadata (`src/app/layout.tsx`)
- [x] Noindex `/debug`, `/config-test`, `/deposit-test` (segment layouts)
- [ ] **Manual:** confirm `NEXT_PUBLIC_APP_URL` is set to the canonical prod domain
      (falls back to `https://dexetera.org`)
- [ ] **Manual:** verify domain in Google Search Console + submit `/sitemap.xml`
- [ ] **Verify:** after deploy, confirm `/robots.txt` and `/sitemap.xml` resolve and
      that debug routes return `noindex`

### P1 — Programmatic market-page SEO (in progress)
- [x] **Server-render market facts** on `/token/[symbol]` — server-rendered
      "About this market" section (`_seo/MarketAboutSection.tsx`) with name, price,
      settlement, volume, category links, and descriptive prose. Rendered from the
      server `layout.tsx` (desktop-visible; `display:none` on mobile but still in the
      crawlable DOM, so the fixed-height mobile trading layout is untouched).
- [x] **JSON-LD per market** — `FinancialProduct` + `BreadcrumbList`
      (`_seo/MarketJsonLd.tsx`), injected from the server `layout.tsx`.
- [x] **Shared cached fetch** — `_seo/marketSeoData.ts` (React `cache()`), reused by
      `generateMetadata` and the layout body (no double-fetch).
- [x] **Canonical on `/token/[symbol]`** — added `alternates.canonical`.
- [ ] **Long-tail copy/metadata** — further tune `generateMetadata` descriptions toward
      "trade [metric] futures", "[metric] prediction market", "[X] settlement odds".
- [ ] **Server-rendered `/markets` (+ per-category)** — render the market list with
      internal links to every `/token/[symbol]` so pages aren't orphaned.
- [ ] **Remaining URL hygiene** — confirm `/s/`, `?ref=`, `?variant=` variants don't
      fragment ranking signals (the `/s/` route already canonicalizes to `/token/`).
- [ ] **`src/app/manifest.ts`** — PWA manifest (icons from `/Dexicon`, theme
      `#00D4FF`, bg `#0A0A0A`).

### P2 — Content & authority (later)
- [ ] `/learn` MDX surface + seed articles (needs a content author — see Open Q #2)
- [ ] Directory/aggregator listings (DefiLlama, DappRadar, CoinGecko, etc.)

### P3 — Prediction-Market Intelligence content layer (Polymarket-sourced)
> Generalized "prediction-market intelligence" content (NOT branded as Polymarket),
> sourced from the public Polymarket APIs, cached in Supabase, server-rendered on
> Dexetera as an organic-traffic magnet that funnels readers into the product.
> See the dedicated design section below.
- [ ] **Data ingestion** — scheduled jobs (reuse Upstash QStash + Redis) polling
      Polymarket data/gamma/clob APIs into Supabase tables; 429 backoff; never on the
      render hot path.
- [ ] **Insight recipes** — compute + store (with timestamps) mispricing gap,
      conviction tape, calibration, category heat, settled scorecard.
- [ ] **Content routes** — `/research` index + `/research/[slug]` posts (server-rendered).
- [ ] **Programmatic pages** — `/research/markets/[slug]`, `/research/traders/[address]`,
      `/research/categories/[key]`; extend `sitemap.ts`; `Article`/`Dataset`/`FAQPage`
      JSON-LD; dynamic OG images (reuse `@vercel/og`).
- [ ] **Generation engine** — weekly auto-assembled post (deterministic templates +
      guardrailed LLM polish using existing `openai` dep; numbers only from stored data).
- [ ] **Funnel** — every page has a clear CTA into Dexetera markets / signup.

### P4 — Distribution & measurement
- [ ] Newsletter signup + ESP integration (pick provider — see Open Q #5)
- [ ] Email send on publish; share widgets / embeds for backlinks
- [ ] GSC + lightweight analytics; publish the Settled Scorecard accuracy for trust

---

## Next Action

**P0 is shipped in code.** Two manual P0 follow-ups remain (domain env confirmation +
Google Search Console verification) — neither blocks P1.

Next point is **P1: programmatic market-page SEO**, starting with the highest-leverage
item:

1. **Server-render market facts + JSON-LD on `/token/[symbol]`.** This is the biggest
   single win — it turns every auto-generated market page from a near-empty client
   shell into indexable, structured content, multiplied across every market the
   sitemap now exposes.
2. Then **server-render `/markets`** with internal links so those pages aren't orphaned.
3. Then **`manifest.ts`** (quick) and **canonical hygiene**.

**Decision needed before coding P1 (Open Q #3):** server-rendering market facts and the
`/markets` list touches currently client-only pages and their hydration. Confirm
appetite for that refactor, or we scope it to an additive server block that wraps the
existing client UI (lower risk, recommended).

---

## Design: Prediction-Market Intelligence Content Layer

**Decision (Jun 6):** Use the **Polymarket public APIs as the data source**, present the
output as **generalized prediction-market intelligence** (not Polymarket-branded), host
it on Dexetera, and use it as a top-of-funnel SEO magnet that drives readers into the
trading product. Adapted from `seo-newsletter-plan.json`.

### Why this fits Dexetera with little net-new plumbing
The plan's hardest requirements are already satisfied or covered by existing deps:

| Plan requirement | Already in this repo |
|---|---|
| Server-rendered indexable content | ✅ pattern proven in P1 (`/token/[symbol]` `_seo`) |
| sitemap / robots / metadata / JSON-LD | ✅ shipped in P0 + P1 |
| Dynamic OG images | ✅ `@vercel/og` (`/api/og/...`) |
| Datastore / cache | ✅ Supabase + Upstash Redis |
| Scheduling (cron) | ✅ Upstash **QStash** (already a dependency) |
| LLM prose polish | ✅ `openai` (already a dependency) |

Net-new work is mostly: the Polymarket ingestion client, the insight computations, the
`/research` routes, and an ESP for email.

### Architecture (target: this Next.js + Supabase app)
1. **Ingestion (server-only):** a typed Polymarket client (data-api / gamma / clob) run
   by scheduled QStash jobs. Cache raw + derived data in new Supabase tables
   (e.g. `pm_markets`, `pm_trades`, `pm_traders`, `pm_signals`, `pm_resolutions`,
   `pm_posts`). Respect rate limits; 429 backoff; **never call Polymarket in a page's
   render path.**
2. **Insight recipes:** compute the plan's recipes (mispricing gap, conviction tape,
   calibration, category heat, settled scorecard) in the job and store outputs **with
   timestamps** so the Settled Scorecard can grade past calls later.
3. **Render (reuses our SEO foundation):** `/research` blog index + `/research/[slug]`
   posts, plus programmatic `/research/markets|traders|categories/[...]`. All
   server-rendered (ISR/revalidate). Add `Article` / `Dataset` / `FAQPage` JSON-LD and
   per-entity dynamic OG images. Extend `sitemap.ts` to include these URLs.
4. **Generation engine:** weekly job assembles a data-grounded draft via deterministic
   per-segment templates; optional LLM pass only polishes prose and **may never invent
   numbers** (every figure traces to a stored value).
5. **Funnel + distribution:** newsletter signup (homepage + post footers), email send on
   publish via the chosen ESP, share/embeds for backlinks, and a clear CTA on every page
   into Dexetera markets.

### Positioning / branding
Neutral "prediction-market intelligence" voice. Attribute data generically as
"aggregated from public prediction-market data" + a methodology page; avoid implying
partnership/endorsement. Keep it clearly part of Dexetera so authority flows to the
product domain (subfolder `/research`, not a separate domain).

### Pitfalls specific to this layer
- **Polymarket ToS / attribution** — public data, but cite generically + methodology page.
- **YMYL (finance/gambling adjacency)** — visible authorship, disclaimers, methodology.
- **Thin programmatic pages** — enforce a data-richness threshold; `noindex` weak ones.
- **Resolved-market decay** — consolidate/redirect into a historical track record.
- **Staleness/limits** — cache aggressively; ISR, not live API calls.

### Open decisions
1. **Section name/route** — `/research` vs `/insights` vs `/signals`? (default `/research`)
2. **ESP** — Resend / Buttondown / Beehiiv?
3. **Cross-linking** — how aggressively should insight pages link to / CTA into Dexetera
   markets vs stay neutral?
4. **Scope of v1** — start with ONE flagship asset (the Calibration / Settled Scorecard)
   + a weekly post, then expand to programmatic pages?
