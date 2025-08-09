# DexContractsV2 Metric Price Hooks Usage Guide

This guide explains how to use the enhanced metric price hooks that solve the "metric not found" error.

## The Problem (Fixed)

The original error occurred because the hook was generating metric IDs from token symbols using `keccak256(toBytes(tokenSymbol))`, but the actual metrics in the system have IDs generated differently by the MetricRegistry contract.

## Solution Overview

We now provide two enhanced hooks:

1. **`useVAMMPriceData`** - Enhanced version with optional registry support
2. **`useMetricRegistry`** - Standalone hook for metric discovery

## Available Hooks

### 1. Enhanced useVAMMPriceData Hook

```typescript
import { useVAMMPriceData } from '@/hooks/useVAMMPriceData';

// Basic usage with predefined symbols
const { markPrice, isLoading, error } = useVAMMPriceData('POPULATION');

// Enhanced usage with metric registry support
const priceData = useVAMMPriceData('World Population', {
  useMetricRegistry: true,
  pollingInterval: 5000,
  enablePolling: true
});
```

### 2. Standalone Metric Registry Hook

```typescript
import { useMetricRegistry } from '@/hooks/useMetricRegistry';

const {
  metrics,
  isLoading,
  getMetricByName,
  getMetricIdByName,
  refreshMetrics
} = useMetricRegistry();

// Get metric ID by name
const worldPopMetricId = getMetricIdByName('World Population');
```

## Predefined Metric Symbols

The system supports these predefined symbols that map to registered metrics:

```typescript
// Population metrics
'POPULATION' → World Population metric
'WORLD_POP' → World Population metric  
'WORLD_POPULATION' → World Population metric

// Temperature/Climate metrics
'TEMP' → Global Average Temperature metric
'TEMPERATURE' → Global Average Temperature metric
'CLIMATE' → Global Average Temperature metric
'GLOBAL_TEMPERATURE' → Global Average Temperature metric
'GLOBAL_AVERAGE_TEMPERATURE' → Global Average Temperature metric

// Economic metrics
'GDP' → US GDP Growth metric
'US_GDP' → US GDP Growth metric
'ECONOMY' → US GDP Growth metric
'US_GDP_GROWTH' → US GDP Growth metric
```

## Usage Examples

### Example 1: Simple Predefined Symbol Usage

```typescript
'use client';
import { useVAMMPriceData } from '@/hooks/useVAMMPriceData';

export function SimpleMetricPrice() {
  const { markPrice, isLoading, error, helpText } = useVAMMPriceData('POPULATION');

  if (isLoading) return <div>Loading price...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      <h3>World Population Market Price</h3>
      <p>Current Price: ${markPrice}</p>
      <small>{helpText}</small>
    </div>
  );
}
```

### Example 2: Enhanced Usage with Registry Support

```typescript
'use client';
import { useVAMMPriceData } from '@/hooks/useVAMMPriceData';

export function EnhancedMetricPrice() {
  const priceData = useVAMMPriceData('Global Average Temperature', {
    useMetricRegistry: true,
    pollingInterval: 10000,
    enablePolling: true
  });

  const { markPrice, isLoading, error, metricInfo, supportsMetricRegistry } = priceData;

  if (isLoading) return <div>Loading metric price...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      <h3>Metric Price Dashboard</h3>
      {metricInfo && (
        <div>
          <h4>{metricInfo.name}</h4>
          <p>{metricInfo.description}</p>
          <p>Metric ID: {metricInfo.id}</p>
        </div>
      )}
      <p>Current Price: ${markPrice}</p>
      <p>Registry Support: {supportsMetricRegistry ? 'Enabled' : 'Disabled'}</p>
    </div>
  );
}
```

### Example 3: Dynamic Metric Discovery

```typescript
'use client';
import { useMetricRegistry, useVAMMPriceData } from '@/hooks';
import { useState } from 'react';

export function MetricExplorer() {
  const [selectedMetric, setSelectedMetric] = useState<string>('');
  const { metrics, isLoading: registryLoading } = useMetricRegistry();
  
  const { markPrice, isLoading: priceLoading, error } = useVAMMPriceData(
    selectedMetric, 
    { useMetricRegistry: true }
  );

  if (registryLoading) return <div>Loading available metrics...</div>;

  return (
    <div>
      <h3>Metric Explorer</h3>
      
      {/* Metric Selection */}
      <div>
        <label>Select Metric:</label>
        <select 
          value={selectedMetric} 
          onChange={(e) => setSelectedMetric(e.target.value)}
        >
          <option value="">Choose a metric...</option>
          {metrics.map((metric) => (
            <option key={metric.metricId} value={metric.name}>
              {metric.name}
            </option>
          ))}
        </select>
      </div>

      {/* Price Display */}
      {selectedMetric && (
        <div>
          <h4>{selectedMetric}</h4>
          {priceLoading ? (
            <p>Loading price...</p>
          ) : error ? (
            <p>Error: {error}</p>
          ) : (
            <p>Current Price: ${markPrice}</p>
          )}
        </div>
      )}

      {/* Available Metrics List */}
      <div>
        <h4>Available Metrics ({metrics.length})</h4>
        <ul>
          {metrics.map((metric) => (
            <li key={metric.metricId}>
              <strong>{metric.name}</strong>
              <br />
              <small>{metric.description}</small>
              <br />
              <code>ID: {metric.metricId}</code>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

## Error Handling

The enhanced hooks provide better error messages:

```typescript
// When using predefined symbols only
const { error } = useVAMMPriceData('INVALID_SYMBOL');
// Error: "No metric registered for symbol: INVALID_SYMBOL. Available: POPULATION, TEMP, GDP, ..."

// When using registry support
const { error } = useVAMMPriceData('Invalid Metric', { useMetricRegistry: true });
// Error: "No metric found for symbol: Invalid Metric. Try using exact metric names like 'World Population', 'Global Average Temperature', or 'US GDP Growth'"
```

## Hook Return Values

### useVAMMPriceData Returns:

```typescript
{
  markPrice: string;           // Current market price
  isLoading: boolean;          // Loading state
  error: string | null;        // Error message
  lastUpdated: number;         // Timestamp of last update
  refetch: () => Promise<void>; // Manual refresh function
  availableMetrics: string[];  // List of predefined symbols
  supportsMetricRegistry: boolean; // Whether registry support is enabled
  helpText: string;           // Usage guidance text
}
```

### useMetricRegistry Returns:

```typescript
{
  metrics: MetricDefinition[];              // All registered metrics
  isLoading: boolean;                       // Loading state
  error: string | null;                     // Error message
  getMetricByName: (name: string) => MetricDefinition | null;
  getMetricIdByName: (name: string) => string | null;
  refreshMetrics: () => Promise<void>;      // Refresh metrics from contract
}
```

## Best Practices

1. **Use predefined symbols** for common metrics (POPULATION, TEMP, GDP)
2. **Enable registry support** when you need to discover new metrics dynamically
3. **Handle loading states** appropriately since registry queries take time
4. **Cache metric IDs** locally to avoid repeated registry calls
5. **Implement error boundaries** for graceful error handling

## Migration from Old Hook

If you were using the old hook that was failing:

```typescript
// OLD (was failing)
const { markPrice } = useVAMMPriceData('someTokenSymbol');

// NEW (working)
const { markPrice } = useVAMMPriceData('POPULATION'); // Use predefined symbol
// OR
const { markPrice } = useVAMMPriceData('World Population', { useMetricRegistry: true });
```

This enhanced system provides robust metric discovery while maintaining backward compatibility with predefined symbols. 