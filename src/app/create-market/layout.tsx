'use client';

export default function CreateMarketLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div style={{ 
      height: '100vh', 
      overflow: 'hidden',
      position: 'relative'
    }}>
      <style jsx global>{`
        html, body {
          overflow: hidden !important;
          height: 100vh;
        }
      `}</style>
      {children}
    </div>
  )
} 