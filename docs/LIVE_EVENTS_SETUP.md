# Live VAMM Event System Setup

This guide explains how to set up and use the live smart contract event system for real-time transaction updates in the DexExtra trading interface.

## 🏗️ System Overview

The live event system consists of:

1. **Smart Contract Event Listener** - Monitors VAMM contracts for position events
2. **Event Database** - Stores events in Supabase with proper indexing
3. **Server-Sent Events (SSE)** - Streams real-time updates to the frontend
4. **Transaction Table Component** - Displays live trading activity
5. **API Endpoints** - Manage event listener and trigger test events

## 🚀 Quick Start

### 1. Start the Development Server
```bash
npm run dev
```

### 2. Test the Event System
```bash
npm run test-events
```

This will:
- Initialize the event listener
- Simulate position events
- Show live updates in the transaction table
- Test the SSE connection

### 3. View Live Updates
1. Open `http://localhost:3000/token/Gold` in your browser
2. Watch the "Recent Transactions" table for live updates
3. Look for the green "Live" indicator next to the table title

## 📊 Monitored Events

The system automatically listens for these VAMM contract events:

### Position Events
- **PositionOpened** - New long/short positions
- **PositionClosed** - Position closures with P&L
- **PositionLiquidated** - Liquidation events

### Vault Events
- **CollateralDeposited** - User deposits
- **CollateralWithdrawn** - User withdrawals
- **MarginReserved** - Margin reservations
- **MarginReleased** - Margin releases

### Display Format
Events are transformed into transaction table format:
- **Type**: `buy` (long) / `sell` (short/close)
- **USDC**: Trading fees in USDC
- **Amount**: Position size (formatted as k/M)
- **Transaction**: Last 4 chars of transaction hash
- **Wallet**: Truncated user address
- **Age**: Time since event (s/m/h/d)

## 🔧 API Endpoints

### Event Listener Control
```bash
# Start event listener
curl -X POST http://localhost:3000/api/events/trigger \
  -H "Content-Type: application/json" \
  -d '{"action": "start"}'

# Stop event listener
curl -X POST http://localhost:3000/api/events/trigger \
  -H "Content-Type: application/json" \
  -d '{"action": "stop"}'

# Check status
curl -X POST http://localhost:3000/api/events/trigger \
  -H "Content-Type: application/json" \
  -d '{"action": "status"}'
```

### Simulate Events (for testing)
```bash
# Simulate a position opened event
curl -X POST http://localhost:3000/api/events/trigger \
  -H "Content-Type: application/json" \
  -d '{"action": "simulate"}'
```

### Query Historical Events
```bash
# Get recent events for Gold vAMM
curl "http://localhost:3000/api/events?contractAddress=0xDAB242Cd90b95A4ED68644347B80e0b3CEaD48c0&limit=10"

# Get specific event type
curl "http://localhost:3000/api/events?eventType=PositionOpened&limit=5"

# Get events for specific user
curl "http://localhost:3000/api/events?userAddress=0x742d35Cc6634C0532925a3b8c17d4C32bE9c6FF7"
```

## 🌊 Real-time Streaming

### Server-Sent Events (SSE)
Connect to the event stream for real-time updates:

```javascript
const eventSource = new EventSource('/api/events/stream?contractAddress=0xDAB242Cd90b95A4ED68644347B80e0b3CEaD48c0');

eventSource.onmessage = function(event) {
  const data = JSON.parse(event.data);
  
  if (data.type === 'event') {
    console.log('New event:', data.event);
  }
};
```

### Event Data Format
```json
{
  "type": "event",
  "event": {
    "eventType": "PositionOpened",
    "user": "0x742d35Cc6634C0532925a3b8c17d4C32bE9c6FF7",
    "isLong": true,
    "size": "1000000000000000000000",
    "price": "3333000000",
    "leverage": "10",
    "fee": "3330000",
    "transactionHash": "0x...",
    "blockNumber": 45123456,
    "timestamp": "2024-01-01T12:00:00.000Z",
    "contractAddress": "0xDAB242Cd90b95A4ED68644347B80e0b3CEaD48c0",
    "chainId": 137
  }
}
```

## 💾 Database Schema

Events are stored in Supabase with this structure:

