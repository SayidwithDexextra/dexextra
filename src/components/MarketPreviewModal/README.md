# MarketPreviewModal Component

A comprehensive modal component for displaying product previews with smooth slide-up animation from the bottom of the screen. Built using the PreviewMarket design system.

## Features

- 🎬 **Smooth Slide Animation** - Slides up from bottom with smooth cubic-bezier transitions
- 🎨 **Design System Integration** - Uses PreviewMarket.json design tokens for consistency
- 📱 **Responsive Design** - Adapts to mobile, tablet, and desktop breakpoints
- ♿ **Accessibility** - Full ARIA support, keyboard navigation, and focus management
- 🖼️ **3D Preview Cards** - Stacked template previews with perspective transforms
- 🎯 **Interactive Elements** - Hover states, button animations, and smooth transitions
- 🔒 **Body Scroll Lock** - Prevents background scrolling when modal is open

## Installation

The component is located in `src/components/MarketPreviewModal/` and includes:

```
MarketPreviewModal/
├── index.ts                     # Main export file
├── MarketPreviewModal.tsx       # Main component
├── MarketPreviewModal.module.css # Styles
├── MarketPreviewModalDemo.tsx   # Demo component
├── types.ts                     # TypeScript definitions
└── README.md                    # Documentation
```

## Usage

### Basic Implementation

```tsx
import { MarketPreviewModal } from '@/components/MarketPreviewModal';

const MyComponent = () => {
  const [isOpen, setIsOpen] = useState(false);

  const templates = [
    {
      id: '1',
      title: 'Portfolio Template',
      image: '/templates/portfolio.jpg',
      category: 'Portfolio'
    },
    // ... more templates
  ];

  return (
    <>
      <button onClick={() => setIsOpen(true)}>
        Show Preview
      </button>

      <MarketPreviewModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        productTitle="Unlimited Access • Framer Template Bundle"
        author="Bryn Taylor"
        price={249}
        currency="$"
        description="Get unlimited access to all templates..."
        category="Digital Product"
        templates={templates}
        onGoToProduct={() => console.log('Navigate to product')}
      />
    </>
  );
};
```

### Demo Component

Use the included demo component to see the modal in action:

```tsx
import { MarketPreviewModalDemo } from '@/components/MarketPreviewModal/MarketPreviewModalDemo';

// In your page component
<MarketPreviewModalDemo />
```

### Integration with ProductCard

For seamless integration with ProductCard components, use the `onViewMarket` callback:

```tsx
import React, { useState } from 'react';
import ProductCard, { ProductCardData } from '@/components/ProductCard';
import { MarketPreviewModal } from '@/components/MarketPreviewModal';

function ProductGrid() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductCardData | null>(null);

  const handleViewMarket = (productData: ProductCardData) => {
    setSelectedProduct(productData);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedProduct(null);
  };

  const mockTemplates = [
    { id: '1', title: 'Template 1', image: null },
    { id: '2', title: 'Template 2', image: null },
    // ... more templates
  ];

  return (
    <>
      <ProductCard
        id="1"
        title="Premium Design Templates"
        author="Design Studio Pro"
        price={29}
        currency="USD"
        imageUrl="/product-image.jpg"
        onViewMarket={handleViewMarket}
      />

      {selectedProduct && (
        <MarketPreviewModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          productTitle={selectedProduct.title}
          author={selectedProduct.author}
          price={selectedProduct.price}
          currency={selectedProduct.currency}
          description={selectedProduct.subtitle || 'Product description...'}
          category="Digital Product"
          templates={mockTemplates}
          onGoToProduct={() => {
            // Navigate to product page
            window.location.href = `/product/${selectedProduct.id}`;
            handleCloseModal();
          }}
        />
      )}
    </>
  );
}
```

## Props

