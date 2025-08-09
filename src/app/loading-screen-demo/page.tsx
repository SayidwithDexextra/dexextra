'use client';

import React, { useState } from 'react';
import LoadingScreen from '@/components/LoadingScreen';

export default function LoadingScreenDemo() {
  const [selectedDemo, setSelectedDemo] = useState<string>('branded');
  const [customMessage, setCustomMessage] = useState('Loading Trading Interface...');
  const [customSubtitle, setCustomSubtitle] = useState('Fetching market data, mark price, and available margin');
  const [selectedSize, setSelectedSize] = useState<'small' | 'default' | 'large'>('large');
  const [selectedVariant, setSelectedVariant] = useState<'glow' | 'orbit' | 'pulse' | 'breathe'>('glow');
  const [fullScreen, setFullScreen] = useState(false);
  const [backgroundColor, setBackgroundColor] = useState('#0a0a0a');

  const presetDemos = {
    branded: {
      message: 'Loading Dex Extra...',
      subtitle: 'Initializing decentralized trading platform',
      size: 'large' as const,
      variant: 'glow' as const,
      fullScreen: false,
      backgroundColor: '#0a0a0a'
    },
    trading: {
      message: 'Loading Trading Interface...',
      subtitle: 'Fetching market data, mark price, and available margin',
      size: 'large' as const,
      variant: 'orbit' as const,
      fullScreen: false,
      backgroundColor: '#0f0f0f'
    },
    processing: {
      message: 'Processing Transaction...',
      subtitle: 'Please wait while we process your request',
      size: 'default' as const,
      variant: 'pulse' as const,
      fullScreen: false,
      backgroundColor: '#1a1a2e'
    },
    connecting: {
      message: 'Connecting to Network...',
      subtitle: 'Establishing secure connection to Polygon',
      size: 'large' as const,
      variant: 'breathe' as const,
      fullScreen: false,
      backgroundColor: '#0f0f23'
    },
    deployment: {
      message: 'Deploying VAMM Contract...',
      subtitle: 'This may take a few minutes. Please do not close this window.',
      size: 'large' as const,
      variant: 'glow' as const,
      fullScreen: false,
      backgroundColor: '#1e1b4b'
    },
    portfolio: {
      message: 'Loading Portfolio...',
      subtitle: 'Fetching your positions and trading history',
      size: 'default' as const,
      variant: 'orbit' as const,
      fullScreen: false,
      backgroundColor: '#0c0a09'
    },
    custom: {
      message: customMessage,
      subtitle: customSubtitle,
      size: selectedSize,
      variant: selectedVariant,
      fullScreen: fullScreen,
      backgroundColor: backgroundColor
    }
  };

  const currentDemo = presetDemos[selectedDemo as keyof typeof presetDemos];

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-black border-b border-gray-800 p-6">
        <h1 className="text-3xl font-bold text-white mb-2">LoadingScreen Component Demo</h1>
        <p className="text-gray-400">
          Explore the Dex Extra logo-centric loading screen with modern animations and branding
        </p>
      </div>

      <div className="flex">
        {/* Controls Panel */}
        <div className="w-80 bg-gray-800 border-r border-gray-700 p-6 space-y-6 overflow-y-auto max-h-screen">
          <div>
            <h3 className="text-lg font-semibold mb-4">Preset Demos</h3>
            <div className="space-y-2">
              {Object.keys(presetDemos).map((demo) => (
                <button
                  key={demo}
                  onClick={() => setSelectedDemo(demo)}
                  className={`w-full text-left px-3 py-2 rounded transition-colors ${
                    selectedDemo === demo
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {demo.charAt(0).toUpperCase() + demo.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {selectedDemo === 'custom' && (
            <>
              <div>
                <label className="block text-sm font-medium mb-2">Message</label>
                <input
                  type="text"
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                  placeholder="Loading message..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Subtitle</label>
                <textarea
                  value={customSubtitle}
                  onChange={(e) => setCustomSubtitle(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white resize-none"
                  placeholder="Subtitle text..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Size</label>
                <select
                  value={selectedSize}
                  onChange={(e) => setSelectedSize(e.target.value as 'small' | 'default' | 'large')}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                >
                  <option value="small">Small</option>
                  <option value="default">Default</option>
                  <option value="large">Large</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Animation Variant</label>
                <select
                  value={selectedVariant}
                  onChange={(e) => setSelectedVariant(e.target.value as 'glow' | 'orbit' | 'pulse' | 'breathe')}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                >
                  <option value="glow">Glow (Default)</option>
                  <option value="orbit">Orbit</option>
                  <option value="pulse">Pulse</option>
                  <option value="breathe">Breathe</option>
                </select>
              </div>

              <div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={fullScreen}
                    onChange={(e) => setFullScreen(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm">Full Screen</span>
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Background Color</label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={backgroundColor}
                    onChange={(e) => setBackgroundColor(e.target.value)}
                    className="w-12 h-10 rounded border border-gray-600"
                  />
                  <input
                    type="text"
                    value={backgroundColor}
                    onChange={(e) => setBackgroundColor(e.target.value)}
                    className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                    placeholder="#0a0a0a"
                  />
                </div>
              </div>
            </>
          )}

          <div className="pt-4 border-t border-gray-700">
            <h4 className="font-medium mb-2">Current Configuration</h4>
            <div className="text-xs text-gray-400 space-y-1">
              <div><strong>Message:</strong> {currentDemo.message}</div>
              <div><strong>Subtitle:</strong> {currentDemo.subtitle}</div>
              <div><strong>Size:</strong> {currentDemo.size}</div>
              <div><strong>Variant:</strong> {currentDemo.variant}</div>
              <div><strong>Full Screen:</strong> {currentDemo.fullScreen ? 'Yes' : 'No'}</div>
              <div><strong>Background:</strong> {currentDemo.backgroundColor}</div>
            </div>
          </div>

          <div className="pt-4 border-t border-gray-700">
            <h4 className="font-medium mb-2">Usage Code</h4>
            <div className="bg-gray-900 p-3 rounded text-xs text-gray-300 overflow-x-auto">
              <pre>{`<LoadingScreen
  message="${currentDemo.message}"
  subtitle="${currentDemo.subtitle}"
  size="${currentDemo.size}"
  variant="${currentDemo.variant}"
  fullScreen={${currentDemo.fullScreen}}
  backgroundColor="${currentDemo.backgroundColor}"
/>`}</pre>
            </div>
          </div>
        </div>

        {/* Preview Panel */}
        <div className="flex-1">
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold">Preview</h3>
              <div className="text-sm text-gray-400">
                {selectedDemo.charAt(0).toUpperCase() + selectedDemo.slice(1)} Demo
              </div>
            </div>
            
            {/* Preview Container */}
            <div className="border border-gray-700 rounded-lg overflow-hidden">
              {currentDemo.fullScreen ? (
                <div className="h-96">
                  <LoadingScreen
                    message={currentDemo.message}
                    subtitle={currentDemo.subtitle}
                    size={currentDemo.size}
                    variant={currentDemo.variant}
                    fullScreen={false} // Force to non-fullscreen for preview
                    backgroundColor={currentDemo.backgroundColor}
                  />
                </div>
              ) : (
                <LoadingScreen
                  message={currentDemo.message}
                  subtitle={currentDemo.subtitle}
                  size={currentDemo.size}
                  variant={currentDemo.variant}
                  fullScreen={currentDemo.fullScreen}
                  backgroundColor={currentDemo.backgroundColor}
                />
              )}
            </div>
          </div>

          {/* Logo-Centric Animation Variants */}
          <div className="p-6 border-t border-gray-700">
            <h3 className="text-xl font-semibold mb-4">Logo Animation Variants</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {(['glow', 'orbit', 'pulse', 'breathe'] as const).map((variant) => (
                <div key={variant} className="border border-gray-700 rounded-lg overflow-hidden">
                  <div className="bg-gray-800 px-3 py-2 text-sm font-medium text-center">
                    {variant.charAt(0).toUpperCase() + variant.slice(1)}
                  </div>
                  <div className="h-40">
                    <LoadingScreen
                      message="Loading..."
                      size="default"
                      variant={variant}
                      fullScreen={false}
                      backgroundColor="#1a1a1a"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Size Comparison */}
          <div className="p-6 border-t border-gray-700">
            <h3 className="text-xl font-semibold mb-4">Size Comparison</h3>
            <div className="grid grid-cols-3 gap-4">
              {(['small', 'default', 'large'] as const).map((size) => (
                <div key={size} className="border border-gray-700 rounded-lg overflow-hidden">
                  <div className="bg-gray-800 px-3 py-2 text-sm font-medium text-center">
                    {size.charAt(0).toUpperCase() + size.slice(1)}
                  </div>
                  <div className="h-32">
                    <LoadingScreen
                      message="Loading..."
                      size={size}
                      variant="glow"
                      fullScreen={false}
                      backgroundColor="#1a1a1a"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Branding Features */}
          <div className="p-6 border-t border-gray-700">
            <h3 className="text-xl font-semibold mb-4">Branding Features</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <h4 className="font-medium text-purple-400">🎯 Logo-Centric Design</h4>
                <ul className="text-sm text-gray-300 space-y-1">
                  <li>• Glow: Multi-layer glowing rings around logo</li>
                  <li>• Orbit: Spinning rings with orbiting particles</li>
                  <li>• Pulse: Energy waves emanating from logo</li>
                  <li>• Breathe: Gentle scaling animation with logo</li>
                </ul>
              </div>
              <div className="space-y-3">
                <h4 className="font-medium text-blue-400">✨ Visual Elements</h4>
                <ul className="text-sm text-gray-300 space-y-1">
                  <li>• Dex Extra logo prominently displayed</li>
                  <li>• Subtle grid pattern background</li>
                  <li>• Gradient overlays and animations</li>
                  <li>• Bouncing progress dots</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Brand Usage Guidelines */}
          <div className="p-6 border-t border-gray-700">
            <h3 className="text-xl font-semibold mb-4">Brand Usage Guidelines</h3>
            <div className="bg-gray-800 rounded-lg p-4 space-y-3">
              <div className="text-sm text-gray-300">
                <strong className="text-white">Best Practices:</strong>
                <ul className="mt-2 space-y-1 ml-4">
                  <li>• Use "glow" variant for main app loading</li>
                  <li>• Use "orbit" for trading interface initialization</li>
                  <li>• Use "pulse" for transaction processing</li>
                  <li>• Use "breathe" for network connections</li>
                </ul>
              </div>
              <div className="text-sm text-gray-300">
                <strong className="text-white">Size Recommendations:</strong>
                <ul className="mt-2 space-y-1 ml-4">
                  <li>• Large: App splash screens and main loading</li>
                  <li>• Default: Modal dialogs and component loading</li>
                  <li>• Small: Inline loading states and micro-interactions</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 