'use client';

import Image from 'next/image';
import Link from 'next/link';
import styles from './Hero.module.css';
import { HeroProps } from './types';

const Hero: React.FC<HeroProps> = ({
  data,
  className = '',
}) => {
  return (
    <section className={`${styles.hero} ${className}`}>
      {/* Background */}
      <div className={styles.bgLayer} aria-hidden="true">
        <div className={styles.bgImage}>
          <Image
            src="/beams.png"
            alt=""
            fill
            priority
            sizes="(max-width: 768px) 100vw, 1400px"
            style={{ objectFit: 'cover' }}
          />
        </div>
        <div className={styles.bgOverlay} />
        <div className={styles.bgGrain} />
        <div className={styles.bgGlow} />
        <div className={styles.bgGlowSecondary} />
      </div>

      {/* Content */}
      <div className={styles.content}>
        <Image
          src="/Dexicon/LOGO-Dexetera-01.svg"
          alt="Dexetera"
          width={200}
          height={68}
          className={styles.logo}
          priority
        />

        <h1 className={styles.title}>{data.title}</h1>

        <div className={styles.divider} />

        <p className={styles.subtitle}>
          Create, and Trade, Community Made Futures Tokens
        </p>

        <div className={styles.ctaRow}>
          <Link href="/explore" className={styles.ctaPrimary}>
            Explore Markets
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </Link>
          <Link href="/new-market" className={styles.ctaSecondary}>
            Create Market
          </Link>
        </div>
      </div>

      {/* Bottom edge strip */}
      <div className={styles.edgeStrip}>
        <div className={styles.edgeItem}>
          <span className={styles.edgeDotGreen} />
          Live
        </div>
        <div className={styles.edgeItem}>
          <span className={styles.edgeDot} />
          On-Chain Settlement
        </div>
        <div className={styles.edgeItem}>
          <span className={styles.edgeDot} />
          Community Created
        </div>
      </div>
    </section>
  );
};

export default Hero;
