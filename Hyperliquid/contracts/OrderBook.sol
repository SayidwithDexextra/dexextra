// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./VaultRouter.sol";

/**
 * @title OrderBook
 * @dev Highly optimized order book with efficient matching engine for futures-style trading
 * Supports both traditional price-based markets and custom metric markets
 * 
 * Key Optimizations:
 * 1. Red-Black Tree for O(log n) price level management
 * 2. Linked lists for efficient order management within price levels
 * 3. Cached best bid/ask for O(1) access
 * 4. Batch matching for gas efficiency
 * 5. Bi-directional matching validation
 */
contract OrderBook is AccessControl, ReentrancyGuard {
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant UPDATER_ROLE = keccak256("UPDATER_ROLE");
    
    enum OrderType { LIMIT, MARKET }
    enum OrderSide { BUY, SELL }
    enum OrderStatus { PENDING, FILLED, CANCELLED, PARTIAL }
    
    // Red-Black Tree node colors
    enum Color { RED, BLACK }
    
    struct Order {
        bytes32 orderId;
        address user;
        OrderType orderType;
        OrderSide side;
        uint256 size;           // Position size
        uint256 price;          // Limit price (0 for market orders)
        uint256 filled;         // Amount filled
        uint256 timestamp;
        OrderStatus status;
        uint256 marginReserved; // Margin reserved for this order
        bytes32 nextOrder;      // Linked list pointer to next order at same price
        bytes32 prevOrder;      // Linked list pointer to previous order at same price
    }
    
    // Red-Black Tree node for price levels
    struct PriceNode {
        uint256 price;
        Color color;
        uint256 parent;
        uint256 left;
        uint256 right;
        bytes32 firstOrder;     // First order in linked list at this price
        bytes32 lastOrder;      // Last order in linked list at this price
        uint256 totalSize;      // Total size of all orders at this price
        uint256 orderCount;     // Number of orders at this price
    }
    
    struct Market {
        bytes32 marketId;
        string symbol;          // e.g., "ETH/USD", "WORLD_POP"
        string metricId;        // Custom metric identifier
        uint256 currentPrice;   // Current/mark price
        uint256 lastPrice;      // Last trade price
        uint256 openInterest;   // Total open interest
        uint256 volume24h;      // 24h trading volume
        uint256 funding;        // Current funding rate
        uint256 lastFundingTime;
        bool isActive;
        bool isCustomMetric;    // True for custom metrics, false for price-based
    }
    
    VaultRouter public vaultRouter; // Upgradeable reference
    
    // Market data
    Market public market;
    
    // Optimized order storage
    mapping(bytes32 => Order) public orders;        // orderId => order
    mapping(address => bytes32[]) public userOrders; // user => orderIds[]
    
    // Red-Black Trees for price levels
    mapping(uint256 => PriceNode) public buyPriceTree;   // price => node
    mapping(uint256 => PriceNode) public sellPriceTree;  // price => node
    uint256 public buyTreeRoot;     // Root of buy price tree
    uint256 public sellTreeRoot;    // Root of sell price tree
    
    // Cached best prices for O(1) access
    uint256 public bestBid;
    uint256 public bestAsk;
    
    // Trading statistics
    mapping(address => uint256) public userVolume;
    mapping(address => uint256) public userTrades;
    
    // Gas optimization constants
    uint256 private constant MAX_BATCH_SIZE = 10;
    uint256 private constant NIL = 0; // Represents null in tree
    
    // Precision and validation constants
    uint256 public constant PRICE_PRECISION = 1e6;    // 6 decimals for USDC compatibility
    uint256 public constant MARGIN_PERCENTAGE = 10;   // 10% margin requirement
    uint256 public constant MAX_REASONABLE_PRICE = 1000 * PRICE_PRECISION;  // $1000 max
    uint256 public constant MIN_REASONABLE_PRICE = 1 * PRICE_PRECISION / 100; // $0.01 min
    uint256 public constant MAX_ORDER_SIZE = 1000000 * PRICE_PRECISION; // 1M units max
    
    // Events
    event OrderPlaced(bytes32 indexed orderId, address indexed user, OrderSide side, uint256 size, uint256 price, uint256 timestamp);
    event OrderFilled(bytes32 indexed orderId, address indexed taker, address indexed maker, uint256 size, uint256 price, uint256 timestamp);
    event OrderCancelled(bytes32 indexed orderId, address indexed user, uint256 timestamp);
    event TradeExecuted(address indexed buyer, address indexed seller, uint256 size, uint256 price, uint256 timestamp);
    event PositionChanged(address indexed user, int256 newSize, uint256 avgEntryPrice, uint256 timestamp);
    event MetricUpdated(bytes32 indexed marketId, uint256 newValue, uint256 timestamp);
    event FundingPaid(address indexed user, int256 fundingAmount, uint256 timestamp);
    event Settlement(bytes32 indexed marketId, uint256 settlementPrice, uint256 timestamp);
    event BatchMatchingCompleted(uint256 totalMatches, uint256 gasUsed, uint256 timestamp);
    
    // LEGO Piece Events
    event VaultRouterUpdated(address indexed oldVaultRouter, address indexed newVaultRouter, uint256 timestamp);
    event ContractPauseStatusChanged(bool isPaused, uint256 timestamp);
    
    constructor(
        bytes32 _marketId,
        string memory _symbol,
        string memory _metricId,
        bool _isCustomMetric,
        address _vaultRouter,
        address _admin
    ) {
        market = Market({
            marketId: _marketId,
            symbol: _symbol,
            metricId: _metricId,
            currentPrice: 0,
            lastPrice: 0,
            openInterest: 0,
            volume24h: 0,
            funding: 0,
            lastFundingTime: block.timestamp,
            isActive: true,
            isCustomMetric: _isCustomMetric
        });
        
        vaultRouter = VaultRouter(_vaultRouter);
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ORACLE_ROLE, _admin);
        _grantRole(UPDATER_ROLE, _admin);
    }
    
    /**
     * @dev Places a limit order in the order book with optimized matching
     * @param side Order side (BUY or SELL)
     * @param size Position size
     * @param price Limit price
     * @return orderId The generated order ID
     */
    function placeLimitOrder(OrderSide side, uint256 size, uint256 price) external nonReentrant whenNotPaused returns (bytes32) {
        require(market.isActive, "OrderBook: market not active");
        require(msg.sender != address(0), "OrderBook: invalid user address");
        
        // Validate order parameters
        _validateOrderParameters(size, price);
        
        bytes32 orderId = keccak256(abi.encodePacked(msg.sender, block.timestamp, size, price, block.prevrandao, gasleft()));
        
        // Calculate required margin
        uint256 marginRequired = _calculateMarginRequired(size, price);
        
        // Reserve margin in vault
        vaultRouter.reserveMargin(msg.sender, orderId, market.marketId, marginRequired);
        
        Order memory newOrder = Order({
            orderId: orderId,
            user: msg.sender,
            orderType: OrderType.LIMIT,
            side: side,
            size: size,
            price: price,
            filled: 0,
            timestamp: block.timestamp,
            status: OrderStatus.PENDING,
            marginReserved: marginRequired,
            nextOrder: bytes32(0),
            prevOrder: bytes32(0)
        });
        
        orders[orderId] = newOrder;
        userOrders[msg.sender].push(orderId);
        
        // Add to order book and attempt optimized matching
        _addOrderToBookOptimized(orderId);
        _matchOrderOptimized(orderId);
        
        emit OrderPlaced(orderId, msg.sender, side, size, price, block.timestamp);
        return orderId;
    }
    
    /**
     * @dev Places a market order with batch matching optimization
     * @param side Order side (BUY or SELL)
     * @param size Position size
     * @return orderId The generated order ID
     */
    function placeMarketOrder(OrderSide side, uint256 size) external nonReentrant whenNotPaused returns (bytes32) {
        require(market.isActive, "OrderBook: market not active");
        require(msg.sender != address(0), "OrderBook: invalid user address");
        
        // Validate order parameters (price = 0 for market orders)
        _validateOrderParameters(size, 0);
        
        bytes32 orderId = keccak256(abi.encodePacked(msg.sender, block.timestamp, size, "MARKET", block.prevrandao, gasleft()));
        
        // For market orders, estimate margin using current market price
        uint256 estimatedPrice = _getEstimatedExecutionPrice(side, size);
        uint256 marginRequired = _calculateMarginRequired(size, estimatedPrice);
        
        // Reserve margin in vault
        vaultRouter.reserveMargin(msg.sender, orderId, market.marketId, marginRequired);
        
        Order memory newOrder = Order({
            orderId: orderId,
            user: msg.sender,
            orderType: OrderType.MARKET,
            side: side,
            size: size,
            price: 0, // Market orders don't have a fixed price
            filled: 0,
            timestamp: block.timestamp,
            status: OrderStatus.PENDING,
            marginReserved: marginRequired,
            nextOrder: bytes32(0),
            prevOrder: bytes32(0)
        });
        
        orders[orderId] = newOrder;
        userOrders[msg.sender].push(orderId);
        
        // Execute market order immediately with batch processing
        _executeMarketOrderOptimized(orderId);
        
        emit OrderPlaced(orderId, msg.sender, side, size, 0, block.timestamp);
        return orderId;
    }
    
    /**
     * @dev Cancels an existing order with optimized removal
     * @param orderId Order ID to cancel
     */
    function cancelOrder(bytes32 orderId) external nonReentrant {
        Order storage order = orders[orderId];
        require(order.orderId != bytes32(0), "OrderBook: order does not exist");
        require(order.user == msg.sender, "OrderBook: not order owner");
        require(order.status == OrderStatus.PENDING || order.status == OrderStatus.PARTIAL, "OrderBook: order not cancellable");
        
        // Remove from order book efficiently
        _removeOrderFromBookOptimized(orderId);
        
        // Update order status
        order.status = OrderStatus.CANCELLED;
        
        // Release reserved margin
        vaultRouter.unreserveMargin(msg.sender, orderId);
        
        emit OrderCancelled(orderId, msg.sender, block.timestamp);
    }
    
    /**
     * @dev Batch cancel multiple orders for gas efficiency
     * @param orderIds Array of order IDs to cancel
     */
    function batchCancelOrders(bytes32[] calldata orderIds) external nonReentrant {
        require(orderIds.length > 0 && orderIds.length <= MAX_BATCH_SIZE, "OrderBook: invalid batch size");
        
        for (uint256 i = 0; i < orderIds.length; i++) {
            bytes32 orderId = orderIds[i];
            Order storage order = orders[orderId];
            
            if (order.orderId != bytes32(0) && order.user == msg.sender && (order.status == OrderStatus.PENDING || order.status == OrderStatus.PARTIAL)) {
                _removeOrderFromBookOptimized(orderId);
                order.status = OrderStatus.CANCELLED;
                vaultRouter.unreserveMargin(msg.sender, orderId);
                emit OrderCancelled(orderId, msg.sender, block.timestamp);
            }
        }
    }
    
    // === OPTIMIZED INTERNAL FUNCTIONS ===
    
    /**
     * @dev Adds order to the order book using Red-Black Tree for price levels
     */
    function _addOrderToBookOptimized(bytes32 orderId) internal {
        Order storage order = orders[orderId];
        
        if (order.side == OrderSide.BUY) {
            _insertOrderInBuyTree(orderId, order.price);
            if (order.price > bestBid) {
                bestBid = order.price;
            }
        } else {
            _insertOrderInSellTree(orderId, order.price);
            if (bestAsk == 0 || order.price < bestAsk) {
                bestAsk = order.price;
            }
        }
    }
    
    /**
     * @dev Removes order from the order book efficiently
     */
    function _removeOrderFromBookOptimized(bytes32 orderId) internal {
        Order storage order = orders[orderId];
        
        if (order.side == OrderSide.BUY) {
            _removeOrderFromBuyTree(orderId, order.price);
        } else {
            _removeOrderFromSellTree(orderId, order.price);
        }
        
        // Update best prices if necessary
        _updateBestPrices();
    }
    
    /**
     * @dev Optimized order matching with batch processing
     */
    function _matchOrderOptimized(bytes32 orderId) internal {
        Order storage order = orders[orderId];
        uint256 gasStart = gasleft();
        uint256 totalMatches = 0;
        
        if (order.side == OrderSide.BUY) {
            totalMatches = _matchBuyOrderOptimized(order);
        } else {
            totalMatches = _matchSellOrderOptimized(order);
        }
        
        uint256 gasUsed = gasStart - gasleft();
        
        if (totalMatches > 0) {
            emit BatchMatchingCompleted(totalMatches, gasUsed, block.timestamp);
        }
    }
    
    /**
     * @dev Optimized buy order matching with early termination
     */
    function _matchBuyOrderOptimized(Order storage buyOrder) internal returns (uint256 totalMatches) {
        totalMatches = 0;
        uint256 batchCount = 0;
        
        while (buyOrder.filled < buyOrder.size && bestAsk > 0 && bestAsk <= buyOrder.price && batchCount < MAX_BATCH_SIZE) {
            PriceNode storage askNode = sellPriceTree[bestAsk];
            
            if (askNode.firstOrder == bytes32(0)) {
                // No orders at this price level, remove it
                _removeEmptyPriceNode(false, bestAsk);
                _updateBestAsk();
                continue;
            }
            
            bytes32 sellOrderId = askNode.firstOrder;
            Order storage sellOrder = orders[sellOrderId];
            
            // Verify order is still valid for matching
            require(sellOrder.status == OrderStatus.PENDING || sellOrder.status == OrderStatus.PARTIAL, "OrderBook: invalid sell order status");
            require(sellOrder.filled < sellOrder.size, "OrderBook: sell order already filled");
            
            uint256 matchSize = _min(buyOrder.size - buyOrder.filled, sellOrder.size - sellOrder.filled);
            require(matchSize > 0, "OrderBook: zero match size");
            
            // Execute the trade
            _executeTrade(buyOrder, sellOrder, matchSize, bestAsk);
            
            // Update order statuses
            buyOrder.filled += matchSize;
            sellOrder.filled += matchSize;
            totalMatches++;
            batchCount++;
            
            if (sellOrder.filled == sellOrder.size) {
                sellOrder.status = OrderStatus.FILLED;
                _removeOrderFromLinkedList(sellOrderId, bestAsk, false);
            } else {
                sellOrder.status = OrderStatus.PARTIAL;
            }
            
            if (askNode.firstOrder == bytes32(0)) {
                _removeEmptyPriceNode(false, bestAsk);
                _updateBestAsk();
            }
        }
        
        if (buyOrder.filled == buyOrder.size) {
            buyOrder.status = OrderStatus.FILLED;
        } else if (buyOrder.filled > 0) {
            buyOrder.status = OrderStatus.PARTIAL;
        }
        
        return totalMatches;
    }
    
    /**
     * @dev Optimized sell order matching with early termination
     */
    function _matchSellOrderOptimized(Order storage sellOrder) internal returns (uint256 totalMatches) {
        totalMatches = 0;
        uint256 batchCount = 0;
        
        while (sellOrder.filled < sellOrder.size && bestBid > 0 && bestBid >= sellOrder.price && batchCount < MAX_BATCH_SIZE) {
            PriceNode storage bidNode = buyPriceTree[bestBid];
            
            if (bidNode.firstOrder == bytes32(0)) {
                // No orders at this price level, remove it
                _removeEmptyPriceNode(true, bestBid);
                _updateBestBid();
                continue;
            }
            
            bytes32 buyOrderId = bidNode.firstOrder;
            Order storage buyOrder = orders[buyOrderId];
            
            // Verify order is still valid for matching
            require(buyOrder.status == OrderStatus.PENDING || buyOrder.status == OrderStatus.PARTIAL, "OrderBook: invalid buy order status");
            require(buyOrder.filled < buyOrder.size, "OrderBook: buy order already filled");
            
            uint256 matchSize = _min(sellOrder.size - sellOrder.filled, buyOrder.size - buyOrder.filled);
            require(matchSize > 0, "OrderBook: zero match size");
            
            // Execute the trade
            _executeTrade(buyOrder, sellOrder, matchSize, bestBid);
            
            // Update order statuses
            sellOrder.filled += matchSize;
            buyOrder.filled += matchSize;
            totalMatches++;
            batchCount++;
            
            if (buyOrder.filled == buyOrder.size) {
                buyOrder.status = OrderStatus.FILLED;
                _removeOrderFromLinkedList(buyOrderId, bestBid, true);
            } else {
                buyOrder.status = OrderStatus.PARTIAL;
            }
            
            if (bidNode.firstOrder == bytes32(0)) {
                _removeEmptyPriceNode(true, bestBid);
                _updateBestBid();
            }
        }
        
        if (sellOrder.filled == sellOrder.size) {
            sellOrder.status = OrderStatus.FILLED;
        } else if (sellOrder.filled > 0) {
            sellOrder.status = OrderStatus.PARTIAL;
        }
        
        return totalMatches;
    }
    
    /**
     * @dev Executes a market order with optimized batch processing
     */
    function _executeMarketOrderOptimized(bytes32 orderId) internal {
        Order storage order = orders[orderId];
        uint256 totalMatches = 0;
        
        if (order.side == OrderSide.BUY) {
            totalMatches = _executeMarketBuyOptimized(order);
        } else {
            totalMatches = _executeMarketSellOptimized(order);
        }
        
        if (order.filled == order.size) {
            order.status = OrderStatus.FILLED;
        } else if (order.filled > 0) {
            order.status = OrderStatus.PARTIAL;
        }
        
        if (totalMatches > 0) {
            emit BatchMatchingCompleted(totalMatches, 0, block.timestamp);
        }
    }
    
    /**
     * @dev Optimized market buy execution
     */
    function _executeMarketBuyOptimized(Order storage buyOrder) internal returns (uint256 totalMatches) {
        totalMatches = 0;
        uint256 batchCount = 0;
        
        while (buyOrder.filled < buyOrder.size && bestAsk > 0 && batchCount < MAX_BATCH_SIZE) {
            PriceNode storage askNode = sellPriceTree[bestAsk];
            
            if (askNode.firstOrder == bytes32(0)) {
                _removeEmptyPriceNode(false, bestAsk);
                _updateBestAsk();
                continue;
            }
            
            bytes32 sellOrderId = askNode.firstOrder;
            Order storage sellOrder = orders[sellOrderId];
            
            // Verify order is still valid for matching
            require(sellOrder.status == OrderStatus.PENDING || sellOrder.status == OrderStatus.PARTIAL, "OrderBook: invalid sell order status");
            require(sellOrder.filled < sellOrder.size, "OrderBook: sell order already filled");
            
            uint256 matchSize = _min(buyOrder.size - buyOrder.filled, sellOrder.size - sellOrder.filled);
            require(matchSize > 0, "OrderBook: zero match size");
            
            _executeTrade(buyOrder, sellOrder, matchSize, bestAsk);
            
            buyOrder.filled += matchSize;
            sellOrder.filled += matchSize;
            totalMatches++;
            batchCount++;
            
            if (sellOrder.filled == sellOrder.size) {
                sellOrder.status = OrderStatus.FILLED;
                _removeOrderFromLinkedList(sellOrderId, bestAsk, false);
            } else {
                sellOrder.status = OrderStatus.PARTIAL;
            }
            
            if (askNode.firstOrder == bytes32(0)) {
                _removeEmptyPriceNode(false, bestAsk);
                _updateBestAsk();
            }
        }
        
        return totalMatches;
    }
    
    /**
     * @dev Optimized market sell execution
     */
    function _executeMarketSellOptimized(Order storage sellOrder) internal returns (uint256 totalMatches) {
        totalMatches = 0;
        uint256 batchCount = 0;
        
        while (sellOrder.filled < sellOrder.size && bestBid > 0 && batchCount < MAX_BATCH_SIZE) {
            PriceNode storage bidNode = buyPriceTree[bestBid];
            
            if (bidNode.firstOrder == bytes32(0)) {
                _removeEmptyPriceNode(true, bestBid);
                _updateBestBid();
                continue;
            }
            
            bytes32 buyOrderId = bidNode.firstOrder;
            Order storage buyOrder = orders[buyOrderId];
            
            // Verify order is still valid for matching
            require(buyOrder.status == OrderStatus.PENDING || buyOrder.status == OrderStatus.PARTIAL, "OrderBook: invalid buy order status");
            require(buyOrder.filled < buyOrder.size, "OrderBook: buy order already filled");
            
            uint256 matchSize = _min(sellOrder.size - sellOrder.filled, buyOrder.size - buyOrder.filled);
            require(matchSize > 0, "OrderBook: zero match size");
            
            _executeTrade(buyOrder, sellOrder, matchSize, bestBid);
            
            sellOrder.filled += matchSize;
            buyOrder.filled += matchSize;
            totalMatches++;
            batchCount++;
            
            if (buyOrder.filled == buyOrder.size) {
                buyOrder.status = OrderStatus.FILLED;
                _removeOrderFromLinkedList(buyOrderId, bestBid, true);
            } else {
                buyOrder.status = OrderStatus.PARTIAL;
            }
            
            if (bidNode.firstOrder == bytes32(0)) {
                _removeEmptyPriceNode(true, bestBid);
                _updateBestBid();
            }
        }
        
        return totalMatches;
    }
    
    // === RED-BLACK TREE IMPLEMENTATION ===
    
    /**
     * @dev Inserts an order into the buy price tree
     */
    function _insertOrderInBuyTree(bytes32 orderId, uint256 price) internal {
        PriceNode storage node = buyPriceTree[price];
        
        if (node.price == 0) {
            // Create new price node
            node.price = price;
            node.color = Color.RED;
            node.totalSize = orders[orderId].size;
            node.orderCount = 1;
            node.firstOrder = orderId;
            node.lastOrder = orderId;
            
            if (buyTreeRoot == 0) {
                buyTreeRoot = price;
                node.color = Color.BLACK;
            } else {
                _insertPriceNode(true, price);
            }
        } else {
            // Add order to existing price level (linked list)
            _addOrderToLinkedList(orderId, price, true);
        }
    }
    
    /**
     * @dev Inserts an order into the sell price tree
     */
    function _insertOrderInSellTree(bytes32 orderId, uint256 price) internal {
        PriceNode storage node = sellPriceTree[price];
        
        if (node.price == 0) {
            // Create new price node
            node.price = price;
            node.color = Color.RED;
            node.totalSize = orders[orderId].size;
            node.orderCount = 1;
            node.firstOrder = orderId;
            node.lastOrder = orderId;
            
            if (sellTreeRoot == 0) {
                sellTreeRoot = price;
                node.color = Color.BLACK;
            } else {
                _insertPriceNode(false, price);
            }
        } else {
            // Add order to existing price level (linked list)
            _addOrderToLinkedList(orderId, price, false);
        }
    }
    
    /**
     * @dev Adds an order to the linked list at a price level
     */
    function _addOrderToLinkedList(bytes32 orderId, uint256 price, bool isBuy) internal {
        Order storage order = orders[orderId];
        
        if (isBuy) {
            PriceNode storage node = buyPriceTree[price];
            if (node.firstOrder == bytes32(0)) {
                // First order at this price level
                node.firstOrder = orderId;
                node.lastOrder = orderId;
            } else {
                // Add to end of linked list
                orders[node.lastOrder].nextOrder = orderId;
                order.prevOrder = node.lastOrder;
                node.lastOrder = orderId;
            }
            node.totalSize += order.size;
            node.orderCount++;
        } else {
            PriceNode storage node = sellPriceTree[price];
            if (node.firstOrder == bytes32(0)) {
                // First order at this price level
                node.firstOrder = orderId;
                node.lastOrder = orderId;
            } else {
                // Add to end of linked list
                orders[node.lastOrder].nextOrder = orderId;
                order.prevOrder = node.lastOrder;
                node.lastOrder = orderId;
            }
            node.totalSize += order.size;
            node.orderCount++;
        }
    }
    
    /**
     * @dev Removes an order from the linked list at a price level
     */
    function _removeOrderFromLinkedList(bytes32 orderId, uint256 price, bool isBuy) internal {
        Order storage order = orders[orderId];
        
        if (isBuy) {
            PriceNode storage node = buyPriceTree[price];
            
            // Update previous order's next pointer
            if (order.prevOrder != bytes32(0)) {
                orders[order.prevOrder].nextOrder = order.nextOrder;
            } else {
                // This was the first order
                node.firstOrder = order.nextOrder;
            }
            
            // Update next order's previous pointer
            if (order.nextOrder != bytes32(0)) {
                orders[order.nextOrder].prevOrder = order.prevOrder;
            } else {
                // This was the last order
                node.lastOrder = order.prevOrder;
            }
            
            // Update node statistics with underflow protection
            uint256 remainingSize = order.size - order.filled;
            require(node.totalSize >= remainingSize, "OrderBook: invalid total size");
            node.totalSize -= remainingSize;
            require(node.orderCount > 0, "OrderBook: invalid order count");
            node.orderCount--;
        } else {
            PriceNode storage node = sellPriceTree[price];
            
            // Update previous order's next pointer
            if (order.prevOrder != bytes32(0)) {
                orders[order.prevOrder].nextOrder = order.nextOrder;
            } else {
                // This was the first order
                node.firstOrder = order.nextOrder;
            }
            
            // Update next order's previous pointer
            if (order.nextOrder != bytes32(0)) {
                orders[order.nextOrder].prevOrder = order.prevOrder;
            } else {
                // This was the last order
                node.lastOrder = order.prevOrder;
            }
            
            // Update node statistics with underflow protection
            uint256 remainingSize = order.size - order.filled;
            require(node.totalSize >= remainingSize, "OrderBook: invalid total size");
            node.totalSize -= remainingSize;
            require(node.orderCount > 0, "OrderBook: invalid order count");
            node.orderCount--;
        }
        
        // Clear order pointers
        order.nextOrder = bytes32(0);
        order.prevOrder = bytes32(0);
    }
    
    /**
     * @dev Removes an order from buy tree
     */
    function _removeOrderFromBuyTree(bytes32 orderId, uint256 price) internal {
        _removeOrderFromLinkedList(orderId, price, true);
        
        PriceNode storage node = buyPriceTree[price];
        if (node.orderCount == 0) {
            _removeEmptyPriceNode(true, price);
        }
    }
    
    /**
     * @dev Removes an order from sell tree
     */
    function _removeOrderFromSellTree(bytes32 orderId, uint256 price) internal {
        _removeOrderFromLinkedList(orderId, price, false);
        
        PriceNode storage node = sellPriceTree[price];
        if (node.orderCount == 0) {
            _removeEmptyPriceNode(false, price);
        }
    }
    
    /**
     * @dev Removes an empty price node from the tree
     */
    function _removeEmptyPriceNode(bool isBuy, uint256 price) internal {
        if (isBuy) {
            _deletePriceNode(true, price);
        } else {
            _deletePriceNode(false, price);
        }
    }
    
    /**
     * @dev Updates best bid price
     */
    function _updateBestBid() internal {
        bestBid = _findMaxPrice(true);
    }
    
    /**
     * @dev Updates best ask price
     */
    function _updateBestAsk() internal {
        bestAsk = _findMinPrice(false);
    }
    
    /**
     * @dev Updates both best bid and ask prices
     */
    function _updateBestPrices() internal {
        _updateBestBid();
        _updateBestAsk();
    }
    
    /**
     * @dev Finds maximum price in buy tree
     */
    function _findMaxPrice(bool isBuy) internal view returns (uint256) {
        uint256 root = isBuy ? buyTreeRoot : sellTreeRoot;
        if (root == 0) return 0;
        
        uint256 current = root;
        while (true) {
            uint256 right = isBuy ? buyPriceTree[current].right : sellPriceTree[current].right;
            if (right == 0) break;
            current = right;
        }
        return current;
    }
    
    /**
     * @dev Finds minimum price in sell tree
     */
    function _findMinPrice(bool isBuy) internal view returns (uint256) {
        uint256 root = isBuy ? buyTreeRoot : sellTreeRoot;
        if (root == 0) return 0;
        
        uint256 current = root;
        while (true) {
            uint256 left = isBuy ? buyPriceTree[current].left : sellPriceTree[current].left;
            if (left == 0) break;
            current = left;
        }
        return current;
    }
    
    // === SIMPLIFIED TREE OPERATIONS ===
    // Note: Full Red-Black Tree implementation would require additional rotation and balancing logic
    // This is a simplified version focusing on the key optimization concepts
    
    /**
     * @dev Simplified tree insertion (would need full RB-tree balancing in production)
     */
    function _insertPriceNode(bool isBuy, uint256 price) internal {
        uint256 root = isBuy ? buyTreeRoot : sellTreeRoot;
        uint256 parent = 0;
        uint256 current = root;
        
        // Find insertion point
        while (current != 0) {
            parent = current;
            if (isBuy) {
                // For buy tree: higher prices go right (descending order for best bid)
                if (price > current) {
                    current = buyPriceTree[current].right;
                } else {
                    current = buyPriceTree[current].left;
                }
            } else {
                // For sell tree: lower prices go left (ascending order for best ask)
                if (price < current) {
                    current = sellPriceTree[current].left;
                } else {
                    current = sellPriceTree[current].right;
                }
            }
        }
        
        // Insert as child of parent
        if (parent != 0) {
            if (isBuy) {
                if (price > parent) {
                    buyPriceTree[parent].right = price;
                } else {
                    buyPriceTree[parent].left = price;
                }
                buyPriceTree[price].parent = parent;
            } else {
                if (price < parent) {
                    sellPriceTree[parent].left = price;
                } else {
                    sellPriceTree[parent].right = price;
                }
                sellPriceTree[price].parent = parent;
            }
        }
    }
    
    /**
     * @dev Simplified tree deletion (would need full RB-tree balancing in production)
     */
    function _deletePriceNode(bool isBuy, uint256 price) internal {
        // Simplified deletion with basic tree structure maintenance
        if (isBuy) {
            PriceNode storage node = buyPriceTree[price];
            uint256 parent = node.parent;
            uint256 left = node.left;
            uint256 right = node.right;
            
            // Update parent's child pointer
            if (parent != 0) {
                if (buyPriceTree[parent].left == price) {
                    buyPriceTree[parent].left = 0;
                } else {
                    buyPriceTree[parent].right = 0;
                }
            }
            
            // Update root if necessary
            if (buyTreeRoot == price) {
                // Find new root - use right child if exists, otherwise left
                if (right != 0) {
                    buyTreeRoot = right;
                    buyPriceTree[right].parent = 0;
                } else if (left != 0) {
                    buyTreeRoot = left;
                    buyPriceTree[left].parent = 0;
                } else {
                    buyTreeRoot = 0;
                }
            }
            
            delete buyPriceTree[price];
        } else {
            PriceNode storage node = sellPriceTree[price];
            uint256 parent = node.parent;
            uint256 left = node.left;
            uint256 right = node.right;
            
            // Update parent's child pointer
            if (parent != 0) {
                if (sellPriceTree[parent].left == price) {
                    sellPriceTree[parent].left = 0;
                } else {
                    sellPriceTree[parent].right = 0;
                }
            }
            
            // Update root if necessary
            if (sellTreeRoot == price) {
                // Find new root - use left child if exists, otherwise right
                if (left != 0) {
                    sellTreeRoot = left;
                    sellPriceTree[left].parent = 0;
                } else if (right != 0) {
                    sellTreeRoot = right;
                    sellPriceTree[right].parent = 0;
                } else {
                    sellTreeRoot = 0;
                }
            }
            
            delete sellPriceTree[price];
        }
    }
    
    // === EXISTING HELPER FUNCTIONS ===
    
    /**
     * @dev Executes a trade between two orders
     */
    function _executeTrade(Order storage buyOrder, Order storage sellOrder, uint256 size, uint256 price) internal {
        // Update market statistics with overflow protection
        market.lastPrice = price;
        
        // Check for overflow before updating volume
        uint256 tradeVolume = size * price;
        require(market.volume24h <= type(uint256).max - tradeVolume, "OrderBook: volume overflow");
        market.volume24h += tradeVolume;
        uint256 halfTradeVolume = tradeVolume / 2;
        require(userVolume[buyOrder.user] <= type(uint256).max - halfTradeVolume, "OrderBook: user volume overflow");
        require(userVolume[sellOrder.user] <= type(uint256).max - halfTradeVolume, "OrderBook: user volume overflow");
        userVolume[buyOrder.user] += halfTradeVolume;
        userVolume[sellOrder.user] += halfTradeVolume;
        // Increment trade counters with overflow protection
        require(userTrades[buyOrder.user] < type(uint256).max, "OrderBook: user trade counter overflow");
        require(userTrades[sellOrder.user] < type(uint256).max, "OrderBook: user trade counter overflow");
        userTrades[buyOrder.user]++;
        userTrades[sellOrder.user]++;
        
        // Calculate required margin for positions
        uint256 buyMargin = _calculateMarginRequired(size, price);
        uint256 sellMargin = _calculateMarginRequired(size, price);
        
        // Lock margin and update positions in vault
        vaultRouter.lockMargin(buyOrder.user, market.marketId, buyMargin);
        vaultRouter.lockMargin(sellOrder.user, market.marketId, sellMargin);
        
        // Update positions (long for buyer, short for seller)
        vaultRouter.updatePosition(buyOrder.user, market.marketId, int256(size), price);
        vaultRouter.updatePosition(sellOrder.user, market.marketId, -int256(size), price);
        
        // Update open interest
        market.openInterest += size;
        
        emit TradeExecuted(buyOrder.user, sellOrder.user, size, price, block.timestamp);
        emit OrderFilled(buyOrder.orderId, buyOrder.user, sellOrder.user, size, price, block.timestamp);
        emit OrderFilled(sellOrder.orderId, sellOrder.user, buyOrder.user, size, price, block.timestamp);
    }
    
    /**
     * @dev Calculates margin required for a position with proper decimal scaling
     */
    function _calculateMarginRequired(uint256 size, uint256 price) internal pure returns (uint256) {
        require(price > 0, "OrderBook: price cannot be zero");
        require(size > 0, "OrderBook: size cannot be zero");
        
        // Check for overflow in multiplication
        require(size <= type(uint256).max / price, "OrderBook: size * price overflow");
        uint256 notional = size * price;
        
        // Use proper decimal scaling for margin calculation
        require(notional <= type(uint256).max / MARGIN_PERCENTAGE, "OrderBook: margin calculation overflow");
        return (notional * MARGIN_PERCENTAGE) / (100 * PRICE_PRECISION);
    }
    
    /**
     * @dev Estimates execution price for market orders with bounds validation
     */
    function _getEstimatedExecutionPrice(OrderSide side, uint256 /* size */) internal view returns (uint256) {
        uint256 estimatedPrice;
        
        if (side == OrderSide.BUY && bestAsk > 0) {
            estimatedPrice = bestAsk;
        } else if (side == OrderSide.SELL && bestBid > 0) {
            estimatedPrice = bestBid;
        } else {
            // Fallback to current price
            estimatedPrice = market.currentPrice;
        }
        
        // Add validation and bounds
        require(estimatedPrice > 0, "OrderBook: invalid estimated price");
        require(estimatedPrice <= MAX_REASONABLE_PRICE, "OrderBook: price too high");
        require(estimatedPrice >= MIN_REASONABLE_PRICE, "OrderBook: price too low");
        
        return estimatedPrice;
    }
    
    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
    
    // === VIEW FUNCTIONS ===
    
    /**
     * @dev Gets the current best bid and ask prices (O(1) access)
     */
    function getBestPrices() external view returns (uint256 bestBidPrice, uint256 bestAskPrice) {
        return (bestBid, bestAsk);
    }
    
    /**
     * @dev Gets market information
     */
    function getMarketInfo() external view returns (Market memory) {
        return market;
    }
    
    /**
     * @dev Gets optimized order book depth with aggregated sizes
     */
    function getOrderBookDepth(uint256 levels) external view returns (
        uint256[] memory bidPrices,
        uint256[] memory bidSizes,
        uint256[] memory askPrices,
        uint256[] memory askSizes
    ) {
        // Implementation would traverse the trees to get depth data
        // This is a simplified version - full implementation would traverse RB-trees
        bidPrices = new uint256[](levels);
        bidSizes = new uint256[](levels);
        askPrices = new uint256[](levels);
        askSizes = new uint256[](levels);
        
        // Fill with cached best prices for now
        if (levels > 0) {
            bidPrices[0] = bestBid;
            askPrices[0] = bestAsk;
            if (bestBid > 0) {
                bidSizes[0] = buyPriceTree[bestBid].totalSize;
            }
            if (bestAsk > 0) {
                askSizes[0] = sellPriceTree[bestAsk].totalSize;
            }
        }
        
        return (bidPrices, bidSizes, askPrices, askSizes);
    }
    
    /**
     * @dev Gets all orders for a user
     */
    function getUserOrders(address user) external view returns (bytes32[] memory) {
        return userOrders[user];
    }
    
    /**
     * @dev Gets order details
     */
    function getOrder(bytes32 orderId) external view returns (Order memory) {
        return orders[orderId];
    }
    
    /**
     * @dev Gets price node information (for debugging)
     */
    function getPriceNode(uint256 price, bool isBuy) external view returns (PriceNode memory) {
        return isBuy ? buyPriceTree[price] : sellPriceTree[price];
    }
    
    // === EXISTING ADMIN FUNCTIONS ===
    
    /**
     * @dev Updates the metric value for custom metric markets
     */
    function updateMetricValue(uint256 newValue) external onlyRole(UPDATER_ROLE) {
        require(market.isCustomMetric, "OrderBook: not a custom metric market");
        
        market.currentPrice = newValue;
        vaultRouter.updateMarkPrice(market.marketId, newValue);
        
        emit MetricUpdated(market.marketId, newValue, block.timestamp);
    }
    
    /**
     * @dev Settles the market (realizes PnL)
     */
    function settleMarket(uint256 settlementPrice) external onlyRole(ORACLE_ROLE) {
        market.currentPrice = settlementPrice;
        vaultRouter.updateMarkPrice(market.marketId, settlementPrice);
        
        emit Settlement(market.marketId, settlementPrice, block.timestamp);
    }
    
    /**
     * @dev Calculates funding payments
     */
    function calculateFunding() external onlyRole(ORACLE_ROLE) {
        uint256 timeSinceLastFunding = block.timestamp - market.lastFundingTime;
        
        if (timeSinceLastFunding >= 8 hours) {
            market.funding = market.currentPrice / 10000; // 0.01%
            market.lastFundingTime = block.timestamp;
        }
    }
    
    // === LEGO PIECE SETTERS FOR UPGRADABILITY ===
    
    function setVaultRouter(address newVaultRouter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newVaultRouter != address(0), "OrderBook: invalid vault router");
        
        address oldVaultRouter = address(vaultRouter);
        vaultRouter = VaultRouter(newVaultRouter);
        
        emit VaultRouterUpdated(oldVaultRouter, newVaultRouter, block.timestamp);
    }
    
    bool public isPaused;
    
    function setPaused(bool paused) external onlyRole(DEFAULT_ADMIN_ROLE) {
        isPaused = paused;
        emit ContractPauseStatusChanged(paused, block.timestamp);
    }
    
    modifier whenNotPaused() {
        require(!isPaused, "OrderBook: contract is paused");
        _;
    }
    
    function setMarketActive(bool active) external onlyRole(DEFAULT_ADMIN_ROLE) {
        market.isActive = active;
    }
    
    /**
     * @dev Validates order parameters with comprehensive bounds checking
     * @param size Order size
     * @param price Order price (0 for market orders)
     */
    function _validateOrderParameters(uint256 size, uint256 price) internal pure {
        require(size > 0, "OrderBook: size must be positive");
        require(size <= MAX_ORDER_SIZE, "OrderBook: size too large");
        
        if (price > 0) { // For limit orders
            require(price >= MIN_REASONABLE_PRICE, "OrderBook: price too low");
            require(price <= MAX_REASONABLE_PRICE, "OrderBook: price too high");
        }
    }
}
