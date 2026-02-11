import type { WalkthroughDefinition, WalkthroughStep } from '@/contexts/WalkthroughContext';

const GET_STARTED_ID = 'get-started';
const GET_STARTED_STORAGE_KEY = 'dexextra:walkthrough:get-started:completed';

const walletConnectSteps: WalkthroughStep[] = [
  {
    id: 'wallet-connect-cta',
    route: '/',
    selector: '[data-walkthrough="header-connect-wallet"]',
    title: 'Connect your wallet',
    description: 'Use the Connect Wallet button in the top-right to link MetaMask and unlock live portfolio data.',
    placement: 'bottom',
    paddingPx: 10,
    radiusPx: 12,
    enterEvents: [{ name: 'walkthrough:wallet:close', detail: { source: 'walkthrough:get-started' } }],
    nextLabel: 'Show wallets',
  },
  {
    id: 'wallet-connect-metamask',
    route: '/',
    selector: '[data-walkthrough="wallet-modal:metamask"]',
    title: 'Select MetaMask',
    description: 'Choose MetaMask to connect your wallet.',
    placement: 'right',
    paddingPx: 12,
    radiusPx: 14,
    enterEvents: [{ name: 'walkthrough:wallet:open', detail: { source: 'walkthrough:get-started' } }],
    nextLabel: 'Continue',
  },
];

const baseSteps: WalkthroughStep[] = [
  {
    id: 'search',
    route: '/',
    selector: '[data-walkthrough="header-search"]',
    title: 'Search markets instantly',
    description: 'Use global search to quickly jump to any active market by symbol, category, or creator.',
    placement: 'bottom',
    paddingPx: 10,
    radiusPx: 12,
    enterEvents: [{ name: 'walkthrough:wallet:close', detail: { source: 'walkthrough:get-started' } }],
  },
  {
    id: 'header-cash-pnl',
    route: '/',
    selector: '[data-walkthrough="header-portfolio-cash-pnl"]',
    title: 'Portfolio, Available Cash & Unrealized P&L',
    description:
      'Your portfolio value, deployable balance (Available Cash), and live P&L on open positions (Unrealized P&L). Click here any time to open your portfolio details.',
    placement: 'bottom',
    paddingPx: 10,
    radiusPx: 12,
    nextLabel: 'Open portfolio sidebar',
  },
  {
    id: 'portfolio-sidebar',
    route: '/',
    selector: '[data-walkthrough="portfolio-sidebar"]',
    title: 'Portfolio sidebar',
    description:
      'This quick drawer gives you a snapshot of your assets, open positions, and open orders. Tap any row to jump into that market.',
    placement: 'left',
    paddingPx: 12,
    radiusPx: 16,
    enterEvents: [{ name: 'portfolioSidebar:open', detail: { source: 'walkthrough:get-started' } }],
    nextLabel: 'Next',
  },
  {
    id: 'portfolio-sidebar-overview',
    route: '/',
    selector: '[data-walkthrough="portfolio-sidebar-overview"]',
    title: 'Overview snapshot',
    description: 'A quick, stable snapshot of your account totals. When you connect a wallet, this fills in live data.',
    placement: 'left',
    paddingPx: 12,
    radiusPx: 16,
    enterEvents: [{ name: 'portfolioSidebar:open', detail: { source: 'walkthrough:get-started' } }],
  },
  {
    id: 'portfolio-sidebar-body',
    route: '/',
    selector: '[data-walkthrough="portfolio-sidebar-body"]',
    title: 'Positions & orders (inside)',
    description: 'Scroll this panel to see positions and orders. Tap any item to jump straight into that market.',
    placement: 'left',
    paddingPx: 12,
    radiusPx: 16,
  },
  {
    id: 'nav-settings',
    route: '/',
    selector: '[data-walkthrough="nav:settings"]',
    title: 'Settings',
    description: 'Head here to update your profile and account preferences.',
    placement: 'right',
    paddingPx: 10,
    radiusPx: 12,
    enterEvents: [{ name: 'portfolioSidebar:close', detail: { source: 'walkthrough:get-started' } }],
    nextLabel: 'Open settings',
  },
  {
    id: 'settings-overview',
    route: '/settings',
    selector: '[data-walkthrough="settings-header"]',
    title: 'Settings overview',
    description:
      'Here you can update things like your username, profile images, and social links. You can come back any time — let’s keep moving.',
    placement: 'bottom',
    paddingPx: 10,
    radiusPx: 12,
    nextLabel: 'Continue',
  },
  {
    id: 'nav-watchlist',
    route: '/',
    selector: '[data-walkthrough="nav:watchlist"]',
    title: 'Watchlist',
    description: 'Save markets you care about and keep them pinned for quick access.',
    placement: 'right',
    paddingPx: 10,
    radiusPx: 12,
  },
  {
    id: 'home-active-markets',
    route: '/',
    selector: '[data-walkthrough="home-active-markets"]',
    title: 'Active markets',
    description:
      'These cards are the live “Active Markets” feed. You can scan what’s trending, jump into a market, and star markets to add them to your watchlist.',
    placement: 'top',
    paddingPx: 12,
    radiusPx: 16,
    allowDocumentScroll: true,
    enterEvents: [
      { name: 'portfolioSidebar:close', detail: { source: 'walkthrough:get-started' } },
      {
        name: 'walkthrough:scrollToSelector',
        detail: { selector: '[data-walkthrough="home-active-markets"]', behavior: 'smooth', block: 'center' },
      },
    ],
    nextLabel: 'Create a market',
  },
  {
    id: 'create-market',
    route: '/',
    selector: '[data-walkthrough="new-market"]',
    title: 'Create a new market',
    description: 'Start the market creation flow from anywhere.',
    placement: 'right',
    paddingPx: 12,
    radiusPx: 12,
    nextLabel: 'Go to creator',
  },
  {
    id: 'creator',
    route: '/new-market',
    selector: '[data-walkthrough="market-creator"]',
    title: 'AI-assisted market creator',
    description: 'Describe what you want to trade, pick a source, validate the value, and deploy.',
    placement: 'top',
    paddingPx: 12,
    radiusPx: 16,
    nextLabel: 'Finish',
  },
];

export function makeGetStartedWalkthrough(opts?: { includeWalletConnectSteps?: boolean }): WalkthroughDefinition {
  const includeWalletConnectSteps = Boolean(opts?.includeWalletConnectSteps);
  return {
    id: GET_STARTED_ID,
    storageKey: GET_STARTED_STORAGE_KEY,
    steps: includeWalletConnectSteps ? [...walletConnectSteps, ...baseSteps] : baseSteps,
  };
}

export const getStartedWalkthrough: WalkthroughDefinition = makeGetStartedWalkthrough();

