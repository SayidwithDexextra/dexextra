# Hero Component

A sleek and minimal hero section component designed for NFT marketplace applications, featuring glass morphism effects, countdown timers, and responsive design.

## Features

- 🎨 **Glass Morphism Design** - Semi-transparent cards with backdrop blur effects
- ⏱️ **Live Countdown Timer** - Real-time countdown to mint start time
- ✅ **Verification Badge** - Visual indicator for verified creators
- 📊 **Stats Display** - Mint price, total items, and countdown in a clean grid
- 📱 **Responsive Design** - Optimized for all screen sizes
- ♿ **Accessible** - WCAG compliant with proper focus states
- 🎭 **Smooth Animations** - Subtle hover effects and transitions

## Usage

```tsx
import { Hero } from '@/components/Hero';
import type { HeroData } from '@/components/Hero';

const heroData: HeroData = {
  title: "DDUST by jiwa",
  author: "e66264",
  isVerified: true,
  stats: {
    mintPrice: "$50.77",
    totalItems: 500,
    mintStartsIn: "2024-12-31T23:59:59Z"
  },
  backgroundImage: "/path/to/hero-bg.jpg"
};

function App() {
  return (
    <Hero 
      data={heroData}
      onMintClick={() => console.log('Mint clicked')}
    />
  );
}
```

## Props

### HeroProps

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `data` | `HeroData` | ✅ | - | Hero content and configuration |
| `className` | `string` | ❌ | `""` | Additional CSS classes |
| `onMintClick` | `() => void` | ❌ | - | Callback when mint action is triggered |

### HeroData

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `title` | `string` | ✅ | - | Main hero title |
| `author` | `string` | ✅ | - | Creator/author name |
| `isVerified` | `boolean` | ❌ | `false` | Show verification badge |
| `stats` | `HeroStats` | ✅ | - | Statistics to display |
| `backgroundImage` | `string` | ❌ | - | Hero background image URL |

### HeroStats

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `mintPrice` | `string` | ✅ | Formatted price string (e.g., "$50.77") |
| `totalItems` | `number` | ✅ | Total number of items available |
| `mintStartsIn` | `string` | ✅ | ISO date string for countdown target |

## Design System

This component follows the design system defined in `design/Hero.json`:

### Colors
- **Background**: Dark theme with glass morphism (`rgba(0, 0, 0, 0.8)`)
- **Text**: White primary (`#FFFFFF`), gray secondary (`#B8B8B8`)
- **Accent**: Cyan verification (`#00D4FF`)

### Typography
- **Hero Title**: 2.5rem, 700 weight, tight letter spacing
- **Author**: 1rem, 400 weight, muted opacity
- **Stats**: 0.75rem labels, 1.125rem values

### Spacing
- **Base Unit**: 8px scale system
- **Card Padding**: 24px
- **Grid Gap**: 16px between stats

### Effects
- **Backdrop Blur**: 20px for glass morphism
- **Border Radius**: 16px for modern feel
- **Shadows**: Layered shadows for depth
- **Transitions**: 250ms ease-out for smooth interactions

## Examples

### Basic Hero
```tsx
<Hero data={{
  title: "Amazing NFT Collection",
  author: "artist123",
  stats: {
    mintPrice: "$25.00",
    totalItems: 1000,
    mintStartsIn: "2024-12-31T00:00:00Z"
  }
}} />
```

### With Background and Verification
```tsx
<Hero data={{
  title: "Verified Collection",
  author: "verified_artist",
  isVerified: true,
  stats: {
    mintPrice: "$100.00",
    totalItems: 250,
    mintStartsIn: "2024-12-25T12:00:00Z"
  },
  backgroundImage: "/hero-bg.jpg"
}} />
```

## Accessibility

- ✅ WCAG 2.1 AA compliant
- ✅ Keyboard navigation support
- ✅ Screen reader friendly
- ✅ High contrast ratios (4.5:1 minimum)
- ✅ Focus indicators for interactive elements

## Browser Support

- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+

## Dependencies

- React 18+
- CSS Modules support
- TypeScript (recommended)

## Performance

- 🚀 Lightweight (~5KB gzipped)
- ⚡ Optimized animations with GPU acceleration
- 🔄 Minimal re-renders with React.memo optimizations
- 📱 Mobile-first responsive design 