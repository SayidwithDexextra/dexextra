# Dexetera Growth System - Implementation Handoff

**Last Updated:** May 31, 2026  
**Status:** Phase 1 & 2 Complete; Phase 3 (Points) complete on dev — PROD migrations pending

---

## Project Context

Dexetera is a decentralized trading platform for permissionless futures markets on any measurable metric. We're building a viral growth system to acquire the first few hundred users through:

1. Shareable social cards (OG images)
2. Referral tracking with points
3. Public leaderboard

---

## What's Been Implemented

### Phase 1: Share Mechanism ✅ COMPLETE

#### 1. OG Image API
**File:** `src/app/api/og/market/[symbol]/route.tsx`

- Generates dynamic 1200x630 PNG images for social sharing
- Fetches market data from Supabase (name, price, settlement date, volume, category)
- Uses `@vercel/og` (Satori-based edge runtime image generation)
- Design follows `design/SophisticatedMinimalDesignSystem.md`
- Includes cyan accent colors, gradient background orbs, glowing logo

**Test URL:** `http://localhost:3000/api/og/market/GOLD`

#### 2. Share Utilities
**File:** `src/lib/shareUtils.ts`

- Platform-specific share text templates (Twitter, Telegram, Discord, WhatsApp, Reddit, Email)
- `buildMarketShareData()` - Converts market object to share-friendly format
- `buildShareUrl()` - Appends referral code to URLs
- `getShareText(platform, data)` - Returns platform-optimized share text

**Example Twitter output:**
```
$GOLD at $2,412.50 on @dexeteralabs

Settlement Jun 30, 2026 · Volume $1.2M
```

#### 3. Dynamic Metadata
**File:** `src/app/token/[symbol]/layout.tsx`

- Server-side market data fetch for metadata
- Sets `og:image`, `og:title`, `og:description`
- Sets Twitter card meta tags (`twitter:card`, `twitter:image`, etc.)
- Falls back gracefully if market not found

#### 4. Enhanced ShareModal
**File:** `src/components/ShareModal/ShareModal.tsx`

- Accepts optional `marketData` prop for context-aware sharing
- Accepts optional `referralCode` prop (for future referral system)
- Uses `shareUtils` for platform-specific text generation
- Exports `ShareModalMarketData` interface

**Usage:**
```tsx
<ShareModal
  isOpen={isOpen}
  onClose={onClose}
  marketData={{
    symbol: 'GOLD-USD',
    name: 'Gold Futures',
    mark_price: 2412500000,
    settlement_date: '2026-06-30T00:00:00Z',
    total_volume: 1200000,
    category: ['commodity'],
    market_identifier: 'GOLD'
  }}
  referralCode="abc123"
/>
```

#### 5. Debug Preview Page
**File:** `src/app/debug/og-preview/page.tsx`

- Visual preview of OG images
- Market dropdown for quick testing
- Twitter/Discord mockup previews
- Direct image URL access

**URL:** `http://localhost:3000/debug/og-preview`

---

## What Needs to Be Implemented

### Phase 2: Referral Tracking ✅ COMPLETE

#### Database Migration ✅
**File:** `database/migrations/024_add_referral_tracking.sql`
**Applied to:** Supabase `khhknmobkkkvvogznxdj` (Dexetera dev) as migration `add_referral_tracking`.
**Still TODO:** apply the same migration to `ttbxrwjfubitqgkiiabo` (Dexetera-PROD) before launch.

- Adds `referral_code` (unique, 8-char hex, default `encode(gen_random_bytes(4),'hex')`),
  `referred_by` (FK → `user_profiles.wallet_address`, `ON DELETE SET NULL`),
  `referred_at`, `referral_count`, `referral_volume_usd`.
- Backfilled a distinct code for every existing profile.
- Adds an atomic `track_referral(p_wallet_address, p_referral_code)` Postgres
  function that validates the code, blocks self-/double-referral, auto-creates
  the referred profile if missing, and increments the referrer's count — all in
  one transaction. Returns a JSON status object (`{ success, error?, referrer? }`).

#### API Endpoints ✅
- **`src/app/api/referral/track/route.ts`** — `POST` `{ wallet_address, referral_code }`.
  Validates with zod, calls the `track_referral` RPC, maps outcomes to HTTP
  statuses (404 invalid code, 400 self-referral, 409 already referred).