```sql
CREATE TABLE contract_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  transaction_hash TEXT NOT NULL,
  block_number BIGINT NOT NULL,
  log_index INTEGER NOT NULL,
  contract_address TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_data JSONB NOT NULL,
  user_address TEXT,
  timestamp TIMESTAMPTZ NOT NULL,
  chain_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(transaction_hash, log_index)
);

-- Indexes for efficient querying
CREATE INDEX idx_contract_events_contract_address ON contract_events(contract_address);
CREATE INDEX idx_contract_events_event_type ON contract_events(event_type);
CREATE INDEX idx_contract_events_user_address ON contract_events(user_address);
CREATE INDEX idx_contract_events_timestamp ON contract_events(timestamp DESC);
```

## 🔧 Configuration

### Environment Variables
```bash
# Blockchain RPC endpoints
RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY
WS_RPC_URL=wss://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY
CHAIN_ID=137

# Event Listener Settings
EVENT_LISTENER_ENABLED=true
EVENT_BATCH_SIZE=1000
EVENT_CONFIRMATIONS=1
EVENT_RETRY_ATTEMPTS=3
EVENT_RETRY_DELAY=5000

# Database
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### Dynamic Contract Loading
The system automatically discovers deployed VAMM contracts from the database:

```typescript
// Contracts are loaded from vamm_markets table
const contracts = await database.getDeployedVAMMContracts();
// Returns vAMM, Vault, and Oracle contracts for monitoring
```

## 🎯 Frontend Integration

### Transaction Table Component
The `TransactionTable` component automatically connects to live events:

```tsx
<TransactionTable vammAddress={vammMarket?.vamm_address} />
```

Features:
- **Live indicator**: Shows connection status
- **Real-time updates**: No page refresh needed
- **Event filtering**: Only shows relevant position events
- **Fallback data**: Uses mock data when no events available
- **Event annotations**: Shows 'C' for closed, 'L' for liquidated

### Connection Status
The table header shows live connection status:
- 🟢 **Live**: Connected and receiving events
- 🟡 **Connecting...**: Establishing connection
- 🔴 **Disconnected**: Connection lost

## 🧪 Testing & Development

### Manual Testing
1. **Start the dev server**: `npm run dev`
2. **Run event test**: `npm run test-events`
3. **Open token page**: `http://localhost:3000/token/Gold`
4. **Watch live updates** in the transaction table

### Event Simulation
Use the `/api/events/trigger` endpoint to simulate events:

```javascript
// Simulate a long position
fetch('/api/events/trigger', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'simulate' })
});
```

### Debug Mode
Enable debug logging in the console:
```bash
DEBUG_MODE=true npm run dev
```

## 🔍 Troubleshooting

### Common Issues

1. **No live events showing**
   - Check if event listener is running: `/api/events/trigger` with `status` action
   - Verify contract addresses in database
   - Check console for SSE connection errors

2. **Events not updating**
   - Refresh the page
   - Check network connectivity
   - Verify RPC endpoints are accessible

3. **Mock data instead of real events**
   - Normal behavior when no real events are available
   - Use simulate action to generate test events

### Debug Commands
```bash
# Check event listener status
curl -X POST http://localhost:3000/api/events/trigger -d '{"action":"status"}'

# Test SSE connection
curl -N http://localhost:3000/api/events/stream

# View recent events
curl "http://localhost:3000/api/events?limit=5"
```

## 📈 Performance

### Optimization Features
- **Event deduplication**: Prevents duplicate storage
- **Efficient indexing**: Fast queries by contract/user/type
- **Connection pooling**: Reuses database connections
- **Event batching**: Processes events in batches
- **Smart filtering**: Only relevant events reach frontend

### Scaling Considerations
- **Rate limiting**: Built-in request throttling
- **Memory management**: Limited event history in memory
- **Connection limits**: Manages WebSocket connections
- **Database partitioning**: For high-volume deployments

## 🔐 Security

### Best Practices
- Events are verified with transaction hashes
- Contract addresses validated against database
- User input sanitized for database queries
- Rate limiting on API endpoints

### Production Deployment
1. Use environment-specific RPC URLs
2. Enable database Row Level Security (RLS)
3. Set up monitoring and alerting
4. Configure proper CORS headers
5. Use HTTPS for all connections

## 🎉 Success!

You now have a fully functional live event system that:
- ✅ Monitors VAMM smart contracts in real-time
- ✅ Stores events in a scalable database
- ✅ Streams updates to the frontend via SSE
- ✅ Displays live trading activity without page reloads
- ✅ Provides testing and debugging tools

The transaction table will now show real-time position opens, closes, and liquidations as they happen on the blockchain! 🚀 