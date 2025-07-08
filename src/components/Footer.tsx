import React from 'react';
import { useETHPrice } from '../hooks/useETHPrice';

const Footer: React.FC = () => {
  const { price: ethPrice, changePercent24h, isLoading, error } = useETHPrice();
  
  return (
    <footer 
      className="fixed bottom-0 right-0 z-40 flex items-center justify-between transition-all duration-300 ease-in-out"
      style={{
        height: '48px',
        background: `
          radial-gradient(circle at 1px 1px, rgba(255,255,255,0.15) 1px, transparent 0),
          radial-gradient(circle at 3px 3px, rgba(255,255,255,0.1) 1px, transparent 0),
          #000000
        `,
        backgroundSize: '4px 4px, 8px 8px',
        backgroundPosition: '0 0, 0 0',
        padding: '0 16px',
        borderTop: '1px solid #333333',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        left: '60px', // Fixed position for collapsed navbar only
        width: 'calc(100vw - 60px)' // Fixed width for collapsed navbar only
      }}
    >
      {/* Left Section - Status Indicators and Navigation */}
      <div 
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '24px',
        }}
      >
        {/* Live Status Indicator */}
        <div 
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 8px',
            fontSize: '12px',
            fontWeight: '500',
            color: '#00FF88',
          }}
        >
          <div 
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: '#00FF88',
            }}
          />
          Live
        </div>

        {/* Aggregating Status */}
        <div 
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 8px',
            fontSize: '12px',
            fontWeight: '400',
            color: '#FFFFFF',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M13 10V3L4 14h7v7l9-11h-7z"/>
          </svg>
          Aggregating
        </div>

        {/* Networks */}
        <div 
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 8px',
            fontSize: '12px',
            fontWeight: '400',
            color: '#FFFFFF',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="3"/>
            <circle cx="12" cy="3" r="1"/>
            <circle cx="12" cy="21" r="1"/>
            <circle cx="3" cy="12" r="1"/>
            <circle cx="21" cy="12" r="1"/>
          </svg>
          Networks
        </div>
      </div>

      {/* Center Section - Navigation Links */}
      <div 
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
        }}
      >
        <a 
          href="/terms"
          style={{
            padding: '4px 8px',
            fontSize: '14px',
            fontWeight: '400',
            color: '#FFFFFF',
            textDecoration: 'none',
            cursor: 'pointer',
            transition: 'color 0.2s ease',
          }}
          onMouseEnter={(e) => e.currentTarget.style.color = '#CCCCCC'}
          onMouseLeave={(e) => e.currentTarget.style.color = '#FFFFFF'}
        >
          Terms of Service
        </a>
        
        <a 
          href="/privacy"
          style={{
            padding: '4px 8px',
            fontSize: '14px',
            fontWeight: '400',
            color: '#FFFFFF',
            textDecoration: 'none',
            cursor: 'pointer',
            transition: 'color 0.2s ease',
          }}
          onMouseEnter={(e) => e.currentTarget.style.color = '#CCCCCC'}
          onMouseLeave={(e) => e.currentTarget.style.color = '#FFFFFF'}
        >
          Privacy Policy
        </a>

        {/* Social Icons */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            style={{
              width: '20px',
              height: '20px',
              padding: '2px',
              cursor: 'pointer',
              color: '#FFFFFF',
              background: 'none',
              border: 'none',
              transition: 'opacity 0.2s ease',
            }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
            onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
          </button>
          
          <button 
            style={{
              width: '20px',
              height: '20px',
              padding: '2px',
              cursor: 'pointer',
              color: '#FFFFFF',
              background: 'none',
              border: 'none',
              transition: 'opacity 0.2s ease',
            }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
            onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.211.375-.445.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Right Section - User Info and Controls */}
      <div 
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
        }}
      >
        {/* ETH Price Display */}
        <div 
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '14px',
            fontWeight: '500',
            color: '#FFFFFF',
          }}
        >
          <span style={{ color: '#FFB800' }}>Ξ</span>
          {isLoading ? (
            <span style={{ color: '#CCCCCC' }}>Loading...</span>
          ) : error ? (
            <span style={{ color: '#EF4444' }}>Error</span>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>${ethPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              <span 
                style={{ 
                  color: changePercent24h >= 0 ? '#10B981' : '#EF4444',
                  fontSize: '12px',
                  fontWeight: '400'
                }}
              >
                {changePercent24h >= 0 ? '↗' : '↘'} {Math.abs(changePercent24h).toFixed(2)}%
              </span>
            </div>
          )}
        </div>

        {/* GWEI Display */}
        <div 
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '14px',
            fontWeight: '500',
            color: '#FFFFFF',
          }}
        >
          <span style={{ color: '#00FF88' }}>⛽</span>
          8.06 GWEI
        </div>

        {/* Support */}
        <a 
          href="/support"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 8px',
            fontSize: '14px',
            fontWeight: '400',
            color: '#FFFFFF',
            textDecoration: 'none',
            cursor: 'pointer',
            transition: 'color 0.2s ease',
          }}
          onMouseEnter={(e) => e.currentTarget.style.color = '#CCCCCC'}
          onMouseLeave={(e) => e.currentTarget.style.color = '#FFFFFF'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/>
          </svg>
          Support
        </a>

        {/* Theme Toggle */}
        <button 
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 8px',
            fontSize: '14px',
            fontWeight: '400',
            color: '#FFFFFF',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            transition: 'opacity 0.2s ease',
          }}
          onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
          onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 3a6 6 0 0 0 9 5.2A9 9 0 1 1 8.2 3a6 6 0 0 0 3.8 0z"/>
          </svg>
        </button>

        {/* User Account */}
        <div 
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '14px',
            fontWeight: '500',
            color: '#FFFFFF',
          }}
        >
          <span>Collector</span>
          <span style={{ color: '#00FF88' }}>Pro</span>
          <span>Crypto</span>
          <span style={{ color: '#FFB800' }}>USD</span>
        </div>

        {/* Volume Control */}
        <button 
          style={{
            width: '20px',
            height: '20px',
            padding: '2px',
            cursor: 'pointer',
            color: '#FFFFFF',
            background: 'none',
            border: 'none',
            transition: 'opacity 0.2s ease',
          }}
          onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
          onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
          </svg>
        </button>
      </div>
    </footer>
  );
};

export default Footer; 