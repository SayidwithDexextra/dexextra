// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./IOrderRouter.sol";

/**
 * @title IOrderBook
 * @dev Interface for the Order Book contract
 * @notice Manages order matching and execution for a specific metric
 */
interface IOrderBook {

    /**
     * @dev Price level in the order book
     */
    struct PriceLevel {
        uint256 price;
        uint256 totalQuantity;
        uint256 orderCount;
        uint256[] orderIds;
    }

    /**
     * @dev Market statistics
     */
    struct MarketStats {
        uint256 lastPrice;
        uint256 volume24h;
        uint256 high24h;
        uint256 low24h;
        int256 priceChange24h;
        uint256 totalTrades;
        uint256 bestBid;
        uint256 bestAsk;
        uint256 spread;
    }

    /**
     * @dev Emitted when order book is updated
     */
    event OrderBookUpdated(
        string indexed metricId,
        uint256 indexed price,
        IOrderRouter.Side side,
        uint256 totalQuantity,
        uint256 orderCount
    );

    /**
     * @dev Emitted when a trade occurs
     */
    event Trade(
        string indexed metricId,
        uint256 indexed buyOrderId,
        uint256 indexed sellOrderId,
        uint256 price,
        uint256 quantity,
        address buyer,
        address seller,
        uint256 timestamp
    );

    /**
     * @dev Emitted when market stats are updated
     */
    event MarketStatsUpdated(
        string indexed metricId,
        uint256 lastPrice,
        uint256 volume24h,
        uint256 high24h,
        uint256 low24h
    );

    /**
     * @dev Adds an order to the order book
     * @param order Order to add
     * @return success True if order was added successfully
     */
    function addOrder(IOrderRouter.Order calldata order)
        external
        returns (bool success);

    /**
     * @dev Removes an order from the order book
     * @param orderId Order ID to remove
     * @return success True if order was removed successfully
     */
    function removeOrder(uint256 orderId)
        external
        returns (bool success);

    /**
     * @dev Matches orders and executes trades
     * @param orderId Order ID to match
     * @return executedQuantity Total quantity executed
     * @return averagePrice Average execution price
     */
    function matchOrder(uint256 orderId)
        external
        returns (uint256 executedQuantity, uint256 averagePrice);

    /**
     * @dev Returns the best bid price
     * @return price Best bid price (0 if no bids)
     */
    function getBestBid() external view returns (uint256 price);

    /**
     * @dev Returns the best ask price
     * @return price Best ask price (0 if no asks)
     */
    function getBestAsk() external view returns (uint256 price);

    /**
     * @dev Returns the current spread
     * @return spread Difference between best ask and best bid
     */
    function getSpread() external view returns (uint256 spread);

    /**
     * @dev Returns price levels for a given side
     * @param side Order side (BUY/SELL)
     * @param depth Number of price levels to return
     * @return levels Array of price levels
     */
    function getPriceLevels(IOrderRouter.Side side, uint256 depth)
        external
        view
        returns (PriceLevel[] memory levels);

    /**
     * @dev Returns orders at a specific price level
     * @param side Order side
     * @param price Price level
     * @return orderIds Array of order IDs at this price
     */
    function getOrdersAtPrice(IOrderRouter.Side side, uint256 price)
        external
        view
        returns (uint256[] memory orderIds);

    /**
     * @dev Returns market statistics
     * @return stats Current market statistics
     */
    function getMarketStats()
        external
        view
        returns (MarketStats memory stats);

    /**
     * @dev Returns total volume at a price level
     * @param side Order side
     * @param price Price level
     * @return volume Total volume at this price
     */
    function getVolumeAtPrice(IOrderRouter.Side side, uint256 price)
        external
        view
        returns (uint256 volume);

    /**
     * @dev Estimates the impact of a market order
     * @param side Order side
     * @param quantity Order quantity
     * @return averagePrice Estimated average execution price
     * @return priceImpact Estimated price impact (basis points)
     */
    function estimateMarketOrder(IOrderRouter.Side side, uint256 quantity)
        external
        view
        returns (uint256 averagePrice, uint256 priceImpact);

    /**
     * @dev Returns the metric ID this order book serves
     * @return metricId Metric identifier
     */
    function getMetricId() external view returns (string memory metricId);

    /**
     * @dev Returns order book configuration
     * @return tickSize Fixed price increment (0.01)
     * @return minOrderSize Minimum order size
     * @return maxOrderSize Maximum order size
     */
    function getConfiguration()
        external
        view
        returns (
            uint256 tickSize,
            uint256 minOrderSize,
            uint256 maxOrderSize
        );

    /**
     * @dev Updates market configuration (admin only)
     * @param tickSize Deprecated: tick size is now fixed at 0.01
     * @param minOrderSize New minimum order size
     * @param maxOrderSize New maximum order size
     */
    function updateConfiguration(
        uint256 tickSize,
        uint256 minOrderSize,
        uint256 maxOrderSize
    ) external;

    /**
     * @dev Pauses/unpauses the order book
     * @param isPaused New pause status
     */
    function setPaused(bool isPaused) external;

    /**
     * @dev Returns pause status
     * @return isPaused Current pause status
     */
    function isPaused() external view returns (bool isPaused);

    /**
     * @dev Returns total number of orders in the book
     * @return totalOrders Total order count
     */
    function getTotalOrders() external view returns (uint256 totalOrders);

    /**
     * @dev Returns total number of orders for a side
     * @param side Order side
     * @return orderCount Order count for the side
     */
    function getOrderCount(IOrderRouter.Side side)
        external
        view
        returns (uint256 orderCount);

    /**
     * @dev Clears all orders from the book (emergency only)
     */
    function clearOrderBook() external;

    /**
     * @dev Initializes the order book (called by factory)
     * @param metricId Metric identifier
     * @param description Market description
     * @param decimals Decimal precision
     * @param minOrderSize Minimum order size
     * @param tickSize Deprecated: tick size is now fixed at 0.01
     * @param vault Central vault address
     * @param router Order router address
     * @param oracleManager UMA oracle manager address
     * @param umaIdentifier UMA identifier for this metric
     * @param settlementDate When the market settles
     * @param tradingEndDate When trading ends
     * @param dataRequestWindow Window before settlement to request data
     * @param autoSettle Whether market auto-settles
     */
    function initialize(
        string calldata metricId,
        string calldata description,
        uint8 decimals,
        uint256 minOrderSize,
        uint256 tickSize,
        address vault,
        address router,
        address oracleManager,
        bytes32 umaIdentifier,
        uint256 settlementDate,
        uint256 tradingEndDate,
        uint256 dataRequestWindow,
        bool autoSettle
    ) external;
}
