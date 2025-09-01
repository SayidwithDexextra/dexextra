// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../interfaces/IOrderBook.sol";
import "../interfaces/IOrderRouter.sol";
import "../interfaces/ICentralVault.sol";
import "../interfaces/ISettlementMarket.sol";
import "../interfaces/IUMAOracleIntegration.sol";
import "../libraries/OrderBookLib.sol";

/**
 * @title OrderBook
 * @dev Order book implementation for custom metrics trading
 * @notice Manages order matching and execution for a specific metric market
 */
contract OrderBook is 
    IOrderBook, 
    ISettlementMarket,
    AccessControl, 
    ReentrancyGuard, 
    Pausable, 
    Initializable 
{
    using OrderBookLib for OrderBookLib.OrderBook;

    // Roles
    bytes32 public constant MARKET_ADMIN_ROLE = keccak256("MARKET_ADMIN_ROLE");
    bytes32 public constant ROUTER_ROLE = keccak256("ROUTER_ROLE");
    bytes32 public constant SETTLEMENT_ROLE = keccak256("SETTLEMENT_ROLE");

    // Market configuration
    string public metricId;
    string public description;
    uint8 public decimals;
    uint256 public minimumOrderSize;
    uint256 public constant TICK_SIZE = 1e16; // 0.01 in 18 decimal precision
    uint256 public maximumOrderSize;

    // Contract addresses
    address public centralVault;
    address public orderRouter;
    address public umaOracleManager;
    bytes32 public umaIdentifier;

    // Settlement configuration
    uint256 public settlementDate;
    uint256 public tradingEndDate;
    uint256 public dataRequestWindow;
    bool public autoSettle;

    // Market state
    MarketState public marketState;
    SettlementInfo public settlementInfo;

    // Order book data
    OrderBookLib.OrderBook private orderBook;
    uint256 private nextOrderId;
    uint256 private constant PRICE_PRECISION = 1e18;

    // Position tracking for settlement
    mapping(address => Position[]) public userPositions;
    Position[] public allPositions;
    uint256 public nextPositionId;

    // Market statistics
    uint256 public lastUpdateTime;
    uint256 private constant STATS_WINDOW = 24 hours;

    // Events
    event MarketInitialized(
        string indexed metricId,
        address indexed vault,
        address indexed router,
        uint256 settlementDate
    );

    event OrderAdded(
        uint256 indexed orderId,
        address indexed trader,
        IOrderRouter.Side side,
        uint256 quantity,
        uint256 price
    );

    event OrderMatched(
        uint256 indexed buyOrderId,
        uint256 indexed sellOrderId,
        uint256 price,
        uint256 quantity,
        address buyer,
        address seller
    );

    event PositionCreated(
        uint256 indexed positionId,
        address indexed trader,
        bool isLong,
        uint256 quantity,
        uint256 entryPrice,
        uint256 collateral
    );

    modifier onlyRouter() {
        require(hasRole(ROUTER_ROLE, msg.sender), "OrderBook: Only router");
        _;
    }

    modifier onlyValidPrice(uint256 price) {
        require(price > 0, "OrderBook: Invalid price");
        require(price % TICK_SIZE == 0, "OrderBook: Price not aligned to tick size");
        _;
    }

    modifier onlyValidQuantity(uint256 quantity) {
        require(quantity >= minimumOrderSize, "OrderBook: Below minimum order size");
        require(maximumOrderSize == 0 || quantity <= maximumOrderSize, "OrderBook: Above maximum order size");
        _;
    }

    modifier onlyActiveTradingPeriod() {
        require(marketState == MarketState.ACTIVE, "OrderBook: Market not active");
        require(block.timestamp < tradingEndDate, "OrderBook: Trading period ended");
        _;
    }

    /**
     * @dev Initializes the order book (called by factory)
     */
    function initialize(
        string calldata _metricId,
        string calldata _description,
        uint8 _decimals,
        uint256 _minOrderSize,
        uint256 _tickSize, // Deprecated: tick size is now fixed at 0.01
        address _vault,
        address _router,
        address _oracleManager,
        bytes32 _umaIdentifier,
        uint256 _settlementDate,
        uint256 _tradingEndDate,
        uint256 _dataRequestWindow,
        bool _autoSettle
    ) external override initializer {
        require(bytes(_metricId).length > 0, "OrderBook: Empty metric ID");
        require(_vault != address(0), "OrderBook: Invalid vault");
        require(_router != address(0), "OrderBook: Invalid router");
        require(_oracleManager != address(0), "OrderBook: Invalid oracle manager");
        require(_settlementDate > block.timestamp, "OrderBook: Invalid settlement date");
        require(_tradingEndDate <= _settlementDate, "OrderBook: Invalid trading end date");

        // Set configuration
        metricId = _metricId;
        description = _description;
        decimals = _decimals;
        minimumOrderSize = _minOrderSize;
        // tickSize = _tickSize; // Removed: tick size is now constant
        maximumOrderSize = 0; // No limit by default

        // Set contract addresses
        centralVault = _vault;
        orderRouter = _router;
        umaOracleManager = _oracleManager;
        umaIdentifier = _umaIdentifier;

        // Set settlement configuration
        settlementDate = _settlementDate;
        tradingEndDate = _tradingEndDate;
        dataRequestWindow = _dataRequestWindow;
        autoSettle = _autoSettle;

        // Initialize state
        marketState = MarketState.ACTIVE;
        nextOrderId = 1;
        nextPositionId = 1;
        lastUpdateTime = block.timestamp;

        // Setup roles
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MARKET_ADMIN_ROLE, msg.sender);
        _grantRole(ROUTER_ROLE, _router);
        _grantRole(SETTLEMENT_ROLE, msg.sender);

        emit MarketInitialized(_metricId, _vault, _router, _settlementDate);
    }

    /**
     * @dev Adds an order to the order book
     */
    function addOrder(IOrderRouter.Order calldata order)
        external
        override
        onlyRouter
        nonReentrant
        whenNotPaused
        onlyActiveTradingPeriod
        onlyValidPrice(order.price)
        onlyValidQuantity(order.quantity)
        returns (bool success)
    {
        require(keccak256(bytes(order.metricId)) == keccak256(bytes(metricId)), "OrderBook: Wrong metric");
        require(order.trader != address(0), "OrderBook: Invalid trader");

        // Check if order is already expired before adding
        if (order.timeInForce == IOrderRouter.TimeInForce.GTD && 
            order.expiryTime > 0 && 
            block.timestamp >= order.expiryTime) {
            // Order is already expired, reject it
            return false;
        }

        // Create internal order with unique ID
        IOrderRouter.Order memory internalOrder = order;
        internalOrder.orderId = nextOrderId++;
        internalOrder.timestamp = block.timestamp;
        internalOrder.status = IOrderRouter.OrderStatus.PENDING;

        // Check collateral requirements with vault
        _validateCollateral(order.trader, order.quantity, order.price, order.side);

        // Add to order book
        orderBook.addOrder(internalOrder);

        // Try to match immediately if market order or if there's a cross
        if (order.orderType == IOrderRouter.OrderType.MARKET || _canExecuteImmediately(internalOrder)) {
            _executeOrder(internalOrder.orderId);
        }

        emit OrderAdded(internalOrder.orderId, order.trader, order.side, order.quantity, order.price);
        return true;
    }

    /**
     * @dev Removes an order from the order book
     */
    function removeOrder(uint256 orderId)
        external
        override
        onlyRouter
        nonReentrant
        returns (bool success)
    {
        orderBook.removeOrder(orderId);
        return true;
    }

    /**
     * @dev Matches orders and executes trades
     */
    function matchOrder(uint256 orderId)
        external
        override
        onlyRouter
        nonReentrant
        whenNotPaused
        returns (uint256 executedQuantity, uint256 averagePrice)
    {
        return _executeOrder(orderId);
    }

    /**
     * @dev Returns the best bid price
     */
    function getBestBid() external view override returns (uint256 price) {
        return orderBook.getBestBid();
    }

    /**
     * @dev Returns the best ask price
     */
    function getBestAsk() external view override returns (uint256 price) {
        return orderBook.getBestAsk();
    }

    /**
     * @dev Returns the current spread
     */
    function getSpread() external view override returns (uint256 spread) {
        uint256 bestBid = orderBook.getBestBid();
        uint256 bestAsk = orderBook.getBestAsk();
        
        if (bestBid == 0 || bestAsk == 0) {
            return 0;
        }
        
        return bestAsk > bestBid ? bestAsk - bestBid : 0;
    }

    /**
     * @dev Returns price levels for a given side
     */
    function getPriceLevels(IOrderRouter.Side side, uint256 depth)
        external
        view
        override
        returns (PriceLevel[] memory levels)
    {
        // Implementation would traverse the Red-Black tree to get price levels
        // For now, returning empty array as RB tree traversal is complex
        levels = new PriceLevel[](0);
    }

    /**
     * @dev Returns orders at a specific price level
     */
    function getOrdersAtPrice(IOrderRouter.Side side, uint256 price)
        external
        view
        override
        returns (uint256[] memory orderIds)
    {
        return orderBook.getOrdersAtPrice(side, price);
    }

    /**
     * @dev Returns market statistics
     */
    function getMarketStats()
        external
        view
        override
        returns (MarketStats memory stats)
    {
        stats.lastPrice = orderBook.lastTradePrice;
        stats.volume24h = orderBook.volume24h;
        stats.high24h = orderBook.high24h;
        stats.low24h = orderBook.low24h;
        
        uint256 currentPrice = orderBook.lastTradePrice;
        uint256 startPrice = _get24hStartPrice();
        
        if (startPrice > 0) {
            stats.priceChange24h = int256(currentPrice) - int256(startPrice);
        }
        
        stats.totalTrades = orderBook.totalTrades;
        stats.bestBid = orderBook.getBestBid();
        stats.bestAsk = orderBook.getBestAsk();
        
        if (stats.bestBid > 0 && stats.bestAsk > 0) {
            stats.spread = stats.bestAsk - stats.bestBid;
        }
    }

    /**
     * @dev Returns total volume at a price level
     */
    function getVolumeAtPrice(IOrderRouter.Side side, uint256 price)
        external
        view
        override
        returns (uint256 volume)
    {
        return orderBook.getVolumeAtPrice(side, price);
    }

    /**
     * @dev Estimates the impact of a market order
     */
    function estimateMarketOrder(IOrderRouter.Side side, uint256 quantity)
        external
        view
        override
        returns (uint256 averagePrice, uint256 priceImpact)
    {
        // Simplified estimation - would need full order book traversal for accuracy
        uint256 bestPrice = side == IOrderRouter.Side.BUY ? orderBook.getBestAsk() : orderBook.getBestBid();
        
        if (bestPrice == 0) {
            return (0, 0);
        }
        
        // Simplified calculation - assume 1% impact per order size relative to minimum
        uint256 impactBps = (quantity * 100) / minimumOrderSize;
        priceImpact = (bestPrice * impactBps) / 10000;
        averagePrice = side == IOrderRouter.Side.BUY ? bestPrice + priceImpact : bestPrice - priceImpact;
    }

    /**
     * @dev Returns the metric ID this order book serves
     */
    function getMetricId() external view override returns (string memory) {
        return metricId;
    }

    /**
     * @dev Returns order book configuration
     */
    function getConfiguration()
        external
        view
        override
        returns (uint256, uint256, uint256)
    {
        return (TICK_SIZE, minimumOrderSize, maximumOrderSize);
    }

    /**
     * @dev Updates market configuration (admin only)
     */
    function updateConfiguration(
        uint256 _tickSize, // Deprecated: tick size is now fixed at 0.01
        uint256 _minOrderSize,
        uint256 _maxOrderSize
    ) external override onlyRole(MARKET_ADMIN_ROLE) {
        // _tickSize parameter is ignored - tick size is now constant
        require(_minOrderSize > 0, "OrderBook: Invalid min order size");
        
        minimumOrderSize = _minOrderSize;
        maximumOrderSize = _maxOrderSize;
    }

    /**
     * @dev Pauses/unpauses the order book
     */
    function setPaused(bool _isPaused) external override(IOrderBook, ISettlementMarket) onlyRole(MARKET_ADMIN_ROLE) {
        if (_isPaused) {
            _pause();
        } else {
            _unpause();
        }
    }

    /**
     * @dev Returns pause status
     */
    function isPaused() external view override returns (bool) {
        return paused();
    }

    /**
     * @dev Returns total number of orders in the book
     */
    function getTotalOrders() external view override returns (uint256) {
        return orderBook.buyOrders.totalOrders + orderBook.sellOrders.totalOrders;
    }

    /**
     * @dev Returns total number of orders for a side
     */
    function getOrderCount(IOrderRouter.Side side)
        external
        view
        override
        returns (uint256)
    {
        return side == IOrderRouter.Side.BUY ? 
            orderBook.buyOrders.totalOrders : 
            orderBook.sellOrders.totalOrders;
    }

    /**
     * @dev Clears all orders from the book (emergency only)
     */
    function clearOrderBook() external override onlyRole(MARKET_ADMIN_ROLE) {
        // Reset order book state
        delete orderBook;
        nextOrderId = 1;
    }

    // Settlement Market Implementation

    /**
     * @dev Gets the current market state
     */
    function getMarketState() external view override returns (MarketState) {
        return marketState;
    }

    /**
     * @dev Gets settlement information
     */
    function getSettlementInfo() external view override returns (SettlementInfo memory) {
        return settlementInfo;
    }

    /**
     * @dev Gets market timing information
     */
    function getMarketTiming()
        external
        view
        override
        returns (uint256, uint256, uint256)
    {
        return (settlementDate, tradingEndDate, dataRequestWindow);
    }

    /**
     * @dev Checks if trading is currently allowed
     */
    function isTradingAllowed() external view override returns (bool) {
        return marketState == MarketState.ACTIVE && block.timestamp < tradingEndDate;
    }

    /**
     * @dev Checks if market is ready for settlement
     */
    function isReadyForSettlement() external view override returns (bool) {
        return block.timestamp >= settlementDate - dataRequestWindow && !settlementInfo.isSettled;
    }

    /**
     * @dev Requests settlement data from UMA Oracle
     */
    function requestSettlement(bytes calldata ancillaryData)
        external
        override
        onlyRole(SETTLEMENT_ROLE)
        returns (bytes32 requestId)
    {
        require(marketState == MarketState.TRADING_ENDED || block.timestamp >= tradingEndDate, "OrderBook: Trading not ended");
        require(!settlementInfo.isSettled, "OrderBook: Already settled");
        
        marketState = MarketState.SETTLEMENT_REQUESTED;
        
        // Request data from UMA Oracle Manager
        requestId = IUMAOracleIntegration(umaOracleManager).requestMetricData(
            umaIdentifier,
            settlementDate,
            ancillaryData,
            0, // Use default reward
            0  // Use default liveness
        );
        
        settlementInfo.umaRequestId = requestId;
        
        emit SettlementRequested(metricId, requestId, settlementDate, ancillaryData);
        return requestId;
    }

    /**
     * @dev Settles the market with final value from UMA
     */
    function settleMarket(int256 finalValue) external override onlyRole(SETTLEMENT_ROLE) {
        require(marketState == MarketState.SETTLEMENT_REQUESTED, "OrderBook: Settlement not requested");
        require(!settlementInfo.isSettled, "OrderBook: Already settled");
        
        // Verify UMA has resolved the request
        bytes32 requestId = settlementInfo.umaRequestId;
        (bool isResolved, int256 resolvedValue) = IUMAOracleIntegration(umaOracleManager).getRequestStatus(requestId);
        require(isResolved, "OrderBook: UMA not resolved");
        require(resolvedValue == finalValue, "OrderBook: Value mismatch");
        
        // Update settlement info
        settlementInfo.isSettled = true;
        settlementInfo.settlementValue = finalValue;
        settlementInfo.settlementTimestamp = block.timestamp;
        settlementInfo.totalPositions = allPositions.length;
        
        marketState = MarketState.SETTLED;
        
        emit MarketSettled(metricId, finalValue, block.timestamp, 0);
    }

    /**
     * @dev Settles individual positions after market settlement
     */
    function settlePositions(uint256[] calldata positionIds) external override nonReentrant {
        require(settlementInfo.isSettled, "OrderBook: Market not settled");
        require(positionIds.length > 0, "OrderBook: No positions to settle");
        require(positionIds.length <= 100, "OrderBook: Too many positions in batch"); // Gas limit protection
        
        uint256 totalPayouts = 0;
        
        for (uint256 i = 0; i < positionIds.length; i++) {
            uint256 positionId = positionIds[i];
            require(positionId > 0 && positionId <= allPositions.length, "OrderBook: Invalid position ID");
            
            Position storage position = allPositions[positionId - 1];
            require(!position.isSettled, "OrderBook: Position already settled");
            require(position.trader != address(0), "OrderBook: Invalid position trader");
            
            (uint256 payout, int256 pnl) = calculatePositionPayout(positionId, settlementInfo.settlementValue);
            
            // Mark as settled before external calls to prevent reentrancy
            position.isSettled = true;
            position.payout = payout;
            
            // Overflow protection for total payouts
            require(totalPayouts <= type(uint256).max - payout, "OrderBook: Total payouts overflow");
            totalPayouts += payout;
            
            // Deallocate original collateral and transfer payout
            (address primaryCollateral,,,) = ICentralVault(centralVault).getPrimaryCollateralToken();
            
            // Deallocate the original collateral
            ICentralVault(centralVault).deallocateAssets(
                position.trader,
                primaryCollateral,
                position.collateral
            );
            
            // Transfer final payout if any
            if (payout > 0) {
                ICentralVault(centralVault).transferAssets(
                    address(this),
                    position.trader,
                    primaryCollateral,
                    payout
                );
            }
            
            emit PositionSettled(position.trader, metricId, positionId, payout, pnl);
        }
        
        // Overflow protection for settlement info
        require(settlementInfo.totalPayouts <= type(uint256).max - totalPayouts, "OrderBook: Settlement payouts overflow");
        settlementInfo.totalPayouts += totalPayouts;
    }

    /**
     * @dev Gets user's positions in the market
     */
    function getUserPositions(address trader)
        external
        view
        override
        returns (Position[] memory positions)
    {
        return userPositions[trader];
    }

    /**
     * @dev Gets all positions in the market
     */
    function getAllPositions(uint256 offset, uint256 limit)
        external
        view
        override
        returns (Position[] memory positions)
    {
        uint256 end = offset + limit;
        if (end > allPositions.length) {
            end = allPositions.length;
        }
        
        positions = new Position[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            positions[i - offset] = allPositions[i];
        }
    }

    /**
     * @dev Calculates settlement payout for a position
     */
    function calculatePositionPayout(uint256 positionId, int256 settlementValue)
        public
        view
        override
        returns (uint256 payout, int256 pnl)
    {
        require(positionId > 0 && positionId <= allPositions.length, "OrderBook: Invalid position ID");
        require(settlementValue >= 0, "OrderBook: Invalid settlement value");
        
        Position memory position = allPositions[positionId - 1];
        uint256 entryPrice = position.entryPrice;
        uint256 quantity = position.quantity;
        uint256 collateral = position.collateral;
        uint256 settlementValueUint = uint256(settlementValue);
        
        require(entryPrice > 0 && quantity > 0, "OrderBook: Invalid position data");
        
        if (position.isLong) {
            // Long position: profit if settlement > entry
            if (settlementValueUint > entryPrice) {
                // Safe arithmetic with overflow protection
                uint256 priceDiff = settlementValueUint - entryPrice;
                require(priceDiff <= type(uint256).max / quantity, "OrderBook: Calculation overflow");
                uint256 profit = (priceDiff * quantity) / PRICE_PRECISION;
                
                // Prevent overflow in addition
                require(profit <= type(uint256).max - collateral, "OrderBook: Payout overflow");
                payout = collateral + profit;
                pnl = int256(profit);
            } else {
                uint256 priceDiff = entryPrice - settlementValueUint;
                require(priceDiff <= type(uint256).max / quantity, "OrderBook: Calculation overflow");
                uint256 loss = (priceDiff * quantity) / PRICE_PRECISION;
                
                if (loss >= collateral) {
                    payout = 0;
                    pnl = -int256(collateral);
                } else {
                    payout = collateral - loss;
                    pnl = -int256(loss);
                }
            }
        } else {
            // Short position: profit if settlement < entry
            if (settlementValueUint < entryPrice) {
                uint256 priceDiff = entryPrice - settlementValueUint;
                require(priceDiff <= type(uint256).max / quantity, "OrderBook: Calculation overflow");
                uint256 profit = (priceDiff * quantity) / PRICE_PRECISION;
                
                require(profit <= type(uint256).max - collateral, "OrderBook: Payout overflow");
                payout = collateral + profit;
                pnl = int256(profit);
            } else {
                uint256 priceDiff = settlementValueUint - entryPrice;
                require(priceDiff <= type(uint256).max / quantity, "OrderBook: Calculation overflow");
                uint256 loss = (priceDiff * quantity) / PRICE_PRECISION;
                
                if (loss >= collateral) {
                    payout = 0;
                    pnl = -int256(collateral);
                } else {
                    payout = collateral - loss;
                    pnl = -int256(loss);
                }
            }
        }
    }

    /**
     * @dev Gets total open interest (long and short)
     */
    function getOpenInterest()
        external
        view
        override
        returns (uint256 longInterest, uint256 shortInterest)
    {
        for (uint256 i = 0; i < allPositions.length; i++) {
            Position memory position = allPositions[i];
            if (!position.isSettled) {
                if (position.isLong) {
                    longInterest += position.quantity;
                } else {
                    shortInterest += position.quantity;
                }
            }
        }
    }

    /**
     * @dev Gets settlement statistics
     */
    function getSettlementStats()
        external
        view
        override
        returns (uint256, uint256, int256, uint256)
    {
        uint256 totalPositions = allPositions.length;
        uint256 totalPayouts = settlementInfo.totalPayouts;
        int256 averagePnL = 0;
        uint256 settledPositions = 0;
        
        int256 totalPnL = 0;
        for (uint256 i = 0; i < allPositions.length; i++) {
            if (allPositions[i].isSettled) {
                settledPositions++;
                if (settlementInfo.isSettled) {
                    (, int256 pnl) = calculatePositionPayout(i + 1, settlementInfo.settlementValue);
                    totalPnL += pnl;
                }
            }
        }
        
        if (settledPositions > 0) {
            averagePnL = totalPnL / int256(settledPositions);
        }
        
        return (totalPositions, totalPayouts, averagePnL, settledPositions);
    }

    /**
     * @dev Emergency function to extend trading deadline
     */
    function extendMarketDeadline(
        uint256 newTradingEndDate,
        uint256 newSettlementDate
    ) external override onlyRole(MARKET_ADMIN_ROLE) {
        require(newTradingEndDate > tradingEndDate, "OrderBook: Cannot shorten trading period");
        require(newSettlementDate >= newTradingEndDate, "OrderBook: Invalid settlement date");
        
        tradingEndDate = newTradingEndDate;
        settlementDate = newSettlementDate;
    }

    /**
     * @dev Gets time until various market events
     */
    function getTimeToEvents()
        external
        view
        override
        returns (uint256, uint256, uint256)
    {
        uint256 currentTime = block.timestamp;
        
        uint256 timeToTradingEnd = tradingEndDate > currentTime ? tradingEndDate - currentTime : 0;
        uint256 timeToSettlement = settlementDate > currentTime ? settlementDate - currentTime : 0;
        uint256 timeToDataRequest = (settlementDate - dataRequestWindow) > currentTime ? 
            (settlementDate - dataRequestWindow) - currentTime : 0;
        
        return (timeToTradingEnd, timeToSettlement, timeToDataRequest);
    }

    /**
     * @dev Checks if position can be modified
     */
    function canModifyPosition(uint256 positionId)
        external
        view
        override
        returns (bool canModify, string memory reason)
    {
        if (positionId == 0 || positionId > allPositions.length) {
            return (false, "Invalid position ID");
        }
        
        Position memory position = allPositions[positionId - 1];
        
        if (position.isSettled) {
            return (false, "Position already settled");
        }
        
        if (marketState != MarketState.ACTIVE) {
            return (false, "Market not active");
        }
        
        if (block.timestamp >= tradingEndDate) {
            return (false, "Trading period ended");
        }
        
        return (true, "");
    }

    /**
     * @dev Gets market settlement deadline info
     */
    function getSettlementDeadline()
        external
        view
        override
        returns (uint256 deadline, bool isExpired)
    {
        deadline = settlementDate + 7 days; // 7 day settlement window
        isExpired = block.timestamp > deadline;
    }

    // Internal functions

    /**
     * @dev Validates collateral requirements
     */
    function _validateCollateral(
        address trader,
        uint256 quantity,
        uint256 price,
        IOrderRouter.Side side
    ) internal view {
        uint256 requiredCollateral = (quantity * price) / PRICE_PRECISION;
        
        // Get primary collateral token from vault
        (address primaryCollateral,,,) = ICentralVault(centralVault).getPrimaryCollateralToken();
        
        // Convert from 18-decimal precision to token's native precision
        uint256 tokenDecimals = IERC20Metadata(primaryCollateral).decimals();
        uint256 adjustedCollateral = requiredCollateral / (10**(18 - tokenDecimals));
        
        // Check with vault for primary collateral (now in correct precision)
        require(
            ICentralVault(centralVault).hasSufficientBalance(trader, primaryCollateral, adjustedCollateral),
            "OrderBook: Insufficient collateral"
        );
    }

    /**
     * @dev Checks if order can execute immediately
     */
    function _canExecuteImmediately(IOrderRouter.Order memory order) internal view returns (bool) {
        uint256 bestCounterPrice = order.side == IOrderRouter.Side.BUY ? 
            orderBook.getBestAsk() : orderBook.getBestBid();
        
        if (bestCounterPrice == 0) {
            return false;
        }
        
        return order.side == IOrderRouter.Side.BUY ? 
            order.price >= bestCounterPrice : 
            order.price <= bestCounterPrice;
    }

    /**
     * @dev Executes order matching
     */
    function _executeOrder(uint256 orderId) internal returns (uint256 executedQuantity, uint256 averagePrice) {
        IOrderRouter.Order storage order = orderBook.orders[orderId];
        require(order.orderId != 0, "OrderBook: Order not found");
        require(order.quantity > order.filledQuantity, "OrderBook: Order already filled");
        
        uint256 fillQuantity = order.quantity - order.filledQuantity;
        uint256 fillPrice = order.price;
        
        // Validate price and quantity
        require(fillPrice > 0, "OrderBook: Invalid fill price");
        require(fillQuantity > 0, "OrderBook: No quantity to fill");
        
        // Check for arithmetic overflow in collateral calculation
        require(fillQuantity <= type(uint256).max / fillPrice, "OrderBook: Collateral calculation overflow");
        uint256 collateralRequired = (fillQuantity * fillPrice) / PRICE_PRECISION;
        
        // Validate with central vault
        (address primaryCollateral,,,) = ICentralVault(centralVault).getPrimaryCollateralToken();
        
        // Convert from 18-decimal precision to token's native precision
        uint256 tokenDecimals = IERC20Metadata(primaryCollateral).decimals();
        uint256 adjustedCollateralRequired = collateralRequired / (10**(18 - tokenDecimals));
        
        require(
            ICentralVault(centralVault).hasSufficientBalance(order.trader, primaryCollateral, adjustedCollateralRequired),
            "OrderBook: Insufficient collateral for execution"
        );
        
        // Create position with safe arithmetic
        Position memory newPosition = Position({
            trader: order.trader,
            isLong: order.side == IOrderRouter.Side.BUY,
            quantity: fillQuantity,
            entryPrice: fillPrice,
            collateral: adjustedCollateralRequired, // Use adjusted amount for consistent precision
            isSettled: false,
            payout: 0
        });
        
        // Allocate collateral in vault (using adjusted amount)
        ICentralVault(centralVault).allocateAssets(order.trader, primaryCollateral, adjustedCollateralRequired);
        
        allPositions.push(newPosition);
        userPositions[order.trader].push(newPosition);
        
        // Update order status
        order.filledQuantity = order.quantity;
        order.status = IOrderRouter.OrderStatus.FILLED;
        
        // Update market stats with overflow protection
        orderBook.lastTradePrice = fillPrice;
        require(orderBook.totalTrades < type(uint256).max, "OrderBook: Trade counter overflow");
        orderBook.totalTrades++;
        
        // Update volume with overflow protection
        uint256 tradeVolume = fillQuantity * fillPrice / PRICE_PRECISION;
        require(orderBook.volume24h <= type(uint256).max - tradeVolume, "OrderBook: Volume overflow");
        orderBook.volume24h += tradeVolume;
        
        // Update 24h high/low safely
        if (orderBook.high24h == 0 || fillPrice > orderBook.high24h) {
            orderBook.high24h = fillPrice;
        }
        if (orderBook.low24h == 0 || fillPrice < orderBook.low24h) {
            orderBook.low24h = fillPrice;
        }
        
        emit PositionCreated(
            nextPositionId++,
            order.trader,
            newPosition.isLong,
            fillQuantity,
            fillPrice,
            newPosition.collateral
        );
        
        return (fillQuantity, fillPrice);
    }

    /**
     * @dev Gets 24h start price for stats calculation
     */
    function _get24hStartPrice() internal view returns (uint256) {
        // Simplified - would need historical price tracking for accuracy
        return orderBook.lastTradePrice;
    }
}
