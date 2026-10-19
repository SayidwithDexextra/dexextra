'use client';

import Link from 'next/link';
import styles from './MarketWallHero.module.css';
import cardStyles from './HeroMarketCard.module.css';
import HeroMarketCard from './HeroMarketCard';
import type { MarketWallHeroProps } from './types';

const DEFAULTS = {
  eyebrow: 'Dexetera / Market Wall',
  title: 'Create, and Trade, Community Made Futures Tokens',
  subtitle: 'Every tile is a market someone here wrote. Take a side, or write your own.',
};

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

        <div className={cardStyles.grid} aria-busy={isLoading || undefined}>
          {isLoading ? (
            Array.from({ length: tileCount }, (_, i) => <TileSkeleton key={i} />)
          ) : shown.length === 0 ? (
            <div className={styles.empty}>
              <i className={`${styles.dot} ${styles.dotIdle}`} />
              No active markets
            </div>
          ) : (
            shown.map((tile) => (
              <HeroMarketCard
                key={tile.id}
                href={`/token/${encodeURIComponent(tile.slug)}`}
                name={tile.name}
                symbol={tile.symbol}
                category={tile.category}
                price={tile.price}
                changePct={tile.changePct}
                series={tile.series ?? []}
                settlementDate={tile.settlementDate}
                live
              />
            ))
          )}
        </div>
      </div>
    </section>
  );
};

const TileSkeleton: React.FC = () => (
  <div className={styles.skelCard} aria-hidden="true">
    <span className={styles.skelBar} style={{ width: 72 }} />
    <span className={styles.skelBar} style={{ width: '70%', height: 12 }} />
    <span className={styles.skelBar} style={{ width: 88, height: 14 }} />
  </div>
);

export default MarketWallHero;
