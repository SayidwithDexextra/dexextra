'use client'

import type { NotificationItem } from '@/contexts/NotificationContext'

/**
 * Per-notification "flavor" used to pick an icon. This is content-based —
 * derived from cta_href + title/body keywords + the DB `kind` field — and
 * intentionally separate from `severity` (which controls the row's accent
 * color). The combination lets one notification be both "warning" and
 * "maintenance", or "info" and "market", and still get an icon that fits
 * what it's actually about.
 */
export type NotificationFlavor =
  | 'market' // anything referencing a market, trade, futures, candlestick
  | 'deposit' // funding, wallet, balance, top-up
  | 'trade' // generic trading/swap action
  | 'welcome' // onboarding, intro, "welcome to ..."
  | 'maintenance' // scheduled / ongoing maintenance
  | 'release' // shipped features, upgrades, "what's new"
  | 'incident' // outage, degraded service
  | 'announcement' // generic platform announcement (fallback)

interface FlavorPalette {
  // Background tint (10% alpha) painted under the icon.
  tint: string
  // Inner border / divider tint (~22% alpha) used by the icon tile.
  ring: string
  // Foreground accent — also picked up by some SVG strokes/fills.
  accent: string
}

const FLAVOR_PALETTE: Record<NotificationFlavor, FlavorPalette> = {
  // Stay on the platform's 4-color palette (blue/green/yellow/red @ Tailwind
  // 400 weight) so the icon tile never invents a new color.
  market: {
    tint: 'rgba(74, 222, 128, 0.10)',
    ring: 'rgba(74, 222, 128, 0.22)',
    accent: '#4ade80',
  },
  deposit: {
    tint: 'rgba(96, 165, 250, 0.10)',
    ring: 'rgba(96, 165, 250, 0.22)',
    accent: '#60a5fa',
  },
  trade: {
    tint: 'rgba(96, 165, 250, 0.10)',
    ring: 'rgba(96, 165, 250, 0.22)',
    accent: '#60a5fa',
  },
  welcome: {
    tint: 'rgba(250, 204, 21, 0.12)',
    ring: 'rgba(250, 204, 21, 0.26)',
    accent: '#facc15',
  },
  maintenance: {
    tint: 'rgba(250, 204, 21, 0.10)',
    ring: 'rgba(250, 204, 21, 0.22)',
    accent: '#facc15',
  },
  release: {
    tint: 'rgba(74, 222, 128, 0.10)',
    ring: 'rgba(74, 222, 128, 0.22)',
    accent: '#4ade80',
  },
  incident: {
    tint: 'rgba(248, 113, 113, 0.10)',
    ring: 'rgba(248, 113, 113, 0.22)',
    accent: '#f87171',
  },
  announcement: {
    tint: 'rgba(96, 165, 250, 0.10)',
    ring: 'rgba(96, 165, 250, 0.22)',
    accent: '#60a5fa',
  },
}

/**
 * Heuristic content-detection. Priority is title → CTA → body → DB kind
 * → severity. Title is the most reliable signal of what a notification is
 * *about*; bodies often mention many things (a welcome note can talk
 * about deposits, markets, AND trading without being any one of them).
 */
