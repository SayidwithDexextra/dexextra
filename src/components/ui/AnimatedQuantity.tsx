import React, { useState, useEffect, useRef } from 'react';

interface AnimatedQuantityProps {
  /** Current quantity value */
  quantity: number;
  /** Previous quantity value for comparison */
  previousQuantity?: number;
  /** Order side for color styling */
  side: 'BUY' | 'SELL';
  /** Custom formatting function */
  formatQuantity?: (qty: number) => string;
  /** Animation duration in milliseconds */
  animationDuration?: number;
  /** Whether to show the increase indicator */
  showIncreaseIndicator?: boolean;
  /** Custom className */
  className?: string;
  /** Speed of counting animation (ms per increment) */
  countingSpeed?: number;
}

/**
 * Animated quantity component that shows scroll animations when quantity increases
 * Follows design system with sophisticated visual feedback
 */
export function AnimatedQuantity({
  quantity,
  previousQuantity,
  side,
  formatQuantity,
  animationDuration = 800,
  showIncreaseIndicator = true,
  className = '',
  countingSpeed = 60
}: AnimatedQuantityProps) {
  const [displayedQuantity, setDisplayedQuantity] = useState(quantity);
  const [isAnimating, setIsAnimating] = useState(false);
  const [showIncrease, setShowIncrease] = useState(false);
  const [increaseAmount, setIncreaseAmount] = useState(0);
  const animationRef = useRef<NodeJS.Timeout>();
  const currentQuantityRef = useRef<HTMLDivElement>(null);

  // Default quantity formatter
  const defaultFormatter = (qty: number): string => {
    if (qty >= 1000000) return `${(qty / 1000000).toFixed(1)}M`;
    if (qty >= 1000) return `${(qty / 1000).toFixed(1)}K`;
    return qty.toFixed(0);
  };

  const formatter = formatQuantity || defaultFormatter;

  // Counting animation effect - count up number by number
  useEffect(() => {
    // Clear any existing animation
    if (animationRef.current) {
      clearInterval(animationRef.current);
    }

    // Only animate if quantity increased and we have a previous value
    if (previousQuantity !== undefined && quantity > previousQuantity) {
      const increase = quantity - previousQuantity;
      setIncreaseAmount(increase);
      setIsAnimating(true);
      setShowIncrease(true);

      let currentCount = previousQuantity;
      const targetCount = quantity;
      
      // Start counting animation
      animationRef.current = setInterval(() => {
        currentCount += 1;
        setDisplayedQuantity(currentCount);
        
        // Add scroll effect to each number change
        if (currentQuantityRef.current) {
          currentQuantityRef.current.style.transform = 'translateY(-2px)';
          setTimeout(() => {
            if (currentQuantityRef.current) {
              currentQuantityRef.current.style.transform = 'translateY(0)';
            }
          }, 30);
        }
        
        // Stop when we reach the target
        if (currentCount >= targetCount) {
          clearInterval(animationRef.current!);
          setDisplayedQuantity(targetCount);
          
          // Hide increase indicator after counting is done
          setTimeout(() => {
            setShowIncrease(false);
            setIsAnimating(false);
          }, 500);
        }
      }, countingSpeed);

      // Cleanup timeout for safety
      const safetyCleanup = setTimeout(() => {
        if (animationRef.current) {
          clearInterval(animationRef.current);
        }
        setDisplayedQuantity(quantity);
        setShowIncrease(false);
        setIsAnimating(false);
      }, animationDuration);

      return () => {
        clearTimeout(safetyCleanup);
        if (animationRef.current) {
          clearInterval(animationRef.current);
        }
      };
    } else {
      // No animation needed, just update display
      setDisplayedQuantity(quantity);
    }
  }, [quantity, previousQuantity, countingSpeed, animationDuration]);

  const sideColor = side === 'SELL' ? '#FF4747' : '#00D084';
  const increaseColor = side === 'SELL' ? '#FF6B6B' : '#26F0A1';

  return (
    <div className={`relative inline-flex items-center ${className}`}>
      {/* Main quantity display with scroll animation */}
      <div
        ref={currentQuantityRef}
        className="transition-all duration-75 ease-out font-mono font-medium"
        style={{
          color: sideColor,
          transform: 'translateY(0)',
          opacity: 1
        }}
      >
        {formatter(displayedQuantity)}
      </div>

      {/* Increase amount indicator */}
      {showIncreaseIndicator && showIncrease && (
        <div
          className={`
            absolute -top-6 left-0 text-xs font-mono font-bold
            animate-pulse transform transition-all duration-500
            ${isAnimating ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'}
          `}
          style={{ color: increaseColor }}
        >
          +{formatter(increaseAmount)}
        </div>
      )}

      {/* Glow effect on increase */}
      {isAnimating && (
        <div
          className="absolute inset-0 rounded-sm animate-pulse"
          style={{
            boxShadow: `0 0 10px ${sideColor}40`,
            animation: `pulse-glow-${side.toLowerCase()} ${animationDuration}ms ease-out`
          }}
        />
      )}

      <style jsx>{`
        @keyframes pulse-glow-buy {
          0% { box-shadow: 0 0 5px #00D08440; }
          50% { box-shadow: 0 0 15px #00D08480; }
          100% { box-shadow: 0 0 5px #00D08420; }
        }
        
        @keyframes pulse-glow-sell {
          0% { box-shadow: 0 0 5px #FF474740; }
          50% { box-shadow: 0 0 15px #FF474780; }
          100% { box-shadow: 0 0 5px #FF474720; }
        }
      `}</style>
    </div>
  );
}

/**
 * Hook to track quantity changes for animations
 */
export function useQuantityAnimation(currentQuantity: number) {
  const [previousQuantity, setPreviousQuantity] = useState<number | undefined>(undefined);
  const [hasIncreased, setHasIncreased] = useState(false);

  useEffect(() => {
    if (previousQuantity !== undefined && currentQuantity > previousQuantity) {
      setHasIncreased(true);
      const resetTimer = setTimeout(() => setHasIncreased(false), 1000);
      return () => clearTimeout(resetTimer);
    }
    setPreviousQuantity(currentQuantity);
  }, [currentQuantity, previousQuantity]);

  return {
    previousQuantity,
    hasIncreased
  };
}

/**
 * Enhanced animated quantity specifically for order book rows
 */
interface OrderBookQuantityProps extends Omit<AnimatedQuantityProps, 'previousQuantity'> {
  /** Order ID for tracking */
  orderId: string;
  /** Whether this row is new */
  isNewOrder?: boolean;
  /** Speed of counting animation (ms per increment) */
  countingSpeed?: number;
}

export function OrderBookAnimatedQuantity({
  orderId,
  quantity,
  side,
  isNewOrder = false,
  countingSpeed = 50, // Faster default for order book
  ...props
}: OrderBookQuantityProps) {
  const { previousQuantity, hasIncreased } = useQuantityAnimation(quantity);
  
  return (
    <AnimatedQuantity
      quantity={quantity}
      previousQuantity={previousQuantity}
      side={side}
      showIncreaseIndicator={!isNewOrder} // Don't show increase for new orders
      countingSpeed={countingSpeed}
      {...props}
    />
  );
}

export default AnimatedQuantity;
