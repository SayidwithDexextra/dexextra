'use client'

import { http, createConfig, createStorage } from 'wagmi'
import { arbitrum, mainnet, polygon } from 'wagmi/chains'
import { injected, walletConnect, coinbaseWallet, safe } from 'wagmi/connectors'

const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || ''

const metadata = {
  name: 'Dexetera',
  description: 'DeFi Unlocked - Advanced DeFi Trading Platform',
  url: typeof window !== 'undefined' ? window.location.origin : 'https://dexetera.win',
  icons: ['https://dexetera.win/Dexicon/LOGO-Dexetera-03.png'],
}

export const wagmiConfig = createConfig({
  chains: [arbitrum, mainnet, polygon],
  connectors: [
    injected(),
    ...(WALLETCONNECT_PROJECT_ID
      ? [
          walletConnect({
            projectId: WALLETCONNECT_PROJECT_ID,
            metadata,
            showQrModal: true,
          }),
        ]
      : []),
    coinbaseWallet({
      appName: metadata.name,
      appLogoUrl: metadata.icons[0],
    }),
    safe(),
  ],
  transports: {
    [arbitrum.id]: http(),
    [mainnet.id]: http(),
    [polygon.id]: http(),
  },
  storage: createStorage({
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    key: 'wagmi.dexetera',
  }),
  ssr: true,
})

export { WALLETCONNECT_PROJECT_ID }
