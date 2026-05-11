import type { WalkthroughDefinition, WalkthroughStep } from '@/contexts/WalkthroughContext';

const GET_STARTED_ID = 'get-started';
const GET_STARTED_STORAGE_KEY = 'dexextra:walkthrough:get-started:completed';

// Events used to drive the mobile chrome from a walkthrough step.
//
// - `mobileMenu:toggle` is what the mobile header button dispatches when the
//   user taps the hamburger; sending it from a step is the equivalent of
//   "open the menu for them" so the next selector (a nav item rendered
//   inside that drawer) can resolve.
// - `mobileMenu:close` is dispatched by the in-drawer close button and mirrors
//   `setIsMobileMenuOpen(false)` on the header — we use it to put the chrome
//   back into its default state when leaving a nav-item step.
const OPEN_MOBILE_MENU = { name: 'mobileMenu:toggle', detail: { isOpen: true } };
const CLOSE_MOBILE_MENU = { name: 'mobileMenu:close' };

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
    enterEvents: [
      { name: 'walkthrough:wallet:close', detail: { source: 'walkthrough:get-started' } },
      CLOSE_MOBILE_MENU,
    ],
    nextLabel: 'Show wallets',
    mobileDescription: 'Tap the Connect button in the top right to link a wallet.',
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
    // The wallet modal is centered and full-width on mobile, so anchoring the
    // tooltip to the side never fits. Auto + the new mobile dock fallback in
    // WalkthroughLayer pins the bubble to the bottom of the viewport.
    mobilePlacement: 'auto',
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
    enterEvents: [
      { name: 'walkthrough:wallet:close', detail: { source: 'walkthrough:get-started' } },
      CLOSE_MOBILE_MENU,
    ],
    mobileDescription: 'Tap the magnifying-glass to search any active market by symbol, category, or creator.',
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
    enterEvents: [{ name: 'portfolioSidebar:close', detail: { source: 'walkthrough:get-started' } }],
    nextLabel: 'Open portfolio sidebar',
    // The desktop block (`hidden md:flex`) isn't rendered at all on mobile.
    // The mobile header has a single Portfolio icon button that opens the
    // same sidebar — surface that as the equivalent target.
    mobileSelector: '[data-walkthrough="header-portfolio-mobile"]',
    mobileTitle: 'Open your portfolio',
    mobileDescription:
      'Tap the wallet icon to see your portfolio value, available cash, and live P&L on open positions.',
    mobileNextLabel: 'Open portfolio',
    mobileEnterEvents: [
      { name: 'portfolioSidebar:close', detail: { source: 'walkthrough:get-started' } },
      CLOSE_MOBILE_MENU,
    ],
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
    // On mobile the sidebar slides in full-screen; left/right placements
    // never fit. Auto picks bottom-dock via the layer's mobile fallback.
    mobilePlacement: 'auto',
    mobileDescription:
      'Your portfolio drawer covers the whole screen on mobile. Swipe through the tabs to see assets, positions, and orders.',
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
    mobilePlacement: 'auto',
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
    enterEvents: [{ name: 'portfolioSidebar:open', detail: { source: 'walkthrough:get-started' } }],
    mobilePlacement: 'auto',
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
    // Nav items aren't in the DOM on mobile until the hamburger menu opens.
    // Open it as part of the step so the selector resolves; close the
    // portfolio sidebar first in case it was left open.
    mobileEnterEvents: [
      { name: 'portfolioSidebar:close', detail: { source: 'walkthrough:get-started' } },
      OPEN_MOBILE_MENU,
    ],
    mobilePlacement: 'auto',
    mobileDescription: 'Open the side menu and tap Settings to update your profile and account preferences.',
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
    // Mobile menu auto-closes on navigation, so no explicit close needed.
    mobileEnterEvents: [CLOSE_MOBILE_MENU],
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
    mobileEnterEvents: [OPEN_MOBILE_MENU],
    mobilePlacement: 'auto',
    mobileDescription: 'Open the menu and tap Watchlist to keep markets you care about a tap away.',
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
    // On mobile the active-markets grid is tall and reaches both edges, so
    // there's no room above OR below for the bubble — let the layer dock it.
    mobilePlacement: 'auto',
    mobileEnterEvents: [
      { name: 'portfolioSidebar:close', detail: { source: 'walkthrough:get-started' } },
      CLOSE_MOBILE_MENU,
      {
        name: 'walkthrough:scrollToSelector',
        detail: { selector: '[data-walkthrough="home-active-markets"]', behavior: 'smooth', block: 'center' },
      },
    ],
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
    // The "+ New Market" CTA only renders inside the mobile drawer. Open
    // the drawer so the button is visible, then let the user follow the
    // call to the creator.
    mobileEnterEvents: [OPEN_MOBILE_MENU],
    mobilePlacement: 'auto',
    mobileDescription: 'Open the menu and tap New Market to launch the creation flow.',
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
    mobilePlacement: 'auto',
    mobileEnterEvents: [CLOSE_MOBILE_MENU],
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
