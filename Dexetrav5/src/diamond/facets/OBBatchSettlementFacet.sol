// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../libraries/OrderBookStorage.sol";
import "../interfaces/ICoreVault.sol";

/**
 * @title OBBatchSettlementFacet
 * @notice Diamond facet for batch settlement of large markets.
 *         Handles batched order cancellation and orchestrates vault batch settlement.
 *         Use this for markets with thousands of orders/positions that cannot settle in one tx.
 * 
 * @dev FIXED: Now properly traverses and clears the price level linked list,
 *      ensuring getActiveOrdersCount() returns 0 after settlement.
 */
contract OBBatchSettlementFacet {
    using OrderBookStorage for OrderBookStorage.State;

    // ============ Events ============
    event OrderCancelled(uint256 indexed orderId, address indexed trader, uint256 price, uint256 amount, bool isBuy);
    event BatchOrderCancellationProgress(uint256 cancelledCount, uint256 remainingLevels, bool isBuySide);
    event BatchSettlementStarted(bytes32 indexed marketId, uint256 finalPrice, uint256 orderCount, uint256 positionCount);
    event BatchOrdersCancelled(bytes32 indexed marketId, uint256 totalCancelled);
    event MarginReleased(address indexed trader, bytes32 indexed orderId, uint256 amount);
    event OrderBookCleanedUp(bytes32 indexed marketId);

    /// @dev Check if challenge window is active
    function _isInChallengeWindow() private view returns (bool) {
        (bool ok, bytes memory data) = address(this).staticcall(
            abi.encodeWithSignature("isInSettlementChallengeWindow()")
        );
        if (!ok || data.length < 32) return false;
        return abi.decode(data, (bool));
    }

    /// @dev Check if we've reached the settlement timestamp (or dev mode is enabled)
    function _isPastSettlementTimestamp() private view returns (bool) {
        (bool devOk, bytes memory devData) = address(this).staticcall(
            abi.encodeWithSignature("isLifecycleDevMode()")
        );
        if (devOk && devData.length >= 32 && abi.decode(devData, (bool))) {
            return true;
        }
        
        (bool ok, bytes memory data) = address(this).staticcall(
            abi.encodeWithSignature("getSettlementTimestamp()")
        );
        if (!ok || data.length < 32) return true;
        uint256 settlementTs = abi.decode(data, (uint256));
        if (settlementTs == 0) return true;
        return block.timestamp >= settlementTs;
    }

    /**
     * @notice Initialize batch settlement process
     * @param finalPrice The settlement price (6 decimals)
     */
    function initBatchSettlement(uint256 finalPrice) external {
        require(finalPrice > 0, "!price");
        require(_isPastSettlementTimestamp(), "before settlement time");
        require(!_isInChallengeWindow(), "challenge window");
        
        OrderBookStorage.State storage s = OrderBookStorage.state();
        require(!s.vault.marketSettled(s.marketId), "already settled");
        require(!s.vault.isMarketSettling(s.marketId), "batch already in progress");

        uint256 positionCount = s.vault.getMarketPositionUserCount(s.marketId);
        
        // Count orders via linked list for accurate reporting
        uint256 buyLevels = _countBuyLevels(s);
        uint256 sellLevels = _countSellLevels(s);
        
        emit BatchSettlementStarted(s.marketId, finalPrice, buyLevels + sellLevels, positionCount);
        
        s.vault.initBatchSettlement(s.marketId, finalPrice);
    }

    /**
     * @notice Cancel buy orders in batches using linked list traversal
     * @param maxOrders Maximum orders to cancel in this batch
     * @return complete True if all buy orders have been cancelled
     * @return cancelledCount Number of orders cancelled in this batch
     */
    function batchCancelBuyOrders(uint256 maxOrders) external returns (bool complete, uint256 cancelledCount) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        require(s.vault.isMarketSettling(s.marketId), "batch not started");
        
        uint256 processed = 0;
        uint256 currentPrice = s.buyPriceHead;
        
        while (currentPrice != 0 && processed < maxOrders) {
            OrderBookStorage.PriceLevel storage level = s.buyLevels[currentPrice];
            uint256 nextPrice = s.buyPriceNext[currentPrice];
            
            if (level.exists) {
                uint256 currentOrderId = level.firstOrderId;
                
                while (currentOrderId != 0 && processed < maxOrders) {
                    OrderBookStorage.Order storage order = s.orders[currentOrderId];
                    uint256 nextOrderId = order.nextOrderId;
                    
                    if (order.trader != address(0)) {
                        _releaseOrderMargin(s, order.trader, currentOrderId, order.isMarginOrder);
                        _removeFromUserOrdersOptimized(s, order.trader, currentOrderId);
                        
                        emit OrderCancelled(currentOrderId, order.trader, order.price, order.amount, true);
                        
                        delete s.orders[currentOrderId];
                        delete s.cumulativeMarginUsed[currentOrderId];
                        delete s.filledAmounts[currentOrderId];
                        
                        processed++;
                        cancelledCount++;
                    }
                    
                    // Update level's firstOrderId to track progress
                    level.firstOrderId = nextOrderId;
                    currentOrderId = nextOrderId;
                }
                
                // Only clear level if ALL orders processed (firstOrderId == 0)
                if (level.firstOrderId == 0) {
                    level.exists = false;
                    level.lastOrderId = 0;
                    level.totalAmount = 0;
                    s.buyPriceExists[currentPrice] = false;
                    
                    // Only remove from linked list when level is empty
                    _removeBuyPriceFromList(s, currentPrice);
                    currentPrice = nextPrice;
                } else {
                    // More orders remain at this price - stop here for next batch
                    break;
                }
            } else {
                // Level doesn't exist, clean up and move on
                _removeBuyPriceFromList(s, currentPrice);
                currentPrice = nextPrice;
            }
        }
        
        // Update head to current position
        s.buyPriceHead = currentPrice;
        complete = (currentPrice == 0);
        
        if (complete) {
            s.bestBid = 0;
            delete s.buyPrices;
        }
        
        uint256 remaining = _countBuyLevels(s);
        emit BatchOrderCancellationProgress(cancelledCount, remaining, true);
    }

    /**
     * @notice Cancel sell orders in batches using linked list traversal
     * @param maxOrders Maximum orders to cancel in this batch
     * @return complete True if all sell orders have been cancelled
     * @return cancelledCount Number of orders cancelled in this batch
     */
    function batchCancelSellOrders(uint256 maxOrders) external returns (bool complete, uint256 cancelledCount) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        require(s.vault.isMarketSettling(s.marketId), "batch not started");
        
        uint256 processed = 0;
        uint256 currentPrice = s.sellPriceHead;
        
        while (currentPrice != 0 && processed < maxOrders) {
            OrderBookStorage.PriceLevel storage level = s.sellLevels[currentPrice];
            uint256 nextPrice = s.sellPriceNext[currentPrice];
            
            if (level.exists) {
                uint256 currentOrderId = level.firstOrderId;
                
                while (currentOrderId != 0 && processed < maxOrders) {
                    OrderBookStorage.Order storage order = s.orders[currentOrderId];
                    uint256 nextOrderId = order.nextOrderId;
                    
                    if (order.trader != address(0)) {
                        _releaseOrderMargin(s, order.trader, currentOrderId, order.isMarginOrder);
                        _removeFromUserOrdersOptimized(s, order.trader, currentOrderId);
                        
                        emit OrderCancelled(currentOrderId, order.trader, order.price, order.amount, false);
                        
                        delete s.orders[currentOrderId];
                        delete s.cumulativeMarginUsed[currentOrderId];
                        delete s.filledAmounts[currentOrderId];
                        
                        processed++;
                        cancelledCount++;
                    }
                    
                    // Update level's firstOrderId to track progress
                    level.firstOrderId = nextOrderId;
                    currentOrderId = nextOrderId;
                }
                
                // Only clear level if ALL orders processed
                if (level.firstOrderId == 0) {
                    level.exists = false;
                    level.lastOrderId = 0;
                    level.totalAmount = 0;
                    s.sellPriceExists[currentPrice] = false;
                    
                    _removeSellPriceFromList(s, currentPrice);
                    currentPrice = nextPrice;
                } else {
                    // More orders remain - stop here for next batch
                    break;
                }
            } else {
                _removeSellPriceFromList(s, currentPrice);
                currentPrice = nextPrice;
            }
        }
        
        s.sellPriceHead = currentPrice;
        complete = (currentPrice == 0);
        
        if (complete) {
            s.bestAsk = 0;
            delete s.sellPrices;
        }
        
        uint256 remaining = _countSellLevels(s);
        emit BatchOrderCancellationProgress(cancelledCount, remaining, false);
    }

    /**
     * @notice Run vault batch calculation (Phase 1)
     */
    function runVaultBatchCalculation(uint256 batchSize) external returns (bool complete) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        require(s.vault.isMarketSettling(s.marketId), "batch not started");
        return s.vault.batchCalculateTotals(s.marketId, batchSize);
    }

    /**
     * @notice Finalize vault haircut calculation (Phase 2)
     */
    function finalizeVaultHaircut() external {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        require(s.vault.isMarketSettling(s.marketId), "batch not started");
        s.vault.finalizeHaircutCalculation(s.marketId);
    }

    /**
     * @notice Run vault batch application (Phase 3)
     */
    function runVaultBatchApplication(uint256 batchSize) external returns (bool complete) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        require(s.vault.isMarketSettling(s.marketId), "batch not started");
        return s.vault.batchApplySettlements(s.marketId, batchSize);
    }

    /**
     * @notice Complete the settlement (Phase 4)
     */
    function completeSettlement() external {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        require(s.vault.isMarketSettling(s.marketId), "batch not started");
        s.vault.finalizeBatchSettlement(s.marketId);
        
        // Final cleanup - ensure all linked lists are cleared
        _clearOrderBookState(s);
    }

    /**
     * @notice Emergency cleanup for already-settled markets with ghost order book entries
     * @dev Can only be called on markets that are already settled (isSettled == true)
     *      This clears the linked list structures that may have been left behind
     */
    function cleanupSettledMarket() external {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        require(s.vault.marketSettled(s.marketId), "market not settled");
        
        // Clear all linked list state
        _clearOrderBookState(s);
        
        emit OrderBookCleanedUp(s.marketId);
    }

    function _clearOrderBookState(OrderBookStorage.State storage s) internal {
        // Clear linked list heads
        s.buyPriceHead = 0;
        s.sellPriceHead = 0;
        s.bestBid = 0;
        s.bestAsk = 0;
        
        // Clear the price arrays
        delete s.buyPrices;
        delete s.sellPrices;
    }

    /**
     * @notice Get settlement progress
     */
    function getSettlementProgress() external view returns (
        uint256 buyOrdersRemaining,
        uint256 sellOrdersRemaining,
        uint8 vaultPhase,
        uint256 vaultCursor,
        uint256 totalPositions
    ) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        
        buyOrdersRemaining = _countBuyLevels(s);
        sellOrdersRemaining = _countSellLevels(s);
        
        (vaultPhase, vaultCursor, totalPositions, ) = s.vault.getBatchSettlementState(s.marketId);
    }

    /**
     * @notice Check if market is being settled via batch process
     */
    function isBatchSettling() external view returns (bool) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        return s.vault.isMarketSettling(s.marketId);
    }

    // ============ Internal Helpers ============

    function _releaseOrderMargin(
        OrderBookStorage.State storage s,
        address trader,
        uint256 orderId,
        bool isMarginOrder
    ) internal {
        if (isMarginOrder) {
            // Try both order ID formats used in order placement
            bytes32 rid = keccak256(abi.encodePacked(s.marketId, trader, orderId));
            try s.vault.unreserveMargin(trader, rid) {} catch {}
            try s.vault.unreserveMargin(trader, bytes32(orderId)) {} catch {}
            
            emit MarginReleased(trader, bytes32(orderId), 0);
        }
    }

    function _removeFromUserOrdersOptimized(
        OrderBookStorage.State storage s,
        address trader,
        uint256 orderId
    ) internal {
        // Try O(1) removal using index if available
        uint256 indexPlusOne = s.userOrderIndex[trader][orderId];
        if (indexPlusOne > 0) {
            uint256 idx = indexPlusOne - 1;
            uint256[] storage orders = s.userOrders[trader];
            uint256 lastIdx = orders.length - 1;
            
            if (idx != lastIdx) {
                uint256 lastOrderId = orders[lastIdx];
                orders[idx] = lastOrderId;
                s.userOrderIndex[trader][lastOrderId] = indexPlusOne;
            }
            orders.pop();
            s.userOrderIndex[trader][orderId] = 0;
        } else {
            // Fallback to O(n) scan
            uint256[] storage orders = s.userOrders[trader];
            for (uint256 i = 0; i < orders.length; i++) {
                if (orders[i] == orderId) {
                    if (i < orders.length - 1) {
                        orders[i] = orders[orders.length - 1];
                    }
                    orders.pop();
                    break;
                }
            }
        }
    }

    function _removeBuyPriceFromList(OrderBookStorage.State storage s, uint256 price) internal {
        uint256 prevPrice = s.buyPricePrev[price];
        uint256 nextPrice = s.buyPriceNext[price];
        
        if (prevPrice != 0) {
            s.buyPriceNext[prevPrice] = nextPrice;
        }
        if (nextPrice != 0) {
            s.buyPricePrev[nextPrice] = prevPrice;
        }
        
        // Clear this node's pointers
        s.buyPriceNext[price] = 0;
        s.buyPricePrev[price] = 0;
    }

    function _removeSellPriceFromList(OrderBookStorage.State storage s, uint256 price) internal {
        uint256 prevPrice = s.sellPricePrev[price];
        uint256 nextPrice = s.sellPriceNext[price];
        
        if (prevPrice != 0) {
            s.sellPriceNext[prevPrice] = nextPrice;
        }
        if (nextPrice != 0) {
            s.sellPricePrev[nextPrice] = prevPrice;
        }
        
        s.sellPriceNext[price] = 0;
        s.sellPricePrev[price] = 0;
    }

    function _countBuyLevels(OrderBookStorage.State storage s) internal view returns (uint256 count) {
        uint256 price = s.buyPriceHead;
        while (price != 0) {
            if (s.buyLevels[price].exists) count++;
            price = s.buyPriceNext[price];
        }
    }

    function _countSellLevels(OrderBookStorage.State storage s) internal view returns (uint256 count) {
        uint256 price = s.sellPriceHead;
        while (price != 0) {
            if (s.sellLevels[price].exists) count++;
            price = s.sellPriceNext[price];
        }
    }
}
