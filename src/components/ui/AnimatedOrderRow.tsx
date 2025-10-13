'use client';

import React, { useEffect, useState } from 'react';

interface AnimatedOrderRowProps {
  children: React.ReactNode;
  orderId: string;
  side: 'BUY' | 'SELL';
  isNew?: boolean;
  animationDelay?: number;
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
  className = '' 
}: AnimatedOrderRowProps) {
  const [isVisible, setIsVisible] = useState(!isNew);
  const [hasAnimated, setHasAnimated] = useState(!isNew);

  useEffect(() => {
    if (isNew && !hasAnimated) {
      // Small delay for staggered animations
      const timer = setTimeout(() => {
        setIsVisible(true);
        setHasAnimated(true);
      }, animationDelay);

      return () => clearTimeout(timer);
    }
  }, [isNew, hasAnimated, animationDelay]);

  // Simple slide from right animation for all orders
  const accentColor = side === 'SELL' ? '#FF4747' : '#00D084';

  return (
    <div
      key={orderId}
      className={`
        relative overflow-hidden
        transition-all duration-400 ease-out
        ${isVisible ? 'opacity-100 max-h-16 translate-x-0' : 'opacity-0 max-h-0 translate-x-8'}
        ${isNew && !hasAnimated ? 'slide-from-right' : ''}
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

      {/* Content with micro-interaction on hover */}
      <div className="group relative transform transition-all duration-200 hover:scale-[1.02]">
        {children}
        
        {/* Subtle border enhancement on hover - following design system */}
        <div className="absolute inset-0 rounded-md border border-transparent group-hover:border-[#333333]/50 transition-colors duration-200 pointer-events-none" />
      </div>

      {/* Clean slide from right animation */}
      <style jsx>{`
        .slide-from-right {
          animation: slideFromRight 400ms ease-out forwards;
        }

        @keyframes slideFromRight {
          0% {
            opacity: 0;
            transform: translateX(24px);
            max-height: 0;
          }
          50% {
            opacity: 0.6;
            max-height: 2rem;
          }
          100% {
            opacity: 1;
            transform: translateX(0);
            max-height: 4rem;
          }
        }

        @keyframes enhanced-flash {
          0% {
            opacity: 0;
            transform: translateX(-100%) scale(0.8);
          }
          50% {
            opacity: 0.8;
            transform: translateX(0%) scale(1.1);
          }
          100% {
            opacity: 0;
            transform: translateX(100%) scale(0.8);
          }
        }

        .animate-enhanced-flash {
          animation: enhanced-flash 600ms ease-out forwards;
        }

        /* Enhanced hover effects following design system */
        .group:hover {
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.02), transparent);
        }
      `}</style>
    </div>
  );
}