export function detectNotificationFlavor(
  item: NotificationItem
): NotificationFlavor {
  const titleLower = item.title.toLowerCase()
  const bodyLower = (item.body || '').toLowerCase()
  const fullText = `${titleLower} ${bodyLower}`
  const href = (item.cta_href || '').toLowerCase()

  // 1. Title-first fast paths — these win even if the body mentions other
  //    flavors. A "Welcome to Dexetera" note that talks about markets and
  //    deposits is still primarily a welcome.
  if (/\b(welcome|getting started|onboarding|new here)\b/.test(titleLower)) {
    return 'welcome'
  }
  if (
    /\b(deposit|withdraw|top[\s-]?up|fund(?:ing|s)?)\b/.test(titleLower)
  ) {
    return 'deposit'
  }
  if (
    /\b(market|trading|candlestick|orderbook|liquidity|leverage)\b/.test(
      titleLower
    )
  ) {
    return 'market'
  }

  // 2. CTA destination — the link the user is about to click is a strong
  //    hint about what the message wants them to do.
  if (
    href.includes('/futures/') ||
    href.includes('/markets/') ||
    href.includes('/market/')
  ) {
    return 'market'
  }
  if (href.includes('/deposit') || href.includes('/wallet')) {
    return 'deposit'
  }

  // 3. Body keywords — used only when title + CTA didn't classify.
  if (
    /\b(market|trading|trade(?!mark)|candlestick|orderbook|liquidity|long|short|pnl|leverage)\b/.test(
      fullText
    )
  ) {
    return 'market'
  }
  if (
    /\b(deposit|top[\s-]?up|fund(?:ing|s)?|balance|withdraw)\b/.test(fullText)
  ) {
    return 'deposit'
  }
  if (
    /\b(welcome|getting started|onboarding|introduc(?:ing|tion))\b/.test(
      fullText
    )
  ) {
    return 'welcome'
  }

  // 4. DB-driven kinds — fall back to these if nothing in the text matched.
  if (item.kind === 'maintenance') return 'maintenance'
  if (item.kind === 'release') return 'release'
  if (item.kind === 'incident') return 'incident'

  // 5. Severity hint — critical messages with no content match still
  //    deserve a shield-style icon rather than a megaphone.
  if (item.severity === 'critical') return 'incident'

  return 'announcement'
}

interface NotificationIconProps {
  item: NotificationItem
  /**
   * Visual size of the icon tile. `sm` is for the header dropdown rows
   * (compact 28px square), `md` is for the standalone /notifications page
   * cards (40px square with slightly more illustrative artwork).
   */
  size?: 'sm' | 'md'
  /**
   * When true, dim the tile to convey the row has already been read.
   * Mirrors the existing severity-stripe dimming on read cards.
   */
  isRead?: boolean
}

/**
 * Renders a tinted square tile with a per-flavor SVG glyph. Designed to
 * sit on the left edge of a notification row, replacing or augmenting the
 * severity dot. The art for each flavor is intentionally a little playful
 * — candlestick chart for markets, sparkles for welcomes, rocket for
 * releases — to gamify the feed without breaking the platform's minimal
 * aesthetic.
 */
