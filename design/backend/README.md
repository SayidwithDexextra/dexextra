# Advanced Chart Backend Infrastructure

A high-performance, scalable **cloud-native** backend infrastructure for supporting both TradingView Advanced Charts and LightweightCharts on vAMM markets platform. **No Docker required** - uses managed cloud services for maximum reliability and scale.

## 🚀 Features

- **Ultra-High Performance**: ClickHouse Cloud-powered OHLCV data with sub-second aggregations
- **Real-Time Streaming**: Pusher-based live price updates (serverless WebSocket alternative)
- **Dual Chart Support**: Native support for both TradingView and LightweightCharts
- **Massive Scale**: Designed to handle millions of markets and transactions
- **Auto-Aggregation**: Automatic OHLCV data generation across multiple timeframes
- **Production Ready**: Comprehensive monitoring, caching, and rate limiting
- **Serverless Deployment**: Optimized for Vercel and other serverless platforms
- **Zero Infrastructure Management**: No servers to maintain or scale

## 📋 Prerequisites

- **Node.js 18+** (for development)
- **Cloud Service Accounts**:
  - ClickHouse Cloud (database)
  - Upstash Redis (caching)  
  - Pusher (real-time updates)
  - Vercel (hosting)
- **Polygon RPC endpoint** (Alchemy/Infura)
- **No Docker or servers required!** ✨

## ⚡ Quick Start

### 1. Cloud-Native Setup (5 Minutes)

```bash
# Run the automated cloud setup
./design/backend/setup-infrastructure.sh
```

This will:
- Install required Node.js dependencies
- Create project structure and configuration files
- Set up environment variables template
- Generate connection test scripts
- Create database initialization scripts
- Provide step-by-step cloud service setup instructions

### 2. Configure Cloud Services

After running setup, configure your cloud services:

```bash
# 1. Sign up for cloud services:
#    - ClickHouse Cloud: https://clickhouse.cloud/
#    - Upstash Redis: https://upstash.com/
#    - Pusher: https://pusher.com/

# 2. Edit .env with your credentials
nano .env

# 3. Test connections
npm run test:connections

# 4. Initialize database
npm run setup:clickhouse

# 5. Start development
npm run dev

# Start ClickHouse and Redis
docker-compose up -d clickhouse redis

# Initialize database
docker exec chart-clickhouse clickhouse-client --password=YOUR_PASSWORD --multiquery < scripts/init-clickhouse.sql
```

## 🏗️ Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   TradingView   │    │ LightweightCharts│    │   WebSockets    │
│     Charts      │    │                 │    │   (Real-time)   │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 │
          ┌─────────────────────────────────────────────┐
          │              Chart API Layer                │
          │  • TradingView Datafeed API                 │
          │  • LightweightCharts REST API               │
          │  • WebSocket Streaming Server               │
          │  • Rate Limiting & Caching                  │
          └─────────────────┬───────────────────────────┘
                            │
          ┌─────────────────┼───────────────────────────┐
          │                 │                           │
    ┌─────▼─────┐    ┌─────▼─────┐           ┌─────▼─────┐
    │  Redis    │    │ClickHouse │           │Blockchain │
    │ (Cache)   │    │(Analytics)│           │   Events  │
    └───────────┘    └───────────┘           └───────────┘
```

## 📊 Database Schema

### Core Tables

1. **vamm_market_transactions** - Raw transaction data
2. **vamm_ohlcv_1s** - 1-second OHLCV aggregations
3. **vamm_ohlcv_1m/5m/1h/1d** - Higher timeframe aggregations
4. **vamm_markets** - Market metadata and configuration
5. **vamm_live_prices** - Real-time price feeds and metrics

### Sample Data Structure

```sql
-- Market transaction example
market_id: 1
market_symbol: 'GOLD'
timestamp: '2024-01-01 12:00:00.000'
price: 2000.50
volume: 1000.0
event_type: 'PositionOpened'
user_address: '0x123...'
is_long: 1
leverage: 10.0
```

## 🔌 API Endpoints

### TradingView Datafeed API

```bash
# Configuration
GET /api/tradingview/config

# Symbol information
GET /api/tradingview/symbols?symbol=GOLD

# Historical data
GET /api/tradingview/history?symbol=GOLD&resolution=1&from=1640995200&to=1641081600

# Symbol search
GET /api/tradingview/search?query=GOLD&limit=10

# Real-time streaming
WebSocket /api/tradingview/stream
```

### LightweightCharts API

```bash
# OHLCV data
GET /api/lightweight/ohlcv?symbol=GOLD&timeframe=1m&from=2024-01-01&to=2024-01-02

# Market list
GET /api/lightweight/markets?tier=tier1&limit=50

# Real-time updates
WebSocket /api/lightweight/realtime
```

## 📈 Performance Features

### ClickHouse Optimizations

- **Columnar Storage**: 10-50x compression ratios
- **Materialized Views**: Automatic OHLCV aggregation
- **Partitioning**: By date and market symbol
- **Indexing**: Optimized for time-series queries
- **Memory Settings**: 20GB RAM allocation for performance

### Caching Strategy

- **Redis TTL**: Different cache durations per timeframe
- **Multi-Level**: L1 (memory) + L2 (Redis) caching
- **Smart Invalidation**: Event-driven cache updates

### Real-Time Streaming

- **WebSocket Pools**: Connection management per market
- **Rate Limiting**: 100 messages/second per connection
- **Heartbeat**: 30-second ping/pong
- **Auto-Reconnection**: Client-side resilience

## 🚦 Monitoring & Health Checks

### Built-in Monitoring

```bash
# Health check
curl http://localhost:3000/health

