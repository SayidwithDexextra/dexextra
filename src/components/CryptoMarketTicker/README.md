# CryptoMarketTicker Component

A professional cryptocurrency market ticker component that displays live price data with seamless scrolling animation. Built using the design system extracted from `CryptomarketTicker.json` and integrated with the `tokenService.ts` for real-time data.

## Features

- 🔄 **Live Data**: Fetches real-time cryptocurrency prices from CoinGecko API
- ⚡ **Auto Updates**: Refreshes price data every 60 seconds automatically  
- 🎯 **Seamless Scrolling**: Infinite horizontal scroll with duplicate content
- 📱 **Responsive Design**: Adapts to mobile, tablet, and desktop breakpoints
- ♿ **Accessibility**: ARIA labels and reduced motion support
- 🎨 **Design System**: Follows exact specifications from design JSON
- 🎭 **Interactive**: Pause on hover functionality
- 🎛️ **Configurable**: Customizable speed and behavior

## Usage

### Basic Usage

```tsx
import { CryptoMarketTicker } from '@/components/CryptoMarketTicker'

function App() {
  return (
    <div>
      <CryptoMarketTicker />
    </div>
  )
}
```

### With Custom Configuration

```tsx
import { CryptoMarketTicker } from '@/components/CryptoMarketTicker'

function App() {
  return (
    <CryptoMarketTicker 
      speed={90}                // Custom scroll speed in px/s
      pauseOnHover={true}       // Enable/disable pause on hover
      className="my-ticker"     // Additional CSS classes
    />
  )
}
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `className` | `string` | `''` | Additional CSS classes to apply |
| `speed` | `number` | `60` | Scroll speed in pixels per second |
| `pauseOnHover` | `boolean` | `true` | Whether to pause animation on mouse hover |

## Design System Specifications

Based on `CryptomarketTicker.json`, the component implements:

### Colors
- **Background**: `#000000` (Pure black)
- **Text**: `#FFFFFF` (White)
- **Positive Change**: `#00C851` (Green)
- **Negative Change**: `#FF4444` (Red)
- **Muted Text**: `#CCCCCC` (Light gray)

### Typography
- **Font Family**: Monospace fonts for consistent alignment
- **Symbol Font Size**: 14px (weight: 600)
- **Price Font Size**: 14px (weight: 500)  
- **Change Font Size**: 13px (weight: 400)

### Layout & Spacing
- **Container Height**: 40px
- **Item Gap**: 32px (24px mobile, 28px tablet)
- **Internal Spacing**: 8px between elements
- **Padding**: 4px-8px for hover states

### Animation
- **Default Speed**: 60px/s
- **Direction**: Left-to-right scroll
- **Behavior**: Seamless infinite loop
- **Hover**: Pause animation (configurable)

## Data Source

The component fetches live data for these cryptocurrencies:

- **Major**: BTC, ETH, XRP, BNB, SOL, USDC, ADA, AVAX, DOGE, TRX
- **DeFi**: LINK, DOT, MATIC, UNI, AAVE, COMP, CRV, SUSHI  
- **Others**: LTC, BCH, NEAR, ATOM, FTM, ALGO, VET, ICP, FLOW
- **Gaming/NFT**: SAND, MANA, ENJ, CHZ
- **Infrastructure**: THETA, FIL, GRT

## Responsive Behavior

### Mobile (`max-width: 480px`)
- Font sizes reduced by ~15%
- Item gap: 24px
- Slower scroll speed (1.5x duration)

### Tablet (`481px - 768px`)
- Font sizes slightly reduced
- Item gap: 28px  
- Moderately slower scroll (1.2x duration)

### Desktop (`769px+`)
- Full font sizes and spacing
- Item gap: 32px
- Normal scroll speed

## Accessibility Features

- **ARIA Role**: `marquee` for screen readers
- **ARIA Label**: "Cryptocurrency market ticker"
- **Keyboard Navigation**: Proper tab indexing
- **Reduced Motion**: Respects `prefers-reduced-motion` setting
- **Fallback**: Static horizontal scroll for accessibility

## Integration with TokenService

The component uses `@/lib/tokenService.ts` for:

1. **Initial Data Load**: `fetchTokenPrices()`
2. **Periodic Updates**: `createTokenPriceUpdater()`
3. **Rate Limiting**: Built-in API call throttling
4. **Error Handling**: Graceful fallbacks for API failures

## Styling

The component uses CSS Modules with design system variables:

```css
.container {
  --ticker-bg: #000000;
  --ticker-text: #FFFFFF;
  --ticker-positive: #00C851;
  --ticker-negative: #FF4444;
  --ticker-speed: 60px;
  --ticker-gap: 32px;
}
```

## Demo

Visit `/crypto-ticker-demo` to see the component in action with different configurations and usage examples.

## Performance Considerations

- **Efficient Rendering**: Uses `will-change: transform` for smooth animations
- **Memory Management**: Cleanup functions prevent memory leaks
- **API Optimization**: Rate limiting and request batching
- **DOM Optimization**: Minimal re-renders with proper state management

## Browser Support

- ✅ **Modern Browsers**: Chrome, Firefox, Safari, Edge (latest)
- ✅ **Mobile Browsers**: iOS Safari, Chrome Mobile
- ✅ **CSS Grid/Flexbox**: Required for layout
- ✅ **CSS Custom Properties**: Required for theming
- ✅ **ES6+ Features**: Arrow functions, destructuring, etc.

## Contributing

When modifying this component:

1. Follow the design system specifications in `CryptomarketTicker.json`
2. Test responsive behavior across breakpoints
3. Verify accessibility with screen readers
4. Check performance with browser dev tools
5. Update this README for any API changes 