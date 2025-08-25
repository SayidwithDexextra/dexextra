# OFF-CHAIN ORDERBOOK DATABASE SCHEMA IMPLEMENTATION PROMPT

## CONTEXT AND OBJECTIVE

You are tasked with implementing a production-ready database schema for DexExtra's off-chain orderbook system. This schema must support high-performance trading with traditional peer-to-peer order matching, moving away from the current synthetic derivatives model where the protocol takes the opposite side of all trades. This system must also support off-chain order matching.

## BUSINESS REQUIREMENTS

### Core Trading Model
- **Traditional Orderbook**: Buy orders must match with sell orders (peer-to-peer trading)
- **Off-Chain Matching**: Orders are matched off-chain for speed, settled on-chain for security
- **Self-Sufficient Markets**: Each market is economically independent, protocol takes no position risk
- **Unlimited Market Creation**: Support for any metric-based market (temperature, population, etc.)
- **Professional Trading Features**: Advanced order types, real-time feeds, institutional-grade performance

### Performance Requirements
- **Sub-10ms Order Processing**: From order submission to order book update
- **1,000+ Matches/Second**: High-frequency matching capability
- **10,000+ Active Orders**: Per market support
- **1,000+ Concurrent WebSocket Connections**: Real-time data distribution
- **99.9% Uptime**: Enterprise-grade reliability

### Security Requirements
- **EIP-712 Signature Verification**: All orders must be cryptographically signed
- **Replay Attack Prevention**: Nonce-based security
- **Row Level Security**: Users can only access their own data
- **Rate Limiting**: Prevent abuse and spam
- **Audit Trail**: Complete history of all trading activity

## TECHNICAL ARCHITECTURE

### Database Platform
- **Primary**: PostgreSQL with Supabase hosting
- **Caching Layer**: Redis for real-time order book state
- **Analytics**: TimescaleDB extension for time-series data
- **Scaling**: Read replicas and connection pooling

### Integration Points
- **Smart Contracts**: Settlement-only contracts on Polygon
- **CentralVault Contract**: Unified collateral management and custody system
- **Router Contract**: Sophisticated order routing with portfolio tracking and P&L calculation
- **WebSocket API**: Socket.io for real-time communication
- **Matching Engine**: Node.js/TypeScript service
- **Frontend**: React-based trading interface
- **Monitoring**: DataDog or Prometheus metrics

## CORE DATA ENTITIES TO IMPLEMENT

### 1. Off-Chain Orders Table
**Purpose**: Store all orders submitted to the matching engine before settlement

**Key Requirements**:
- Support for all professional order types (MARKET, LIMIT, STOP, IOC, FOK, etc.)
- EIP-712 signature storage and verification fields
- Collateral management (reservation and release)
- Advanced order features (iceberg, post-only, reduce-only)
- Performance-optimized indexes for order book queries
- Proper constraints for data integrity

**Critical Fields**:
- Order identification and trader information
- Order details (side, type, quantity, price, status)
- Signature verification data (hash, signature, nonce)
- Collateral management fields
- Timestamps for lifecycle tracking
- Metadata for analytics and security

### 2. Trade Matches Table
**Purpose**: Record successful order matches pending on-chain settlement

**Key Requirements**:
- Link to both buy and sell orders
- Settlement workflow tracking (PENDING → SETTLING → SETTLED)
- Fee calculation and distribution
- Gas management for on-chain settlement
- Batch settlement support
- Comprehensive audit trail

**Critical Fields**:
- Match identification and related orders
- Trade execution details (quantity, price, total value)
- Settlement status and transaction information
- Fee calculations (maker/taker fees)
- Timestamps for settlement lifecycle

### 3. Order Book Snapshots Table
**Purpose**: Store periodic snapshots for analytics and monitoring

**Key Requirements**:
- Real-time market data aggregation
- Order book depth visualization
- 24-hour trading statistics
- Performance metrics tracking
- JSONB storage for flexible data structures

**Critical Fields**:
- Market identification and timestamp
- Best bid/ask prices and spread calculation
- Volume and liquidity metrics
- Order book depth levels
- System performance metrics

### 4. User Trading Statistics Table
**Purpose**: Track individual trader performance and risk metrics

**Key Requirements**:
- P&L calculation and tracking
- Volume and trade count statistics
- Risk management metrics
- Position size tracking
- Daily limits and resets

