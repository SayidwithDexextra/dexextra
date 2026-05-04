'use client';

import React, { useEffect, useState } from 'react';

interface AnimatedOrderRowProps {
  children: React.ReactNode;
  orderId: string;
  side: 'BUY' | 'SELL';
  isNew?: boolean;
  animationDelay?: number;
  /** Animation style for newly inserted rows. */
  animationType?: 'slideFromRight' | 'slideFromTop';
  className?: string;
}

/**
 * Sophisticated sliding animation component for order book entries
 * Follows @SophisticatedMinimalDesignSystem.md standards
 */
export function AnimatedOrderRow({ 
  children, 
  orderId, 
  side, 
  isNew = false, 
  animationDelay = 0,
  animationType = 'slideFromRight',
  className = '' 
}: AnimatedOrderRowProps) {
  const [isVisible, setIsVisible] = useState(!isNew);
  const [hasAnimated, setHasAnimated] = useState(!isNew);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;

    const onChange = () => setPrefersReducedMotion(Boolean(mq.matches));
    onChange();
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    if (!isNew) return;
    if (!prefersReducedMotion) return;
    // Show immediately (no animation) when reduced motion is enabled.
    setIsVisible(true);
    setHasAnimated(true);
  }, [isNew, prefersReducedMotion]);

  useEffect(() => {
    if (isNew && !hasAnimated) {
      if (prefersReducedMotion) {
        setIsVisible(true);
        setHasAnimated(true);
        return;
      }
      // Small delay for staggered animations
      const timer = setTimeout(() => {
        setIsVisible(true);
        setHasAnimated(true);
      }, animationDelay);

      return () => clearTimeout(timer);
    }
  }, [isNew, hasAnimated, animationDelay, prefersReducedMotion]);

  // Simple slide from right animation for all orders
  const accentColor = side === 'SELL' ? '#FF4747' : '#00D084';
  const hiddenTransformClass = animationType === 'slideFromTop' ? 'translate-y-2' : 'translate-x-8';
  const visibleTransformClass = animationType === 'slideFromTop' ? 'translate-y-0' : 'translate-x-0';
  const enterAnimationClass =
    animationType === 'slideFromTop' ? 'slide-from-top' : 'slide-from-right';

  return (
    <div
      key={orderId}
      className={`
        relative overflow-hidden
        ${isNew && !hasAnimated ? 'transition-all duration-300 ease-out' : ''}
        ${isVisible ? `opacity-100 max-h-16 ${visibleTransformClass}` : `opacity-0 max-h-0 ${hiddenTransformClass}`}
        ${isNew && !hasAnimated ? enterAnimationClass : ''}
        ${className}
      `}
      style={{
        '--accent-color': accentColor,
        '--animation-delay': `${animationDelay}ms`
      } as React.CSSProperties}
    >
      {/* Enhanced flash highlight for new orders */}
      {isNew && (
        <div 
          className={`
            absolute inset-0 pointer-events-none z-10
            bg-gradient-to-r from-transparent via-white/25 to-transparent
            opacity-0 animate-enhanced-flash
          `}
          style={{ animationDelay: `${animationDelay + 100}ms` }}
        />
      )}

      {/* Content */}
      <div className="relative">
        {children}
      </div>

      {/* Clean slide animations */}
      <style jsx>{`
        .slide-from-right {
          animation: slideFromRight 200ms ease-out forwards;
        }

        .slide-from-top {
          animation: slideFromTop 200ms ease-out forwards;
        }

        @keyframes slideFromRight {
          0% {
            opacity: 0;
            transform: translateX(12px);
          }
          100% {
            opacity: 1;
            transform: translateX(0);
          }
        }

        @keyframes slideFromTop {
          0% {
            opacity: 0;
            transform: translateY(-8px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes enhanced-flash {
          0% { opacity: 0; }
          40% { opacity: 0.5; }
          100% { opacity: 0; }
        }

        .animate-enhanced-flash {
          animation: enhanced-flash 300ms ease-out forwards;
        }

        @media (prefers-reduced-motion: reduce) {
          .slide-from-right,
          .slide-from-top,
          .animate-enhanced-flash {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
