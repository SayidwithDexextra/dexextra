import { useState, useEffect, useRef, useCallback } from 'react';

export interface OrderBookEntry {
  order_id: string;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  filled_quantity?: number;
}

export interface AnimationState {
  orderId: string;
  isQuantityIncreasing: boolean;
  previousQuantity?: number;
  isNewOrder: boolean;
  animationStartTime?: number;
}

/**
 * Hook to manage order book animations including quantity increases and new order insertions
 */
export function useOrderBookAnimations(
  orders: OrderBookEntry[],
  animationDuration: number = 1000
) {
  const [animationStates, setAnimationStates] = useState<Map<string, AnimationState>>(new Map());
  const previousOrdersRef = useRef<Map<string, OrderBookEntry>>(new Map());
  const newOrderWindow = useRef<number>(5000); // Consider orders "new" for 5 seconds

  // Track order changes and detect animations needed
  const updateAnimationStates = useCallback(() => {
    const currentTime = Date.now();
    const newStates = new Map<string, AnimationState>();
    const previousOrders = previousOrdersRef.current;

    orders.forEach(order => {
      const orderId = order.order_id;
      const previousOrder = previousOrders.get(orderId);
      const currentQuantity = order.quantity - (order.filled_quantity || 0);
      
      // Determine if this is a new order (not in previous state)
      const isNewOrder = !previousOrder;
      
      // Determine if quantity increased
      const previousQuantity = previousOrder ? previousOrder.quantity - (previousOrder.filled_quantity || 0) : undefined;
      const isQuantityIncreasing = previousQuantity !== undefined && currentQuantity > previousQuantity;

      // Create animation state
      const animationState: AnimationState = {
        orderId,
        isQuantityIncreasing,
        previousQuantity,
        isNewOrder,
        animationStartTime: isQuantityIncreasing ? currentTime : undefined
      };

      newStates.set(orderId, animationState);
    });

    setAnimationStates(newStates);

    // Update previous orders reference
    const newPreviousOrders = new Map<string, OrderBookEntry>();
    orders.forEach(order => {
      newPreviousOrders.set(order.order_id, { ...order });
    });
    previousOrdersRef.current = newPreviousOrders;
  }, [orders]);

  // Update animation states when orders change
  useEffect(() => {
    updateAnimationStates();
  }, [updateAnimationStates]);

  // Clean up expired animation states
  useEffect(() => {
    const cleanup = () => {
      const currentTime = Date.now();
      setAnimationStates(prevStates => {
        const newStates = new Map(prevStates);
        
        for (const [orderId, state] of newStates) {
          // Remove animation state if animation duration has passed
          if (state.animationStartTime && 
              currentTime - state.animationStartTime > animationDuration) {
            const updatedState = { ...state };
            updatedState.isQuantityIncreasing = false;
            updatedState.animationStartTime = undefined;
            newStates.set(orderId, updatedState);
          }
        }
        
        return newStates;
      });
    };

    const interval = setInterval(cleanup, 100);
    return () => clearInterval(interval);
  }, [animationDuration]);

  // Get animation state for a specific order
  const getAnimationState = useCallback((orderId: string): AnimationState | undefined => {
    return animationStates.get(orderId);
  }, [animationStates]);

  // Check if an order should show quantity increase animation
  const shouldAnimateQuantityIncrease = useCallback((orderId: string): boolean => {
    const state = animationStates.get(orderId);
    return state?.isQuantityIncreasing || false;
  }, [animationStates]);

  // Check if an order is new and should show new order animation
  const isNewOrder = useCallback((orderId: string): boolean => {
    const state = animationStates.get(orderId);
    return state?.isNewOrder || false;
  }, [animationStates]);

  // Get animation delay for staggered animations
  const getAnimationDelay = useCallback((index: number): number => {
    return index * 50; // 50ms delay between each animation
  }, []);

  return {
    animationStates,
    getAnimationState,
    shouldAnimateQuantityIncrease,
    isNewOrder,
    getAnimationDelay,
    updateAnimationStates
  };
}

/**
 * Hook specifically for tracking quantity changes in a single order
 */
export function useOrderQuantityTracking(
  orderId: string,
  currentQuantity: number,
  side: 'BUY' | 'SELL'
) {
  const [previousQuantity, setPreviousQuantity] = useState<number | undefined>(undefined);
  const [isAnimating, setIsAnimating] = useState(false);
  const [increaseAmount, setIncreaseAmount] = useState(0);
  const animationTimeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    // Clear existing timeout
    if (animationTimeoutRef.current) {
      clearTimeout(animationTimeoutRef.current);
    }

    // Check for quantity increase
    if (previousQuantity !== undefined && currentQuantity > previousQuantity) {
      const increase = currentQuantity - previousQuantity;
      setIncreaseAmount(increase);
      setIsAnimating(true);

      // Stop animation after duration
      animationTimeoutRef.current = setTimeout(() => {
        setIsAnimating(false);
      }, 800);
    }

    // Update previous quantity
    setPreviousQuantity(currentQuantity);

    return () => {
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
      }
    };
  }, [currentQuantity, previousQuantity]);

  return {
    isAnimating,
    increaseAmount,
    previousQuantity,
    hasIncreased: previousQuantity !== undefined && currentQuantity > previousQuantity
  };
}

export default useOrderBookAnimations;


