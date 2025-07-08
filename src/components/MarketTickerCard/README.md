# MarketTickerCard Component

A sleek, modern card component for displaying market items, products, or digital assets with a dark theme design system.

## Features

- 🎨 **Dark Theme Design**: Matches the sleek aesthetic from the design system
- 📱 **Responsive Layout**: Adapts to different screen sizes with CSS Grid
- ⚡ **Performance Optimized**: Uses Next.js Image component for optimal loading
- 🎯 **Interactive States**: Hover effects and button interactions
- 🔧 **TypeScript Support**: Fully typed for better development experience
- 🎪 **Flexible Layout**: Container component for multiple cards

## Components

### MarketTickerCard

Individual card component for displaying a single market item.

#### Props

```typescript
interface MarketTickerCardProps {
  id: string;                    // Unique identifier
  title: string;                 // Card title
  categories: string[];          // Array of category tags
  price: number;                 // Price value
  currency?: string;             // Currency symbol (default: '$')
  imageUrl?: string;             // Optional image URL
  imageAlt?: string;             // Alt text for image
  onViewProduct?: () => void;    // Product view callback
  onViewDemo?: () => void;       // Demo view callback
  className?: string;            // Additional CSS classes
  isDisabled?: boolean;          // Disabled state
}
```

### MarketTickerCardContainer

Container component for displaying multiple cards in a responsive grid.

#### Props

```typescript
interface MarketTickerCardContainerProps {
  title?: string;                           // Section title (default: 'Latest Drops')
  cards: MarketTickerCardData[];            // Array of card data
  onCardViewProduct?: (cardId: string) => void; // Product view callback
  onCardViewDemo?: (cardId: string) => void;    // Demo view callback
  className?: string;                       // Additional CSS classes
}
```

## Usage

### Basic Example

```tsx
import { MarketTickerCard } from '@/components/MarketTickerCard';

const ExampleCard = () => {
  return (
    <MarketTickerCard
      id="1"
      title="iPad Pro 05 Standard Mockup"
      categories={['Mockups', 'Photoshop']}
      price={19}
      currency="$"
      imageUrl="/path/to/image.jpg"
      onViewProduct={() => console.log('Product clicked')}
      onViewDemo={() => console.log('Demo clicked')}
    />
  );
};
```

### Container Example

```tsx
import { MarketTickerCardContainer } from '@/components/MarketTickerCard';

const cardData = [
  {
    id: '1',
    title: 'iPad Pro 05 Standard Mockup',
    categories: ['Mockups', 'Photoshop'],
    price: 19,
    currency: '$',
    imageUrl: '/path/to/image.jpg',
    imageAlt: 'iPad Pro mockup',
  },
  // ... more cards
];

const ExampleContainer = () => {
  return (
    <MarketTickerCardContainer
      title="Latest Drops"
      cards={cardData}
      onCardViewProduct={(id) => console.log('Product:', id)}
      onCardViewDemo={(id) => console.log('Demo:', id)}
    />
  );
};
```

## Design System

The component implements the design system from `MarketTickers.json`:

- **Colors**: Dark theme with subtle borders and shadows
- **Typography**: System fonts with proper hierarchy
- **Spacing**: 8px scale with consistent padding/margins
- **Animations**: Smooth hover effects and transitions
- **Layout**: Responsive grid system

## Responsive Behavior

- **Mobile (≤768px)**: Single column layout
- **Tablet (769px-1024px)**: Two column layout
- **Desktop (≥1025px)**: Three column layout

## Customization

You can customize the appearance by:

1. **Passing custom className**: Override specific styles
2. **Modifying CSS variables**: Update the design tokens
3. **Extending the component**: Create wrapper components with additional functionality

## Dependencies

- React 18+
- Next.js 13+ (for Image component)
- CSS Modules support 