import type { WalkthroughDefinition } from '@/contexts/WalkthroughContext';

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
    },
    {
      id: 'trade',
      selector: '[data-walkthrough="token-trade"]',
      title: 'Trading panel',
      description: 'Place long/short orders and manage your position from here.',
      placement: 'auto',
      paddingPx: 10,
      radiusPx: 14,
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
    },
  ],
};

