'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { CountdownTickerProps, TimeRemaining, CountdownItemProps } from './types';
import styles from './CountdownTicker.module.css';
import Silk from './Silk';

// Individual countdown item component
const CountdownItem: React.FC<CountdownItemProps> = ({ value, label, className }) => {
  return (
    <div className={`${styles.countdownItem} ${className || ''}`}>
      <div className={styles.countdownNumber}>
        {value < 0 ? 0 : value}
      </div>
      <div className={styles.countdownLabel}>
        {label}
      </div>
    </div>
  );
};

// Main countdown ticker component
const CountdownTicker: React.FC<CountdownTickerProps> = ({
  targetDate,
  title,
  subtitle,
  onComplete,
  className,
  showBanner = true
}) => {
  const [timeRemaining, setTimeRemaining] = useState<TimeRemaining>({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0
  });
  const [isCompleted, setIsCompleted] = useState(false);

  const calculateTimeRemaining = useCallback((): TimeRemaining => {
    const target = new Date(targetDate);
    const now = new Date();
    const difference = target.getTime() - now.getTime();

    if (difference <= 0) {
      return { days: 0, hours: 0, minutes: 0, seconds: 0 };
    }

    const days = Math.floor(difference / (1000 * 60 * 60 * 24));
    const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((difference % (1000 * 60)) / 1000);

    return { days, hours, minutes, seconds };
  }, [targetDate]);

  useEffect(() => {
    const updateTimer = () => {
      const newTimeRemaining = calculateTimeRemaining();
      setTimeRemaining(newTimeRemaining);

      // Check if countdown is complete
      if (newTimeRemaining.days === 0 && 
          newTimeRemaining.hours === 0 && 
          newTimeRemaining.minutes === 0 && 
          newTimeRemaining.seconds === 0) {
        if (!isCompleted) {
          setIsCompleted(true);
          onComplete?.();
        }
      }
    };

    // Update immediately
    updateTimer();

    // Set up interval to update every second
    const interval = setInterval(updateTimer, 1000);

    // Cleanup interval on unmount
    return () => clearInterval(interval);
  }, [calculateTimeRemaining, isCompleted, onComplete]);

  const containerClass = showBanner 
    ? `${styles.banner} ${isCompleted ? styles.completed : ''} ${className || ''}`
    : `${styles.standalone} ${className || ''}`;

  if (isCompleted) {
    return (
      <div className={containerClass}>
        <div className={styles.silkBackground}>
          <Silk 
            speed={2} 
            scale={0.8} 
            color="#3a3a3a" 
            noiseIntensity={1.0} 
            rotation={0.1} 
          />
        </div>
        <div className={styles.contentLayer}>
          <div className={styles.completedMessage}>
            {title ? `${title} has ended!` : 'Countdown Complete!'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={containerClass}>
      <div className={styles.silkBackground}>
        <Silk 
          speed={3} 
          scale={.8} 
          color="#3a3a3a" 
          noiseIntensity={1.2} 
          rotation={0.2} 
        />
      </div>
      <div className={styles.contentLayer}>
        {showBanner && (title || subtitle) && (
          <div className={styles.content}>
            {title && <h1 className={styles.title}>{title}</h1>}
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
        )}
        
        <div className={styles.countdown}>
          <CountdownItem 
            value={timeRemaining.days} 
            label="Days" 
          />
          <CountdownItem 
            value={timeRemaining.hours} 
            label="Hours" 
          />
          <CountdownItem 
            value={timeRemaining.minutes} 
            label="Minutes" 
          />
          <CountdownItem 
            value={timeRemaining.seconds} 
            label="Seconds" 
          />
        </div>
      </div>
    </div>
  );
};

export default CountdownTicker; 