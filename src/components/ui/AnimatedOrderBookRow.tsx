import React, { useState, useEffect, useRef } from 'react';
import { AnimatedQuantity } from './AnimatedQuantity';
import { useOrderQuantityTracking } from '@/hooks/useOrderBookAnimations';

interface AnimatedOrderBookRowProps {
  /** Order data */
  order: {
    order_id: string;
    side: 'BUY' | 'SELL';
    price: number;
    quantity: number;
    filled_quantity?: number;
  };
  /** Whether this is a new order */
  isNewOrder?: boolean;
  /** Animation delay for staggered effects */
  animationDelay?: number;
  /** Maximum quantity for depth bar calculation */
  maxQuantity: number;
  /** Whether to show depth bar */
  showDepthBar?: boolean;
  /** Custom quantity formatter */
  formatQuantity?: (qty: number) => string;
  /** Custom price formatter */
  formatPrice?: (price: number) => string;
  /** Additional className */
  className?: string;
  /** Click handler */
  onClick?: () => void;
}

/**
 * Enhanced order book row with sophisticated animations for quantity increases
 * Includes depth visualization, scroll animations, and new order effects
 */
export function AnimatedOrderBookRow({
  order,
  isNewOrder = false,
  animationDelay = 0,
  maxQuantity,
  showDepthBar = true,
  formatQuantity,
  formatPrice,
  className = '',
  onClick
}: AnimatedOrderBookRowProps) {
  const [isVisible, setIsVisible] = useState(!isNewOrder);
  const [hasAnimated, setHasAnimated] = useState(!isNewOrder);
  const rowRef = useRef<HTMLDivElement>(null);

  const remainingQuantity = order.quantity - (order.filled_quantity || 0);
  const fillPercentage = maxQuantity > 0 ? (remainingQuantity / maxQuantity) * 100 : 0;

  // Track quantity changes for animation
  const { isAnimating, increaseAmount, hasIncreased } = useOrderQuantityTracking(
    order.order_id,
    remainingQuantity,
    order.side
  );

  // Handle new order animation
  useEffect(() => {
    if (isNewOrder && !hasAnimated) {
      const timer = setTimeout(() => {
        setIsVisible(true);
        setHasAnimated(true);
      }, animationDelay);

      return () => clearTimeout(timer);
    }
  }, [isNewOrder, hasAnimated, animationDelay]);

  // Apply quantity increase scroll effect
  useEffect(() => {
    if (isAnimating && rowRef.current) {
      // Add highlight effect to the entire row
      rowRef.current.style.transform = 'translateX(2px)';
      rowRef.current.style.transition = 'all 0.3s ease-out';
      
      // Reset after animation
      const resetTimer = setTimeout(() => {
        if (rowRef.current) {
          rowRef.current.style.transform = 'translateX(0)';
        }
      }, 300);

      return () => clearTimeout(resetTimer);
    }
  }, [isAnimating]);

  // Color scheme based on side
  const sideColor = order.side === 'SELL' ? '#FF4747' : '#00D084';
  const sideColorLight = order.side === 'SELL' ? '#FF474710' : '#00D08410';
  
  // Default formatters
  const defaultQuantityFormatter = (qty: number): string => {
    if (qty >= 1000000) return `${(qty / 1000000).toFixed(1)}M`;
    if (qty >= 1000) return `${(qty / 1000).toFixed(1)}K`;
    return qty.toFixed(0);
  };

  const defaultPriceFormatter = (price: number): string => {
    return `$${price.toFixed(2)}`;
  };

  const qtyFormatter = formatQuantity || defaultQuantityFormatter;
  const priceFormatter = formatPrice || defaultPriceFormatter;

  return (
    <div
      ref={rowRef}
      className={`
        relative overflow-hidden cursor-pointer transition-all duration-300
        hover:bg-[#1a1a1a] group
        ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}
        ${isAnimating ? 'bg-opacity-20' : ''}
        ${className}
      `}
      style={{
        backgroundColor: isAnimating ? sideColorLight : 'transparent',
        borderLeft: isAnimating ? `2px solid ${sideColor}` : '2px solid transparent',
        transition: isNewOrder ? 'all 0.5s ease-out' : 'all 0.3s ease-out'
      }}
      onClick={onClick}
    >
      {/* Depth bar background */}
      {showDepthBar && (
        <div
          className="absolute inset-y-0 right-0 transition-all duration-300"
          style={{
            width: `${fillPercentage}%`,
            backgroundColor: sideColorLight,
            opacity: 0.3
          }}
        />
      )}

      {/* Row content */}
      <div className="relative z-10 flex items-center justify-between py-1 px-3 text-sm">
        {/* Price */}
        <div 
          className="font-mono font-medium min-w-0 flex-1"
          style={{ color: sideColor }}
        >
          {priceFormatter(order.price)}
        </div>

        {/* Animated Quantity */}
        <div className="text-right text-gray-300 font-mono flex items-center justify-end min-w-0 flex-1">
          <AnimatedQuantity
            quantity={remainingQuantity}
            side={order.side}
            formatQuantity={qtyFormatter}
            showIncreaseIndicator={!isNewOrder}
          />
        </div>

        {/* Additional info on hover */}
        <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-xs text-gray-500 ml-2">
          ID: {order.order_id.slice(0, 6)}...
        </div>
      </div>

      {/* Quantity increase indicator */}
      {hasIncreased && !isNewOrder && (
        <div 
          className="absolute top-0 left-0 w-full h-full pointer-events-none"
          style={{
            background: `linear-gradient(90deg, ${sideColor}20 0%, transparent 100%)`,
            animation: 'flash-increase 0.8s ease-out'
          }}
        />
      )}

      {/* New order glow effect */}
      {isNewOrder && isVisible && (
        <div 
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `linear-gradient(90deg, ${sideColor}30 0%, transparent 100%)`,
            animation: 'flash-new-order 1s ease-out'
          }}
        />
      )}

      <style jsx>{`
        @keyframes flash-increase {
          0% { opacity: 0; }
          30% { opacity: 1; }
          100% { opacity: 0; }
        }
        
        @keyframes flash-new-order {
          0% { opacity: 0; transform: translateX(-10px); }
          50% { opacity: 1; transform: translateX(0); }
          100% { opacity: 0; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}

/**
 * Container for multiple animated order book rows with staggered animations
 */
interface AnimatedOrderBookListProps {
  /** Array of orders */
  orders: Array<{
    order_id: string;
    side: 'BUY' | 'SELL';
    price: number;
    quantity: number;
    filled_quantity?: number;
  }>;
  /** Maximum number of orders to display */
  maxDisplayed?: number;
  /** Whether to show depth bars */
  showDepthBars?: boolean;
  /** Custom formatters */
  formatQuantity?: (qty: number) => string;
  formatPrice?: (price: number) => string;
  /** Click handler for individual orders */
  onOrderClick?: (order: any) => void;
  /** Additional className */
  className?: string;
}

export function AnimatedOrderBookList({
  orders,
  maxDisplayed = 10,
  showDepthBars = true,
  formatQuantity,
  formatPrice,
  onOrderClick,
  className = ''
}: AnimatedOrderBookListProps) {
  const displayedOrders = orders.slice(0, maxDisplayed);
  const maxQuantity = Math.max(...displayedOrders.map(o => o.quantity - (o.filled_quantity || 0)));

  return (
    <div className={`space-y-0 ${className}`}>
      {displayedOrders.map((order, index) => (
        <AnimatedOrderBookRow
          key={order.order_id}
          order={order}
          animationDelay={index * 50}
          maxQuantity={maxQuantity}
          showDepthBar={showDepthBars}
          formatQuantity={formatQuantity}
          formatPrice={formatPrice}
          onClick={() => onOrderClick?.(order)}
        />
      ))}
    </div>
  );
}

export default AnimatedOrderBookRow;


