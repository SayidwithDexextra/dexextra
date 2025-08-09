'use client'

import { Faucet } from '@/components/Faucet'

export default function RewardsPage() {
  return (
    <div style={{ 
      width: '100%',
      height: '100vh',
      padding: '20px 60px',
      background: 'transparent',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      boxSizing: 'border-box'
    }}>
      {/* Title Section */}
      <div style={{
        textAlign: 'center',
        marginBottom: '28px',
        paddingBottom: '20px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        flexShrink: 0
      }}>
        <h1 style={{
          fontSize: '36px',
          fontWeight: '700',
          color: '#ffffff',
          lineHeight: '1.1',
          letterSpacing: '-0.02em',
          marginBottom: '10px',
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        }}>
          Rewards
        </h1>
        <p style={{
          fontSize: '16px',
          fontWeight: '400',
          color: '#9CA3AF',
          lineHeight: '1.4',
          maxWidth: '450px',
          margin: '0 auto',
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        }}>
          Claim unlimited test USDC tokens to explore Dexetra markets.
        </p>
      </div>

      {/* Faucet Section */}
      <div style={{
        flex: 1,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        overflow: 'hidden'
      }}>
        <Faucet />
      </div>

      {/* Mobile Responsive Styles */}
      <style jsx>{`
        @media (max-width: 768px) {
          div:first-child {
            padding: 16px 24px !important;
          }
          
          h1[style*="font-size: 36px"] {
            font-size: 28px !important;
            margin-bottom: 8px !important;
          }
          
          p[style*="font-size: 16px"] {
            font-size: 14px !important;
            line-height: 1.3 !important;
          }
        }
      `}</style>
    </div>
  )
} 