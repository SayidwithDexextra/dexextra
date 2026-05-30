# Dexetera Growth System

Production-grade referral tracking, points system, and viral sharing infrastructure.

---

## Overview

This system creates a viral loop: users share markets → new users sign up with referral codes → referrers earn points → leaderboard creates competition → more sharing.

**Core Components:**
1. Referral tracking (single-level)
2. Points system (action-based rewards)
3. OG image generation (shareable social cards)
4. Enhanced share flow (ref codes auto-appended)
5. Public leaderboard (competition driver)

---

## Data Model

### Referral Fields (user_profiles table)

```sql
ALTER TABLE user_profiles 
ADD COLUMN referral_code TEXT UNIQUE DEFAULT encode(gen_random_bytes(4), 'hex'),
ADD COLUMN referred_by TEXT REFERENCES user_profiles(wallet_address),
ADD COLUMN referred_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN referral_count INT DEFAULT 0,
ADD COLUMN referral_volume_usd DECIMAL(20,2) DEFAULT 0;

CREATE INDEX idx_user_profiles_referral_code ON user_profiles(referral_code);
CREATE INDEX idx_user_profiles_referred_by ON user_profiles(referred_by);
```

| Column | Type | Description |
|--------|------|-------------|
| `referral_code` | TEXT | Unique 8-char hex code for sharing (e.g., `a1b2c3d4`) |
| `referred_by` | TEXT | Wallet address of referrer (nullable) |
| `referred_at` | TIMESTAMP | When referral was recorded |
| `referral_count` | INT | Number of users this account has referred |
| `referral_volume_usd` | DECIMAL | Cumulative trading volume of referred users |

### Points Table

```sql
CREATE TABLE user_points (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    wallet_address TEXT NOT NULL REFERENCES user_profiles(wallet_address),
    action TEXT NOT NULL,
    points INT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_user_points_wallet ON user_points(wallet_address);
CREATE INDEX idx_user_points_action ON user_points(action);
CREATE INDEX idx_user_points_created ON user_points(created_at);
```

| Column | Type | Description |
|--------|------|-------------|
| `wallet_address` | TEXT | User earning the points |
| `action` | TEXT | Action type (see Point Actions below) |
| `points` | INT | Points awarded |
| `metadata` | JSONB | Context: `{ referred_wallet, market_id, volume }` |

### Leaderboard View

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

---

## Point Actions

| Action | Points | Trigger | Rationale |
|--------|--------|---------|-----------|
| `referral_signup` | 5 | Referred user connects wallet | Low value - easy to game |
| `referral_first_trade` | 25 | Referred user executes first trade | Shows real intent |
| `referral_volume_1k` | 50 | Referred user hits $1K cumulative volume | Quality user |
| `referral_volume_10k` | 150 | Referred user hits $10K cumulative volume | Whale acquisition |
| `market_created_active` | 100 | Created market gets 5+ unique traders | Supply side incentive |
| `market_created_volume` | 200 | Created market hits $10K volume | Product-market fit |

### Point Award Logic

Points are awarded **once per milestone** (not repeatable):

```typescript
// Example: Award referral_volume_1k
const hasAward = await checkExistingAward(referrerWallet, 'referral_volume_1k', { referred_wallet: newUserWallet });
if (!hasAward && referredUserVolume >= 1000) {
  await awardPoints(referrerWallet, 'referral_volume_1k', 50, { referred_wallet: newUserWallet });
}
```

---

## API Endpoints

### POST /api/referral/track

Called on wallet connect when `?ref=` param is present.

**Request:**
```json
{
  "wallet_address": "0x...",
  "referral_code": "a1b2c3d4"
}
```

**Response:**
```json
{
  "success": true,
  "referred_by": "0x...",
  "message": "Referral tracked"
}
```

**Logic:**
1. Validate referral code exists
2. Ensure user isn't referring themselves
3. Ensure user doesn't already have a referrer
4. Set `referred_by` and `referred_at`
5. Increment referrer's `referral_count`
6. Award `referral_signup` points to referrer

### GET /api/referral/stats/[wallet]

Returns referral stats for a user.

**Response:**
```json
{
  "referral_code": "a1b2c3d4",
  "referral_count": 12,
  "referral_volume_usd": 45230.50,
  "total_points": 425,
  "rank": 23,
  "referral_link": "https://dexetera.org?ref=a1b2c3d4"
}
```

### GET /api/referral/leaderboard

Returns top referrers.

**Query params:**
- `limit` (default: 100, max: 500)
- `offset` (default: 0)