**Critical Fields**:
- User and market identification
- Volume breakdown (buy/sell/total)
- P&L metrics (realized/unrealized)
- Risk metrics (position sizes, limits)
- Time-windowed statistics

### 5. Settlement Queue Table
**Purpose**: Manage on-chain settlement workflow

**Key Requirements**:
- Priority-based queue management
- Retry logic for failed settlements
- Gas price optimization
- Batch settlement support
- Error handling and reporting

**Critical Fields**:
- Queue position and priority
- Settlement attempts and timing
- Gas management parameters
- Status tracking and error logging

### 6. WebSocket Connections Table
**Purpose**: Track real-time connections and subscriptions

**Key Requirements**:
- Connection lifecycle management
- Subscription tracking by market
- Rate limiting and abuse prevention
- Performance monitoring
- Security logging

**Critical Fields**:
- Connection identification and metadata
- Subscription management
- Activity and performance metrics
- Rate limiting data
- Security information

### 7. System Metrics Table
**Purpose**: Store system-wide performance and health metrics

**Key Requirements**:
- Performance monitoring data
- System health indicators
- Trading volume statistics
- Error rate tracking
- Capacity planning metrics

**Critical Fields**:
- Performance metrics (latency, throughput)
- System health indicators
- Trading statistics
- Error and timeout rates

### 8. Centralized Vault Operations Table
**Purpose**: Track all collateral deposits, withdrawals, and allocations through the CentralVault contract

**Key Requirements**:
- Complete audit trail of all vault operations
- Support for multiple collateral token types
- Real-time balance tracking and reservations
- Cross-market collateral utilization
- Liquidation and margin call tracking
- Integration with smart contract events

**Critical Fields**:
- Operation identification and type (deposit, withdrawal, allocation, release)
- User and collateral token information
- Amount and balance tracking
- Transaction hash and block number linkage
- Cross-market allocation tracking
- Margin and liquidation data

### 9. Router Contract Portfolio Table
**Purpose**: Comprehensive portfolio tracking with sophisticated P&L calculations and risk metrics

**Key Requirements**:
- Real-time P&L calculation across all markets
- Position aggregation and risk assessment
- Historical performance tracking
- Cross-market exposure analysis
- Margin utilization and available buying power
- Portfolio-level statistics and analytics

**Critical Fields**:
- User identification and market breakdown
- Position details (open, closed, average entry prices)
- Realized and unrealized P&L calculations
- Risk metrics (portfolio value, exposure, margin ratios)
- Performance analytics (win rate, average trade size, ROI)
- Time-series data for portfolio evolution

### 10. User Positions Table
**Purpose**: Track individual positions across all markets with detailed entry/exit information

**Key Requirements**:
- Position lifecycle management (open, modify, close)
- Multiple entry/exit price tracking for average calculations
- Cross-market position correlation
- Position-specific P&L and performance metrics
- Settlement and oracle price integration
- Position size and leverage tracking

**Critical Fields**:
- Position identification and market details
- Entry/exit pricing and quantity information
- Current position status and P&L
- Leverage and margin requirements
- Settlement price and final outcomes
- Position modification history

### 11. Portfolio Snapshots Table
**Purpose**: Periodic snapshots of user portfolios for historical analysis and performance tracking

**Key Requirements**:
- Time-series portfolio value tracking
- Performance benchmarking capabilities
- Risk metric evolution over time
- Portfolio composition analysis
- Drawdown and volatility calculations
- Comparison with market performance

**Critical Fields**:
- Snapshot timestamp and user identification
- Portfolio value and composition breakdown
- Performance metrics (total return, Sharpe ratio, max drawdown)
- Risk metrics (VaR, portfolio beta, correlation)
- Asset allocation percentages
- Benchmark comparison data

## PERFORMANCE OPTIMIZATION REQUIREMENTS

### Database Indexes
- **Composite Indexes**: Optimized for order book queries (metric_id, side, price, timestamp)
- **Partial Indexes**: Only on active/pending records
- **Covering Indexes**: Include frequently accessed columns
- **Time-based Indexes**: For efficient range queries
- **Portfolio Indexes**: User-centric indexes for fast portfolio aggregation
- **P&L Calculation Indexes**: Optimized for real-time P&L computations
- **Cross-Market Indexes**: Enable efficient cross-market position analysis

