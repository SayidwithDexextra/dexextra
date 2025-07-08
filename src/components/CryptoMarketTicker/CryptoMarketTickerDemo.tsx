'use client'

import React from 'react'
import CryptoMarketTicker from './CryptoMarketTicker'

export default function CryptoMarketTickerDemo() {
  return (
    <div className="space-y-8 p-8 bg-gray-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Crypto Market Ticker Demo
        </h1>
        <p className="text-gray-600 mb-8">
          Live cryptocurrency market data ticker with seamless scrolling animation
        </p>

        {/* Default Configuration */}
        <section className="mb-12">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">
            Default Configuration
          </h2>
          <div className="border border-gray-200 rounded-lg overflow-hidden shadow-sm">
            <CryptoMarketTicker />
          </div>
          <p className="text-sm text-gray-500 mt-2">
            Standard speed (60px/s), pause on hover enabled
          </p>
        </section>

        {/* Fast Speed */}
        <section className="mb-12">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">
            Fast Speed
          </h2>
          <div className="border border-gray-200 rounded-lg overflow-hidden shadow-sm">
            <CryptoMarketTicker speed={120} />
          </div>
          <p className="text-sm text-gray-500 mt-2">
            Double speed (120px/s) for faster scrolling
          </p>
        </section>

        {/* Slow Speed */}
        <section className="mb-12">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">
            Slow Speed
          </h2>
          <div className="border border-gray-200 rounded-lg overflow-hidden shadow-sm">
            <CryptoMarketTicker speed={30} />
          </div>
          <p className="text-sm text-gray-500 mt-2">
            Half speed (30px/s) for slower scrolling
          </p>
        </section>

        {/* No Pause on Hover */}
        <section className="mb-12">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">
            No Pause on Hover
          </h2>
          <div className="border border-gray-200 rounded-lg overflow-hidden shadow-sm">
            <CryptoMarketTicker pauseOnHover={false} />
          </div>
          <p className="text-sm text-gray-500 mt-2">
            Continuous scrolling without pause on mouse hover
          </p>
        </section>

        {/* Custom Styling */}
        <section className="mb-12">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">
            Custom Styling Example
          </h2>
          <div className="border-2 border-blue-500 rounded-lg overflow-hidden shadow-lg">
            <CryptoMarketTicker className="border-t-4 border-blue-600" />
          </div>
          <p className="text-sm text-gray-500 mt-2">
            With custom container styling and border
          </p>
        </section>

        {/* Implementation Notes */}
        <section className="mb-12">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">
            Implementation Notes
          </h2>
          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
            <ul className="space-y-3 text-sm text-gray-700">
              <li className="flex items-start">
                <span className="text-green-500 mr-2">✓</span>
                <span>
                  <strong>Live Data:</strong> Fetches real-time cryptocurrency prices from CoinGecko API
                </span>
              </li>
              <li className="flex items-start">
                <span className="text-green-500 mr-2">✓</span>
                <span>
                  <strong>Auto Updates:</strong> Refreshes price data every 60 seconds automatically
                </span>
              </li>
              <li className="flex items-start">
                <span className="text-green-500 mr-2">✓</span>
                <span>
                  <strong>Seamless Scrolling:</strong> Duplicates ticker content for infinite scroll effect
                </span>
              </li>
              <li className="flex items-start">
                <span className="text-green-500 mr-2">✓</span>
                <span>
                  <strong>Responsive Design:</strong> Adapts typography and spacing for mobile, tablet, and desktop
                </span>
              </li>
              <li className="flex items-start">
                <span className="text-green-500 mr-2">✓</span>
                <span>
                  <strong>Accessibility:</strong> Includes ARIA labels and respects reduced motion preferences
                </span>
              </li>
              <li className="flex items-start">
                <span className="text-green-500 mr-2">✓</span>
                <span>
                  <strong>Design System:</strong> Follows exact specifications from CryptomarketTicker.json
                </span>
              </li>
            </ul>
          </div>
        </section>

        {/* Usage Example */}
        <section className="mb-12">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">
            Usage Example
          </h2>
          <div className="bg-gray-900 text-gray-100 p-6 rounded-lg border border-gray-700 overflow-x-auto">
            <pre className="text-sm">
{`import { CryptoMarketTicker } from '@/components/CryptoMarketTicker'

// Basic usage
<CryptoMarketTicker />

// With custom configuration
<CryptoMarketTicker 
  speed={90}
  pauseOnHover={true}
  className="my-custom-class"
/>`}
            </pre>
          </div>
        </section>
      </div>
    </div>
  )
} 