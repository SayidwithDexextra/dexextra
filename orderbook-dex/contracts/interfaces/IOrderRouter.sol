// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title IOrderRouter
 * @dev Interface for the Order Router contract
 * @notice Handles order routing, execution, and P&L tracking
 */
interface IOrderRouter {
    /**
     * @dev Order types supported by the system
     */
    enum OrderType {
        MARKET,
        LIMIT,
        STOP_LOSS,
        TAKE_PROFIT,
        STOP_LIMIT,
        ICEBERG,
        FILL_OR_KILL,
        IMMEDIATE_OR_CANCEL,
        ALL_OR_NONE
    }

    /**
     * @dev Order side (buy/sell)
     */
    enum Side {
        BUY,
        SELL
    }

    /**
     * @dev Order status
     */
    enum OrderStatus {
        PENDING,
        PARTIALLY_FILLED,
        FILLED,
        CANCELLED,
        EXPIRED,
        REJECTED
    }

    /**
     * @dev Time in force options
     */
    enum TimeInForce {
        GTC,  // Good Till Cancelled
        IOC,  // Immediate or Cancel
        FOK,  // Fill or Kill
        GTD   // Good Till Date
    }

    /**
     * @dev Order structure
     */
    struct Order {
        uint256 orderId;
        address trader;
        string metricId;
        OrderType orderType;
        Side side;
        uint256 quantity;
        uint256 price;
        uint256 filledQuantity;
        uint256 timestamp;
        uint256 expiryTime;
        OrderStatus status;
        TimeInForce timeInForce;
        uint256 stopPrice;      // For stop orders
        uint256 icebergQty;     // For iceberg orders
        bool postOnly;          // Post-only flag
        bytes32 metadataHash;   // Additional metadata
    }

    /**
     * @dev Trade execution result
     */
    struct TradeExecution {
        uint256 orderId;
        uint256 executedQuantity;
        uint256 executedPrice;
        uint256 timestamp;
        address counterparty;
        uint256 fees;
    }

    /**
     * @dev P&L summary for a user
     */
    struct PnLSummary {
        int256 realizedPnL;     // Realized profit/loss
        int256 unrealizedPnL;   // Unrealized profit/loss
        uint256 totalVolume;    // Total trading volume
        uint256 totalFees;      // Total fees paid
        uint256 totalTrades;    // Number of trades
    }

    /**
     * @dev Emitted when an order is placed
     */
    event OrderPlaced(
        uint256 indexed orderId,
        address indexed trader,
        string indexed metricId,
        OrderType orderType,
        Side side,
        uint256 quantity,
        uint256 price
    );

    /**
     * @dev Emitted when an order is executed
     */
    event OrderExecuted(
        uint256 indexed orderId,
        address indexed trader,
        uint256 executedQuantity,
        uint256 executedPrice,
        uint256 timestamp
    );

    /**
     * @dev Emitted when an order is cancelled
     */
    event OrderCancelled(
        uint256 indexed orderId,
        address indexed trader,
        uint256 remainingQuantity
    );

    /**
     * @dev Places a new order
     * @param order Order details
     * @return orderId Generated order ID
     */
    function placeOrder(Order calldata order)
        external
        returns (uint256 orderId);

    /**
     * @dev Cancels an existing order
     * @param orderId Order ID to cancel
     */
    function cancelOrder(uint256 orderId) external;

    /**
     * @dev Modifies an existing order
     * @param orderId Order ID to modify
     * @param newQuantity New order quantity
     * @param newPrice New order price
     */
    function modifyOrder(
        uint256 orderId,
        uint256 newQuantity,
        uint256 newPrice
    ) external;

    /**
     * @dev Batch order operations
     * @param orders Array of orders to place
     * @param cancellations Array of order IDs to cancel
     */
    function batchOperations(
        Order[] calldata orders,
        uint256[] calldata cancellations
    ) external;

    /**
     * @dev Returns order details
     * @param orderId Order ID to query
     * @return order Order details
     */
    function getOrder(uint256 orderId)
        external
        view
        returns (Order memory order);

    /**
     * @dev Returns user's active orders
     * @param trader Trader address
     * @return orders Array of active orders
     */
    function getUserActiveOrders(address trader)
        external
        view
        returns (Order[] memory orders);

