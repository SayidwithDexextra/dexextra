# DeFi Trading Widgets

A comprehensive set of React components for displaying cryptocurrency trading data, built following the design system extracted from trading interface specifications.

## Components

### Widget
Main container component that orchestrates all sub-components.

### WidgetDemo
Interactive demonstration component with live data simulation and feature showcase.

### MarketOverview
Displays market capitalization and 24h trading volume with mini charts.

### TrendingSection / TopGainersSection
Display lists of trending tokens and top gaining tokens respectively.

### TokenListItem
Individual token display component showing icon, name, price, and percentage change.

### SectionHeader
Reusable header component with icon, title, and "View more" link.

### MiniChart
SVG-based mini chart component for displaying price trends.

## Design System

The components follow the design system defined in `design/Widgets.json`:

- **Colors**: Dark theme with specific accent colors for positive/negative changes
- **Typography**: Inter font family with monospace for prices
- **Spacing**: 4px base unit system
- **Layout**: Responsive grid system
- **Interactions**: Hover effects and transitions

## Usage

### Basic Widget
```tsx
import { Widget } from '@/components/widgets';

export default function TradingDashboard() {
  return (
    <div className="min-h-screen bg-black text-white p-6">
      <Widget />
    </div>
  );
}
```

### Interactive Demo
```tsx
import { WidgetDemo } from '@/components/widgets';

export default function DemoPage() {
  return <WidgetDemo />;
}
```

## Demo Features

The `WidgetDemo` component includes:

- **Live Data Simulation**: Toggle real-time data updates
- **Interactive Controls**: Start/stop live feeds and reset data
- **Component Stats**: Overview of widget metrics
- **Feature Documentation**: Built-in feature explanations
- **Sample Data Display**: JSON structure examples
- **Responsive Layout**: Works on all screen sizes

## Routes

- `/widgets` - Basic widget display
- `/demo` - Interactive demo with controls

## Features

- 📱 Responsive design
- 🎨 Design system compliance
- 🔄 Hover interactions
- 📊 SVG-based mini charts
- 💫 Smooth animations
- ♿ Accessibility considerations
- 🔴 Live data simulation
- 🎮 Interactive controls

## Data Structure

Components accept typed props based on interfaces defined in `types.ts`:

- `TokenData`: Individual token information
- `MarketData`: Market overview data
- `SectionData`: Section configuration
- `ChartData`: Chart display data

## Getting Started

1. Import the desired components from `@/components/widgets`
2. Use the `Widget` component for basic functionality
3. Use the `WidgetDemo` component for development and showcasing
4. Customize data using the mock data utilities
5. Style using the provided CSS modules or extend with Tailwind classes 