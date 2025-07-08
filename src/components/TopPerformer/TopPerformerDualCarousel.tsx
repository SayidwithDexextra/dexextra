"use client";

import React, { useState, useRef } from 'react';
import { TopPerformerData } from './types';
import TopPerformerCard from './TopPerformerCard';
import styles from './TopPerformer.module.css';

interface TopPerformerDualCarouselProps {
  performers: TopPerformerData[];
  autoPlay?: boolean;
  autoPlayInterval?: number;
  speed?: number;
  className?: string;
  showArrows?: boolean;
}

const TopPerformerDualCarousel: React.FC<TopPerformerDualCarouselProps> = ({
  performers,
  autoPlay: _autoPlay = true,
  autoPlayInterval: _autoPlayInterval = 4000,
  speed: _speed = 1000,
  className = '',
  showArrows: _showArrows = false
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const topTrackRef = useRef<HTMLDivElement>(null);
  const bottomTrackRef = useRef<HTMLDivElement>(null);

  // Split performers into two arrays for the two carousels
  const topPerformers = performers.slice(0, Math.ceil(performers.length / 2));
  const bottomPerformers = performers.slice(Math.ceil(performers.length / 2));

  // Create duplicated performers for smooth infinite scroll
  const duplicatedTopPerformers = [...topPerformers, ...topPerformers, ...topPerformers];
  const duplicatedBottomPerformers = [...bottomPerformers, ...bottomPerformers, ...bottomPerformers];

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  if (performers.length === 0) {
    return null;
  }

  return (
    <div 
      className={`${styles.dualCarouselContainer} ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      role="region"
      aria-label="Top performers"
    >
      {/* Top Carousel - Moving Right */}
      <div className={styles.carouselWrapper}>
        <div 
          ref={topTrackRef}
          className={`${styles.carouselTrackRight} ${isHovered ? styles.carouselTrackPaused : ''}`}
        >
          {duplicatedTopPerformers.map((performer, index) => (
            <TopPerformerCard 
              key={`top-${performer.id}-${index}`} 
              performer={performer} 
            />
          ))}
        </div>
      </div>

      {/* Bottom Carousel - Moving Left */}
      <div className={styles.carouselWrapper}>
        <div 
          ref={bottomTrackRef}
          className={`${styles.carouselTrackLeft} ${isHovered ? styles.carouselTrackPaused : ''}`}
        >
          {duplicatedBottomPerformers.map((performer, index) => (
            <TopPerformerCard 
              key={`bottom-${performer.id}-${index}`} 
              performer={performer} 
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default TopPerformerDualCarousel; 