import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Limit Orders | Dexetra',
  description: 'Manage your limit orders on Dexetra trading platform',
};

export default function LimitOrdersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
} 