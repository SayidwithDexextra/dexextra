import type { WalkthroughDefinition } from '@/contexts/WalkthroughContext';

/**
 * The mobile token page is laid out very differently from desktop:
 *   - The full `MarketInfoHeader` (settlement badge, description, wayback
 *     link, etc.) is replaced by a single compact tappable bar that opens
 *     a bottom sheet with the same info.
 *   - The right-rail (orderbook / token info / trade panel / live metric
 *     card) is collapsed into a tab strip + bottom action bar (Activity /
 *     Long / Short / Comments).
 *
 * Rather than try to point at hidden desktop nodes, the walkthrough below
 * uses `mobileSelector` to swap in the equivalent mobile target where one
 * exists, and `skipOnMobile: true` for the steps that have no mobile
 * counterpart — those concepts are taught when the user actually opens
 * the corresponding sheet.
 */
export const tokenPageWalkthrough: WalkthroughDefinition = {
  id: 'token-page',
  storageKey: 'dexextra:walkthrough:token-page:completed',
  steps: [
    {
      id: 'market-header',
      selector: '[data-walkthrough="token-market-header"]',
      title: 'Market header',
      description:
        'This is the market header — it shows the market name, status, tags, contract addresses, and quick links. Everything you need to identify and verify a market at a glance.',
      placement: 'bottom',
      paddingPx: 8,
      radiusPx: 14,
      // Mobile collapses the full header into a single tappable bar that
      // opens a bottom sheet with the same details.
      mobileSelector: '[data-walkthrough="token-market-header-mobile"]',
      mobilePlacement: 'bottom',
      mobileTitle: 'Market summary',
      mobileDescription:
        'Tap this bar any time to see the full market name, status, tags, contracts, and quick links.',
      mobilePaddingPx: 4,
      mobileRadiusPx: 8,
    },
    {
      id: 'settlement-date',
      selector: '[data-walkthrough="token-settlement-date"]',
      title: 'Settlement date',
      description:
        'This badge shows when the market settles. Hover to see a live countdown. Once the settlement date is reached, the market enters the resolution process.',
      placement: 'bottom',
      paddingPx: 6,
      radiusPx: 10,
      // The settlement badge lives inside the desktop-only MarketInfoHeader.
      // It's still reachable via the market summary bottom sheet on mobile,
      // but pointing at a non-existent node would just spotlight the page
      // body, so we skip the dedicated step on phones.
      skipOnMobile: true,
    },
    {
      id: 'description',
      selector: '[data-walkthrough="token-description"]',
      title: 'Market description',
      description:
        'The market description explains what this market is about and what conditions determine its outcome. Click "More" to expand the full description.',
      placement: 'bottom',
      paddingPx: 6,
      radiusPx: 10,
      skipOnMobile: true,
    },
    {
      id: 'wayback-link',
      selector: '[data-walkthrough="token-wayback"]',
      title: 'Wayback Machine archive',
      description:
        'This links to an archived snapshot of the market\'s source page via the Wayback Machine — a tamper-proof reference so you can verify the original data source.',
      placement: 'bottom',
      paddingPx: 6,
      radiusPx: 10,
      // The mobile compact bar mirrors the wayback badge with the same
      // `data-walkthrough` attribute, so the layer's "first visible match"
      // resolution will pick the right one without us doing anything.
      mobilePlacement: 'bottom',
      mobilePaddingPx: 4,
      mobileRadiusPx: 8,
    },
    {
      id: 'chart',
      selector: '[data-walkthrough="token-chart"]',
      title: 'Chart & price context',
      description:
        'Use the chart to understand price action (candles). The metric live price tracker is a separate indicator overlaid on top of the chart for comparison — it renders in purple.',
      placement: 'auto',
      paddingPx: 10,
      radiusPx: 14,
      // Both desktop and mobile render a `data-walkthrough="token-chart"`
      // node — the layer's "first visible match" resolver will pick the
      // right one. On mobile the chart fills almost the whole viewport,
      // so dock the bubble at the bottom (auto + dock-fallback).
      mobilePlacement: 'auto',
      mobileDescription:
        'Pinch and pan the chart to read price action. The purple overlay is the live metric tracker for comparison.',
    },
    {
      id: 'activity',
      selector: '[data-walkthrough="token-activity"]',
      title: 'Market activity',
      description:
        'These tabs show your platform-wide activity — not just this market. Positions includes all market positions, and the Open Orders + Order History tabs aggregate across all markets.',
      placement: 'auto',
      paddingPx: 10,
      radiusPx: 14,
      // On mobile, activity lives behind the bottom-bar Activity icon
      // (opens a sheet). Highlight that button instead of the desktop
      // panel so users know how to reach it.
      mobileSelector: '[data-walkthrough="token-activity-mobile"]',
      mobilePlacement: 'top',
      mobileTitle: 'Open the activity sheet',
      mobileDescription:
        'Tap the activity icon to slide up a sheet with your positions, open orders, and order history across every market.',
      mobilePaddingPx: 6,
      mobileRadiusPx: 10,
    },
    {
      id: 'token-activity-manage',
      selector:
        '[data-walkthrough="token-activity-manage"], [data-walkthrough="token-activity-empty-positions"]',
      title: 'Manage positions',
      description:
        'In the Positions tab, each row has a Manage action. Use it to reveal controls for that position (top up margin or close).',
      placement: 'auto',
      paddingPx: 10,
      radiusPx: 14,
      enterEvents: [{ name: 'walkthrough:tokenActivity:collapsePositions' }],
      nextLabel: 'Close a position',
      // Manage / close UI lives inside the desktop activity panel that
      // isn't rendered on mobile; the mobile activity sheet has its own
      // controls revealed only when the user opens it manually.
      skipOnMobile: true,
    },
    {
      id: 'token-activity-close',
      selector:
        '[data-walkthrough="token-activity-close-position"], [data-walkthrough="token-activity-empty-positions"]',
      title: 'Close positions',
      description:
        'To close (or reduce) a position, click Manage, then hit Close Position. You’ll choose a close size and confirm in the modal.',
      placement: 'auto',
      paddingPx: 10,
      radiusPx: 14,
      enterEvents: [{ name: 'walkthrough:tokenActivity:expandFirstPosition' }],
      skipOnMobile: true,
    },
    {
      id: 'trade',
      selector: '[data-walkthrough="token-trade"]',
      title: 'Trading panel',
      description: 'Place long/short orders and manage your position from here.',
      placement: 'auto',
      paddingPx: 10,
      radiusPx: 14,
      // Mobile replaces the side trading panel with two big Long / Short
      // buttons in the bottom action bar — highlight them together by
      // pointing at the action-bar wrapper.
      mobileSelector: '[data-walkthrough="token-mobile-action-bar"]',
      mobilePlacement: 'top',
      mobileTitle: 'Place a trade',
      mobileDescription:
        'Tap Long or Short to open the trading sheet. Activity and Comments live right next to them in the same bar.',
      mobilePaddingPx: 6,
      mobileRadiusPx: 10,
    },
    {
      id: 'token-info',
      selector: '[data-walkthrough="token-info"]',
      title: 'Token info (sidebar)',
      description:
        'This panel summarizes the market details and key status information for the token you’re viewing.',
      placement: 'auto',
      paddingPx: 10,
      radiusPx: 14,
      // Token info on mobile is reached by tapping the compact market bar,
      // which opens an info bottom sheet — we already covered that step.
      skipOnMobile: true,
    },
    {
      id: 'live-metric',
      selector: '[data-walkthrough="token-live-price"]',
      title: 'Market metric source',
      description:
        'This card shows the metric URL that the market is centered around — the canonical source used for resolving and verifying this market’s metric value.',
      placement: 'auto',
      paddingPx: 10,
      radiusPx: 14,
      // Same as token-info: lives inside the desktop right-rail; the
      // mobile sheet shows it after the user taps the market summary bar.
      skipOnMobile: true,
    },
    {
      id: 'comments',
      selector: '[data-walkthrough="token-comments"]',
      title: 'Community discussion',
      description:
        'Join the conversation — post comments, reply to other traders, and discuss market sentiment. This is where the community shares analysis and insights.',
      placement: 'auto',
      paddingPx: 10,
      radiusPx: 14,
      nextLabel: 'Finish',
      mobileSelector: '[data-walkthrough="token-comments-mobile"]',
      mobilePlacement: 'top',
      mobileTitle: 'Open the comments sheet',
      mobileDescription:
        'Tap the chat bubble to slide up the comments sheet — post, reply, and read the rest of the community.',
      mobilePaddingPx: 6,
      mobileRadiusPx: 10,
      mobileNextLabel: 'Finish',
    },
  ],
};
