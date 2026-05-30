'use client';

import { useState, useEffect } from 'react';

export default function OGPreviewPage() {
  const [symbol, setSymbol] = useState('GOLD');
  const [imageKey, setImageKey] = useState(0);
  const [markets, setMarkets] = useState<Array<{ market_identifier: string; name: string; symbol: string }>>([]);
  const [loading, setLoading] = useState(true);

  const ogUrl = `/api/og/market/${symbol}?t=${imageKey}`;

  useEffect(() => {
    fetch('/api/markets?limit=50')
      .then(res => res.json())
      .then(data => {
        if (data.data) {
          setMarkets(data.data);
          if (data.data.length > 0 && !symbol) {
            setSymbol(data.data[0].market_identifier);
          }
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const refresh = () => setImageKey(k => k + 1);

  return (
    <div style={{ 
      minHeight: '100vh', 
      backgroundColor: '#0A0A0A', 
      padding: '32px',
      fontFamily: 'system-ui, sans-serif'
    }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '32px' }}>
          <h1 style={{ color: 'white', fontSize: '24px', fontWeight: 600, marginBottom: '8px' }}>
            OG Image Preview
          </h1>
          <p style={{ color: '#606060', fontSize: '14px' }}>
            Preview and iterate on social share card designs
          </p>
        </div>

        {/* Controls */}
        <div style={{ 
          display: 'flex', 
          gap: '16px', 
          marginBottom: '24px',
          alignItems: 'center',
          flexWrap: 'wrap'
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ color: '#808080', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Market Symbol
            </label>
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && refresh()}
              placeholder="GOLD"
              style={{
                backgroundColor: '#1A1A1A',
                border: '1px solid #333',
                borderRadius: '8px',
                padding: '10px 14px',
                color: 'white',
                fontSize: '14px',
                width: '200px',
                outline: 'none',
              }}
            />
          </div>

          {markets.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ color: '#808080', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Quick Select
              </label>
              <select
                value={symbol}
                onChange={(e) => {
                  setSymbol(e.target.value);
                  setImageKey(k => k + 1);
                }}
                style={{
                  backgroundColor: '#1A1A1A',
                  border: '1px solid #333',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  color: 'white',
                  fontSize: '14px',
                  minWidth: '250px',
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                {markets.map((m) => (
                  <option key={m.market_identifier} value={m.market_identifier}>
                    {m.name || m.symbol} ({m.market_identifier})
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={refresh}
            style={{
              backgroundColor: '#00D4FF',
              color: '#0A0A0A',
              border: 'none',
              borderRadius: '8px',
              padding: '10px 20px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              marginTop: '20px',
            }}
          >
            Refresh
          </button>

          <a
            href={ogUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              backgroundColor: '#1A1A1A',
              color: '#808080',
              border: '1px solid #333',
              borderRadius: '8px',
              padding: '10px 20px',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
              marginTop: '20px',
              textDecoration: 'none',
            }}
          >
            Open Raw Image
          </a>
        </div>

        {/* URL Display */}
        <div style={{ 
          backgroundColor: '#1A1A1A', 
          borderRadius: '8px', 
          padding: '12px 16px',
          marginBottom: '24px',
          border: '1px solid #222'
        }}>
          <code style={{ color: '#00D4FF', fontSize: '13px', wordBreak: 'break-all' }}>
            {typeof window !== 'undefined' ? window.location.origin : ''}{ogUrl.split('?')[0]}
          </code>
        </div>

        {/* Preview Card */}
        <div style={{ 
          backgroundColor: '#1A1A1A', 
          borderRadius: '12px', 
          padding: '24px',
          border: '1px solid #222'
        }}>
          <div style={{ 
            color: '#606060', 
            fontSize: '12px', 
            textTransform: 'uppercase', 
            letterSpacing: '0.05em',
            marginBottom: '16px'
          }}>
            Preview (1200×630)
          </div>
          
          <div style={{
            position: 'relative',
            width: '100%',
            maxWidth: '1200px',
            aspectRatio: '1200/630',
            backgroundColor: '#0A0A0A',
            borderRadius: '8px',
            overflow: 'hidden',
            border: '1px solid #333',
          }}>
            {loading ? (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: '#606060',
              }}>
                Loading markets...
              </div>
            ) : (
              <img
                key={imageKey}
                src={ogUrl}
                alt="OG Preview"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                }}
              />
            )}
          </div>
        </div>

        {/* Social Preview Mockups */}
        <div style={{ marginTop: '32px' }}>
          <div style={{ 
            color: '#606060', 
            fontSize: '12px', 
            textTransform: 'uppercase', 
            letterSpacing: '0.05em',
            marginBottom: '16px'
          }}>
            Social Preview Mockups
          </div>

          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
            {/* Twitter Card Mockup */}
            <div style={{
              backgroundColor: '#1A1A1A',
              borderRadius: '12px',
              padding: '16px',
              border: '1px solid #222',
              width: '400px',
            }}>
              <div style={{ color: '#808080', fontSize: '12px', marginBottom: '12px' }}>Twitter / X</div>
              <div style={{
                borderRadius: '12px',
                overflow: 'hidden',
                border: '1px solid #333',
              }}>
                <img
                  src={ogUrl}
                  alt="Twitter preview"
                  style={{ width: '100%', aspectRatio: '1200/630', objectFit: 'cover' }}
                />
                <div style={{ padding: '12px', backgroundColor: '#0A0A0A' }}>
                  <div style={{ color: '#808080', fontSize: '13px' }}>dexetera.org</div>
                  <div style={{ color: 'white', fontSize: '15px', fontWeight: 500, marginTop: '4px' }}>
                    {symbol} | Dexetera
                  </div>
                  <div style={{ color: '#808080', fontSize: '13px', marginTop: '4px' }}>
                    Trade any metric. No permission needed.
                  </div>
                </div>
              </div>
            </div>

            {/* Discord Card Mockup */}
            <div style={{
              backgroundColor: '#1A1A1A',
              borderRadius: '12px',
              padding: '16px',
              border: '1px solid #222',
              width: '400px',
            }}>
              <div style={{ color: '#808080', fontSize: '12px', marginBottom: '12px' }}>Discord</div>
              <div style={{
                borderRadius: '8px',
                overflow: 'hidden',
                border: '1px solid #333',
                borderLeft: '4px solid #00D4FF',
                backgroundColor: '#0A0A0A',
              }}>
                <div style={{ padding: '12px' }}>
                  <div style={{ color: '#00D4FF', fontSize: '13px', fontWeight: 500 }}>Dexetera</div>
                  <div style={{ color: 'white', fontSize: '14px', marginTop: '8px' }}>
                    {symbol} | Dexetera
                  </div>
                  <div style={{ color: '#808080', fontSize: '13px', marginTop: '4px' }}>
                    Trade any metric. No permission needed.
                  </div>
                </div>
                <img
                  src={ogUrl}
                  alt="Discord preview"
                  style={{ width: '100%', aspectRatio: '1200/630', objectFit: 'cover' }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
