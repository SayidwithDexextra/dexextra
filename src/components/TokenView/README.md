# TokenView Components - Crypto Dashboard

This folder contains all the components that make up a comprehensive crypto token dashboard, designed to match professional DEX/trading interface layouts with exact spacing and theming.

## 🧱 Layout Structure

The dashboard follows a 2-column main layout:
- **Left Column**: ~65% width (Chart + Transaction Table)
- **Right Column**: ~35% width (Token Info + Thread + Trade Panel)
- **Responsive**: `grid-cols-1 md:grid-cols-2` with proper gap spacing
- **Background**: Deep black (`bg-black`) with white text

## Components

### 🔍 **Chart Panel Components**

#### TradingViewWidget (Chart Section - Top Left)
- **Height**: `h-[500px]` on desktop, `h-[400px]` on mobile  
- **Padding**: Edge-to-edge TradingView integration (no internal padding)
- **Margin**: `mb-4` bottom spacing
- **Features**: Professional TradingView chart with real-time data
- **Styling**: Deep black background (`#0d0d0d`), subtle widget controls with `gap-2`

#### TokenChart (Alternative Chart)
- **Alternative**: SVG-based chart with multiple timeframe options
- **Features**: Mock data generation, gradient fills, responsive design
- **Use Case**: When TradingView integration isn't needed

### 📊 **Transaction Table (Bottom Left)**

#### TransactionTable
- **Margin**: `mt-4` from chart
- **Container**: `rounded-md bg-zinc-900 p-3`
- **Table**: `text-sm` with proper `px-3 py-2` cell padding
- **Features**: 
  - Overflow-x scroll on mobile (`overflow-x-auto`)
  - Color-coded buy/sell indicators
  - Hover effects and proper spacing
- **Data**: Recent transactions with type, amount, price, time, user

### 🐶 **Token Info Panel (Top Right)**

#### TokenInfoPanel
- **Avatar**: `w-12 h-12 rounded-full border-2 border-yellow-400`
- **Title**: `text-lg font-semibold` with `mt-2 mb-1` spacing
- **Stats Grid**: `grid grid-cols-2 gap-2 mt-4`
- **Colors**: Green for gains (`text-green-400`), Red for losses (`text-red-500`)
- **Features**: Market cap, volume, supply, holders with proper formatting

### 💬 **Thread Panel (Community Chat)**

#### ThreadPanel
- **Chat List**: `max-h-[150px] overflow-y-auto` scrollable messages
- **Messages**: `py-1 px-2 rounded bg-zinc-800 mb-1` styling
- **Input**: `rounded px-3 py-2 bg-zinc-900 w-full` with focus states
- **Features**: 
  - Real-time chat simulation
  - Online user count
  - Send message functionality

### 💵 **Trade Panel (Buy/Sell Box)**

#### TradingPanel
- **Container**: `p-4` padding with `bg-zinc-900`
- **Buttons**: `px-2 py-1 rounded-md bg-zinc-700` for trade type selection
- **Input**: Proper styling with token integration
- **Auto-approve**: Toggle switch with `flex justify-between items-center mt-2`
- **CTA Button**: `bg-green-500 hover:bg-green-600 text-black font-semibold rounded-xl px-4 py-2 mt-4 w-full`

### 📈 **Additional Components**

#### TokenStats
- **Grid Layout**: Token statistics with responsive grid
- **Formatting**: Large numbers with M/B suffixes
- **Colors**: Positive/negative value indicators

## 🎯 Responsive Behavior

```tsx
// Main layout structure
<div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 md:gap-x-6">
  {/* Left Column */}
  <div className="space-y-4">
    <TradingViewWidget />
    <TransactionTable />
  </div>
  
  {/* Right Column */}
  <div className="space-y-4">
    <TokenInfoPanel tokenData={tokenData} />
    <ThreadPanel />
    <TradingPanel tokenData={tokenData} />
  </div>
</div>
```

## 🎨 Styling Standards

- **Font**: Inter, sans-serif
- **Spacing**: `space-x-4`, `space-y-4`, `p-4`, `gap-2`/`gap-4`
- **Border Radius**: `rounded-lg`, `rounded-xl` for cards
- **Colors**: 
  - Background: `bg-black`, `bg-zinc-900`, `bg-zinc-800`
  - Text: `text-white`, `text-zinc-400`, `text-zinc-300`
  - Accents: `text-green-400`, `text-red-500`, `text-yellow-400`
- **Interactive**: Hover states, focus rings, transitions

## Usage

```tsx
import { 
  TradingViewWidget, 
  TransactionTable, 
  TokenInfoPanel, 
  ThreadPanel, 
  TradingPanel 
} from '@/components/TokenView';

// Dashboard Layout
<div className="min-h-screen bg-black text-white px-4 md:px-8 lg:px-12 py-4 md:py-6">
  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 md:gap-x-6">
    {/* Left: Chart + Transactions */}
    <div>
      <TradingViewWidget symbol="CRYPTO:BTCUSD" />
      <TransactionTable />
    </div>
    
    {/* Right: Token Info + Community + Trading */}
    <div className="space-y-4">
      <TokenInfoPanel tokenData={tokenData} />
      <ThreadPanel />
      <TradingPanel tokenData={tokenData} />
    </div>
  </div>
</div>
```

## Props

- **TradingViewWidget**: `symbol`, `height`, `theme` configuration
- **TokenInfoPanel & TradingPanel**: Require `TokenData` from `@/types/token`
- **TransactionTable & ThreadPanel**: Optional data arrays, fallback to mock data

## Dependencies

- React + Next.js
- TailwindCSS with custom zinc color palette
- TypeScript for type safety
- TradingView widget integration 