    /**
     * @dev Returns user's order history
     * @param trader Trader address
     * @param limit Maximum number of orders to return
     * @param offset Offset for pagination
     * @return orders Array of historical orders
     */
    function getUserOrderHistory(
        address trader,
        uint256 limit,
        uint256 offset
    ) external view returns (Order[] memory orders);

    /**
     * @dev Returns trade executions for an order
     * @param orderId Order ID to query
     * @return executions Array of trade executions
     */
    function getOrderExecutions(uint256 orderId)
        external
        view
        returns (TradeExecution[] memory executions);

    /**
     * @dev Returns user's P&L summary
     * @param trader Trader address
     * @param metricId Metric ID (empty string for all metrics)
     * @return summary P&L summary
     */
    function getUserPnL(address trader, string calldata metricId)
        external
        view
        returns (PnLSummary memory summary);

    /**
     * @dev Returns market depth for a metric
     * @param metricId Metric ID
     * @param depth Number of price levels to return
     * @return buyOrders Buy side order book
     * @return sellOrders Sell side order book
     */
    function getMarketDepth(string calldata metricId, uint256 depth)
        external
        view
        returns (
            Order[] memory buyOrders,
            Order[] memory sellOrders
        );

    /**
     * @dev Estimates order execution price and quantity
     * @param metricId Metric ID
     * @param side Order side
     * @param quantity Order quantity
     * @return estimatedPrice Estimated average execution price
     * @return estimatedQuantity Estimated executable quantity
     * @return priceImpact Estimated price impact
     */
    function estimateExecution(
        string calldata metricId,
        Side side,
        uint256 quantity
    )
        external
        view
        returns (
            uint256 estimatedPrice,
            uint256 estimatedQuantity,
            uint256 priceImpact
        );

    /**
     * @dev Sets slippage protection parameters
     * @param maxSlippage Maximum acceptable slippage (basis points)
     */
    function setSlippageProtection(uint256 maxSlippage) external;

    /**
     * @dev Returns current slippage protection setting
     * @param trader Trader address
     * @return maxSlippage Maximum slippage setting
     */
    function getSlippageProtection(address trader)
        external
        view
        returns (uint256 maxSlippage);

    /**
     * @dev Checks if an order has expired and updates status if needed
     * @param orderId The order ID to check
     * @return isExpired Whether the order has expired
     */
    function checkOrderExpiry(uint256 orderId) external returns (bool isExpired);

    /**
     * @dev Batch expire multiple orders to save gas
     * @param orderIds Array of order IDs to check for expiration
     * @return expiredCount Number of orders that were expired
     */
    function batchExpireOrders(uint256[] calldata orderIds) external returns (uint256 expiredCount);

    /**
     * @dev Get expired orders for a user
     * @param trader The trader address
     * @return expiredOrders Array of expired orders
     */
    function getUserExpiredOrders(address trader) external view returns (Order[] memory expiredOrders);

    /**
     * @dev Get orders that are eligible for expiration (GTD orders past expiry time)
     * @param trader The trader address (address(0) for all users)
     * @param limit Maximum number of orders to return
     * @return eligibleOrders Array of orders eligible for expiration
     */
    function getOrdersEligibleForExpiration(address trader, uint256 limit) 
        external view returns (Order[] memory eligibleOrders);

    /**
     * @dev Check if an order is expired (view function)
     * @param orderId The order ID to check
     * @return isExpired Whether the order is expired
     */
    function isOrderExpired(uint256 orderId) external view returns (bool isExpired);

    /**
     * @dev Cleanup expired orders for a user (convenience function)
     * @param trader The trader address
     * @return cleanedCount Number of orders cleaned up
     */
    function cleanupUserExpiredOrders(address trader) external returns (uint256 cleanedCount);

    /**
     * @dev Registers a market order book
     * @param metricId The metric identifier
     * @param orderBook The order book contract address
     */
    function registerMarket(string calldata metricId, address orderBook) external;

    /**
     * @dev Gets the order book address for a metric
     * @param metricId The metric identifier
     * @return orderBook The order book contract address
     */
    function getMarketOrderBook(string calldata metricId) external view returns (address orderBook);
}
