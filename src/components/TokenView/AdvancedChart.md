# TradingView Charting Components

The charting UI has been rebuilt around the TradingView Charting Library using a single component:

- `TradingViewChart` for all layouts (desktop and mobile)

## Features

✅ **Custom Market Support**: Works with any user-created vAMM market symbol  
✅ **Real-time Data**: Live price updates via Pusher WebSocket integration  
✅ **Full TradingView Features**: Complete charting library with indicators and drawings  
✅ **Symbol Search**: Search and switch between custom markets within the chart  
✅ **Multiple Timeframes**: From 1-minute to monthly intervals  
✅ **Dark/Light Themes**: Customizable appearance  
✅ **Mobile Responsive**: Works on all screen sizes  

## Quick Start

### 1. Basic Usage

```tsx
import { TradingViewChart } from '@/components/TradingView';

function MyChartComponent() {
  return (
    <TradingViewChart symbol="MYGOLD" interval="15" theme="dark" height={600} />
  );
}
```

### 2. Advanced Configuration

```tsx
<TradingViewChart
  symbol="MYBTC"
  interval="1D"
  theme="dark"
  height={700}
  autosize={false}
  allowSymbolChange={true}
  hideTopToolbar={false}
  hideSideToolbar={false}
  hideVolumePanel={false}
  studies={['Volume@tv-basicstudies', 'RSI@tv-basicstudies', 'MACD@tv-basicstudies']}
  drawingsAccess={true}
  savingEnabled={false}
  onSymbolChange={(symbol) => console.log('Changed to:', symbol)}
  onIntervalChange={(interval) => console.log('New interval:', interval)}
/>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `symbol` | `string` | Required | Your custom vAMM market symbol |
| `interval` | `string` | `"15"` | Chart timeframe (1, 5, 15, 30, 60, 240, 1D, 1W, 1M) |
| `theme` | `'light' \| 'dark'` | `"dark"` | Chart color theme |
| `height` | `number` | `600` | Chart height in pixels |
| `width` | `number` | `undefined` | Chart width (optional) |
| `autosize` | `boolean` | `true` | Auto-resize to container |
| `allowSymbolChange` | `boolean` | `true` | Enable symbol search in chart |
| `hideTopToolbar` | `boolean` | `false` | Hide top toolbar |
| `hideSideToolbar` | `boolean` | `false` | Hide drawing tools |
| `hideVolumePanel` | `boolean` | `false` | Hide volume indicator |
| `studies` | `string[]` | `[]` | Default technical indicators |
| `drawingsAccess` | `boolean` | `true` | Enable drawing tools |
| `savingEnabled` | `boolean` | `false` | Enable chart settings persistence |
| `onSymbolChange` | `(symbol: string) => void` | `undefined` | Symbol change callback |
| `onIntervalChange` | `(interval: string) => void` | `undefined` | Interval change callback |

## Prerequisites

### 1. TradingView Library Setup

The TradingView charting library is required but not included. You need to:

1. **Host Library Locally**
   ```bash
   # Download TradingView library and place in public/charting_library/
   # Required files:
   # public/charting_library/charting_library.min.js
   # public/charting_library/
   # Contact TradingView for library access
   ```

### 2. Environment Variables

```env
# Supabase (for market data)
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_key

# Pusher (for real-time updates)
NEXT_PUBLIC_PUSHER_KEY=your_pusher_key
NEXT_PUBLIC_PUSHER_CLUSTER=us2

# ClickHouse (for historical data)
CLICKHOUSE_HOST=your_clickhouse_host
CLICKHOUSE_PASSWORD=your_password
```

### 3. Database Schema

Your `vamm_markets` table should include:
```sql
CREATE TABLE vamm_markets (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(50) NOT NULL,
  description TEXT,
  category TEXT[],
  vamm_address VARCHAR(42),
  vault_address VARCHAR(42),
  oracle_address VARCHAR(42),
  initial_price DECIMAL,
  price_decimals INTEGER DEFAULT 8,
  deployment_status VARCHAR(20) DEFAULT 'deployed',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## API Integration

The components automatically integrate with these API endpoints:

### Required Endpoints
- `GET /api/tradingview/config` - Chart configuration
- `GET /api/tradingview/search?query=SYMBOL` - Symbol search
- `GET /api/tradingview/symbols?symbol=SYMBOL` - Symbol details
- `GET /api/tradingview/history` - Historical OHLCV data

### Real-time Data
- Pusher channel: `market-{SYMBOL}`
- Event: `price-update`
- Format: `{ timestamp, open, high, low, close, volume }`

## Custom Market Integration

### 1. Market Creation Flow
1. User creates vAMM market via your factory contract
2. Market gets stored in `vamm_markets` table with `deployment_status: 'deployed'`
3. Chart automatically discovers the new market
4. Users can search and trade the custom market

### 2. Symbol Format
- **Input**: Custom user symbols (e.g., "MYGOLD", "APPLESTOCK", "ELECTION2024")
- **Display**: Prefixed format ("VAMM:MYGOLD")
- **Search**: Works with symbol and description text

### 3. Market Categories
Supports multiple market types determined by `category` field:
- `futures` (default)
- `crypto` 
- `stock`
- `index`
- `commodity`

## Troubleshooting

### Chart Not Loading
1. **Check TradingView Library**: Ensure `public/charting_library/` exists
2. **Verify API Endpoints**: Test `/api/tradingview/config` manually
3. **Database Connection**: Confirm Supabase credentials
4. **Market Data**: Ensure markets exist with `deployment_status: 'deployed'`

### No Market Data
1. **Check Symbol**: Verify market exists in database
2. **ClickHouse Data**: Ensure OHLCV data pipeline is running
3. **API Response**: Check browser network tab for errors

### Real-time Updates Not Working
1. **Pusher Configuration**: Verify Pusher credentials
2. **Channel Subscription**: Check browser console for connection errors
3. **Data Pipeline**: Ensure price streaming service is running

## Example Implementation

See `examples/AdvancedChartExample.tsx` for a complete implementation showing:
- Market selection from database
- Symbol and interval controls
- Error handling
- Real-time updates
- Integration with existing hooks

## Performance Considerations

- **Caching**: Historical data is cached for 5 minutes
- **Throttling**: Real-time updates are throttled to prevent spam
- **Lazy Loading**: Chart library loads only when component mounts
- **Memory Management**: Proper cleanup on component unmount

## Supported Browsers

- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

## License

This component uses the TradingView charting library which requires a commercial license for production use. Contact TradingView for licensing details. 