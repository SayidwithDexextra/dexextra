import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dexetera — Hedging Examples',
  description: 'How real businesses use Dexetera to hedge un-hedgeable risk.',
  robots: { index: false, follow: false },
};

export default function HedgingDeckLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
