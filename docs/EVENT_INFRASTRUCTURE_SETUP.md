# Smart Contract Event Infrastructure Setup

This document explains how to set up and use the backend infrastructure for receiving and subscribing to smart contract events from your DEX contracts.

## 🏗️ Architecture Overview

The event infrastructure consists of:

1. **Event Listener Service** - Monitors blockchain for smart contract events
2. **Database Layer** - Stores events and manages subscriptions
3. **API Endpoints** - Exposes event data and management functions
4. **WebSocket Server** - Provides real-time event streaming
5. **Type Definitions** - TypeScript types for all event data

## 📋 Prerequisites

### Dependencies
```bash
npm install ethers ws @types/ws tsx
```

### Environment Variables
Add these to your `.env.local` file:

```bash
# Blockchain Configuration
RPC_URL=http://localhost:8545
WS_RPC_URL=ws://localhost:8545
CHAIN_ID=31337

# Contract Addresses (populate after deployment)
VAMM_FACTORY_ADDRESS=0x...
MOCK_USDC_ADDRESS=0x...
MOCK_ORACLE_ADDRESS=0x...

# Event Listener Configuration
EVENT_LISTENER_ENABLED=true
EVENT_BATCH_SIZE=1000
EVENT_CONFIRMATIONS=1
EVENT_RETRY_ATTEMPTS=3
EVENT_RETRY_DELAY=5000

# Database (Supabase)
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## 🗄️ Database Setup

### 1. Run Migrations
Execute the SQL migration in your Supabase dashboard:

```sql
-- Run the contents of database/migrations/001_create_event_tables.sql
```

This creates:
- `contract_events` - Stores all smart contract events
- `event_subscriptions` - Manages user subscriptions
- `contract_sync_status` - Tracks sync progress
- Indexes and views for efficient querying

### 2. Configure Permissions (Optional)
For production, enable Row Level Security and set up appropriate policies.

## 🚀 Starting the Event Listener

### Development Mode
```bash
# Start the event listener in development
npm run event-listener

# Or run directly
npx tsx src/services/eventListener.ts
```

### Production Mode
```bash
# Build the project
npm run build

# Start the event listener as a background service
pm2 start src/services/eventListener.ts --name "dex-event-listener"
```

### With Docker
```dockerfile
# Add to your Dockerfile
COPY src/services/eventListener.ts ./
RUN npx tsx src/services/eventListener.ts &
```

## 📊 Monitored Events

The infrastructure automatically listens for these events:

### vAMM Contract Events
- `PositionOpened` - New trading positions
- `PositionClosed` - Position closures
- `FundingUpdated` - Funding rate changes
- `FundingPaid` - Funding payments
- `PositionLiquidated` - Liquidations
- `TradingFeeCollected` - Fee collections
- `ParametersUpdated` - Configuration changes

### Vault Contract Events
- `CollateralDeposited` - Deposits
- `CollateralWithdrawn` - Withdrawals
- `MarginReserved` - Margin reservations
- `MarginReleased` - Margin releases
- `PnLUpdated` - P&L changes
- `FundingApplied` - Funding applications
- `UserLiquidated` - User liquidations

### Factory Contract Events
- `MarketCreated` - New market deployments
- `MarketStatusChanged` - Market status updates
- `DeploymentFeeUpdated` - Fee changes

### Oracle Events
- `PriceUpdated` - Price updates
- `OracleStatusChanged` - Oracle status changes

## 🔌 API Endpoints

### Query Events
```bash
GET /api/events
```

Query parameters:
- `contractAddress` - Filter by contract
- `eventType` - Filter by event type
- `userAddress` - Filter by user
- `fromBlock` - Start block number
- `toBlock` - End block number
- `limit` - Number of results (default: 50)
- `offset` - Pagination offset

Example:
```bash
curl "http://localhost:3000/api/events?eventType=PositionOpened&limit=10"
```

### Event Metrics
```bash
GET /api/events/metrics?timeRange=24h
```

Returns:
- Total events count
- Events by type breakdown
- Unique users count
- Total volume

### Event Subscriptions
```bash
# Get all subscriptions
GET /api/events/subscriptions

# Create a subscription
POST /api/events/subscriptions
{
  "contractAddress": "0x...",
  "eventName": "PositionOpened",
  "userAddress": "0x...",
  "webhookUrl": "https://your-app.com/webhook"
}
```

### Event Listener Status
```bash
GET /api/events/status
```

Returns:
- Is running status
- Number of contracts monitored
- WebSocket connection status
- Connected clients count

## 🔌 Real-time WebSocket API

### Connect to WebSocket
```javascript
const ws = new WebSocket('ws://localhost:3000/api/events/websocket')

ws.onopen = () => {
   console.log('Connected to event stream')
}

ws.onmessage = (event) => {
  const data = JSON.parse(event.data)
   console.log('New event:', data.event)
}

