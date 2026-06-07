import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dexetera — Pitch Deck',
  description: 'Private investor pitch deck for Dexetera.',
  robots: { index: false, follow: false },
};

export default function PitchDeckLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
