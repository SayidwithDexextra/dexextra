import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Create Market | Dexetra',
  description: 'Create a new vAMM market on Dexetra platform',
};

export default function CreateMarketLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div 
      style={{ 
        height: '100vh', 
        overflow: 'hidden',
        position: 'relative'
      }}
      className="create-market-layout"
    >
      {children}
    </div>
  );
} 