// Subscribe to specific events
ws.send(JSON.stringify({
  type: 'subscribe',
  contractAddress: '0x...',
  eventType: 'PositionOpened'
}))
```

### Event Data Format
```typescript
{
  event: {
    eventType: "PositionOpened",
    user: "0x...",
    isLong: true,
    size: "1000000000000000000000",
    price: "50000000000000000000000",
    leverage: "10",
    fee: "3000000000000000000",
    transactionHash: "0x...",
    blockNumber: 12345,
    timestamp: "2024-01-01T00:00:00.000Z"
  }
}
```

## 🎯 Usage Examples

### Frontend Hook for Real-time Events
```typescript
// src/hooks/useContractEvents.ts
import { useEffect, useState } from 'react'
import { SmartContractEvent } from '@/types/events'

export function useContractEvents(contractAddress?: string) {
  const [events, setEvents] = useState<SmartContractEvent[]>([])
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:3000/api/events/websocket')

    ws.onopen = () => {
      setIsConnected(true)
      if (contractAddress) {
        ws.send(JSON.stringify({
          type: 'subscribe',
          contractAddress
        }))
      }
    }

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      setEvents(prev => [data.event, ...prev.slice(0, 99)]) // Keep last 100
    }

    ws.onclose = () => setIsConnected(false)

    return () => ws.close()
  }, [contractAddress])

  return { events, isConnected }
}
```

### Query Historical Events
```typescript
// src/lib/eventQueries.ts
export async function fetchUserEvents(userAddress: string) {
  const response = await fetch(`/api/events?userAddress=${userAddress}&limit=100`)
  const data = await response.json()
  return data.data
}

export async function fetchPositionEvents(contractAddress: string) {
  const response = await fetch(`/api/events?contractAddress=${contractAddress}&eventType=PositionOpened`)
  const data = await response.json()
  return data.data
}
```

### Real-time Trading Activity Feed
```typescript
// src/components/TradingActivityFeed.tsx
import { useContractEvents } from '@/hooks/useContractEvents'

export function TradingActivityFeed({ vammAddress }: { vammAddress: string }) {
  const { events, isConnected } = useContractEvents(vammAddress)

  return (
    <div className="activity-feed">
      <div className="status">
        Status: {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
      </div>
      
      {events.map(event => (
        <div key={`${event.transactionHash}-${event.logIndex}`} className="event-item">
          <span className="event-type">{event.eventType}</span>
          <span className="user">{event.user}</span>
          <span className="timestamp">{new Date(event.timestamp).toLocaleTimeString()}</span>
        </div>
      ))}
    </div>
  )
}
```

## 🔧 Configuration

### Custom Contract Monitoring
To monitor additional contracts, update your environment:

```bash
# Add new contract addresses
CUSTOM_CONTRACT_1_ADDRESS=0x...
CUSTOM_CONTRACT_1_TYPE=vAMM
```

Then update the contract configuration in `src/lib/env.ts`.

### Event Filtering
The event listener automatically filters and indexes events for efficient querying. Custom filters can be added to the `EventDatabase` class.

### Performance Tuning
- **Batch Size**: Increase `EVENT_BATCH_SIZE` for faster historical sync
- **Confirmations**: Adjust `EVENT_CONFIRMATIONS` based on network security needs
- **Retry Logic**: Configure `EVENT_RETRY_ATTEMPTS` and `EVENT_RETRY_DELAY` for network reliability

## 🔍 Monitoring & Debugging

### Check Event Listener Status
```bash
curl http://localhost:3000/api/events/status
```

### View Recent Events
```bash
curl "http://localhost:3000/api/events?limit=10"
```

### Check Database Sync Status
```sql
SELECT * FROM contract_sync_status;
```

### View Event Metrics
```bash
curl "http://localhost:3000/api/events/metrics?timeRange=1h"
```

## 🚨 Error Handling

The infrastructure includes comprehensive error handling:

- **Connection Failures**: Automatic reconnection with exponential backoff
- **Duplicate Events**: Unique constraints prevent duplicate storage
- **Missing Blocks**: Automatic detection and re-sync of missing events
- **Rate Limiting**: Built-in request batching and throttling

## 📈 Scaling Considerations

For production deployments:

1. **Database Indexing**: Optimize queries with proper indexes
2. **Event Archiving**: Implement data retention policies
3. **Load Balancing**: Use multiple event listener instances
4. **Caching**: Cache frequently accessed event data
5. **Monitoring**: Set up alerts for listener health and database performance

## 🔒 Security

- Events are stored with transaction hashes for verification
- WebSocket connections can be authenticated
- Database access uses Row Level Security (RLS)
- API endpoints include input validation and rate limiting

## 🧪 Testing

Run tests for the event infrastructure:

```bash
# Unit tests
npm test src/services/eventListener.test.ts

# Integration tests
npm test src/lib/eventDatabase.test.ts

# API tests
npm test src/app/api/events/*.test.ts
```

## 📞 Support

For issues or questions:

1. Check the event listener logs
2. Verify contract addresses are correct
3. Ensure RPC endpoints are accessible
4. Check database connectivity
5. Review environment variable configuration

## 🔄 Updating

When smart contracts are updated:

1. Update contract addresses in environment
2. Update ABIs in the event listener service
3. Add new event types to TypeScript definitions
4. Update database schema if needed
5. Restart the event listener service 