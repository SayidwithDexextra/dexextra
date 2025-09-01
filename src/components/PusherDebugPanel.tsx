'use client';

import React, { useState, useEffect } from 'react';
import { PusherClientService } from '@/lib/pusher-client';

/**
 * Debug panel for Pusher connection status and subscriptions
 * Useful for troubleshooting real-time connectivity issues
 */
export default function PusherDebugPanel() {
  const [pusherClient, setPusherClient] = useState<PusherClientService | null>(null);
  const [connectionState, setConnectionState] = useState<any>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    try {
      const client = new PusherClientService({ enableLogging: true });
      setPusherClient(client);

      // Monitor connection state
      const updateState = () => {
        setConnectionState(client.getConnectionState());
      };

      client.onConnectionStateChange(() => {
        updateState();
      });

      // Initial state
      updateState();

      // Update every few seconds
      const interval = setInterval(updateState, 3000);

      return () => {
        clearInterval(interval);
        client.disconnect();
      };
    } catch (error) {
      console.error('❌ Failed to initialize Pusher debug panel:', error);
    }
  }, []);

  if (!isVisible) {
    return (
      <button
        onClick={() => setIsVisible(true)}
        className="fixed bottom-20 right-4 bg-blue-600 hover:bg-blue-700 text-white text-xs py-2 px-3 rounded-full shadow-lg z-50"
      >
        📡 Pusher Debug
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 bg-gray-900 border border-gray-600 rounded-lg p-4 shadow-lg z-50 max-w-md">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-white text-sm font-bold">📡 Pusher Debug Panel</h3>
        <button
          onClick={() => setIsVisible(false)}
          className="text-gray-400 hover:text-white text-sm"
        >
          ✕
        </button>
      </div>

      {connectionState ? (
        <div className="space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-gray-400">Status:</span>
            <span className={`font-mono ${connectionState.isConnected ? 'text-green-400' : 'text-red-400'}`}>
              {connectionState.state}
            </span>
          </div>
          
          <div className="flex justify-between">
            <span className="text-gray-400">Socket ID:</span>
            <span className="font-mono text-gray-300">
              {connectionState.socketId || 'None'}
            </span>
          </div>
          
          <div className="flex justify-between">
            <span className="text-gray-400">Subscriptions:</span>
            <span className="font-mono text-gray-300">
              {connectionState.subscriptionCount}
            </span>
          </div>

          {connectionState.subscriptions.length > 0 && (
            <div className="mt-3 p-2 bg-gray-800 rounded">
              <div className="text-gray-400 mb-1">Active Channels:</div>
              {connectionState.subscriptions.map((channel: string, index: number) => (
                <div key={index} className="font-mono text-gray-300 text-xs">
                  {channel}
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 text-gray-500">
            Last updated: {new Date().toLocaleTimeString()}
          </div>
        </div>
      ) : (
        <div className="text-gray-400 text-xs">Initializing...</div>
      )}

      <div className="mt-3 space-y-1">
        <button
          onClick={() => {
            if (pusherClient) {
              console.log('🔄 Manual Pusher reconnect');
              pusherClient.reconnect();
            }
          }}
          className="w-full bg-green-600 hover:bg-green-700 text-white text-xs py-1 px-2 rounded"
        >
          Reconnect
        </button>
        
        <button
          onClick={() => {
            console.log('📊 Pusher connection state:', connectionState);
            console.log('📊 Environment variables:', {
              pusherKey: process.env.NEXT_PUBLIC_PUSHER_KEY?.slice(0, 10) + '...',
              pusherCluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER
            });
          }}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs py-1 px-2 rounded"
        >
          Log Debug Info
        </button>
      </div>
    </div>
  );
}





