# ProductCard Component

A responsive and interactive product card component with modal integration for displaying digital products and templates.

## Features

- 🎨 **Modern Design** - Clean, minimal design with hover effects
- 📱 **Responsive** - Adapts to mobile, tablet, and desktop breakpoints  
- 🔗 **Modal Integration** - Seamless integration with MarketPreviewModal
- ⚡ **Interactive** - Hover effects, click handlers, and smooth transitions
- 🎯 **Accessible** - ARIA labels and keyboard navigation support

## Installation

The component is located in `src/components/ProductCard/` and includes:

```
ProductCard/
├── index.ts                     # Main export file
├── ProductCard.tsx              # Main component
├── ProductCard.module.css       # Styles
├── ProductCardDemo.tsx          # Demo component
├── types.ts                     # TypeScript definitions
└── README.md                    # Documentation
```

## Usage

### Basic Implementation

```tsx
import { ProductCard } from '@/components/ProductCard';

const MyComponent = () => {
  return (
    <ProductCard
      id="1"
      title="Premium Design Templates"
      subtitle="Professional templates for modern websites"
      author="Design Studio Pro"
      price={29}
      currency="USD"
      imageUrl="/product-image.jpg"
      imageAlt="Product preview"
    />
  );
};
```

### With Modal Integration

```tsx
import React, { useState } from 'react';
import { ProductCard, ProductCardData } from '@/components/ProductCard';
import { MarketPreviewModal } from '@/components/MarketPreviewModal';

const ProductGrid = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductCardData | null>(null);

  const handleViewMarket = (productData: ProductCardData) => {
    setSelectedProduct(productData);
    setIsModalOpen(true);
  };

  return (
    <>
      <ProductCard
        id="1"
        title="Premium Templates"
        author="Design Studio"
        price={29}
        currency="USD"
        imageUrl="/product.jpg"
        onViewMarket={handleViewMarket}
      />

      {selectedProduct && (
        <MarketPreviewModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          productTitle={selectedProduct.title}
          author={selectedProduct.author}
          price={selectedProduct.price}
          currency={selectedProduct.currency}
          description={selectedProduct.subtitle || 'Product description...'}
          category="Digital Product"
          templates={mockTemplates}
          onGoToProduct={() => {
            // Handle product navigation
            window.location.href = `/product/${selectedProduct.id}`;
          }}
        />
      )}
    </>
  );
};
```

## Props

### ProductCardProps

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `id` | `string` | ✅ | Unique product identifier |
| `title` | `string` | ✅ | Product title |
| `subtitle` | `string` | ❌ | Optional product subtitle |
| `author` | `string` | ✅ | Product author/creator |
| `price` | `number` | ✅ | Product price |
| `currency` | `string` | ❌ | Price currency (default: 'USD') |
| `imageUrl` | `string` | ✅ | Product image URL |
| `imageAlt` | `string` | ❌ | Image alt text |
| `href` | `string` | ❌ | Optional link URL |
| `onCardClick` | `(id: string) => void` | ❌ | Card click handler |
| `onActionClick` | `(id: string) => void` | ❌ | Action button click handler |
| `onViewMarket` | `(data: ProductCardData) => void` | ❌ | Market preview handler |
| `className` | `string` | ❌ | Additional CSS classes |

### ProductCardData

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `id` | `string` | ✅ | Unique identifier |
| `title` | `string` | ✅ | Product title |
| `subtitle` | `string` | ❌ | Product subtitle |
| `author` | `string` | ✅ | Author name |
| `price` | `number` | ✅ | Product price |
| `currency` | `string` | ❌ | Price currency |
| `imageUrl` | `string` | ✅ | Image URL |
| `imageAlt` | `string` | ❌ | Image alt text |
| `href` | `string` | ❌ | Link URL |

## Styling

The component uses CSS Modules for styling with the following design features:

### Visual Design
- **Card Layout**: Clean white background with rounded corners (16px)
- **Image Area**: 280px height with hover scale effect (1.05x)
- **Typography**: Hierarchical text sizing and weights
- **Color Scheme**: Neutral grays with coral accent (#FF8A65)

### Interactive States
- **Hover Effects**: Card lifts (-2px), image scales, button transforms
- **Transitions**: Smooth 0.3s ease transitions
- **Button States**: Background changes, color inversion on hover

### Responsive Behavior
- **Mobile**: Reduced image height (240px), adjusted padding
- **Tablet**: Maintained proportions with optimized spacing
- **Desktop**: Full-size layout with all hover effects

## Accessibility Features

- **ARIA Labels**: Proper button and image labeling
- **Keyboard Navigation**: Tab-accessible interactive elements
- **Screen Reader**: Semantic HTML structure
- **Focus States**: Visible focus indicators
- **Alt Text**: Configurable image descriptions

## Integration Examples

### Grid Layout

```tsx
<div className="product-grid">
  {products.map((product) => (
    <ProductCard
      key={product.id}
      {...product}
      onViewMarket={handleViewMarket}
    />
  ))}
</div>

<style jsx>{`
  .product-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 32px;
    max-width: 1200px;
    margin: 0 auto;
  }
`}</style>
```

### With Custom Handlers

```tsx
const handleProductAction = (id: string) => {
  // Custom logic for product actions
  analytics.track('product_viewed', { productId: id });
  router.push(`/product/${id}`);
};

<ProductCard
  id="product-1"
  title="Premium Template"
  author="Designer"
  price={49}
  currency="USD"
  imageUrl="/template.jpg"
  onActionClick={handleProductAction}
  onCardClick={(id) => console.log('Card clicked:', id)}
/>
```

## Demo Component

Use the included demo component to see all features:

```tsx
import { ProductCardDemo } from '@/components/ProductCard';

// In your page component
<ProductCardDemo />
```

The demo includes:
- Multiple product examples
- Modal integration showcase
- Responsive design demonstration
- Interactive feature examples 