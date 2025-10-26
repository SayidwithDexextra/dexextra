# vAMM Wizard Component

A comprehensive, step-by-step wizard for creating virtual Automated Market Makers (vAMM) with a **production-ready implementation** integrated into the `/create-market` route.

## Features

- **4-Step Process**: Guided workflow for market creation
- **Real-time Validation**: Form validation on each step  
- **Clean Design**: Follows the minimal, professional design system
- **Fixed Footer Navigation**: Non-intrusive step progress at bottom of screen
- **Non-scrollable Layout**: Full viewport height with internal scrolling
- **Supabase Integration**: Saves market data to database
- **Responsive**: Mobile-friendly interface
- **Type Safety**: Full TypeScript support

## Production Implementation

### **Live at `/create-market`**
The wizard is now fully integrated into the main create-market route, replacing the previous form implementation.

### **Key Design Features**
- **Non-scrollable page**: Full viewport height (100vh) with overflow hidden
- **Fixed step footer**: Progress navigation stuck to bottom of screen
- **Internal scrolling**: Form content scrolls within the main container
- **Professional layout**: Left-aligned labels, right-aligned inputs (max 3 per step)

## Components Structure

```
src/components/VAMMWizard/
├── VAMMWizard.tsx              # Main wizard orchestrator  
├── FixedStepFooter.tsx         # Fixed bottom step navigation
├── types.ts                    # TypeScript definitions
├── validation.ts               # Form validation logic
├── VAMMWizard.module.css      # Styling with fixed footer support
├── steps/
│   ├── Step1MarketInfo.tsx     # Market information (3 fields)
│   ├── Step2OracleSetup.tsx    # Oracle configuration (3 fields)
│   ├── Step3MarketImages.tsx # Market image uploads (banner, icon, supporting photos)
│   └── Step4ReviewDeploy.tsx   # Review and deployment
└── README.md                   # This file
```

## Step-by-Step Breakdown

### Step 1: Market Information
- **Symbol**: Market identifier (left: label, right: input)
- **Description**: Detailed market description (textarea)
- **Category**: Market category selection (dropdown)

### Step 2: Oracle Configuration  
- **Oracle Address**: Price oracle with pre-configured options
- **Initial Price**: Starting market price
- **Price Decimals**: Decimal precision with live preview

### Step 3: Collateral Settings
- **Token Address**: ERC-20 collateral with common token shortcuts
- **Token Symbol**: Display symbol (auto-filled from selection)
- **Minimum Collateral**: Minimum amount with summary preview

### Step 4: Review & Deploy
- **Complete Review**: All configuration in organized sections
- **Deploy**: Creates market record in Supabase with loading states
- **Success/Error**: Comprehensive feedback with contract details

## Layout Architecture

### **Non-scrollable Design**
```css
/* Page level - no scroll */
html, body { overflow: hidden; height: 100vh; }

/* Container - full height */
.container { height: 100vh; display: flex; flex-direction: column; }

/* Content - internal scroll */
.formSection { flex: 1; overflow-y: auto; }

/* Footer - fixed bottom */
.fixedStepFooter { position: fixed; bottom: 0; }
```

### **Mobile Responsive**
- Stacks form fields vertically on mobile
- Footer reorganizes to vertical layout
- Maintains non-scrollable behavior across devices

## Usage

### Production Route
```tsx
// Integrated at /create-market
import { VAMMWizard } from '@/components/VAMMWizard';

<VAMMWizard 
  onComplete={(result) =>  console.log('Deployed:', result)}
  onCancel={() => router.push('/markets')}
/>
```

### Custom Implementation
```tsx
import { VAMMWizard, FixedStepFooter } from '@/components/VAMMWizard';

// Full control over layout
<>
  <div className="custom-container">
    <VAMMWizard onComplete={handleComplete} />
  </div>
  <FixedStepFooter 
    currentStep={step} 
    completedSteps={completed}
    onStepClick={handleStepClick}
  />
</>
```

## Design System Integration

**Exact match to ProductFormDesign.json:**
- **Colors**: Light background (#FAFAFA), dark text (#1A1A1A), muted helpers (#6B6B6B)
- **Typography**: 48px bold titles, 20px section headers, 16px body text  
- **Layout**: Left labels (200px), right inputs (flexible), 32px gap
- **Spacing**: 8px-based scale with generous 48px section gaps
- **Buttons**: Dark primary (#1A1A1A) with hover effects

## API Integration

### Supabase Schema
```sql
CREATE TABLE vamm_markets (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(10) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(50) NOT NULL,
  oracle_address VARCHAR(42) NOT NULL,
  initial_price DECIMAL NOT NULL,
  price_decimals INTEGER DEFAULT 8,
  collateral_token_address VARCHAR(42) NOT NULL,
  collateral_symbol VARCHAR(10) NOT NULL,
  minimum_collateral DECIMAL DEFAULT 0,
  deployment_fee DECIMAL DEFAULT 0.1,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  -- Contract deployment fields
  vamm_address VARCHAR(42),
  vault_address VARCHAR(42), 
  market_id VARCHAR(255),
  transaction_hash VARCHAR(66),
  deployment_status VARCHAR(20) DEFAULT 'pending'
);
```

### API Endpoints
- `POST /api/markets` - Create new vAMM market
- `GET /api/markets` - List markets with filtering

## Environment Variables
```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_key
```

## Features in Detail

### **Smart Form Interactions**
- **Auto-completion**: Token selection auto-fills symbols
- **Real-time previews**: Price calculations, collateral summaries
- **Progressive validation**: Validates each step before proceeding
- **Error recovery**: Clear error messages with field highlighting

### **Professional UX**
- **Fixed footer progress**: Always visible, non-intrusive step tracking
- **Smooth transitions**: 0.2s ease animations throughout
- **Loading states**: Comprehensive feedback during deployment
- **Responsive design**: Seamless mobile experience

### **Production Ready**
- **Database persistence**: All market data saved to Supabase
- **Error handling**: Comprehensive try-catch with user feedback
- **Type safety**: Full TypeScript with strict validation
- **Performance**: Optimized renders with useCallback

## Browser Support
- Modern browsers with CSS Grid support
- Mobile responsive (iOS Safari, Android Chrome)
- Tested viewport heights from 320px to 1920px+

## Accessibility
- Semantic HTML form structure
- Keyboard navigation support
- Screen reader friendly labels and descriptions
- Focus management between steps
- Error announcements 
lka