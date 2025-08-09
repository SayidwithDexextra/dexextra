/**
 * Example usage of MetricResolutionModal component
 * Shows integration with the resolve-metric-fast API
 */

'use client';

import React, { useState } from 'react';
import { MetricResolutionModal, type MetricResolutionResponse } from './MetricResolutionModal';

export default function MetricResolutionExample() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [response, setResponse] = useState<MetricResolutionResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Example function to call the resolve-metric-fast API
  const analyzeMetric = async () => {
    setIsLoading(true);
    
    try {
      const apiResponse = await fetch('/api/resolve-metric-fast', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          metric: 'Tesla Q4 2024 Vehicle Deliveries',
          description: 'Number of vehicles delivered by Tesla in Q4 2024',
          urls: [
            'https://ir.tesla.com',
            'https://www.sec.gov/edgar/search/#/entityName=tesla',
            'https://www.reuters.com/business/autos-transportation/'
          ]
        })
      });

      const result: MetricResolutionResponse = await apiResponse.json();
      setResponse(result);
      setIsModalOpen(true);
      
    } catch (error) {
      console.error('Failed to analyze metric:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle when user accepts the analysis
  const handleAccept = () => {
    console.log('Analysis accepted:', response);
    
    // Here you could:
    // - Save the analysis to database
    // - Create a market based on the metric
    // - Send to another API endpoint
    // - Update application state
    
    setIsModalOpen(false);
  };

  // Handle modal close
  const handleClose = () => {
    setIsModalOpen(false);
    setResponse(null);
  };

  return (
    <div style={{ padding: '40px', maxWidth: '600px', margin: '0 auto' }}>
      <h1>Metric Resolution Modal Example</h1>
      
      <p>
        This example shows how to integrate the MetricResolutionModal 
        with the resolve-metric-fast API endpoint.
      </p>

      <button 
        onClick={analyzeMetric}
        disabled={isLoading}
        style={{
          padding: '12px 24px',
          backgroundColor: '#00d084',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          fontSize: '16px',
          cursor: isLoading ? 'not-allowed' : 'pointer',
          opacity: isLoading ? 0.6 : 1
        }}
      >
        {isLoading ? 'Analyzing...' : 'Analyze Tesla Deliveries'}
      </button>

      {/* The Modal Component */}
      {response && (
        <MetricResolutionModal
          isOpen={isModalOpen}
          onClose={handleClose}
          response={response}
          onAccept={handleAccept}
          imageUrl="https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=600&h=300&fit=crop&auto=format"
          fullscreenImageUrl="https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=1400&h=900&fit=crop&auto=format"
        />
      )}

      <div style={{ marginTop: '40px', fontSize: '14px', color: '#666' }}>
        <h3>What happens when you click "Analyze":</h3>
        <ol>
          <li>Calls the <code>/api/resolve-metric-fast</code> endpoint</li>
          <li>Sends metric name and source URLs</li>
          <li>Receives AI analysis with confidence scores</li>
          <li>Opens the modal with typewriter animation</li>
          <li>Allows user to view full analysis and accept/decline</li>
        </ol>
      </div>
    </div>
  );
} 