export function NotificationIcon({
  item,
  size = 'md',
  isRead = false,
}: NotificationIconProps) {
  const flavor = detectNotificationFlavor(item)
  const palette = FLAVOR_PALETTE[flavor]
  const dim = isRead ? 0.55 : 1

  // Tile dimensions tuned to the surrounding row metrics. SVG viewBox is
  // a constant 32x32 across both sizes so the art scales cleanly.
  const tileClass =
    size === 'sm'
      ? 'w-7 h-7 rounded-md'
      : 'w-10 h-10 rounded-lg'
  const svgClass = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5'

  return (
    <div
      className={`dex-notification-icon relative flex items-center justify-center flex-shrink-0 transition-all duration-200 ${tileClass}`}
      style={{
        backgroundColor: palette.tint,
        boxShadow: `inset 0 0 0 1px ${palette.ring}`,
        opacity: dim,
      }}
      data-flavor={flavor}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={svgClass}
      >
        <FlavorArt flavor={flavor} accent={palette.accent} />
      </svg>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Per-flavor SVG art                                                       */
/* ──────────────────────────────────────────────────────────────────────── */

interface FlavorArtProps {
  flavor: NotificationFlavor
  accent: string
}

function FlavorArt({ flavor, accent }: FlavorArtProps) {
  switch (flavor) {
    case 'market':
      return <MarketGlyph />
    case 'deposit':
      return <DepositGlyph accent={accent} />
    case 'trade':
      return <TradeGlyph accent={accent} />
    case 'welcome':
      return <WelcomeGlyph accent={accent} />
    case 'maintenance':
      return <MaintenanceGlyph accent={accent} />
    case 'release':
      return <ReleaseGlyph accent={accent} />
    case 'incident':
      return <IncidentGlyph accent={accent} />
    case 'announcement':
    default:
      return <AnnouncementGlyph accent={accent} />
  }
}

/**
 * MarketGlyph — the showcase icon. Two candlesticks: a green "up" candle
 * on the left and a red "down" candle on the right, sitting on a faint
 * baseline. On hover, the up candle nudges up and the down candle nudges
 * down to emphasize the "rise and fall" the user explicitly wanted.
 */
function MarketGlyph() {
  return (
    <>
      {/* Baseline — almost invisible, just enough to anchor the candles. */}
      <line
        x1="4"
        y1="25"
        x2="28"
        y2="25"
        stroke="currentColor"
        strokeOpacity="0.18"
        strokeWidth="1"
        strokeLinecap="round"
      />

      {/* Up candle (left) — green wick + body. */}
      <g className="dex-candle-up" style={{ transformOrigin: '11px 16px' }}>
        <line
          x1="11"
          y1="6"
          x2="11"
          y2="23"
          stroke="#4ade80"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
        <rect
          x="8.25"
          y="10"
          width="5.5"
          height="11"
          rx="0.75"
          fill="#4ade80"
        />
      </g>

      {/* Down candle (right) — red wick + body. */}
      <g className="dex-candle-down" style={{ transformOrigin: '21px 16px' }}>
        <line
          x1="21"
          y1="9"
          x2="21"
          y2="26"
          stroke="#f87171"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
        <rect
          x="18.25"
          y="14"
          width="5.5"
          height="10"
          rx="0.75"
          fill="#f87171"
        />
      </g>
    </>
  )
}

/**
 * DepositGlyph — wallet outline with a coin dropping into it. The coin
 * has a slight motion on hover to suggest "in-flight" funding.
 */
function DepositGlyph({ accent }: { accent: string }) {
  return (
    <>
      {/* Coin — sits above the wallet, animates downward on hover. */}
      <circle
        className="dex-deposit-coin"
        cx="22"
        cy="9"
        r="3"
        fill={accent}
        style={{ transformOrigin: '22px 9px' }}
      />
      {/* Wallet body. */}
      <rect
        x="6"
        y="13"
        width="20"
        height="13"
        rx="2.5"
        stroke={accent}
        strokeWidth="1.6"
        fill="none"
      />
      {/* Wallet flap (subtle inner divider). */}
      <path
        d="M19 19h7"
        stroke={accent}
        strokeOpacity="0.55"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="22.5" cy="19" r="1.1" fill={accent} fillOpacity="0.7" />
    </>
  )
}

/**
 * TradeGlyph — two curving arrows forming a swap loop.
 */
function TradeGlyph({ accent }: { accent: string }) {
  return (
    <>
      {/* Top arc: pointing right. */}
      <path
        d="M7 13c2-4 6-6 10-6 4 0 7 1.5 9 4"
        stroke={accent}
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M22 7l4 4-4 4"
        stroke={accent}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Bottom arc: pointing left. */}
      <path
        d="M25 19c-2 4-6 6-10 6-4 0-7-1.5-9-4"
        stroke={accent}
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
        opacity="0.75"
      />
      <path
        d="M10 25l-4-4 4-4"
        stroke={accent}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity="0.75"
      />
    </>
  )
}

/**
 * WelcomeGlyph — a hero sparkle flanked by two smaller ones. Twinkles on
 * hover via a subtle scale shift on each star.
 */
function WelcomeGlyph({ accent }: { accent: string }) {
  // Four-point sparkle path (a + cross). Repeated at three sizes.
  const sparkle = 'M0 -6 L1.2 -1.2 L6 0 L1.2 1.2 L0 6 L-1.2 1.2 L-6 0 L-1.2 -1.2 Z'
  return (
    <>
      <g
        className="dex-sparkle-hero"
        transform="translate(16 16)"
        style={{ transformOrigin: '16px 16px' }}
      >
        <path d={sparkle} fill={accent} />
      </g>
      <g
        className="dex-sparkle-small dex-sparkle-small--a"
        transform="translate(7 8) scale(0.5)"
      >
        <path d={sparkle} fill={accent} fillOpacity="0.85" />
      </g>
      <g
        className="dex-sparkle-small dex-sparkle-small--b"
        transform="translate(25 23) scale(0.45)"
      >
        <path d={sparkle} fill={accent} fillOpacity="0.8" />
      </g>
    </>
  )
}

/**
 * MaintenanceGlyph — a wrench at an angle. Subtle rotate on hover.
 */
function MaintenanceGlyph({ accent }: { accent: string }) {
  return (
    <g
      className="dex-maintenance-wrench"
      style={{ transformOrigin: '16px 16px' }}
    >
      <path
        d="M20 7a5 5 0 016.6 6.6l-13 13a3 3 0 11-4.2-4.2l13-13a5 5 0 011.6-1.4z"
        stroke={accent}
        strokeWidth="1.6"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M20 7a5 5 0 00-1.4 5 5 5 0 005 5 5 5 0 002.6-.8"
        stroke={accent}
        strokeOpacity="0.5"
        strokeWidth="1.6"
        fill={accent}
        fillOpacity="0.18"
      />
      <circle cx="11" cy="23" r="1.2" fill={accent} />
    </g>
  )
}

/**
 * ReleaseGlyph — a rocket angled up-right with a small exhaust trail.
 * Lifts slightly on hover for the "shipping it" energy.
 */
function ReleaseGlyph({ accent }: { accent: string }) {
  return (
    <g className="dex-release-rocket" style={{ transformOrigin: '16px 16px' }}>
      {/* Rocket body */}
      <path
        d="M22 6c-2 0-5 1-8 4l-2 2c-1 1-1 2 0 3l3 3c1 1 2 1 3 0l2-2c3-3 4-6 4-8l-2-2z"
        fill={accent}
        fillOpacity="0.18"
        stroke={accent}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Window */}
      <circle cx="19" cy="11" r="1.4" fill={accent} />
      {/* Fins */}
      <path
        d="M11 13l-3 1 2 3 2-2z"
        fill={accent}
        fillOpacity="0.5"
        stroke={accent}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      {/* Exhaust trail */}
      <path
        d="M9 19l-3 3M11 21l-2 4M13 23l-1 3"
        stroke={accent}
        strokeOpacity="0.65"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </g>
  )
}

