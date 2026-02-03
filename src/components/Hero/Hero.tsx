'use client';

import Image from 'next/image';
import styles from './Hero.module.css';
import { HeroProps } from './types';

const Hero: React.FC<HeroProps> = ({ 
  data, 
  className = '',
}) => {
  return (
    <section className={`${styles.hero} ${className}`}>
      {/* Background image only */}
      <div
        className={styles.heroBackground}
        aria-hidden="true"
      >
        <Image
          src="/beams.png"
          alt=""
          fill
          priority
          sizes="(max-width: 768px) 100vw, 1200px"
          style={{ objectFit: 'cover' }}
        />
      </div>
      
      {/* Content overlay */}
      <div className={styles.heroOverlay}>
        <div className={styles.heroOverlayInner}>
          <Image
            src="/Dexicon/LOGO-Dexetera-01.svg"
            alt="Dexetra Logo"
            width={200}
            height={72}
            className={styles.heroLogo}
            priority
          />
          <h1 className={styles.heroTitle}>{data.title}</h1>
          <p className={styles.heroSubtitle}>
            Create, and Trade, Community Made Futures Tokens
          </p>
        </div>
      </div>
    </section>
  );
};

export default Hero;