**Response:**
```json
{
  "leaderboard": [
    {
      "rank": 1,
      "wallet_address": "0x...",
      "username": "whale_trader",
      "display_name": "Whale Trader",
      "profile_image_url": "https://...",
      "referral_count": 89,
      "total_points": 4250
    }
  ],
  "total_participants": 1247
}
```

### GET /api/og/market/[symbol]

Generates dynamic OG image for market sharing.

**Returns:** PNG image (1200x630)

**Image contains:**
- Dexetera logo
- Market name and symbol
- Current mark price
- 24h change (% and direction)
- Volume, open interest
- Settlement date countdown

### GET /api/og/position/[wallet]/[market_id]

Generates OG image for position sharing.

**Returns:** PNG image (1200x630)

**Image contains:**
- Dexetera logo
- "I'm LONG/SHORT on [MARKET]"
- Entry price → Current price
- Unrealized P&L ($ and %)
- Call to action

---

## Frontend Implementation

### 1. Referral Code Capture

On any page load, check for `?ref=` parameter:

```typescript
// hooks/useReferralCapture.ts
export function useReferralCapture() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const refCode = params.get('ref');
    
    if (refCode && refCode.length === 8) {
      localStorage.setItem('dexetera_ref', refCode);
    }
  }, []);
}
```

### 2. Track Referral on Wallet Connect

When user connects wallet, send stored ref code:

```typescript
// In wallet connection flow
const storedRef = localStorage.getItem('dexetera_ref');
if (storedRef) {
  await fetch('/api/referral/track', {
    method: 'POST',
    body: JSON.stringify({
      wallet_address: connectedAddress,
      referral_code: storedRef
    })
  });
  localStorage.removeItem('dexetera_ref'); // Clear after use
}
```

### 3. Enhanced ShareModal

Modify `ShareModal` to inject referral codes:

```typescript
// Get user's referral code
const { data: stats } = useReferralStats(walletAddress);

// Build share URL with ref code
const shareUrl = stats?.referral_code 
  ? `${baseUrl}?ref=${stats.referral_code}`
  : baseUrl;
```

### 4. ReferralCard Component

Display user's referral stats:

```
┌─────────────────────────────────────┐
│  Your Referral Link                 │
│  ┌─────────────────────────────┐    │
│  │ dexetera.org?ref=a1b2c3d4  │ 📋 │
│  └─────────────────────────────┘    │
│                                     │
│  12 Referrals    425 Points   #23  │
│  ────────────    ──────────   Rank │
└─────────────────────────────────────┘
```

### 5. Leaderboard Page

Route: `/leaderboard`

Display top referrers with:
- Rank
- Avatar + username
- Referral count
- Total points
- Highlight current user's position

---

## OG Image Design Specs

### Market Card (1200x630)

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  [DEXETERA LOGO]                                        │
│                                                         │
│  ┌────────┐                                             │
│  │  ICON  │  GOLD FUTURES                              │
│  │        │  Settlement: Jun 30, 2026                  │
│  └────────┘                                             │
│                                                         │
│  $2,412.50                              ▲ 2.4%         │
│  Mark Price                             24h Change      │
│                                                         │
│  Vol: $1.2M       OI: $340K       12 days remaining    │
│                                                         │
│  ─────────────────────────────────────────────────────  │
│  Trade any metric. No permission needed.                │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Colors:**
- Background: `#0a0a0a` (near black)
- Primary text: `#ffffff`
- Secondary text: `#888888`
- Accent (positive): `#22c55e`
- Accent (negative): `#ef4444`
- Brand accent: `#00D4FF` (cyan)

### Position Card (1200x630)

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  [DEXETERA LOGO]                                        │
│                                                         │
│                                                         │
│            I'm LONG on GOLD                             │
│                                                         │
│       Entry: $2,380  →  Current: $2,412                │
│                                                         │
│                                                         │
│              +$320.00    ▲ 1.3%                        │
│              Unrealized P&L                             │
│                                                         │
│  ─────────────────────────────────────────────────────  │
│  Trade any metric. No permission needed.    dexetera.org│
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Database Triggers

### Update Referrer Volume

When a referred user trades, update referrer's `referral_volume_usd`:

```sql
CREATE OR REPLACE FUNCTION update_referrer_volume()
RETURNS TRIGGER AS $$
DECLARE
    referrer_wallet TEXT;
BEGIN
    -- Get the referrer of the trading user
    SELECT referred_by INTO referrer_wallet
    FROM user_profiles
    WHERE wallet_address = NEW.trader_wallet;
    
    -- If user has a referrer, update their volume
    IF referrer_wallet IS NOT NULL THEN
        UPDATE user_profiles
        SET referral_volume_usd = referral_volume_usd + NEW.volume_usd
        WHERE wallet_address = referrer_wallet;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### Award Volume Milestone Points

Check and award points when volume thresholds are crossed:

```sql
CREATE OR REPLACE FUNCTION check_volume_milestones()
RETURNS TRIGGER AS $$
DECLARE
    referrer_wallet TEXT;
    referred_volume DECIMAL;