/**
 * IncidentGlyph — a shield with an exclamation. Conveys "heads up,
 * something needs attention" without being alarming.
 */
function IncidentGlyph({ accent }: { accent: string }) {
  return (
    <>
      <path
        d="M16 5l9 3v6c0 6-4 11-9 13-5-2-9-7-9-13V8l9-3z"
        fill={accent}
        fillOpacity="0.15"
        stroke={accent}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <line
        x1="16"
        y1="11"
        x2="16"
        y2="18"
        stroke={accent}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="16" cy="21.5" r="1.25" fill={accent} />
    </>
  )
}

/**
 * AnnouncementGlyph — megaphone. Default for plain platform announcements.
 */
function AnnouncementGlyph({ accent }: { accent: string }) {
  return (
    <>
      {/* Horn cone */}
      <path
        d="M7 13l13-5v16l-13-5v-6z"
        fill={accent}
        fillOpacity="0.18"
        stroke={accent}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {/* Handle / tail */}
      <rect
        x="4"
        y="13"
        width="3"
        height="6"
        rx="1"
        fill={accent}
        fillOpacity="0.55"
      />
      {/* Sound waves */}
      <path
        d="M23 12c1.5 1.5 1.5 6.5 0 8"
        stroke={accent}
        strokeOpacity="0.7"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M25.5 9c2.5 2 2.5 12 0 14"
        stroke={accent}
        strokeOpacity="0.45"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
    </>
  )
}
