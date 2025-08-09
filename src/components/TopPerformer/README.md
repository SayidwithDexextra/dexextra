# TopPerformer Component

A sleek, modern carousel component for displaying top performer profiles with a dark theme design. Built with React and TypeScript, featuring smooth animations, responsive design, and accessibility support.

## Features

- 🎨 **Dark Theme Design**: Beautiful dark theme with carefully crafted colors and typography
- 🎠 **Smooth Carousel**: Auto-playing carousel with infinite scroll support
- 🔄 **Dual Carousel**: Two independent carousels moving in opposite directions
- 🌫️ **Gradient Fade Effects**: Elegant shadow transitions on both ends for seamless appearance
- 📱 **Responsive**: Adapts to different screen sizes seamlessly
- ♿ **Accessible**: Full keyboard navigation and screen reader support
- 🎯 **Interactive**: Hover effects and click handling - hover to pause!
- ⚡ **Performant**: Optimized animations and efficient rendering

## Components

### TopPerformerCarousel

The main carousel component that displays multiple performer cards with navigation controls.

### TopPerformerDualCarousel

A dual carousel component that displays two independent carousels moving in opposite directions. Perfect for creating dynamic, eye-catching displays.

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `performers` | `TopPerformerData[]` | **required** | Array of performer data |
| `autoPlay` | `boolean` | `true` | Enable auto-play functionality |
| `autoPlayInterval` | `number` | `3000` | Auto-play interval in milliseconds |
| `showArrows` | `boolean` | `true` | Show navigation arrows |
| `showDots` | `boolean` | `false` | Show dot indicators |
| `slidesToShow` | `number` | `4` | Number of slides visible at once |
| `slidesToScroll` | `number` | `1` | Number of slides to scroll at once |
| `infinite` | `boolean` | `true` | Enable infinite scrolling |
| `speed` | `number` | `500` | Animation speed in milliseconds |
| `className` | `string` | `''` | Additional CSS classes |

#### TopPerformerDualCarousel Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `performers` | `TopPerformerData[]` | **required** | Array of performer data |
| `autoPlay` | `boolean` | `true` | Enable auto-play functionality |
| `autoPlayInterval` | `number` | `3000` | Auto-play interval in milliseconds |
| `speed` | `number` | `500` | Animation speed in milliseconds |
| `className` | `string` | `''` | Additional CSS classes |
| `showArrows` | `boolean` | `false` | Show navigation arrows (disabled by default) |

### TopPerformerCard

Individual performer card component.

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `performer` | `TopPerformerData` | **required** | Performer data object |
| `onClick` | `(performer: TopPerformerData) => void` | `undefined` | Click handler |

### TopPerformerData Interface

```typescript
interface TopPerformerData {
  id: string;           // Unique identifier
  name: string;         // Performer name
  role: string;         // Performer role/title
  description?: string; // Optional description
  avatarUrl: string;    // Avatar image URL
  profileUrl?: string;  // Optional profile link
}
```

## Usage

### Basic Usage

```tsx
import { TopPerformerCarousel, TopPerformerData } from '@/components/TopPerformer';

const performers: TopPerformerData[] = [
  {
    id: '1',
    name: 'Alex neuski',
    role: 'Designer',
    description: 'UI/UX specialist',
    avatarUrl: '/avatars/alex.jpg',
    profileUrl: '/profile/alex'
  },
  // ... more performers
];

function MyComponent() {
  return (
    <TopPerformerCarousel 
      performers={performers}
      autoPlay={true}
      showArrows={true}
    />
  );
}
```

### Advanced Usage

```tsx
import { TopPerformerCarousel } from '@/components/TopPerformer';

function AdvancedExample() {
  const handlePerformerClick = (performer: TopPerformerData) => {
    // Custom click handling
     console.log('Performer clicked:', performer);
  };

  return (
    <TopPerformerCarousel 
      performers={performers}
      autoPlay={false}
      showArrows={true}
      showDots={true}
      slidesToShow={3}
      slidesToScroll={2}
      infinite={false}
      speed={800}
      className="custom-carousel"
    />
  );
}
```

### Dual Carousel Usage

```tsx
import { TopPerformerDualCarousel, TopPerformerData } from '@/components/TopPerformer';

function DualCarouselExample() {
  const performers: TopPerformerData[] = [
    // ... your performer data
  ];

  return (
    <TopPerformerDualCarousel 
      performers={performers}
      autoPlay={true}
      speed={500}
    />
  );
}
```

### Demo Components

Use the demo components to see the carousels in action:

```tsx
import { TopPerformerDemo, TopPerformerDualDemo } from '@/components/TopPerformer';

function DemoPage() {
  return (
    <div>
      <TopPerformerDemo />
      <TopPerformerDualDemo />
    </div>
  );
}
```

## Styling

The component uses CSS modules for styling. The design system is based on the `TopPerformer.json` specification with the following key features:

- **Colors**: Dark theme with `#000000` background, `#1a1a1a` card backgrounds
- **Typography**: System font stack with three-tier hierarchy
- **Spacing**: Consistent 20px grid system with larger card dimensions
- **Animations**: Smooth 0.2s ease-in-out transitions with slower carousel movement
- **Gradient Effects**: Elegant fade transitions using CSS pseudo-elements
- **Responsive**: Mobile-first design with breakpoints

### Custom Styling

You can customize the appearance by:

1. **CSS Classes**: Use the `className` prop to add custom classes
2. **CSS Variables**: Override component CSS variables
3. **Theme Overrides**: Modify the CSS module directly

## Accessibility

The component includes comprehensive accessibility features:

- **Keyboard Navigation**: Arrow keys for navigation
- **Screen Reader Support**: Proper ARIA labels and roles
- **Focus Management**: Visible focus indicators
- **Semantic HTML**: Proper heading hierarchy and button elements

## Performance

- **Optimized Rendering**: Efficient re-renders with proper memoization
- **Smooth Animations**: Hardware-accelerated CSS transforms
- **Lazy Loading**: Avatar images with error fallbacks
- **Memory Management**: Proper cleanup of intervals and event listeners

## Browser Support

- Chrome 88+
- Firefox 85+
- Safari 14+
- Edge 88+

## Dependencies

- React 18+
- TypeScript 4.5+

## Contributing

When contributing to this component:

1. Follow the existing code style
2. Add proper TypeScript types
3. Include accessibility features
4. Test across different screen sizes
5. Update documentation as needed

## License

This component follows the same license as the parent project. 