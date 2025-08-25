'use client';

import React, { useState, useEffect } from 'react';
import { AdvancedChart } from '../index';
// Removed useVAMMMarkets hook - smart contract functionality disabled

/**
 * Example component showing how to use AdvancedChart with custom vAMM markets
 */
export default function AdvancedChartExample() {
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [interval, setInterval] = useState<string>('15');
  // Stub values - smart contract functionality removed
  const markets: any[] = []
  const isLoading = false
  const error = null

  // Auto-select first available market
  useEffect(() => {
    if (markets.length > 0 && !selectedSymbol) {
      setSelectedSymbol(markets[0].symbol);
    }
  }, [markets, selectedSymbol]);

  const handleSymbolChange = (newSymbol: string) => {
    console.log('Symbol changed to:', newSymbol);
    setSelectedSymbol(newSymbol);
  };

  const handleIntervalChange = (newInterval: string) => {
    console.log('Interval changed to:', newInterval);
    setInterval(newInterval);
  };

  if (isLoading) {
    return (
      <div className="p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-4"></div>
        <p className="text-gray-400">Loading vAMM markets...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center">
        <div className="text-red-500 text-lg mb-2">⚠️ Error Loading Markets</div>
        <p className="text-gray-400">{error}</p>
      </div>
    );
  }

  if (markets.length === 0) {
    return (
      <div className="p-8 text-center">
        <div className="text-yellow-500 text-lg mb-2">📊 No Markets Available</div>
        <p className="text-gray-400">
          No deployed vAMM markets found. Create a market first to see charts.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Market Selection Controls */}
      <div className="bg-gray-900 p-4 rounded-lg border border-gray-700">
        <h3 className="text-lg font-semibold text-white mb-4">Advanced Chart Demo</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Symbol Selector */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Market Symbol
            </label>
            <select
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded-md px-3 py-2 text-white focus:ring-2 focus:ring-blue-500"
            >
              {markets.map((market) => (
                <option key={market.id} value={market.symbol}>
                  {market.symbol} - {market.description}
                </option>
              ))}
            </select>
          </div>

          {/* Interval Selector */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Time Interval
            </label>
            <select
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded-md px-3 py-2 text-white focus:ring-2 focus:ring-blue-500"
            >
              <option value="1">1 minute</option>
              <option value="5">5 minutes</option>
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="60">1 hour</option>
              <option value="240">4 hours</option>
              <option value="1D">1 day</option>
            </select>
          </div>
        </div>

        {/* Market Info */}
        {selectedSymbol && (
          <div className="mt-4 p-3 bg-gray-800 rounded-md">
            <div className="text-sm text-gray-400">
              Selected Market: <span className="text-white font-medium">{selectedSymbol}</span>
            </div>
            {markets.find(m => m.symbol === selectedSymbol) && (
              <div className="text-xs text-gray-500 mt-1">
                vAMM: {markets.find(m => m.symbol === selectedSymbol)?.vamm_address?.slice(0, 10)}...
              </div>
            )}
          </div>
        )}
      </div>

      {/* Advanced Chart */}
      {selectedSymbol && (
        <div className="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
          <AdvancedChart
            symbol={selectedSymbol}
            interval={interval}
            theme="dark"
            height={600}
            autosize={false}
            allowSymbolChange={true}
            hideTopToolbar={false}
            hideSideToolbar={false}
            hideVolumePanel={false}
            studies={['Volume']}
            drawingsAccess={true}
            savingEnabled={false}
            onSymbolChange={handleSymbolChange}
            onIntervalChange={handleIntervalChange}
            className="border-0"
          />
        </div>
      )}

      {/* Usage Information */}
      <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-4">
        <h4 className="text-blue-400 font-medium mb-2">📚 Usage Information</h4>
        <div className="text-sm text-gray-300 space-y-1">
          <p>• This chart displays real-time data from your custom vAMM markets</p>
          <p>• Markets are automatically fetched from your Supabase database</p>
          <p>• Only deployed markets with valid contract addresses are shown</p>
          <p>• Use the symbol search in the chart to find other markets</p>
          <p>• Charts support full TradingView features including indicators and drawings</p>
        </div>
      </div>

      {/* Technical Information */}
      <div className="bg-gray-900 p-4 rounded-lg border border-gray-700">
        <h4 className="text-gray-300 font-medium mb-3">🔧 Technical Details</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-400">
          <div>
            <strong>API Endpoints:</strong>
            <ul className="mt-1 space-y-1">
              <li>• /api/tradingview/config</li>
              <li>• /api/tradingview/search</li>
              <li>• /api/tradingview/symbols</li>
              <li>• /api/tradingview/history</li>
            </ul>
          </div>
          <div>
            <strong>Data Sources:</strong>
            <ul className="mt-1 space-y-1">
              <li>• Supabase vamm_markets table</li>
              <li>• ClickHouse OHLCV data</li>
              <li>• Real-time Pusher streams</li>
              <li>• Blockchain event data</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
} 