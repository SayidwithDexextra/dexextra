import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Dexetera — Trade Any Metric',
    short_name: 'Dexetera',
    description:
      'Decentralized trading platform for permissionless futures markets on any measurable metric. Create, trade, and settle markets on real-world data.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#0A0A0A',
    theme_color: '#00D4FF',
    categories: ['finance', 'business'],
    icons: [
      {
        src: '/Dexicon/LOGO-Dexetera-square.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/Dexicon/LOGO-Dexetera-square-gradient.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  };
}
