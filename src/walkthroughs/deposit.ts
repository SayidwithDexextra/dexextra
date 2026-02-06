import type { WalkthroughDefinition } from '@/contexts/WalkthroughContext';

export const depositWalkthrough: WalkthroughDefinition = {
  id: 'deposit',
  title: 'Deposit walkthrough',
  steps: [
    {
      id: 'deposit-button',
      selector: '[data-walkthrough="deposit-button"]',
      title: 'Deposit collateral',
      description:
        'Use this button to open the deposit flow and add collateral to your account.',
      placement: 'auto',
      paddingPx: 10,
      radiusPx: 12,
      gapPx: 22,
      nextLabel: 'Open deposits',
    },
    {
      id: 'chain-arbitrum',
      selector: '[data-walkthrough="deposit-chain-arbitrum"]',
      title: 'Arbitrum deposits',
      description:
        'Deposits are facilitated through Arbitrum. In this step, pick the chain you want to deposit from.',
      placement: 'auto',
      paddingPx: 10,
      radiusPx: 14,
      gapPx: 22,
      enterEvents: [
        { name: 'walkthrough:deposit:open' },
        { name: 'walkthrough:deposit:openChain', detail: { chain: 'Arbitrum' } },
      ],
      nextLabel: 'Choose USDC',
    },
    {
      id: 'token-usdc',
      selector: '[data-walkthrough="deposit-token-arbitrum-usdc"]',
      title: 'USDC collateral',
      description:
        'USDC is the collateral token for this flow. Select USDC on Arbitrum to continue.',
      placement: 'auto',
      paddingPx: 10,
      radiusPx: 14,
      gapPx: 22,
      enterEvents: [
        { name: 'walkthrough:deposit:openChain', detail: { chain: 'Arbitrum' } },
        { name: 'walkthrough:deposit:setToken', detail: { chain: 'Arbitrum', symbol: 'USDC' } },
      ],
      nextLabel: 'Continue',
    },
    {
      id: 'continue',
      selector: '[data-walkthrough="deposit-continue"]',
      title: 'Proceed to deposit details',
      description:
        'Continue to the deposit screen. You can deposit via the Arbitrum spoke vault address, or use the in-app deposit action when a wallet is connected.',
      placement: 'auto',
      paddingPx: 10,
      radiusPx: 14,
      gapPx: 22,
      nextLabel: 'Deposit action',
    },
    {
      id: 'function-cta',
      selector: '[data-walkthrough="deposit-function-cta"]',
      title: 'In-app deposit action',
      description:
        'This button starts the Arbitrum deposit flow from inside the app. In the walkthrough we’ll stop before submitting a transaction.',
      placement: 'auto',
      paddingPx: 10,
      radiusPx: 14,
      gapPx: 22,
      enterEvents: [
        { name: 'walkthrough:deposit:setStep', detail: { step: 'external' } },
      ],
      nextLabel: 'Enter amount',
    },
    {
      id: 'spoke',
      selector: '[data-walkthrough="deposit-spoke-modal"]',
      title: 'Enter amount & deposit',
      description:
        'Enter the USDC amount you want to deposit on Arbitrum, then click Deposit. Your wallet will prompt you to approve and submit the transaction.',
      placement: 'auto',
      paddingPx: 12,
      radiusPx: 16,
      gapPx: 22,
      enterEvents: [
        { name: 'walkthrough:deposit:openSpoke', detail: { amount: '1' } },
      ],
      nextLabel: 'Finish',
    },
  ],
};

