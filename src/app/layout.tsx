import type { Metadata } from 'next'
import { Inter, Space_Grotesk } from 'next/font/google'
import { GeistMono } from 'geist/font/mono'
import './globals.css'
import ClientLayout from '@/components/ClientLayout'
// Removed CentralizedVaultProvider import - smart contract functionality deleted

const inter = Inter({ subsets: ['latin'] })

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
})

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
      <body className={`${inter.className} ${spaceGrotesk.variable} ${GeistMono.variable}`}>
        <ClientLayout>
          {children}
        </ClientLayout>
      </body>
    </html>
  )
}