### Query Optimization
- **Materialized Views**: For complex aggregations
- **Function-based Indexes**: For computed columns
- **Partition Strategies**: For large time-series data
- **Query Plan Analysis**: Ensure optimal execution
- **Portfolio Aggregation Views**: Pre-computed portfolio summaries for fast dashboard loading
- **P&L Calculation Functions**: Optimized stored procedures for real-time P&L calculations
- **Cross-Market Position Views**: Aggregated views for multi-market position analysis

### Caching Strategy
- **Redis Integration**: Order book state caching
- **Connection Pooling**: Efficient database connections
- **Read Replicas**: Distribute analytics queries
- **CDN Integration**: Static asset optimization
- **Portfolio Cache**: Redis-based caching for frequently accessed portfolio data
- **P&L Cache**: Real-time P&L calculations cached for instant dashboard updates
- **Position Cache**: Current position data cached for fast portfolio page loading

## SECURITY IMPLEMENTATION

### Row Level Security (RLS)
- **User Isolation**: Traders can only see their own orders and trades
- **Market Access Control**: Restrict access to specific markets
- **Admin Overrides**: System administrators can access all data
- **Audit Logging**: Track all data access attempts

### Data Protection
- **Encryption at Rest**: Sensitive data must be encrypted
- **Secure Transport**: All connections use TLS
- **API Rate Limiting**: Prevent abuse and spam
- **IP Whitelisting**: Optional for high-value traders

### Audit Requirements
- **Complete Audit Trail**: Every order and trade must be logged
- **Immutable Records**: No deletion of trading history
- **Regulatory Compliance**: Support for financial regulations
- **Data Retention**: Configurable retention policies

## MONITORING AND ANALYTICS

### Performance Metrics
- **Order Processing Latency**: Real-time latency tracking
- **Matching Engine Throughput**: Orders and matches per second
- **Database Performance**: Query execution times
- **WebSocket Performance**: Connection and message metrics

### Business Metrics
- **Trading Volume**: By market, user, and time period
- **Market Health**: Spread, depth, and activity metrics
- **User Engagement**: Trading frequency and patterns
- **Revenue Metrics**: Fee generation and distribution
- **Portfolio Performance**: User portfolio returns and risk-adjusted performance
- **Vault Utilization**: Collateral usage and margin efficiency metrics
- **Cross-Market Activity**: Multi-market trading patterns and correlations

### Alerting System
- **Performance Alerts**: Latency and error rate thresholds
- **System Health**: Database and service availability
- **Business Alerts**: Unusual trading patterns
- **Security Alerts**: Potential fraud or abuse

## SCALABILITY CONSIDERATIONS

### Horizontal Scaling
- **Database Sharding**: Partition by market or user
- **Read Replicas**: Distribute query load
- **Microservices**: Separate matching, settlement, and analytics
- **Load Balancing**: Distribute WebSocket connections

### Vertical Scaling
- **Connection Pooling**: Efficient database resource usage
- **Memory Optimization**: In-memory order book caching
- **CPU Optimization**: Efficient matching algorithms
- **Storage Optimization**: Archive old data

### Future Growth
- **Multi-Chain Support**: Cross-chain trading capabilities
- **Global Distribution**: Regional deployment strategies
- **Enhanced Features**: Margin trading, derivatives
- **API Ecosystem**: Third-party integrations

## IMPLEMENTATION PRIORITIES

### Phase 1: Core Foundation (Week 1-2)
1. Implement core tables with proper constraints and indexes
2. Set up basic security policies and access controls
3. Create essential views for order book and market data
4. Implement basic monitoring and metrics collection

### Phase 2: Advanced Features (Week 3-4)
1. Add advanced order types and features
2. Implement comprehensive audit logging
3. Create analytics and reporting views
4. Add performance optimization features

### Phase 3: Production Hardening (Week 5-6)
1. Implement comprehensive monitoring and alerting
2. Add advanced security features and rate limiting
3. Optimize for high-volume trading scenarios
4. Create backup and disaster recovery procedures

### Phase 4: Enterprise Features (Week 7-8)
1. Add institutional trading features
2. Implement advanced analytics and reporting
3. Create API documentation and developer tools
4. Add compliance and regulatory features

## SUCCESS CRITERIA

### Performance Benchmarks
- Order book queries execute in under 1ms
- Order insertion/update operations complete in under 5ms
- Real-time views update within 10ms of data changes
- System can handle 10,000 concurrent connections

