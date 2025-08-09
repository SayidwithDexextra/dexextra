# CountdownTicker Component

A responsive countdown timer component built with the Settlement Design System. Features a sleek dark theme with clean typography and structured layout.

## Features

- ⏱️ **Real-time countdown** - Updates every second
- 🎨 **Design System Integration** - Built with Settlement design tokens
- 📱 **Responsive** - Adapts to mobile, tablet, and desktop
- 🎯 **Flexible Layout** - Banner or standalone modes
- 🎪 **Completion Callbacks** - Execute functions when countdown ends
- ♿ **Accessible** - Semantic HTML and proper ARIA attributes
- 🎨 **Customizable** - Accept custom CSS classes

## Installation

```bash
# The component is already included in this project
# Import from the components directory
```

## Usage

### Basic Usage

```tsx
import { CountdownTicker } from '@/components/CountdownTicker';

function MyComponent() {
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + 7); // 7 days from now

  return (
    <CountdownTicker
      targetDate={targetDate}
      title="Launch Sale"
      subtitle="Get 25% off with the code 'launch2023' for a limited time!"
      onComplete={() => alert('Sale started!')}
    />
  );
}
```

### Standalone Mode

```tsx
<CountdownTicker
  targetDate={new Date(Date.now() + 24 * 60 * 60 * 1000)} // 24 hours from now
  showBanner={false}
  onComplete={() =>  console.log('Time up!')}
/>
```

### Custom Styling

```tsx
<CountdownTicker
  targetDate={targetDate}
  title="Special Event"
  subtitle="Join us for an exclusive preview!"
  className="my-custom-countdown"
  onComplete={() => handleEventStart()}
/>
```

## Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `targetDate` | `Date \| string` | ✅ | - | Target date to count down to |
| `title` | `string` | ❌ | - | Optional title to display |
| `subtitle` | `string` | ❌ | - | Optional subtitle to display |
| `onComplete` | `() => void` | ❌ | - | Callback when countdown reaches zero |
| `className` | `string` | ❌ | - | Custom CSS class name |
| `showBanner` | `boolean` | ❌ | `true` | Whether to show the banner layout or just the ticker |

## Design System Integration

This component uses the Settlement Design System with the following tokens:

### Colors
- Background: `#1a1a1a` (primary.background)
- Text Primary: `#ffffff` (text.primary)
- Text Secondary: `#e0e0e0` (text.secondary)
- Text Muted: `#a0a0a0` (text.muted)

### Typography
- Hero: `48px / 700` (fontSizes.hero / fontWeights.bold)
- Subtitle: `16px / 400` (fontSizes.subtitle / fontWeights.regular)
- Countdown Number: `40px / 700` (fontSizes.countdownNumber / fontWeights.bold)
- Countdown Label: `14px / 400` (fontSizes.countdownLabel / fontWeights.regular)

### Spacing
- Container padding: `32px` (spacing.xl)
- Countdown gap: `32px` (spacing.xl)
- Component margins: `8px` (spacing.md)

## Responsive Behavior

### Mobile (< 768px)
- Stacked layout (flex-direction: column)
- Smaller countdown numbers (32px)
- Reduced spacing (16px gaps)
- Centered alignment

### Tablet (768px - 1024px)
- Horizontal layout maintained
- Medium countdown numbers (36px)
- Balanced spacing (24px gaps)

### Desktop (> 1024px)
- Full horizontal layout
- Large countdown numbers (40px)
- Maximum spacing (32px gaps)

## Examples

### Launch Sale Banner
```tsx
<CountdownTicker
  targetDate={new Date('2024-12-25T00:00:00')}
  title="Holiday Sale"
  subtitle="Up to 50% off selected items!"
  onComplete={() => startSale()}
/>
```

### Event Countdown
```tsx
<CountdownTicker
  targetDate={new Date('2024-06-15T19:00:00')}
  title="Live Webinar"
  subtitle="Join us for an exclusive tech talk"
  onComplete={() => redirectToWebinar()}
/>
```

### Simple Timer
```tsx
<CountdownTicker
  targetDate={new Date(Date.now() + 60 * 60 * 1000)} // 1 hour from now
  showBanner={false}
  onComplete={() => showNotification()}
/>
```

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## Accessibility

- Semantic HTML structure
- Proper heading hierarchy
- Color contrast compliance (WCAG AA)
- Keyboard navigation support
- Screen reader friendly

## Performance

- Efficient timer updates (1-second intervals)
- Automatic cleanup on unmount
- Memoized calculations
- Minimal re-renders

## Contributing

1. Follow the existing code style
2. Update tests if needed
3. Update documentation for new features
4. Ensure responsive design works across breakpoints 