// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "../interfaces/IOrderRouter.sol";
import "../interfaces/IOrderBook.sol";
import "../interfaces/ICentralVault.sol";
import "../interfaces/IUMAOracleIntegration.sol";

/**
 * @title OrderRouter
 * @dev Routes orders, manages P&L tracking, and handles advanced order types
 * @notice Central routing system for all trading operations across markets
 */
contract OrderRouter is IOrderRouter, AccessControl, ReentrancyGuard, Pausable {
    using Counters for Counters.Counter;

    // Roles
    bytes32 public constant ROUTER_ADMIN_ROLE = keccak256("ROUTER_ADMIN_ROLE");
    bytes32 public constant MARKET_ROLE = keccak256("MARKET_ROLE");

    // Constants
    uint256 public constant MAX_ORDERS_PER_USER = 1000; // Maximum active orders per user
    uint256 public constant MAX_SLIPPAGE_BPS = 5000; // 50%
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant PRECISION = 1e18;

    // State variables
    ICentralVault public immutable centralVault;
    IUMAOracleIntegration public immutable umaOracleManager;
    uint256 public tradingFeeRate; // In basis points
    address public feeRecipient;

    // Order management
    Counters.Counter private orderIdCounter;
    mapping(uint256 => Order) public orders;
    mapping(address => uint256[]) public userOrders;
    mapping(string => address) public marketOrderBooks;

    // P&L tracking
    mapping(address => mapping(string => PnLSummary)) public userPnL;
    mapping(address => uint256) public userSlippageSettings;

    // Trade execution tracking
    mapping(uint256 => TradeExecution[]) public orderExecutions;
    mapping(address => uint256) public userTotalVolume;
    mapping(address => uint256) public userTotalFees;

    // Risk management
    struct RiskLimits {
        uint256 maxPositionSize;
        uint256 maxDailyVolume;
        uint256 maxOpenOrders;
        bool enabled;
    }
    
    mapping(address => RiskLimits) public userRiskLimits;
    mapping(address => mapping(uint256 => uint256)) public dailyVolume; // user => day => volume

    // Events
    event MarketRegistered(string indexed metricId, address indexed orderBook);
    event MarketDeregistered(string indexed metricId, address indexed orderBook);
    event TradingFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event UserRiskLimitsUpdated(address indexed user, uint256 maxPosition, uint256 maxDailyVolume, uint256 maxOrders);
    event SlippageProtectionUpdated(address indexed user, uint256 maxSlippage);
    event OrderLimitReached(address indexed user, uint256 activeOrders, uint256 maxActiveOrders);
    event OrderExpired(uint256 indexed orderId, address indexed trader, string indexed metricId);
    event BatchOrdersExpired(uint256[] orderIds, address indexed caller);

    modifier onlyRegisteredMarket(string calldata metricId) {
        require(marketOrderBooks[metricId] != address(0), "OrderRouter: Market not registered");
        _;
    }

    modifier validOrder(Order calldata order) {
        require(order.trader != address(0), "OrderRouter: Invalid trader");
        require(order.quantity > 0, "OrderRouter: Invalid quantity");
        require(bytes(order.metricId).length > 0, "OrderRouter: Empty metric ID");
        _;
    }

    /**
     * @dev Constructor
     */
    constructor(
        address _centralVault,
        address _umaOracleManager,
        address _admin,
        uint256 _tradingFeeRate
    ) {
        require(_centralVault != address(0), "OrderRouter: Invalid vault");
        require(_umaOracleManager != address(0), "OrderRouter: Invalid oracle manager");
        require(_admin != address(0), "OrderRouter: Invalid admin");
        require(_tradingFeeRate <= 1000, "OrderRouter: Fee too high"); // Max 10%

        centralVault = ICentralVault(_centralVault);
        umaOracleManager = IUMAOracleIntegration(_umaOracleManager);
        tradingFeeRate = _tradingFeeRate;
        feeRecipient = _admin;

        // Setup roles
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ROUTER_ADMIN_ROLE, _admin);

        // Initialize order counter
        orderIdCounter.increment(); // Start from 1
    }

    /**
     * @dev Places a new order
     */
    function placeOrder(Order calldata order)
        external
        override
        nonReentrant
        whenNotPaused
        onlyRegisteredMarket(order.metricId)
        validOrder(order)
        returns (uint256 orderId)
    {
        require(order.trader == msg.sender, "OrderRouter: Unauthorized trader");
        
        // Enforce maximum active orders per user limit
        uint256 activeOrderCount = _getActiveOrderCount(msg.sender);
        if (activeOrderCount >= MAX_ORDERS_PER_USER) {
            emit OrderLimitReached(msg.sender, activeOrderCount, MAX_ORDERS_PER_USER);
            revert("OrderRouter: Exceeds maximum active orders per user");
        }
        
        // Check user risk limits
        _validateRiskLimits(msg.sender, order);

        // Generate unique order ID
        orderId = orderIdCounter.current();
        orderIdCounter.increment();

        // Create order with assigned ID
        Order memory newOrder = order;
        newOrder.orderId = orderId;
        newOrder.timestamp = block.timestamp;
        newOrder.status = OrderStatus.PENDING;

        // Validate order based on type
        _validateOrderType(newOrder);

        // Store order
        orders[orderId] = newOrder;
        userOrders[msg.sender].push(orderId);

        // Route to appropriate order book
        address orderBookAddress = marketOrderBooks[order.metricId];
        bool success = IOrderBook(orderBookAddress).addOrder(newOrder);
        require(success, "OrderRouter: Order book rejected order");

        emit OrderPlaced(
            orderId,
            msg.sender,
            order.metricId,
            order.orderType,
            order.side,
            order.quantity,
            order.price
        );

        return orderId;
    }

    /**
     * @dev Cancels an existing order
     */
    function cancelOrder(uint256 orderId) external override nonReentrant {
        Order storage order = orders[orderId];
        require(order.orderId != 0, "OrderRouter: Order not found");
        require(order.trader == msg.sender, "OrderRouter: Unauthorized");
        require(
            order.status == OrderStatus.PENDING || order.status == OrderStatus.PARTIALLY_FILLED,
            "OrderRouter: Cannot cancel order"
        );

        // Update order status
        order.status = OrderStatus.CANCELLED;

        // Remove from order book
        address orderBookAddress = marketOrderBooks[order.metricId];
        IOrderBook(orderBookAddress).removeOrder(orderId);

        emit OrderCancelled(orderId, msg.sender, order.quantity - order.filledQuantity);
    }

    /**
     * @dev Modifies an existing order
     */
    function modifyOrder(
        uint256 orderId,
        uint256 newQuantity,
        uint256 newPrice
    ) external override nonReentrant {
        Order storage order = orders[orderId];
        require(order.orderId != 0, "OrderRouter: Order not found");
        require(order.trader == msg.sender, "OrderRouter: Unauthorized");
        require(order.status == OrderStatus.PENDING, "OrderRouter: Cannot modify order");
        require(newQuantity > 0, "OrderRouter: Invalid quantity");

        // Cancel existing order
        order.status = OrderStatus.CANCELLED;
        address orderBookAddress = marketOrderBooks[order.metricId];
        IOrderBook(orderBookAddress).removeOrder(orderId);

        // Create new order with modified parameters
        Order memory modifiedOrder = order;
        modifiedOrder.quantity = newQuantity;
        modifiedOrder.price = newPrice;
        modifiedOrder.status = OrderStatus.PENDING;
        modifiedOrder.timestamp = block.timestamp;

        // Place modified order
        orders[orderId] = modifiedOrder;
        IOrderBook(orderBookAddress).addOrder(modifiedOrder);
    }

    /**
     * @dev Batch order operations
     */
    function batchOperations(
        Order[] calldata ordersToPlace,
        uint256[] calldata cancellations
    ) external override nonReentrant whenNotPaused {
        // Check that batch operation won't exceed max active orders limit before starting
        uint256 activeOrderCount = _getActiveOrderCount(msg.sender);
        uint256 totalAfterBatch = activeOrderCount + ordersToPlace.length;
        if (totalAfterBatch > MAX_ORDERS_PER_USER) {
            emit OrderLimitReached(msg.sender, activeOrderCount, MAX_ORDERS_PER_USER);
            revert("OrderRouter: Batch operation would exceed maximum active orders per user");
        }
        
        // Cancel orders first
        for (uint256 i = 0; i < cancellations.length; i++) {
            uint256 orderId = cancellations[i];
            Order storage order = orders[orderId];
            
            if (order.orderId != 0 && order.trader == msg.sender && 
                (order.status == OrderStatus.PENDING || order.status == OrderStatus.PARTIALLY_FILLED)) {
                
                order.status = OrderStatus.CANCELLED;
                address orderBookAddress = marketOrderBooks[order.metricId];
                IOrderBook(orderBookAddress).removeOrder(orderId);
                
                emit OrderCancelled(orderId, msg.sender, order.quantity - order.filledQuantity);
            }
        }

        // Place new orders
        for (uint256 i = 0; i < ordersToPlace.length; i++) {
            Order calldata order = ordersToPlace[i];
            require(order.trader == msg.sender, "OrderRouter: Unauthorized trader");
            
            if (marketOrderBooks[order.metricId] != address(0)) {
                this.placeOrder(order);
            }
        }
    }

    /**
     * @dev Returns order details
     */
    function getOrder(uint256 orderId)
        external
        view
        override
        returns (Order memory order)
    {
        return orders[orderId];
    }

    /**
     * @dev Returns user's active orders
     */
    function getUserActiveOrders(address trader)
        external
        view
        override
        returns (Order[] memory activeOrders)
    {
        uint256[] memory userOrderIds = userOrders[trader];
        uint256 activeCount = 0;

        // Count active orders
        for (uint256 i = 0; i < userOrderIds.length; i++) {
            Order memory order = orders[userOrderIds[i]];
            if (order.status == OrderStatus.PENDING || order.status == OrderStatus.PARTIALLY_FILLED) {
                activeCount++;
            }
        }

        // Build result array
        activeOrders = new Order[](activeCount);
        uint256 index = 0;
        for (uint256 i = 0; i < userOrderIds.length; i++) {
            Order memory order = orders[userOrderIds[i]];
            if (order.status == OrderStatus.PENDING || order.status == OrderStatus.PARTIALLY_FILLED) {
                activeOrders[index] = order;
                index++;
            }
        }
    }

    /**
     * @dev Returns user's order history
     */
    function getUserOrderHistory(
        address trader,
        uint256 limit,
        uint256 offset
    ) external view override returns (Order[] memory historicalOrders) {
        uint256[] memory userOrderIds = userOrders[trader];
        
        uint256 start = offset;
        uint256 end = offset + limit;
        if (end > userOrderIds.length) {
            end = userOrderIds.length;
        }
        if (start >= userOrderIds.length) {
            return new Order[](0);
        }

        historicalOrders = new Order[](end - start);
        for (uint256 i = start; i < end; i++) {
            historicalOrders[i - start] = orders[userOrderIds[userOrderIds.length - 1 - i]]; // Reverse order
        }
    }

    /**
     * @dev Returns trade executions for an order
     */
    function getOrderExecutions(uint256 orderId)
        external
        view
        override
        returns (TradeExecution[] memory executions)
    {
        return orderExecutions[orderId];
    }

    /**
     * @dev Returns user's P&L summary
     */
    function getUserPnL(address trader, string calldata metricId)
        external
        view
        override
        returns (PnLSummary memory summary)
    {
        if (bytes(metricId).length == 0) {
            // Return aggregate P&L across all metrics (simplified)
            summary.totalVolume = userTotalVolume[trader];
            summary.totalFees = userTotalFees[trader];
            // Note: Aggregating P&L across metrics would require more complex logic
        } else {
            summary = userPnL[trader][metricId];
        }
    }

    /**
     * @dev Returns market depth for a metric
     */
    function getMarketDepth(string calldata metricId, uint256 depth)
        external
        view
        override
        onlyRegisteredMarket(metricId)
        returns (Order[] memory buyOrders, Order[] memory sellOrders)
    {
        // This would require order book integration to get actual depth
        // For now, returning empty arrays
        buyOrders = new Order[](0);
        sellOrders = new Order[](0);
    }

    /**
     * @dev Estimates order execution price and quantity
     */
    function estimateExecution(
        string calldata metricId,
        Side side,
        uint256 quantity
    )
        external
        view
        override
        onlyRegisteredMarket(metricId)
        returns (uint256 estimatedPrice, uint256 estimatedQuantity, uint256 priceImpact)
    {
        address orderBookAddress = marketOrderBooks[metricId];
        (uint256 avgPrice, uint256 impact) = IOrderBook(orderBookAddress).estimateMarketOrder(side, quantity);
        return (avgPrice, quantity, impact); // Assuming full quantity can be executed
    }

    /**
     * @dev Sets slippage protection parameters
     */
    function setSlippageProtection(uint256 maxSlippage) external override {
        require(maxSlippage <= MAX_SLIPPAGE_BPS, "OrderRouter: Slippage too high");
        
        userSlippageSettings[msg.sender] = maxSlippage;
        
        emit SlippageProtectionUpdated(msg.sender, maxSlippage);
    }

    /**
     * @dev Returns current slippage protection setting
     */
    function getSlippageProtection(address trader)
        external
        view
        override
        returns (uint256 maxSlippage)
    {
        return userSlippageSettings[trader];
    }

    /**
     * @dev Registers a new market order book
     */
    function registerMarket(string calldata metricId, address orderBook)
        external
        onlyRole(ROUTER_ADMIN_ROLE)
    {
        require(bytes(metricId).length > 0, "OrderRouter: Empty metric ID");
        require(orderBook != address(0), "OrderRouter: Invalid order book");
        require(marketOrderBooks[metricId] == address(0), "OrderRouter: Market already registered");

        marketOrderBooks[metricId] = orderBook;
        
        emit MarketRegistered(metricId, orderBook);
    }

    /**
     * @dev Deregisters a market order book
     */
    function deregisterMarket(string calldata metricId)
        external
        onlyRole(ROUTER_ADMIN_ROLE)
    {
        address orderBook = marketOrderBooks[metricId];
        require(orderBook != address(0), "OrderRouter: Market not registered");

        delete marketOrderBooks[metricId];
        
        emit MarketDeregistered(metricId, orderBook);
    }

    /**
     * @dev Updates trading fee rate
     */
    function setTradingFeeRate(uint256 newFeeRate)
        external
        onlyRole(ROUTER_ADMIN_ROLE)
    {
        require(newFeeRate <= 1000, "OrderRouter: Fee too high"); // Max 10%
        
        uint256 oldFee = tradingFeeRate;
        tradingFeeRate = newFeeRate;
        
        emit TradingFeeUpdated(oldFee, newFeeRate);
    }

    /**
     * @dev Updates fee recipient
     */
    function setFeeRecipient(address newRecipient)
        external
        onlyRole(ROUTER_ADMIN_ROLE)
    {
        require(newRecipient != address(0), "OrderRouter: Invalid recipient");
        
        address oldRecipient = feeRecipient;
        feeRecipient = newRecipient;
        
        emit FeeRecipientUpdated(oldRecipient, newRecipient);
    }

    /**
     * @dev Sets risk limits for a user
     */
    function setUserRiskLimits(
        address user,
        uint256 maxPositionSize,
        uint256 maxDailyVolume,
        uint256 maxOpenOrders,
        bool enabled
    ) external onlyRole(ROUTER_ADMIN_ROLE) {
        userRiskLimits[user] = RiskLimits({
            maxPositionSize: maxPositionSize,
            maxDailyVolume: maxDailyVolume,
            maxOpenOrders: maxOpenOrders,
            enabled: enabled
        });

        emit UserRiskLimitsUpdated(user, maxPositionSize, maxDailyVolume, maxOpenOrders);
    }

    /**
     * @dev Records trade execution (called by order books)
     */
    function recordTradeExecution(
        uint256 orderId,
        uint256 executedQuantity,
        uint256 executedPrice,
        address counterparty,
        uint256 fees
    ) external onlyRole(MARKET_ROLE) {
        Order storage order = orders[orderId];
        require(order.orderId != 0, "OrderRouter: Order not found");

        // Update order
        order.filledQuantity += executedQuantity;
        if (order.filledQuantity >= order.quantity) {
            order.status = OrderStatus.FILLED;
        } else {
            order.status = OrderStatus.PARTIALLY_FILLED;
        }

        // Record execution
        TradeExecution memory execution = TradeExecution({
            orderId: orderId,
            executedQuantity: executedQuantity,
            executedPrice: executedPrice,
            timestamp: block.timestamp,
            counterparty: counterparty,
            fees: fees
        });

        orderExecutions[orderId].push(execution);

        // Update P&L tracking
        _updatePnL(order.trader, order.metricId, order.side, executedQuantity, executedPrice, fees);

        // Update volume tracking
        userTotalVolume[order.trader] += (executedQuantity * executedPrice) / PRECISION;
        userTotalFees[order.trader] += fees;

        emit OrderExecuted(orderId, order.trader, executedQuantity, executedPrice, block.timestamp);
    }

    /**
     * @dev Emergency pause function
     */
    function pause() external onlyRole(ROUTER_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @dev Emergency unpause function
     */
    function unpause() external onlyRole(ROUTER_ADMIN_ROLE) {
        _unpause();
    }

    // Internal functions

    /**
     * @dev Validates order type specific requirements
     */
    function _validateOrderType(Order memory order) internal view {
        if (order.orderType == OrderType.MARKET) {
            // Market orders don't need price validation
        } else if (order.orderType == OrderType.LIMIT) {
            require(order.price > 0, "OrderRouter: Limit order needs price");
        } else if (order.orderType == OrderType.STOP_LOSS || order.orderType == OrderType.TAKE_PROFIT) {
            require(order.stopPrice > 0, "OrderRouter: Stop order needs stop price");
        } else if (order.orderType == OrderType.STOP_LIMIT) {
            require(order.price > 0 && order.stopPrice > 0, "OrderRouter: Stop limit needs both prices");
        } else if (order.orderType == OrderType.ICEBERG) {
            require(order.icebergQty > 0 && order.icebergQty < order.quantity, "OrderRouter: Invalid iceberg quantity");
        }

        // Validate time in force
        if (order.timeInForce == TimeInForce.GTD) {
            require(order.expiryTime > block.timestamp, "OrderRouter: Invalid expiry time");
        }
    }

    /**
     * @dev Validates user risk limits
     */
    function _validateRiskLimits(address user, Order calldata order) internal view {
        RiskLimits memory limits = userRiskLimits[user];
        if (!limits.enabled) return;

        // Check position size limit
        if (limits.maxPositionSize > 0) {
            require(order.quantity <= limits.maxPositionSize, "OrderRouter: Exceeds position size limit");
        }

        // Check daily volume limit with overflow protection
        if (limits.maxDailyVolume > 0) {
            uint256 currentDay = block.timestamp / 1 days;
            
            // Prevent overflow in order value calculation
            require(order.quantity <= type(uint256).max / order.price, "OrderRouter: Order value overflow");
            uint256 orderValue = (order.quantity * order.price) / PRECISION;
            
            uint256 currentDailyVolume = dailyVolume[user][currentDay];
            require(currentDailyVolume <= type(uint256).max - orderValue, "OrderRouter: Daily volume overflow");
            require(
                currentDailyVolume + orderValue <= limits.maxDailyVolume,
                "OrderRouter: Exceeds daily volume limit"
            );
        }

        // Check max open orders with gas optimization
        if (limits.maxOpenOrders > 0) {
            uint256 activeOrders = _getActiveOrderCount(user);
            require(activeOrders < limits.maxOpenOrders, "OrderRouter: Too many open orders");
        }
    }

    /**
     * @dev Updates P&L tracking for a user
     */
    function _updatePnL(
        address trader,
        string memory metricId,
        Side side,
        uint256 quantity,
        uint256 price,
        uint256 fees
    ) internal {
        PnLSummary storage pnl = userPnL[trader][metricId];
        
        // Prevent overflow in trade value calculation
        require(quantity <= type(uint256).max / price, "OrderRouter: Trade value overflow");
        uint256 tradeValue = (quantity * price) / PRECISION;
        
        // Overflow protection for accumulating values
        require(pnl.totalVolume <= type(uint256).max - tradeValue, "OrderRouter: Total volume overflow");
        require(pnl.totalFees <= type(uint256).max - fees, "OrderRouter: Total fees overflow");
        require(pnl.totalTrades < type(uint256).max, "OrderRouter: Total trades overflow");
        
        pnl.totalVolume += tradeValue;
        pnl.totalFees += fees;
        pnl.totalTrades++;

        // Simplified P&L calculation with safer arithmetic
        int256 tradeValueSigned = int256(tradeValue);
        require(tradeValueSigned >= 0, "OrderRouter: Invalid trade value conversion");
        
        if (side == Side.BUY) {
            // Check for overflow in positive direction
            if (pnl.unrealizedPnL > 0) {
                require(pnl.unrealizedPnL <= type(int256).max - tradeValueSigned, "OrderRouter: PnL overflow");
            }
            pnl.unrealizedPnL += tradeValueSigned;
        } else {
            // Check for overflow in negative direction  
            if (pnl.unrealizedPnL < 0) {
                require(pnl.unrealizedPnL >= type(int256).min + tradeValueSigned, "OrderRouter: PnL underflow");
            }
            pnl.unrealizedPnL -= tradeValueSigned;
        }

        // Update daily volume with overflow protection
        uint256 currentDay = block.timestamp / 1 days;
        uint256 currentDailyVolume = dailyVolume[trader][currentDay];
        require(currentDailyVolume <= type(uint256).max - tradeValue, "OrderRouter: Daily volume overflow");
        dailyVolume[trader][currentDay] += tradeValue;
    }

    /**
     * @dev Gets current day for daily tracking
     */
    function getCurrentDay() external view returns (uint256) {
        return block.timestamp / 1 days;
    }

    /**
     * @dev Gets daily volume for user
     */
    function getDailyVolume(address user, uint256 day) external view returns (uint256) {
        return dailyVolume[user][day];
    }

    /**
     * @dev Gets user risk limits
     */
    function getUserRiskLimits(address user) external view returns (RiskLimits memory) {
        return userRiskLimits[user];
    }

    /**
     * @dev Gets registered market order book
     */
    function getMarketOrderBook(string calldata metricId) external view returns (address) {
        return marketOrderBooks[metricId];
    }

    /**
     * @dev Calculates trading fees for an execution
     */
    function calculateTradingFees(uint256 tradeValue) public view returns (uint256) {
        return (tradeValue * tradingFeeRate) / BASIS_POINTS;
    }

    /**
     * @dev Gets the current number of active orders for a user
     */
    function getUserActiveOrderCount(address user) external view returns (uint256) {
        return _getActiveOrderCount(user);
    }

    /**
     * @dev Gets the total number of orders (active + historical) for a user
     */
    function getUserTotalOrderCount(address user) external view returns (uint256) {
        return userOrders[user].length;
    }

    /**
     * @dev Gets the remaining active order slots for a user
     */
    function getRemainingOrderSlots(address user) external view returns (uint256) {
        uint256 activeCount = _getActiveOrderCount(user);
        if (activeCount >= MAX_ORDERS_PER_USER) {
            return 0;
        }
        return MAX_ORDERS_PER_USER - activeCount;
    }

    /**
     * @dev Internal function to count active orders for a user
     */
    function _getActiveOrderCount(address user) internal view returns (uint256) {
        uint256 activeCount = 0;
        uint256[] memory userOrderIds = userOrders[user];
        for (uint256 i = 0; i < userOrderIds.length; i++) {
            Order memory order = orders[userOrderIds[i]];
            if (order.status == OrderStatus.PENDING || order.status == OrderStatus.PARTIALLY_FILLED) {
                activeCount++;
            }
        }
        return activeCount;
    }

    /**
     * @dev Checks if an order has expired and updates status if needed
     * @param orderId The order ID to check
     * @return isExpired Whether the order has expired
     */
    function checkOrderExpiry(uint256 orderId) public returns (bool isExpired) {
        Order storage order = orders[orderId];
        require(order.orderId != 0, "OrderRouter: Order not found");
        
        // Only check expiry for GTD orders with expiry time set
        if (order.timeInForce == TimeInForce.GTD && 
            order.expiryTime > 0 && 
            block.timestamp >= order.expiryTime &&
            (order.status == OrderStatus.PENDING || order.status == OrderStatus.PARTIALLY_FILLED)) {
            
            // Mark order as expired
            order.status = OrderStatus.EXPIRED;
            
            // Remove from order book
            address orderBookAddress = marketOrderBooks[order.metricId];
            if (orderBookAddress != address(0)) {
                IOrderBook(orderBookAddress).removeOrder(orderId);
            }
            
            emit OrderExpired(orderId, order.trader, order.metricId);
            return true;
        }
        
        return false;
    }

    /**
     * @dev Batch expire multiple orders to save gas
     * @param orderIds Array of order IDs to check for expiration
     * @return expiredCount Number of orders that were expired
     */
    function batchExpireOrders(uint256[] calldata orderIds) 
        external 
        nonReentrant 
        returns (uint256 expiredCount) 
    {
        require(orderIds.length > 0, "OrderRouter: No orders provided");
        require(orderIds.length <= 100, "OrderRouter: Too many orders in batch"); // Gas limit protection
        
        uint256[] memory expiredOrderIds = new uint256[](orderIds.length);
        uint256 actualExpiredCount = 0;
        
        for (uint256 i = 0; i < orderIds.length; i++) {
            if (checkOrderExpiry(orderIds[i])) {
                expiredOrderIds[actualExpiredCount] = orderIds[i];
                actualExpiredCount++;
            }
        }
        
        if (actualExpiredCount > 0) {
            // Create array with exact size
            uint256[] memory finalExpiredIds = new uint256[](actualExpiredCount);
            for (uint256 i = 0; i < actualExpiredCount; i++) {
                finalExpiredIds[i] = expiredOrderIds[i];
            }
            
            emit BatchOrdersExpired(finalExpiredIds, msg.sender);
        }
        
        return actualExpiredCount;
    }

    /**
     * @dev Get expired orders for a user
     * @param trader The trader address
     * @return expiredOrders Array of expired orders
     */
    function getUserExpiredOrders(address trader) 
        external 
        view 
        returns (Order[] memory expiredOrders) 
    {
        uint256[] memory userOrderIds = userOrders[trader];
        uint256 expiredCount = 0;
        
        // Count expired orders
        for (uint256 i = 0; i < userOrderIds.length; i++) {
            Order memory order = orders[userOrderIds[i]];
            if (order.status == OrderStatus.EXPIRED) {
                expiredCount++;
            }
        }
        
        // Build result array
        expiredOrders = new Order[](expiredCount);
        uint256 index = 0;
        for (uint256 i = 0; i < userOrderIds.length; i++) {
            Order memory order = orders[userOrderIds[i]];
            if (order.status == OrderStatus.EXPIRED) {
                expiredOrders[index] = order;
                index++;
            }
        }
    }

    /**
     * @dev Get orders that are eligible for expiration (GTD orders past expiry time)
     * @param trader The trader address (address(0) for all users)
     * @param limit Maximum number of orders to return
     * @return eligibleOrders Array of orders eligible for expiration
     */
    function getOrdersEligibleForExpiration(address trader, uint256 limit) 
        external 
        view 
        returns (Order[] memory eligibleOrders) 
    {
        require(limit > 0 && limit <= 1000, "OrderRouter: Invalid limit");
        
        Order[] memory tempOrders = new Order[](limit);
        uint256 count = 0;
        
        if (trader != address(0)) {
            // Check specific trader's orders
            uint256[] memory userOrderIds = userOrders[trader];
            for (uint256 i = 0; i < userOrderIds.length && count < limit; i++) {
                Order memory order = orders[userOrderIds[i]];
                if (_isOrderEligibleForExpiration(order)) {
                    tempOrders[count] = order;
                    count++;
                }
            }
        } else {
            // Check all orders (expensive, should be used carefully)
            for (uint256 orderId = 1; orderId <= orderIdCounter.current() && count < limit; orderId++) {
                Order memory order = orders[orderId];
                if (order.orderId != 0 && _isOrderEligibleForExpiration(order)) {
                    tempOrders[count] = order;
                    count++;
                }
            }
        }
        
        // Return exact size array
        eligibleOrders = new Order[](count);
        for (uint256 i = 0; i < count; i++) {
            eligibleOrders[i] = tempOrders[i];
        }
    }

    /**
     * @dev Check if an order is eligible for expiration
     * @param order The order to check
     * @return eligible Whether the order is eligible for expiration
     */
    function _isOrderEligibleForExpiration(Order memory order) internal view returns (bool eligible) {
        return order.timeInForce == TimeInForce.GTD && 
               order.expiryTime > 0 && 
               block.timestamp >= order.expiryTime &&
               (order.status == OrderStatus.PENDING || order.status == OrderStatus.PARTIALLY_FILLED);
    }

    /**
     * @dev Check if an order is expired (view function)
     * @param orderId The order ID to check
     * @return isExpired Whether the order is expired
     */
    function isOrderExpired(uint256 orderId) external view returns (bool isExpired) {
        Order memory order = orders[orderId];
        if (order.orderId == 0) return false;
        
        return _isOrderEligibleForExpiration(order);
    }

    /**
     * @dev Cleanup expired orders for a user (convenience function)
     * @param trader The trader address
     * @return cleanedCount Number of orders cleaned up
     */
    function cleanupUserExpiredOrders(address trader) 
        external 
        nonReentrant 
        returns (uint256 cleanedCount) 
    {
        uint256[] memory userOrderIds = userOrders[trader];
        uint256[] memory expiredIds = new uint256[](userOrderIds.length);
        uint256 expiredCount = 0;
        
        // Find expired orders
        for (uint256 i = 0; i < userOrderIds.length; i++) {
            Order memory order = orders[userOrderIds[i]];
            if (_isOrderEligibleForExpiration(order)) {
                expiredIds[expiredCount] = userOrderIds[i];
                expiredCount++;
            }
        }
        
        // Batch expire them
        if (expiredCount > 0) {
            uint256[] memory idsToExpire = new uint256[](expiredCount);
            for (uint256 i = 0; i < expiredCount; i++) {
                idsToExpire[i] = expiredIds[i];
            }
            return this.batchExpireOrders(idsToExpire);
        }
        
        return 0;
    }
}