BEGIN
    SELECT referred_by INTO referrer_wallet
    FROM user_profiles
    WHERE wallet_address = NEW.trader_wallet;
    
    IF referrer_wallet IS NULL THEN
        RETURN NEW;
    END IF;
    
    -- Calculate referred user's total volume
    SELECT SUM(volume_usd) INTO referred_volume
    FROM trades
    WHERE trader_wallet = NEW.trader_wallet;
    
    -- Check $1K milestone
    IF referred_volume >= 1000 THEN
        INSERT INTO user_points (wallet_address, action, points, metadata)
        SELECT referrer_wallet, 'referral_volume_1k', 50, 
               jsonb_build_object('referred_wallet', NEW.trader_wallet)
        WHERE NOT EXISTS (
            SELECT 1 FROM user_points 
            WHERE wallet_address = referrer_wallet 
            AND action = 'referral_volume_1k'
            AND metadata->>'referred_wallet' = NEW.trader_wallet
        );
    END IF;
    
    -- Check $10K milestone
    IF referred_volume >= 10000 THEN
        INSERT INTO user_points (wallet_address, action, points, metadata)
        SELECT referrer_wallet, 'referral_volume_10k', 150,
               jsonb_build_object('referred_wallet', NEW.trader_wallet)
        WHERE NOT EXISTS (
            SELECT 1 FROM user_points 
            WHERE wallet_address = referrer_wallet 
            AND action = 'referral_volume_10k'
            AND metadata->>'referred_wallet' = NEW.trader_wallet
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

---

## Implementation Checklist

### Phase 1: Database (Day 1)
- [ ] Create migration: Add referral columns to `user_profiles`
- [ ] Create migration: Create `user_points` table
- [ ] Create migration: Create `referral_leaderboard` view
- [ ] Create migration: Add database triggers
- [ ] Test migrations locally
- [ ] Deploy to Supabase

### Phase 2: APIs (Day 1-2)
- [ ] Implement `POST /api/referral/track`
- [ ] Implement `GET /api/referral/stats/[wallet]`
- [ ] Implement `GET /api/referral/leaderboard`
- [ ] Add referral code generation to profile creation
- [ ] Test API endpoints

### Phase 3: OG Images (Day 2)
- [ ] Install `@vercel/og` dependency
- [ ] Implement `GET /api/og/market/[symbol]`
- [ ] Implement `GET /api/og/position/[wallet]/[market]`
- [ ] Add OG meta tags to market pages
- [ ] Test image generation

### Phase 4: Frontend (Day 3)
- [ ] Create `useReferralCapture` hook
- [ ] Modify wallet connect flow to track referrals
- [ ] Update `ShareModal` to include ref codes
- [ ] Create `ReferralCard` component
- [ ] Create `/leaderboard` page

### Phase 5: Polish (Day 4)
- [ ] Add loading states
- [ ] Add error handling
- [ ] Test full referral flow end-to-end
- [ ] Test OG images on Twitter/Discord/Telegram
- [ ] Monitor for edge cases

---

## Success Metrics

Track after 30 days:

| Metric | Target | Measurement |
|--------|--------|-------------|
| Share rate | 20%+ of traders share at least once | `COUNT(shares) / COUNT(traders)` |
| Referral adoption | 30%+ of users have shared their ref code | Users with `referral_count > 0` |
| Conversion rate | 15%+ of ref clicks → wallet connect | Track via ref code usage |
| Activation rate | 40%+ of referred users make first trade | Referred users with trades |
| Viral coefficient | > 0.5 | `AVG(referral_count)` for active users |

---

## Security Considerations

1. **Self-referral prevention**: Users cannot use their own referral code
2. **Single referrer**: Once `referred_by` is set, it cannot be changed
3. **Rate limiting**: `/api/referral/track` limited to 10 req/min per IP
4. **Code validation**: Referral codes must be exactly 8 hex characters
5. **Points audit**: All point awards logged with metadata for dispute resolution

---

## Future Enhancements (Not in v1)

- Multi-level referrals (MLM-style tiers)
- Point decay over time
- Seasonal leaderboard resets
- NFT badges for top referrers
- Referral-exclusive markets
- Trading fee discounts for referrers
