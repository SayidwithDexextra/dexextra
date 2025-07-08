"use client";

import React, { useState, useEffect, useRef } from 'react';
import { TopPerformerCarouselProps } from './types';
import TopPerformerCard from './TopPerformerCard';
import styles from './TopPerformer.module.css';

const TopPerformerCarousel: React.FC<TopPerformerCarouselProps> = ({
  performers,
  autoPlay = true,
  autoPlayInterval = 3000,
  showArrows = true,
  showDots = false,
  slidesToShow = 4,
  slidesToScroll = 1,
  infinite = true,
  speed = 500,
  className = ''
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const totalSlides = performers.length;
  const maxIndex = infinite ? totalSlides : totalSlides - slidesToShow;

  // Auto-play functionality
  useEffect(() => {
    if (autoPlay && !isHovered && totalSlides > slidesToShow) {
      intervalRef.current = setInterval(() => {
        setCurrentIndex((prevIndex) => {
          if (infinite) {
            return (prevIndex + slidesToScroll) % totalSlides;
          } else {
            return prevIndex + slidesToScroll >= maxIndex ? 0 : prevIndex + slidesToScroll;
          }
        });
      }, autoPlayInterval);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [autoPlay, isHovered, autoPlayInterval, slidesToScroll, totalSlides, slidesToShow, infinite, maxIndex]);

  const goToSlide = (index: number) => {
    setCurrentIndex(index);
  };

  const goToPrevious = () => {
    setCurrentIndex((prevIndex) => {
      if (infinite) {
        return prevIndex === 0 ? totalSlides - slidesToScroll : prevIndex - slidesToScroll;
      } else {
        return Math.max(0, prevIndex - slidesToScroll);
      }
    });
  };

  const goToNext = () => {
    setCurrentIndex((prevIndex) => {
      if (infinite) {
        return (prevIndex + slidesToScroll) % totalSlides;
      } else {
        return Math.min(maxIndex, prevIndex + slidesToScroll);
      }
    });
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowLeft') {
      goToPrevious();
    } else if (event.key === 'ArrowRight') {
      goToNext();
    }
  };

  // Create duplicated performers for infinite scroll
  const displayPerformers = infinite 
    ? [...performers, ...performers, ...performers]
    : performers;

  // Calculate transform based on current index
  const getTransform = () => {
    if (infinite) {
      // For infinite scroll, we start from the middle set
      const offset = totalSlides;
      const translateX = -((currentIndex + offset) * (360 + 20)); // card width + margin
      return `translateX(${translateX}px)`;
    } else {
      const translateX = -(currentIndex * (360 + 20));
      return `translateX(${translateX}px)`;
    }
  };

  // Reset position for infinite scroll
  useEffect(() => {
    if (infinite && trackRef.current) {
      if (currentIndex >= totalSlides) {
        setTimeout(() => {
          trackRef.current!.style.transition = 'none';
          setCurrentIndex(currentIndex % totalSlides);
          setTimeout(() => {
            trackRef.current!.style.transition = `transform ${speed}ms ease-in-out`;
          }, 10);
        }, speed);
      } else if (currentIndex < 0) {
        setTimeout(() => {
          trackRef.current!.style.transition = 'none';
          setCurrentIndex(totalSlides + currentIndex);
          setTimeout(() => {
            trackRef.current!.style.transition = `transform ${speed}ms ease-in-out`;
          }, 10);
        }, speed);
      }
    }
  }, [currentIndex, infinite, totalSlides, speed]);

  if (performers.length === 0) {
    return null;
  }

  return (
    <div 
      className={`${styles.carouselContainer} ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="region"
      aria-label="Top performers carousel"
    >
      <div className={styles.carouselWrapper}>
        <div 
          ref={trackRef}
          className={styles.carouselTrack}
          style={{
            transform: getTransform(),
            transition: `transform ${speed}ms ease-in-out`
          }}
        >
          {displayPerformers.map((performer, index) => (
            <TopPerformerCard 
              key={`${performer.id}-${index}`} 
              performer={performer} 
            />
          ))}
        </div>
      </div>

      {showArrows && totalSlides > slidesToShow && (
        <>
          <button 
            className={`${styles.arrow} ${styles.arrowLeft}`}
            onClick={goToPrevious}
            aria-label="Previous slide"
          >
            <svg 
              className={styles.arrowIcon}
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2"
            >
              <path d="M15 18L9 12L15 6" />
            </svg>
          </button>
          
          <button 
            className={`${styles.arrow} ${styles.arrowRight}`}
            onClick={goToNext}
            aria-label="Next slide"
          >
            <svg 
              className={styles.arrowIcon}
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2"
            >
              <path d="M9 18L15 12L9 6" />
            </svg>
          </button>
        </>
      )}

      {showDots && totalSlides > slidesToShow && (
        <div className={styles.dotsContainer}>
          {Array.from({ length: Math.ceil(totalSlides / slidesToScroll) }).map((_, index) => (
            <button
              key={index}
              className={`${styles.dot} ${
                Math.floor(currentIndex / slidesToScroll) === index ? styles.active : ''
              }`}
              onClick={() => goToSlide(index * slidesToScroll)}
              aria-label={`Go to slide ${index + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default TopPerformerCarousel; 