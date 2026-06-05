'use client';

import { useEffect } from 'react';

/**
 * Human visitors of a /s/<symbol> share link are redirected to the real market
 * page. Social crawlers don't execute JS, so they stay on this page and read
 * the variant-aware Open Graph / Twitter metadata for the link preview.
 */
export default function ShareRedirect({ href }: { href: string }) {
  useEffect(() => {
    window.location.replace(href);
  }, [href]);

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0F0F0F',
        color: '#A1A1A1',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 15,
      }}
    >
      <a href={href} style={{ color: '#FFFFFF', textDecoration: 'none' }}>
        Continue to Dexetera →
      </a>
    </main>
  );
}