# Metrics endpoint
curl http://localhost:9090/metrics

# ClickHouse performance
SELECT * FROM system.query_log 
WHERE event_time >= now() - INTERVAL 1 HOUR
ORDER BY query_duration_ms DESC;
```

### Performance Metrics

- Query response times (P50, P95, P99)
- WebSocket connection counts
- Cache hit rates
- Data ingestion rates
- Memory and CPU usage

## 🔧 Configuration

### Environment Variables

Key configuration options:

```bash
# Core Database
CLICKHOUSE_HOST=http://localhost:8123
CLICKHOUSE_PASSWORD=your_secure_password
REDIS_HOST=localhost

# Performance Tuning
CLICKHOUSE_BATCH_SIZE=10000
CACHE_OHLCV_1M_TTL=300
WS_MAX_CONNECTIONS=1000

# Feature Flags
ENABLE_TRADINGVIEW_CHARTS=true
ENABLE_LIGHTWEIGHT_CHARTS=true
ENABLE_REALTIME_STREAMING=true
```

See `environment-variables.txt` for complete configuration options.

### Production Deployment

```bash
# Build production images
docker-compose -f docker-compose.prod.yml build

# Deploy with scaling
docker-compose -f docker-compose.prod.yml up -d --scale chart-api=3

# Monitor logs
docker-compose logs -f chart-api
```

## 🔐 Security Features

- **Rate Limiting**: Per-endpoint and per-IP limits
- **JWT Authentication**: Optional token-based auth
- **CORS Protection**: Configurable allowed origins
- **Input Validation**: Joi schema validation
- **SQL Injection Protection**: Parameterized queries

## 📚 Integration Examples

### TradingView Widget

```javascript
new TradingView.widget({
    container_id: 'tradingview_chart',
    symbol: 'VAMM:GOLD',
    datafeed: new Datafeeds.UDFCompatibleDatafeed('http://localhost:3000/api/tradingview'),
    library_path: '/charting_library/',
    locale: 'en',
    disabled_features: ['use_localstorage_for_settings'],
    enabled_features: ['study_templates'],
    charts_storage_url: 'http://localhost:3000/api/tradingview',
    charts_storage_api_version: '1.1',
    client_id: 'vamm-charts',
    user_id: 'public_user_id'
});
```

### LightweightCharts Integration

```javascript
import { createChart } from 'lightweight-charts';

const chart = createChart(document.body, { width: 600, height: 400 });
const candlestickSeries = chart.addCandlestickSeries();

// Fetch and display data
fetch('/api/lightweight/ohlcv?symbol=GOLD&timeframe=1m')
    .then(response => response.json())
    .then(data => {
        candlestickSeries.setData(data.data);
    });

// Real-time updates
const ws = new WebSocket('ws://localhost:8080/api/lightweight/realtime');
ws.onmessage = (event) => {
    const update = JSON.parse(event.data);
    if (update.type === 'price_update') {
        candlestickSeries.update(update.data);
    }
};
```

## 🧪 Testing

### Load Testing

```bash
# Install dependencies
npm install -g artillery

# Run load tests
artillery run load-test-config.yml

# WebSocket stress test
node scripts/ws-stress-test.js
```

### Data Validation

```bash
# Verify OHLCV aggregations
npm run test:ohlcv

# Check real-time data flow
npm run test:realtime

# Performance benchmarks
npm run benchmark
```

## 🔍 Troubleshooting

### Common Issues

1. **ClickHouse Memory Errors**
   ```bash
   # Increase memory limit
   echo 'max_memory_usage = 40000000000' >> config/clickhouse/config.xml
   ```

2. **WebSocket Connection Drops**
   ```bash
   # Check connection limits
   echo 'WS_MAX_CONNECTIONS=2000' >> .env
   ```

3. **Slow Query Performance**
   ```sql
   -- Check query performance
   SELECT query, query_duration_ms 
   FROM system.query_log 
   ORDER BY query_duration_ms DESC 
   LIMIT 10;
   ```

### Performance Tuning

1. **Optimize ClickHouse Settings**
   - Increase `max_memory_usage` for large datasets
   - Tune `mark_cache_size` based on available RAM
   - Adjust `max_threads` to match CPU cores

2. **Redis Configuration**
   - Set appropriate `maxmemory` limit
   - Use `allkeys-lru` eviction policy
   - Enable AOF persistence for durability

3. **WebSocket Optimization**
   - Implement connection pooling
   - Use message batching for high-frequency updates
   - Monitor connection lifecycle events

## 📝 Development

### Local Development

```bash
# Clone and setup
git clone <repository>
cd chart-backend

# Install dependencies
npm install

# Start development server
npm run dev

# Watch logs
npm run logs
```

### Code Structure

```
chart-backend/
├── src/
│   ├── api/           # REST API endpoints
│   ├── websocket/     # WebSocket handlers
│   ├── services/      # Business logic
│   ├── models/        # Data models
│   └── utils/         # Helper functions
├── config/            # Configuration files
├── scripts/           # Deployment scripts
└── tests/             # Test suites
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

## 🆘 Support

- Documentation: `docs/`
- Issues: GitHub Issues
- Discord: [Community Server]
- Email: support@dexextra.com

---

**Built with ❤️ for the DexExtra vAMM Platform** 