### MarketPreviewModalProps

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `isOpen` | `boolean` | ✅ | Controls modal visibility |
| `onClose` | `() => void` | ✅ | Callback when modal closes |
| `productTitle` | `string` | ✅ | Main product title |
| `author` | `string` | ✅ | Product author/creator |
| `price` | `number` | ✅ | Product price |
| `currency` | `string` | ❌ | Price currency (default: '$') |
| `description` | `string` | ✅ | Product description |
| `category` | `string` | ❌ | Product category badge |
| `templates` | `PreviewTemplate[]` | ✅ | Array of template previews |
| `onGoToProduct` | `() => void` | ✅ | CTA button callback |

### PreviewTemplate

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `id` | `string` | ✅ | Unique template identifier |
| `title` | `string` | ✅ | Template title |
| `image` | `string` | ❌ | Template preview image URL |
| `category` | `string` | ❌ | Template category |

## Design System Integration

The component uses design tokens from `PreviewMarket.json`:

### Colors
- **Primary**: `#FF8A65` (coral button color)
- **Text**: `#1A1A1A` (primary text)
- **Secondary Text**: `#666666` (descriptions, meta)
- **Background**: `#FFFFFF` (modal background)

### Typography
- **Hero Text**: 48px, bold (product title)
- **Body Text**: 16px, regular (descriptions)
- **Caption**: 14px, regular (author, meta)

### Spacing
- **Base Unit**: 8px grid system
- **Section Padding**: 32px-64px
- **Component Gaps**: 16px-48px

### Effects
- **Border Radius**: 8px-24px scale
- **Shadows**: Layered depth shadows
- **Animations**: Smooth cubic-bezier transitions

## Animation Details

### Slide-Up Animation
- **Duration**: 300ms
- **Easing**: `cubic-bezier(0.4, 0, 0.2, 1)`
- **Transform**: `translateY(100%)` → `translateY(0)`

### Preview Cards
- **3D Perspective**: `perspective(1000px)`
- **Rotation**: Various Y-axis rotations (-5deg to 5deg)
- **Stacking**: Z-index layering for depth

### Interactive States
- **Button Hover**: Color change + `translateY(-1px)`
- **Card Hover**: Scale transform + border highlight
- **Backdrop**: Opacity fade in/out

## Accessibility Features

- **ARIA Labels**: Proper modal labeling
- **Keyboard Support**: ESC key to close
- **Focus Management**: Traps focus within modal
- **Screen Reader**: Semantic HTML structure
- **Color Contrast**: WCAG compliant color ratios

## Responsive Behavior

### Mobile (< 768px)
- Single column layout
- Reduced font sizes
- Smaller preview cards
- Touch-optimized spacing

### Tablet (768px - 1024px)
- Maintained two-column layout
- Adjusted spacing
- Optimized touch targets

### Desktop (> 1024px)
- Full two-column layout
- Maximum spacing
- Hover interactions

## Customization

### CSS Custom Properties

You can override design tokens by providing CSS custom properties:

```css
.customModal {
  --primary-color: #your-color;
  --text-color: #your-text-color;
  --border-radius: 12px;
}
```

### Extending Styles

```tsx
import styles from './CustomModal.module.css';

<MarketPreviewModal
  // ... props
  className={styles.customModal}
/>
```

## Performance Considerations

- **Lazy Loading**: Modal only renders when `isOpen` is true
- **Animation Optimization**: Uses transform properties for GPU acceleration
- **Image Loading**: Supports lazy loading for template images
- **Memory Management**: Proper cleanup of event listeners

## Browser Support

- Chrome 60+
- Firefox 60+
- Safari 12+
- Edge 79+

## Dependencies

- React 18+
- CSS Modules support
- TypeScript (optional but recommended)

## Related Components

- `ProductCard` - For grid layouts
- `Button` - Standalone button component
- `Hero` - Landing page hero sections

## Contributing

When contributing to this component:

1. Follow the design system tokens
2. Maintain accessibility standards
3. Test across all breakpoints
4. Update TypeScript definitions
5. Add comprehensive tests 