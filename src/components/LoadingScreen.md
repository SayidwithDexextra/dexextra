# LoadingScreen Component

A premium, logo-centric loading screen component featuring the Dex Extra brand logo with sophisticated animations. Perfect for creating a consistent brand experience across your decentralized trading platform.

## Demo

Visit `/loading-screen-demo` to see live examples and customize the component with all logo animation variants.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `message` | `string` | `"Loading..."` | Main loading message displayed to users |
| `subtitle` | `string` | `undefined` | Optional secondary message with additional context |
| `size` | `'small' \| 'default' \| 'large'` | `'default'` | Size of the logo and overall component |
| `fullScreen` | `boolean` | `true` | Whether to render as full screen or inline component |
| `backgroundColor` | `string` | `'#0a0a0a'` | Background color of the loading screen |
| `variant` | `'glow' \| 'orbit' \| 'pulse' \| 'breathe'` | `'glow'` | Logo animation style variant |

## Logo Animation Variants

### Glow (Default)
Multi-layer glowing rings around the Dex Extra logo with floating dots.
```tsx
<LoadingScreen variant="glow" />
```

### Orbit
Spinning rings with orbiting particles around the logo container.
```tsx
<LoadingScreen variant="orbit" />
```

### Pulse
Energy waves emanating from the logo with pulsing background layers.
```tsx
<LoadingScreen variant="pulse" />
```

### Breathe
Gentle scaling animation with subtle corner accents and breathing effects.
```tsx
<LoadingScreen variant="breathe" />
```

## Basic Usage

```tsx
import LoadingScreen from '@/components/LoadingScreen';

// Simple branded loading screen
<LoadingScreen />

// With custom message and variant
<LoadingScreen 
  message="Loading Dex Extra..."
  subtitle="Initializing decentralized trading platform"
  variant="glow"
/>

// Inline version for components
<LoadingScreen 
  message="Processing..."
  variant="pulse"
  fullScreen={false}
  size="small"
/>
```

## Brand-Focused Examples

### Main App Loading
```tsx
<LoadingScreen
  message="Loading Dex Extra..."
  subtitle="Initializing decentralized trading platform"
  size="large"
  variant="glow"
  backgroundColor="#0a0a0a"
/>
```

### Trading Interface
```tsx
<LoadingScreen
  message="Loading Trading Interface..."
  subtitle="Fetching market data, mark price, and available margin"
  size="large"
  variant="orbit"
  backgroundColor="#0f0f0f"
/>
```

### Transaction Processing
```tsx
<LoadingScreen
  message="Processing Transaction..."
  subtitle="Please wait while we process your request"
  size="default"
  variant="pulse"
  backgroundColor="#1a1a2e"
/>
```

### Network Connection
```tsx
<LoadingScreen
  message="Connecting to Network..."
  subtitle="Establishing secure connection to Polygon"
  size="large"
  variant="breathe"
  backgroundColor="#0f0f23"
/>
```

## Branding Features

### Logo-Centric Design
- **Dex Extra Logo**: Prominently displayed as the central element
- **Consistent Branding**: Maintains brand identity across all loading states
- **Professional Appearance**: Premium design suitable for financial applications
- **Responsive Scaling**: Logo scales appropriately with component size

### Modern Animations
- **Glow**: Multi-layer glowing rings with floating particles around logo
- **Orbit**: Dual spinning rings with orbiting particles and bordered logo container
- **Pulse**: Energy waves and pulsing backgrounds emanating from logo
- **Breathe**: Gentle scaling animations with subtle accent elements

### Visual Elements
- **Grid Pattern Background**: Subtle grid overlay for technical aesthetic
- **Gradient Overlays**: Multi-layer gradient animations
- **Progress Dots**: Bouncing dots indicating active loading
- **Fade-in Text**: Smooth text animations with staggered delays

## Customization

The component offers extensive customization while maintaining brand consistency:

- **Message & Subtitle**: Dynamic content for different loading contexts
- **Animation Variants**: 4 distinct logo-focused animations
- **Size Options**: Responsive sizing for different use cases
- **Background Colors**: Customizable backgrounds to match your design
- **Layout Modes**: Full-screen overlay or inline component

## Size Configurations

### Small (20x20 container, 12x12 logo)
- Perfect for inline loading states
- Compact design for micro-interactions
- Maintains logo visibility at small size

### Default (24x24 container, 16x16 logo)
- Ideal for modal dialogs and component loading
- Balanced size for most use cases
- Clear logo detail and readable text

### Large (32x32 container, 24x24 logo)
- Optimal for app splash screens and main loading
- Maximum brand impact and visibility
- Premium presentation for important loading states

## Brand Usage Guidelines

### Best Practices

1. **Variant Selection**:
   - `glow` for main app loading and splash screens
   - `orbit` for trading interface initialization
   - `pulse` for transaction processing and active operations
   - `breathe` for network connections and gentle transitions

2. **Size Recommendations**:
   - `large` for app splash screens and main loading
   - `default` for modal dialogs and component loading
   - `small` for inline loading states and micro-interactions

3. **Message Guidelines**:
   - Use "Loading Dex Extra..." for app initialization
   - Be specific about what's loading (e.g., "Loading Trading Interface...")
   - Keep subtitles informative but concise
   - Use present tense for better user experience

4. **Background Colors**:
   - Use dark backgrounds (#0a0a0a, #0f0f0f) for consistency
   - Match your app's color scheme
   - Ensure sufficient contrast for logo visibility

### Brand Consistency

- **Logo Prominence**: Always features the Dex Extra logo as the central element
- **Color Scheme**: Consistent purple/blue gradient theme
- **Typography**: Clean, modern text styling
- **Animation Style**: Sophisticated animations that reinforce brand quality

## Accessibility

- **High Contrast**: Logo and text maintain visibility against backgrounds
- **Clear Messaging**: Descriptive loading messages for screen readers
- **Responsive Design**: Scales appropriately across devices
- **Animation Considerations**: Consider adding `prefers-reduced-motion` support
- **Brand Recognition**: Consistent logo placement aids user recognition

## Browser Support

- **Modern Browsers**: Chrome, Firefox, Safari, Edge
- **CSS Features**: Advanced gradients, transforms, and animations
- **SVG Support**: Vector logo ensures crisp display at all sizes
- **Responsive**: Optimized for mobile and desktop

## Migration from Previous Version

The logo-centric LoadingScreen includes significant changes:

1. **Logo Integration**: Dex Extra logo is now the central design element
2. **New Variants**: Updated animation variants (`glow`, `orbit`, `pulse`, `breathe`)
3. **Brand Focus**: Design emphasizes brand consistency and recognition
4. **Enhanced Animations**: More sophisticated animations around logo

Update your existing implementations:
```tsx
// Previous version
<LoadingScreen size="large" variant="orbit" />

// New logo-centric version  
<LoadingScreen size="large" variant="glow" message="Loading Dex Extra..." />
```

## Technical Implementation

The component uses:
- **SVG Logo**: Scalable vector graphics for crisp logo display
- **CSS-in-JS**: Embedded styles for custom animations
- **React Hooks**: Efficient rendering and state management
- **TypeScript**: Full type safety and IntelliSense support 