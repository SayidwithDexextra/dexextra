'use client';

import React, { useState } from 'react';

/**
 * Test component for verifying real-time order broadcasting
 * DELETE this component before production deployment
 */
export default function RealtimeTestComponent() {
  const [loading, setLoading] = useState(false);
  const [lastResponse, setLastResponse] = useState<any>(null);

  const testBroadcast = async (type: string = 'placed') => {
    setLoading(true);
    try {
      const response = await fetch(`/api/test/broadcast-order?type=${type}`, {
        method: 'GET'
      });
      const data = await response.json();
      setLastResponse(data);
      console.log('🧪 Test broadcast response:', data);
    } catch (error) {
      console.error('❌ Test broadcast failed:', error);
      setLastResponse({ error: error instanceof Error ? error.message : 'Unknown error' });
    } finally {
      setLoading(false);
    }
  };

  const testCustomOrder = async () => {
    setLoading(true);
    try {
      const customOrder = {
        metricId: 'SILVER_V2',
        side: Math.random() > 0.5 ? 'BUY' : 'SELL',
        quantity: Math.floor(Math.random() * 2000) + 100,
        price: 24.0 + Math.random() * 2, // Random price between 24-26
        orderType: Math.random() > 0.5 ? 'LIMIT' : 'MARKET',
        eventType: 'placed'
      };

      const response = await fetch('/api/test/broadcast-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(customOrder)
      });
      
      const data = await response.json();
      setLastResponse(data);
      console.log('🧪 Custom test broadcast response:', data);
    } catch (error) {
      console.error('❌ Custom test broadcast failed:', error);
      setLastResponse({ error: error instanceof Error ? error.message : 'Unknown error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 bg-gray-900 border border-gray-600 rounded-lg p-4 shadow-lg z-50 max-w-sm">
      <h3 className="text-white text-sm font-bold mb-3">🧪 Realtime Test Panel</h3>
      
      <div className="space-y-2 mb-3">
        <button
          onClick={() => testBroadcast('placed')}
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white text-xs py-2 px-3 rounded"
        >
          Test Order Placed
        </button>
        
        <button
          onClick={() => testBroadcast('executed')}
          disabled={loading}
          className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white text-xs py-2 px-3 rounded"
        >
          Test Order Executed
        </button>
        
        <button
          onClick={() => testBroadcast('cancelled')}
          disabled={loading}
          className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white text-xs py-2 px-3 rounded"
        >
          Test Order Cancelled
        </button>
        
        <button
          onClick={testCustomOrder}
          disabled={loading}
          className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white text-xs py-2 px-3 rounded"
        >
          Random Order
        </button>
      </div>

      {loading && (
        <div className="text-yellow-400 text-xs">Broadcasting...</div>
      )}

      {lastResponse && (
        <div className="mt-3 p-2 bg-gray-800 rounded text-xs text-gray-300 max-h-24 overflow-y-auto">
          <pre>{JSON.stringify(lastResponse, null, 2)}</pre>
        </div>
      )}

      <div className="mt-2 text-xs text-gray-500">
        Check browser console and recent transactions table for real-time updates
      </div>
    </div>
  );
}





