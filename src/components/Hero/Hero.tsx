'use client';

import React, { useState, useEffect } from 'react';
import styles from './Hero.module.css';
import { HeroProps, CountdownTime } from './types';
import Hero3DBackground from './Hero3DBackground';
import Dither from './Dither';



const VerificationBadge: React.FC<{ isVerified: boolean }> = ({ isVerified }) => {
  if (!isVerified) return null;
  
  return (
    <div className={styles.verificationBadge}>
      <svg 
        className={styles.verificationIcon} 
        viewBox="0 0 24 24" 
        fill="currentColor"
      >
        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
      </svg>
    </div>
  );
};

const StatItem: React.FC<{ label: string; value: string | number }> = ({ label, value }) => (
  <div className={styles.statItem}>
    <p className={styles.statLabel}>{label}</p>
    <p className={styles.statValue}>{value}</p>
  </div>
);

const Countdown: React.FC<{ targetDate: string }> = ({ targetDate }) => {
  const [timeLeft, setTimeLeft] = useState<CountdownTime>({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0
  });

  useEffect(() => {
    let isMounted = true;
    
    const calculateTimeLeft = () => {
      if (!isMounted) return;
      
      const difference = new Date(targetDate).getTime() - new Date().getTime();
      
      if (difference > 0) {
        const days = Math.floor(difference / (1000 * 60 * 60 * 24));
        const hours = Math.floor((difference / (1000 * 60 * 60)) % 24);
        const minutes = Math.floor((difference / 1000 / 60) % 60);
        const seconds = Math.floor((difference / 1000) % 60);
        
        setTimeLeft({ days, hours, minutes, seconds });
      } else {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
      }
    };

    calculateTimeLeft();
    const timer = setInterval(calculateTimeLeft, 1000);

    return () => {
      isMounted = false;
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [targetDate]);

  const formatNumber = (num: number) => num.toString().padStart(2, '0');

  return (
    <div className={styles.countdown}>
      <span>{formatNumber(timeLeft.days)}</span>
      <span className={styles.countdownSeparator}>:</span>
      <span>{formatNumber(timeLeft.hours)}</span>
      <span className={styles.countdownSeparator}>:</span>
      <span>{formatNumber(timeLeft.minutes)}</span>
      <span className={styles.countdownSeparator}>:</span>
      <span>{formatNumber(timeLeft.seconds)}</span>
    </div>
  );
};

const Hero: React.FC<HeroProps> = ({ 
  data, 
  className = '',
  onMintClick 
}) => {
  const heroStyle = data.backgroundImage 
    ? { backgroundImage: `url(${data.backgroundImage})` }
    : {};

  return (
    <section 
      className={`${styles.hero} ${className}`}
      style={heroStyle}
    >
      {/* 3D Background - fills entire hero container */}
      <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 1 }}>
  <Dither
    waveColor={[0.7, 0.5, 0.5]}
    disableAnimation={false}
    enableMouseInteraction={true}
    mouseRadius={0.3}
    colorNum={4}
    waveAmplitude={0.3}
    waveFrequency={3}
    waveSpeed={0.02}
  />
</div>

      
      <div className={styles.container}>
        <h1 className={styles.title}>{data.title}</h1>
        <p className={styles.subHeading}>Create, and Trade, Community Made Futures Tokens</p>
   
      </div>
    </section>
  );
};

export default Hero; 