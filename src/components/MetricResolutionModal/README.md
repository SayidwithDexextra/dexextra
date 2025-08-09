# MetricResolutionModal

A production-ready modal component for displaying AI metric analysis results with a beautiful typewriter animation and expandable visualization.

## Features

- ✨ **AI Typewriter Effect** - Word-by-word animated text display
- 🎨 **Beautiful Design** - Green gradient lighting with dark theme
- 📊 **Metric Display** - Value, confidence, and asset price information
- 🖼️ **Expandable Images** - Click to view fullscreen visualizations
- 📱 **Mobile Responsive** - Optimized for all screen sizes
- ⌨️ **Keyboard Support** - ESC key to close fullscreen image
- 🎯 **TypeScript Ready** - Full type safety and IntelliSense

## Usage

### Basic Example

```tsx
import { useState } from 'react';
import { MetricResolutionModal, type MetricResolutionResponse } from '@/components/MetricResolutionModal';

function MyComponent() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  const mockResponse: MetricResolutionResponse = {
    status: 'completed',
    processingTime: '2847ms',
    cached: false,
    data: {
      metric: 'Tesla Q4 2024 Vehicle Deliveries',
      value: '484,507',
      unit: 'vehicles',
      as_of: '2024-01-02T15:30:00Z',
      confidence: 0.92,
      asset_price_suggestion: '67.50',
      reasoning: 'Based on comprehensive analysis of official Tesla investor relations...',
      sources: [
        {
          url: 'https://ir.tesla.com/press-release/tesla-q4-2024',
          screenshot_url: 'https://example.com/screenshot.png',
          quote: 'Tesla delivered 484,507 vehicles...',
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
  };

  return (
    <div>
      <button onClick={() => setIsModalOpen(true)}>
        Show Analysis
      </button>
      
      <MetricResolutionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        response={mockResponse}
        onAccept={() => {
          console.log('User accepted the analysis');
          setIsModalOpen(false);
        }}
      />
    </div>
  );
}
```

### With Custom Images

```tsx
<MetricResolutionModal
  isOpen={isModalOpen}
  onClose={() => setIsModalOpen(false)}
  response={response}
  imageUrl="https://example.com/chart-preview.jpg"
  fullscreenImageUrl="https://example.com/chart-full.jpg"
  onAccept={handleAccept}
/>
```

## Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `isOpen` | `boolean` | ✅ | - | Controls modal visibility |
| `onClose` | `() => void` | ✅ | - | Called when modal should close |
| `response` | `MetricResolutionResponse` | ✅ | - | Analysis data to display |
| `onAccept` | `() => void` | ❌ | `onClose` | Called when Accept button is clicked |
| `imageUrl` | `string` | ❌ | Default chart | URL for the preview image |
| `fullscreenImageUrl` | `string` | ❌ | Default chart | URL for the fullscreen image |

## TypeScript Types

The component exports these TypeScript interfaces:

- `MetricResolution` - Individual metric data
- `MetricResolutionResponse` - Complete API response
- `MetricResolutionModalProps` - Component props

## Integration with resolve-metric-fast API

This component is designed to work seamlessly with the `/api/resolve-metric-fast` endpoint:

```tsx
async function analyzeMetric(metric: string, urls: string[]) {
  const response = await fetch('/api/resolve-metric-fast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ metric, urls })
  });
  
  const result: MetricResolutionResponse = await response.json();
  
  return (
    <MetricResolutionModal
      isOpen={true}
      onClose={() => {}}
      response={result}
    />
  );
}
```

## Styling

The component uses CSS modules and is fully styled. The design includes:

- Dark theme with green gradient lighting
- Smooth animations and transitions
- Mobile-responsive layout
- Professional typography hierarchy

## Accessibility

- Keyboard navigation support (ESC key)
- ARIA labels for screen readers
- Focus management for modal interactions
- Semantic HTML structure 