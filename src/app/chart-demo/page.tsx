'use client';

import React, { useState } from 'react';
import { 
  ChartSelector, 
  LightweightChart, 
  TradingViewWidget 
} from '@/components/TokenView';

const availableSymbols = ['BTC', 'ETH', 'GOLD'];

export default function ChartDemoPage() {
  const [selectedSymbol, setSelectedSymbol] = useState('GOLD');

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold">📊 Chart Components Demo</h1>
          <p className="text-lg text-gray-400">
            Test all three chart components with live data from our backend
          </p>
          
          {/* Symbol Selector */}
          <div className="flex justify-center gap-2">
            {availableSymbols.map((symbol) => (
              <button
                key={symbol}
                onClick={() => setSelectedSymbol(symbol)}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  selectedSymbol === symbol
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {symbol}
              </button>
            ))}
          </div>
        </div>

        {/* Chart Selector Demo - Main Feature */}
        <div className="space-y-4">
          <div className="text-center">
            <h2 className="text-2xl font-semibold mb-2">🎯 ChartSelector (Recommended)</h2>
            <p className="text-gray-400">
              Complete chart solution with user choice between lightweight and advanced
            </p>
          </div>
          
          <ChartSelector
            symbol={selectedSymbol}
            height={500}
            defaultChart="lightweight"
            className="mx-auto"
          />
        </div>

        {/* Individual Chart Components */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
          
          {/* LightweightChart Demo */}
          <div className="space-y-4">
            <div className="text-center">
              <h2 className="text-xl font-semibold mb-2">⚡ LightweightChart</h2>
              <p className="text-gray-400 text-sm">
                Fast performance with real-time data from your backend
              </p>
            </div>
            
            <LightweightChart
              symbol={selectedSymbol}
              height={400}
            />
            
            {/* Features List */}
            <div className="bg-gray-900 rounded-lg p-4">
              <h3 className="font-medium text-green-400 mb-2">✅ Features:</h3>
              <ul className="text-sm text-gray-300 space-y-1">
                <li>• Real-time data from /api/charts/ohlcv</li>
                <li>• Auto-refresh every 30 seconds</li>
                <li>• Multiple timeframes (1m-1d)</li>
                <li>• Volume histogram overlay</li>
                <li>• Interactive zoom & pan</li>
                <li>• Fast loading (~100ms)</li>
              </ul>
            </div>
          </div>

          {/* TradingViewWidget Demo */}
          <div className="space-y-4">
            <div className="text-center">
              <h2 className="text-xl font-semibold mb-2">📈 TradingViewWidget</h2>
              <p className="text-gray-400 text-sm">
                Professional trading with full TradingView functionality
              </p>
            </div>
            
            <TradingViewWidget
              symbol={`${selectedSymbol}USD`}
              height={400}
              theme="dark"
              style="1"
              enable_publishing={false}
              allow_symbol_change={true}
            />
            
            {/* Features List */}
            <div className="bg-gray-900 rounded-lg p-4">
              <h3 className="font-medium text-blue-400 mb-2">📊 Features:</h3>
              <ul className="text-sm text-gray-300 space-y-1">
                <li>• Full TradingView integration</li>
                <li>• 100+ technical indicators</li>
                <li>• Professional drawing tools</li>
                <li>• Symbol search & comparison</li>
                <li>• Global market data</li>
                <li>• Advanced order visualization</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Performance Comparison */}
        <div className="bg-gray-900 rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4 text-center">🚀 Performance Comparison</h2>
          
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left py-2 text-gray-400">Feature</th>
                  <th className="text-center py-2 text-green-400">LightweightChart</th>
                  <th className="text-center py-2 text-blue-400">TradingViewWidget</th>
                </tr>
              </thead>
              <tbody className="space-y-2">
                <tr className="border-b border-gray-800">
                  <td className="py-2 font-medium">Load Time</td>
                  <td className="text-center text-green-400">⚡ Instant (&lt;100ms)</td>
                  <td className="text-center text-red-400">🐢 2-5 seconds</td>
                </tr>
                <tr className="border-b border-gray-800">
                  <td className="py-2 font-medium">Real-time Data</td>
                  <td className="text-center text-green-400">✅ Every 30s</td>
                  <td className="text-center text-red-400">❌ Manual refresh</td>
                </tr>
                <tr className="border-b border-gray-800">
                  <td className="py-2 font-medium">Technical Indicators</td>
                  <td className="text-center text-red-400">❌ Basic only</td>
                  <td className="text-center text-green-400">✅ 100+ indicators</td>
                </tr>
                <tr className="border-b border-gray-800">
                  <td className="py-2 font-medium">Drawing Tools</td>
                  <td className="text-center text-red-400">❌ None</td>
                  <td className="text-center text-green-400">✅ Professional</td>
                </tr>
                <tr className="border-b border-gray-800">
                  <td className="py-2 font-medium">Data Source</td>
                  <td className="text-center text-green-400">✅ Your backend</td>
                  <td className="text-center text-yellow-400">⚠️ TradingView only</td>
                </tr>
                <tr className="border-b border-gray-800">
                  <td className="py-2 font-medium">Mobile Performance</td>
                  <td className="text-center text-green-400">✅ Excellent</td>
                  <td className="text-center text-yellow-400">⚠️ Heavy</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* API Status */}
        <div className="bg-gray-900 rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4 text-center">🔗 Backend Integration Status</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gray-800 rounded-lg p-4 text-center">
              <div className="text-green-400 text-2xl mb-2">✅</div>
              <div className="font-medium">OHLCV API</div>
              <div className="text-xs text-gray-400">Real-time price data</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4 text-center">
              <div className="text-green-400 text-2xl mb-2">✅</div>
              <div className="font-medium">Markets API</div>
              <div className="text-xs text-gray-400">Available symbols</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4 text-center">
              <div className="text-green-400 text-2xl mb-2">✅</div>
              <div className="font-medium">ClickHouse DB</div>
              <div className="text-xs text-gray-400">7 days of data</div>
            </div>
          </div>
        </div>

        {/* Code Examples */}
        <div className="bg-gray-900 rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4 text-center">💻 Quick Start Code</h2>
          
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            
            {/* ChartSelector Example */}
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="font-medium text-green-400 mb-2">ChartSelector (Best Choice)</h3>
              <div className="text-xs text-gray-300 bg-gray-900 p-3 rounded overflow-x-auto">
                <div>import &#123; ChartSelector &#125; from &apos;@/components/TokenView&apos;;</div>
                <br />
                <div>&lt;ChartSelector</div>
                <div>  symbol=&quot;BTC&quot;</div>
                <div>  height=&#123;500&#125;</div>
                <div>  defaultChart=&quot;lightweight&quot;</div>
                <div>/&gt;</div>
              </div>
            </div>

            {/* LightweightChart Example */}
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="font-medium text-green-400 mb-2">LightweightChart</h3>
              <div className="text-xs text-gray-300 bg-gray-900 p-3 rounded overflow-x-auto">
                <div>import &#123; LightweightChart &#125; from &apos;@/components/TokenView&apos;;</div>
                <br />
                <div>&lt;LightweightChart</div>
                <div>  symbol=&quot;ETH&quot;</div>
                <div>  height=&#123;400&#125;</div>
                <div>  className=&quot;border rounded&quot;</div>
                <div>/&gt;</div>
              </div>
            </div>

            {/* TradingViewWidget Example */}
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="font-medium text-blue-400 mb-2">TradingViewWidget</h3>
              <div className="text-xs text-gray-300 bg-gray-900 p-3 rounded overflow-x-auto">
                <div>import &#123; TradingViewWidget &#125; from &apos;@/components/TokenView&apos;;</div>
                <br />
                <div>&lt;TradingViewWidget</div>
                <div>  symbol=&quot;BTCUSD&quot;</div>
                <div>  height=&#123;600&#125;</div>
                <div>  theme=&quot;dark&quot;</div>
                <div>/&gt;</div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-gray-500 text-sm py-8">
          <p>🎉 Professional-grade charting components ready for production!</p>
          <p className="mt-2">
            Visit <code className="bg-gray-800 px-2 py-1 rounded">/token/{selectedSymbol}</code> to see ChartSelector in your actual trading interface
          </p>
        </div>
      </div>
    </div>
  );
} 