- **`src/app/api/referral/stats/[wallet]/route.ts`** — `GET` returns
  `referral_code`, `referral_count`, `referral_volume_usd`, `referral_link`,
  plus `total_points: 0` / `rank: null` placeholders until Phase 3.

#### Frontend ✅
- **`src/lib/referralApi.ts`** — `captureReferralFromUrl()`,
  `getStoredReferralCode()`, `clearStoredReferral()`, `trackStoredReferral()`,
  `getReferralStats()`. Stored under `localStorage['dexetera_ref']`.
- **`src/hooks/useReferralCapture.ts`** — mounts in `ClientLayout` to capture
  `?ref=` on first load.
- **Wallet wiring** — `createOrGetUserProfile()` in `src/hooks/useWallet.tsx`
  calls `trackStoredReferral()` (non-blocking) after every successful connect,
  covering injected wallets, Magic, account switches, and session restore.
  The stored code is cleared on success or any definitive 4xx outcome.

**Test:** visit `http://localhost:3000/?ref=<code>` (any code from
`SELECT referral_code FROM user_profiles`), connect a different wallet, then
`GET /api/referral/stats/<referrer_wallet>` should show `referral_count` +1.

---

### Phase 3: Points System ✅ COMPLETE (dev) — PROD pending

#### Database Migration ✅ APPLIED TO DEV
**File:** `database/migrations/025_create_points_system.sql`
**Applied to:** dev `khhknmobkkkvvogznxdj` as migration `create_points_system`.
Verified end-to-end: a referral awarded the referrer 5 `referral_signup` points,
`get_points_summary` returned `total_points 5 / rank 1`, and a duplicate award
was correctly a no-op (`awarded: false`). Test data cleaned up afterward.
**Still TODO:** apply to PROD `ttbxrwjfubitqgkiiabo` before launch.

Contains:
- **`user_points` ledger** — `id, wallet_address (FK), action, points, dedupe_key, metadata, created_at`.
  Added a `dedupe_key` column (not in the original sketch) + a partial unique
  index on `(wallet_address, action, dedupe_key)` so one-time awards can't be
  double-counted, while repeatable actions (`dedupe_key = NULL`) are unaffected.
- **`award_points(wallet, action, points, metadata, dedupe_key)`** — idempotent
  insert via `ON CONFLICT DO NOTHING`; auto-creates the profile row if missing;
  returns `{ awarded, points, action }`.
- **`get_points_summary(wallet)`** — returns `total_points` + global `rank`
  (rank is `NULL` for wallets with no points). Reused by the stats endpoint and
  by the Phase 4 leaderboard.
- **`track_referral()` updated** — on a successful referral it now also calls
  `award_points(referrer, 'referral_signup', 5, …, dedupe_key = referred_wallet)`,
  so the referrer earns 5 points per unique referred signup.

#### Server helper ✅
**File:** `src/lib/points.ts` — `awardPoints(wallet, action, { dedupeKey, metadata, points })`
plus the `POINT_ACTIONS` value table. Server-only (uses the service-role client).
This is the single integration point for the remaining triggers below.

#### Stats endpoint ✅
`src/app/api/referral/stats/[wallet]/route.ts` now returns real `total_points`
and `rank` from `get_points_summary` (was hard-coded `0` / `null`).

#### Point Actions
| Action | Points | Trigger | Status |
|--------|--------|---------|--------|
| `referral_signup` | 5 | Referred user connects wallet | ✅ wired in `track_referral` |
| `referral_first_trade` | 25 | Referred user executes first trade | ⏳ call `awardPoints` from trade flow |
| `referral_volume_1k` | 50 | Referred user hits $1K cumulative volume | ⏳ call `awardPoints` from volume rollup |
| `referral_volume_10k` | 150 | Referred user hits $10K cumulative volume | ⏳ call `awardPoints` from volume rollup |
| `market_created_active` | 100 | Created market gets 5+ unique traders | ⏳ call `awardPoints` from market analytics |
| `market_created_volume` | 200 | Created market hits $10K volume | ⏳ call `awardPoints` from market analytics |