### Reliability Standards
- 99.9% database uptime
- Zero data loss tolerance
- Automatic failover within 30 seconds
- Complete audit trail for all operations

### Security Standards
- All sensitive data encrypted at rest and in transit
- Row-level security properly implemented and tested
- Rate limiting prevents abuse and spam
- Complete audit logging for compliance

## TECHNICAL SPECIFICATIONS

### Data Types and Precision
- **Monetary Values**: NUMERIC(30,8) for precision
- **Prices**: NUMERIC(20,8) for market prices
- **Timestamps**: TIMESTAMPTZ for timezone awareness
- **Addresses**: VARCHAR(42) for Ethereum addresses
- **Hashes**: VARCHAR(66) for transaction hashes

### Naming Conventions
- **Tables**: snake_case with descriptive names
- **Columns**: snake_case with clear purpose
- **Indexes**: idx_table_columns for consistency
- **Views**: v_purpose for easy identification
- **Functions**: action_purpose for clarity

### Documentation Requirements
- **Table Comments**: Clear purpose and usage
- **Column Comments**: Data format and constraints
- **Index Comments**: Performance purpose
- **View Comments**: Business logic explanation
- **Function Comments**: Input/output specification

## ADDITIONAL CONSIDERATIONS

### Third-Party Integrations
- **Supabase**: Primary database hosting and real-time subscriptions
- **Redis Cloud**: Order book caching and message queuing
- **Socket.io**: WebSocket connections and real-time updates
- **DataDog**: Monitoring, alerting, and performance analytics
- **Alchemy**: Blockchain node access and webhook services

### Market-Specific Features
- **Metrics Markets**: Support for any measurable real-world data
- **Oracle Integration**: UMA oracle system for settlement data
- **Custom Tick Sizes**: Flexible pricing precision per market
- **Market Lifecycle**: Creation, trading, settlement, and closure
- **Position Management**: Track user positions across markets

### Centralized Vault System Integration
- **Multi-Token Collateral**: Support for USDC, ETH, and other approved tokens
- **Cross-Market Margin**: Unified collateral pool across all markets
- **Real-Time Balance Tracking**: Instant updates on deposits, withdrawals, and allocations
- **Margin Requirements**: Dynamic margin calculations based on portfolio risk
- **Liquidation Engine**: Automated liquidation system for under-collateralized positions
- **Collateral Optimization**: Intelligent allocation of collateral across positions

### Router Contract Portfolio Features
- **Unified P&L Tracking**: Real-time profit and loss across all positions
- **Risk Management**: Portfolio-level risk metrics and exposure limits
- **Performance Analytics**: Detailed trading performance statistics
- **Cross-Market Arbitrage**: Detection and tracking of arbitrage opportunities
- **Portfolio Optimization**: Suggestions for portfolio rebalancing and risk reduction
- **Tax Reporting**: Comprehensive trade history for tax compliance
- **API Integration**: RESTful APIs for portfolio data access
- **Real-Time Updates**: WebSocket feeds for live portfolio changes

### Portfolio Dashboard Requirements
- **Portfolio Value**: Real-time total portfolio value and daily/weekly/monthly changes
- **Asset Allocation**: Breakdown of positions across different markets and asset types
- **P&L Summary**: Realized vs unrealized gains/losses with time period filters
- **Performance Metrics**: ROI, Sharpe ratio, win rate, average trade size, max drawdown
- **Risk Metrics**: Portfolio beta, Value at Risk (VaR), portfolio volatility
- **Trading History**: Complete trade log with filtering and export capabilities
- **Position Details**: Current positions with entry prices, current values, and unrealized P&L
- **Margin Status**: Available buying power, margin utilization, and margin requirements
- **Fee Summary**: Total fees paid across all trades and time periods
- **Tax Information**: Realized gains/losses for tax reporting purposes

### Regulatory Compliance
- **KYC Integration**: Optional identity verification
- **Trade Reporting**: Regulatory reporting capabilities
- **Market Surveillance**: Detect manipulation and abuse
- **Data Export**: Support for compliance audits
- **Geographic Restrictions**: Market access controls

This comprehensive prompt provides the foundation for implementing a production-ready database schema that will support DexExtra's transformation into a professional-grade trading platform with institutional-level performance and unlimited market creation capabilities. Do not simplify the Order book matching logic.
