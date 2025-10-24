import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import ClientLayout from '@/components/ClientLayout'
// Removed CentralizedVaultProvider import - smart contract functionality deleted

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Dexetera - DeFi Unlocked',
  description: 'Advanced DeFi Trading Platform',
  icons: {
    icon: [
      {
        url: '/Dexicon/LOGO-Dexetera-03.svg',
        type: 'image/svg+xml',
      },
      {
        url: '/Dexicon/LOGO-Dexetera-03.png',
        type: 'image/png',
        sizes: '32x32',
      },
    ],
    shortcut: '/Dexicon/LOGO-Dexetera-03.png',
    apple: '/Dexicon/LOGO-Dexetera-03@2x.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <ClientLayout>
          {children}
        </ClientLayout>
      </body>
    </html>
  )
}
