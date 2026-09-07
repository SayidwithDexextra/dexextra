'use client';

import Link from 'next/link';
import styles from './MarketWallHero.module.css';
import type { MarketWallHeroProps, MarketWallTile } from './types';

const DEFAULTS = {
  eyebrow: 'Dexetera / Market Wall',
  title: 'Create, and Trade, Community Made Futures Tokens',
  subtitle: 'Every tile is a market someone here wrote. Take a side, or write your own.',
};

function sparkPoints(series: number[], width = 76, height = 26): string {
  if (series.length < 2) return '';
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const pad = 2;
  const innerH = height - pad * 2;
  return series
    .map((value, index) => {
      const x = (index / (series.length - 1)) * width;
      const y = pad + innerH - ((value - min) / range) * innerH;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

function formatChange(changePct: number | null, direction: 'up' | 'down'): string {
  if (changePct == null) return '—';
  const abs = Math.abs(changePct).toFixed(1);
  return `${direction === 'up' ? '▲' : '▼'} ${abs}%`;
}

const MarketWallHero: React.FC<MarketWallHeroProps> = ({
  tiles,
  totalMarkets,
  isLoading = false,
  tileCount = 6,
  className = '',
  title = DEFAULTS.title,
  subtitle = DEFAULTS.subtitle,
  eyebrow = DEFAULTS.eyebrow,
}) => {
  const shown = tiles.slice(0, tileCount);

  return (
    <section className={`${styles.hero} ${className}`}>
      <div className={styles.bg} aria-hidden="true">
        <div className={styles.grid} />
        <div className={styles.glowGreen} />
        <div className={styles.glowBlue} />
        <div className={styles.sweep} />
      </div>

      <div className={styles.left}>
        <div>
          <div className={styles.eyebrow}>{eyebrow}</div>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.subtitle}>{subtitle}</p>
        </div>

        <div>
          <div className={styles.ctaRow}>
            <Link href="/explore" className={styles.ctaPrimary}>
              Explore Markets
              <svg
                className={styles.ctaArrow}
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
            <Link href="/new-market" className={styles.ctaSecondary}>
              Create Market
            </Link>
          </div>

          <div className={styles.status}>
            <span className={styles.statusItem}>
              <i className={`${styles.dot} ${styles.dotLive}`} />
              Live
            </span>
            <span className={styles.statusItem}>
              <i className={`${styles.dot} ${styles.dotInfo}`} />
              On-Chain Settlement
            </span>
            <span className={styles.statusItem}>
              <i className={`${styles.dot} ${styles.dotIdle}`} />
              Community Created
            </span>
          </div>
        </div>
      </div>

      <div className={styles.right}>
        <div className={styles.panelHead}>
          <h4>Active Markets</h4>
          <div className={styles.badge}>
            {isLoading ? '—' : totalMarkets ?? tiles.length}
          </div>
        </div>

        <div className={styles.wall} aria-busy={isLoading || undefined}>
          {isLoading ? (
            Array.from({ length: tileCount }, (_, i) => <TileSkeleton key={i} />)
          ) : shown.length === 0 ? (
            <div className={styles.empty}>
              <i className={`${styles.dot} ${styles.dotIdle}`} />
              No active markets
            </div>
          ) : (
            shown.map((tile) => <Tile key={tile.id} tile={tile} />)
          )}
        </div>
      </div>
    </section>
  );
};

const Tile: React.FC<{ tile: MarketWallTile }> = ({ tile }) => {
  const isUp = tile.direction === 'up';
  const color = isUp ? '#4ADE80' : '#F87171';
  const points =
    tile.series && tile.series.length > 1 ? sparkPoints(tile.series) : '';

  return (
    <Link href={`/token/${encodeURIComponent(tile.slug)}`} className={styles.tile}>
      <span className={styles.tileName}>
        <i className={`${styles.dot} ${isUp ? styles.dotUp : styles.dotDown}`} />
        <span>{tile.name}</span>
      </span>

      <span className={styles.tileSpark}>
        {points ? (
          <svg
            className={styles.spark}
            viewBox="0 0 76 26"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polyline
              points={points}
              fill="none"
              stroke={color}
              strokeWidth="1.6"
              strokeLinejoin="miter"
              strokeLinecap="butt"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ) : null}
      </span>

      <span className={styles.tileFoot}>
        <span className={styles.tilePrice}>{tile.price}</span>
        <span className={isUp ? styles.tileChangeUp : styles.tileChangeDown}>
          {formatChange(tile.changePct, tile.direction)}
        </span>
      </span>
    </Link>
  );
};

const TileSkeleton: React.FC = () => (
  <div className={styles.tile} aria-hidden="true">
    <span className={styles.tileName}>
      <span className={styles.skelBar} style={{ width: 84 }} />
    </span>
    <span className={styles.tileSpark}>
      <span className={styles.skelBar} style={{ width: '100%', height: 12 }} />
    </span>
    <span className={styles.tileFoot}>
      <span className={styles.skelBar} style={{ width: 52 }} />
      <span className={styles.skelBar} style={{ width: 32 }} />
    </span>
  </div>
);

export default MarketWallHero;
