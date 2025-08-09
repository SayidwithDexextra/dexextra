'use client';

import React, { useState } from 'react';
import { MetricResolutionModal, type MetricResolutionResponse } from '@/components/MetricResolutionModal';

export default function MetricResolutionDemo() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentScenario, setCurrentScenario] = useState<MetricResolutionResponse | null>(null);

  // Demo scenarios with different metric types
  const scenarios: { name: string; data: MetricResolutionResponse }[] = [
    {
      name: 'Tesla Vehicle Deliveries',
      data: {
        status: 'completed',
        processingTime: '2.8s',
        cached: false,
        data: {
          metric: 'Tesla Q4 2024 Vehicle Deliveries',
          value: '484.5K',
          unit: 'vehicles',
          as_of: '2024-01-02T15:30:00Z',
          confidence: 0.92,
          asset_price_suggestion: '267.50',
          reasoning: 'Based on comprehensive analysis of Tesla\'s official investor relations documents and SEC filings, the company delivered approximately 484,507 vehicles in Q4 2024. This represents a significant milestone in Tesla\'s production capabilities and market expansion. The data was cross-referenced with multiple official sources including quarterly earnings reports, press releases, and regulatory filings to ensure accuracy. Market analysts have responded positively to these delivery numbers, which exceeded expectations and demonstrate Tesla\'s ability to scale production efficiently.',
          sources: [
            {
              url: 'https://ir.tesla.com/press-release/tesla-q4-2024-delivery-report',
              screenshot_url: 'https://example.com/tesla-screenshot.png',
              quote: 'Tesla delivered 484,507 vehicles in Q4 2024',
              match_score: 0.98
            }
          ]
        },
        performance: {
          totalTime: 2847,
          breakdown: {
            cacheCheck: '~45ms',
            scraping: '~1.8s',
            processing: '~320ms',
            aiAnalysis: '~682ms'
          }
        }
      }
    },
    {
      name: 'Apple Revenue',
      data: {
        status: 'completed',
        processingTime: '1.2s',
        cached: true,
        data: {
          metric: 'Apple Q1 2024 Total Revenue',
          value: '119.6B',
          unit: 'USD',
          as_of: '2024-02-01T16:00:00Z',
          confidence: 0.95,
          asset_price_suggestion: '185.20',
          reasoning: 'Apple reported record-breaking Q1 2024 revenue of $119.58 billion, representing a 2% increase year-over-year. This performance was driven by strong iPhone sales, robust services growth, and expanding market presence in emerging markets. The revenue figure reflects Apple\'s continued dominance in premium consumer electronics and growing services ecosystem.',
          sources: [
            {
              url: 'https://investor.apple.com/investor-relations/sec-filings/',
              screenshot_url: 'https://example.com/apple-screenshot.png',
              quote: 'Total net sales of $119.58 billion for Q1 2024',
              match_score: 0.99
            }
          ]
        },
        performance: {
          totalTime: 1200,
          breakdown: {
            cacheCheck: '~890ms',
            scraping: '~120ms',
            processing: '~95ms',
            aiAnalysis: '~95ms'
          }
        }
      }
    },
    {
      name: 'Global Crypto Market Cap',
      data: {
        status: 'completed',
        processingTime: '3.4s',
        cached: false,
        data: {
          metric: 'Total Cryptocurrency Market Capitalization',
          value: '1.68T',
          unit: 'USD',
          as_of: '2024-01-15T12:00:00Z',
          confidence: 0.78,
          asset_price_suggestion: '42,500.00',
          reasoning: 'The total cryptocurrency market capitalization reached approximately $1.68 trillion as of January 15, 2024. This metric aggregates the market value of all cryptocurrencies and provides insight into overall market sentiment and adoption. The calculation includes Bitcoin, Ethereum, and thousands of altcoins, reflecting the diverse and evolving digital asset ecosystem.',
          sources: [
            {
              url: 'https://coinmarketcap.com/charts/',
              screenshot_url: 'https://example.com/crypto-screenshot.png',
              quote: 'Total Market Cap: $1.68T',
              match_score: 0.85
            }
          ]
        },
        performance: {
          totalTime: 3400,
          breakdown: {
            cacheCheck: '~32ms',
            scraping: '~2.1s',
            processing: '~450ms',
            aiAnalysis: '~818ms'
          }
        }
      }
    }
  ];

  const openModal = (scenario: MetricResolutionResponse) => {
    setCurrentScenario(scenario);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setCurrentScenario(null);
  };

  const handleAccept = () => {
    console.log('Analysis accepted:', currentScenario);
    alert('Analysis accepted! Check console for details.');
    closeModal();
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
      padding: '40px 20px',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <div style={{
        maxWidth: '800px',
        margin: '0 auto',
        textAlign: 'center'
      }}>
        {/* Header */}
        <h1 style={{
          color: '#ffffff',
          fontSize: '2.5rem',
          fontWeight: '600',
          marginBottom: '16px',
          background: 'linear-gradient(135deg, #00d084 0%, #00b8ff 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text'
        }}>
          Metric Resolution Modal Demo
        </h1>
        
        <p style={{
          color: '#a0a0a0',
          fontSize: '1.1rem',
          marginBottom: '40px',
          lineHeight: '1.6'
        }}>
          Test the production MetricResolutionModal component with different metric scenarios
        </p>

        {/* Scenario Buttons */}
        <div style={{
          display: 'grid',
          gap: '20px',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          marginBottom: '40px'
        }}>
          {scenarios.map((scenario, index) => (
            <button
              key={index}
              onClick={() => openModal(scenario.data)}
              style={{
                background: 'rgba(0, 0, 0, 0.6)',
                border: '1px solid rgba(0, 208, 132, 0.2)',
                borderRadius: '12px',
                padding: '20px',
                color: '#ffffff',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                backdropFilter: 'blur(10px)',
                fontSize: '1rem',
                fontWeight: '500'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'rgba(0, 208, 132, 0.5)';
                e.currentTarget.style.background = 'rgba(0, 208, 132, 0.1)';
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'rgba(0, 208, 132, 0.2)';
                e.currentTarget.style.background = 'rgba(0, 0, 0, 0.6)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <div style={{ marginBottom: '8px', fontWeight: '600' }}>
                {scenario.name}
              </div>
              <div style={{ 
                fontSize: '0.9rem', 
                color: '#a0a0a0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span>{scenario.data.data.value} {scenario.data.data.unit}</span>
                <span style={{
                  background: scenario.data.cached ? '#ff9800' : '#00d084',
                  color: '#000',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  fontWeight: '600'
                }}>
                  {scenario.data.cached ? 'CACHED' : 'LIVE'}
                </span>
              </div>
            </button>
          ))}
        </div>

        {/* Instructions */}
        <div style={{
          background: 'rgba(0, 0, 0, 0.4)',
          border: '1px solid rgba(0, 208, 132, 0.1)',
          borderRadius: '12px',
          padding: '24px',
          textAlign: 'left'
        }}>
          <h3 style={{ 
            color: '#00d084', 
            marginBottom: '16px',
            fontSize: '1.2rem'
          }}>
            📊 Demo Features
          </h3>
          <ul style={{
            color: '#e0e0e0',
            lineHeight: '1.8',
            listStylePosition: 'inside'
          }}>
            <li>🎬 <strong>AI Typewriter Animation</strong> - Watch the summary text stream word-by-word</li>
            <li>🎯 <strong>Confidence Indicators</strong> - Color-coded reliability scores</li>
            <li>📸 <strong>Expandable Images</strong> - Click the chart to view fullscreen</li>
            <li>⌨️ <strong>Keyboard Navigation</strong> - Press ESC to close fullscreen image</li>
            <li>📱 <strong>Mobile Responsive</strong> - Try resizing your browser window</li>
            <li>✅ <strong>Accept Action</strong> - Click Accept to see console output</li>
          </ul>
        </div>
      </div>

      {/* Modal Component */}
      {currentScenario && (
        <MetricResolutionModal
          isOpen={isModalOpen}
          onClose={closeModal}
          response={currentScenario}
          onAccept={handleAccept}
          imageUrl="https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=600&h=300&fit=crop&auto=format"
          fullscreenImageUrl="https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=1400&h=900&fit=crop&auto=format"
        />
      )}
    </div>
  );
} 