> Trades are recorded in the `liquidation-direct-webhook` Supabase edge
> function, not the Next.js app, so the trade/volume awards need a hook there
> (or in a volume rollup job). Each is a one-liner:
> `awardPoints(referredWallet, 'referral_first_trade', { dedupeKey: referredWallet })`
> (award to the referrer instead if you want referrers credited — match the
> `referral_signup` recipient convention).

---

### Phase 4: Leaderboard

#### Database View
```sql
CREATE VIEW referral_leaderboard AS
SELECT 
    up.wallet_address,
    up.username,
    up.display_name,
    up.profile_image_url,
    up.referral_code,
    up.referral_count,
    up.referral_volume_usd,
    COALESCE(SUM(pt.points), 0) as total_points,
    RANK() OVER (ORDER BY COALESCE(SUM(pt.points), 0) DESC) as rank
FROM user_profiles up
LEFT JOIN user_points pt ON up.wallet_address = pt.wallet_address
WHERE up.is_active = true
GROUP BY up.wallet_address, up.username, up.display_name, 
         up.profile_image_url, up.referral_code, up.referral_count, 
         up.referral_volume_usd
ORDER BY total_points DESC;
```

#### API Endpoint
**Create:** `src/app/api/referral/leaderboard/route.ts`

#### Frontend Page
**Create:** `src/app/leaderboard/page.tsx`

---

## File Structure Reference

```
src/
├── app/
│   ├── api/
│   │   ├── og/
│   │   │   └── market/[symbol]/route.tsx  ✅ DONE
│   │   └── referral/
│   │       ├── track/route.ts             ✅ DONE
│   │       ├── stats/[wallet]/route.ts    ✅ DONE
│   │       └── leaderboard/route.ts       ❌ TODO
│   ├── debug/
│   │   └── og-preview/page.tsx            ✅ DONE
│   ├── leaderboard/
│   │   └── page.tsx                       ❌ TODO
│   └── token/[symbol]/
│       └── layout.tsx                     ✅ DONE (metadata)
├── components/
│   └── ShareModal/
│       └── ShareModal.tsx                 ✅ DONE (updated)
├── hooks/
│   ├── useReferralCapture.ts              ✅ DONE
│   └── useWallet.tsx                      ✅ DONE (referral wiring)
└── lib/
    ├── shareUtils.ts                      ✅ DONE
    ├── referralApi.ts                     ✅ DONE
    └── points.ts                          ✅ DONE (server-side award helper)

database/
└── migrations/
    ├── 024_add_referral_tracking.sql      ✅ DONE (applied to dev)
    └── 025_create_points_system.sql       ✅ DONE (applied to dev)

docs/
├── GROWTH_SYSTEM.md                       ✅ Full spec document
└── GROWTH_IMPLEMENTATION_HANDOFF.md       ✅ This file
```

---

## Design System Reference

**File:** `design/SophisticatedMinimalDesignSystem.md`

Key colors:
- Background: `#0A0A0A`, `#0F0F0F`, `#1A1A1A`
- Borders: `#222222`, `#333333`
- Text: `white`, `#9CA3AF`, `#808080`, `#606060`
- Accent (cyan): `#00D4FF`
- Positive: `#4ade80` (green-400)
- Negative: `#f87171` (red-400)

---

## Dependencies Added

```json
{
  "@vercel/og": "^0.6.x"
}
```

---

## Testing

1. **OG Image:** `http://localhost:3000/api/og/market/[SYMBOL]`
2. **Preview Page:** `http://localhost:3000/debug/og-preview`
3. **Meta Tags:** Visit any market page, inspect `<head>` for `og:` tags
4. **Share Modal:** Open share on any market, check platform-specific text

---

## Next Action

Dev migrations `024` + `025` are both applied and verified. Continue **Phase 3 → 4**:

1. Hook the remaining point actions (trade / volume / market milestones) by calling
   `awardPoints(...)` from the `liquidation-direct-webhook` edge function or a
   volume rollup job — see the Point Actions table above.
2. **Phase 4 (Leaderboard):** the `referral_leaderboard` view in the spec is now
   redundant with `get_points_summary`; build `/api/referral/leaderboard/route.ts`
   on top of `user_points` + `user_profiles`, then `src/app/leaderboard/page.tsx`.

**Before launch:** apply both `024_add_referral_tracking.sql` and
`025_create_points_system.sql` to the PROD project `ttbxrwjfubitqgkiiabo`
(only the dev project has `024` so far; neither has `025` yet).
