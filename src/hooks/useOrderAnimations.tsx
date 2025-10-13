'use client';

import { useRef, useEffect, useState } from 'react';

interface OrderAnimationState {
  orderId: string;
  isNew: boolean;
  animationDelay: number;
  timestamp: number;
}

interface UseOrderAnimationsOptions {
  staggerDelay?: number;
  newOrderWindow?: number;
}

/**
 * Hook to manage sophisticated order animations
 * Tracks new orders and provides animation states
 */
export function useOrderAnimations<T extends { order_id: string | number; created_at: string }>(
  orders: T[],
  options: UseOrderAnimationsOptions = {}
) {
  const { staggerDelay = 50, newOrderWindow = 5000 } = options;
  
  const [animationStates, setAnimationStates] = useState<Map<string, OrderAnimationState>>(new Map());
  const previousOrdersRef = useRef<Set<string>>(new Set());
  const animationCounterRef = useRef(0);

  useEffect(() => {
    const currentOrderIds = new Set(orders.map(order => order.order_id.toString()));
    const previousOrderIds = previousOrdersRef.current;
    
    // Find new orders
    const newOrderIds = Array.from(currentOrderIds).filter(id => !previousOrderIds.has(id));
    
    if (newOrderIds.length > 0) {
      console.log('🎬 [ORDER_ANIMATIONS] New orders detected:', newOrderIds.length);
      
      setAnimationStates(prevStates => {
        const newStates = new Map(prevStates);
        
        newOrderIds.forEach((orderId, index) => {
          const order = orders.find(o => o.order_id.toString() === orderId);
          if (order) {
            // Check if order is actually new (within the time window)
            const orderTime = new Date(order.created_at).getTime();
            const now = Date.now();
            const isActuallyNew = (now - orderTime) < newOrderWindow;
            
            if (isActuallyNew) {
              newStates.set(orderId, {
                orderId,
                isNew: true,
                animationDelay: index * staggerDelay,
                timestamp: now
              });
              
              console.log(`✨ [ORDER_ANIMATIONS] Marking order ${orderId} as new with ${index * staggerDelay}ms delay`);
            }
          }
        });
        
        return newStates;
      });
    }
    
    // Update the previous orders reference
    previousOrdersRef.current = currentOrderIds;
  }, [orders, staggerDelay, newOrderWindow]);

  // Clean up old animation states
  useEffect(() => {
    const cleanup = () => {
      const now = Date.now();
      const cleanupThreshold = 10000; // 10 seconds
      
      setAnimationStates(prevStates => {
        const newStates = new Map();
        
        for (const [orderId, state] of prevStates) {
          if (now - state.timestamp < cleanupThreshold) {
            // Mark as no longer new after first render cycle
            newStates.set(orderId, {
              ...state,
              isNew: state.isNew && (now - state.timestamp < 1000) // Only new for 1 second
            });
          }
        }
        
        return newStates;
      });
    };

    const interval = setInterval(cleanup, 1000);
    return () => clearInterval(interval);
  }, []);

  // Helper function to get animation state for an order
  const getAnimationState = (orderId: string | number): OrderAnimationState | null => {
    return animationStates.get(orderId.toString()) || null;
  };

  // Helper function to check if an order is new
  const isOrderNew = (orderId: string | number): boolean => {
    const state = getAnimationState(orderId);
    return state?.isNew || false;
  };

  // Helper function to get animation delay for an order
  const getAnimationDelay = (orderId: string | number): number => {
    const state = getAnimationState(orderId);
    return state?.animationDelay || 0;
  };

  return {
    isOrderNew,
    getAnimationDelay,
    getAnimationState,
    animationStates
  };
}

