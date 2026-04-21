// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../libraries/LibDiamond.sol";
import "../libraries/OrderBookStorage.sol";
import "../interfaces/ICoreVault.sol";

/**
 * @title OBBatchSettlementFacet
 * @notice Diamond facet for batch settlement of large markets.
 *         Handles batched order cancellation and orchestrates vault batch settlement.
 *         Use this for markets with thousands of orders/positions that cannot settle in one tx.
 */
contract OBBatchSettlementFacet {
    using OrderBookStorage for OrderBookStorage.State;

    // ============ Settlement Phases ============
    // Order cancellation phases
    uint8 constant ORDERS_PENDING = 0;
    uint8 constant ORDERS_CANCELLING_BUYS = 1;
    uint8 constant ORDERS_CANCELLING_SELLS = 2;
    uint8 constant ORDERS_DONE = 3;

    // ============ Batch Order State (stored in OrderBookStorage.State for simplicity) ============
    // We use lastCheckedIndex as the cursor since it's available

    // ============ Events ============
    event OrderCancelled(uint256 indexed orderId, address indexed trader, uint256 price, uint256 amount, bool isBuy);
    event BatchOrderCancellationProgress(uint256 cancelledCount, uint256 remainingPrices, bool isBuySide);
    event BatchSettlementStarted(bytes32 indexed marketId, uint256 finalPrice, uint256 orderCount, uint256 positionCount);
    event BatchOrdersCancelled(bytes32 indexed marketId, uint256 totalCancelled);

    modifier onlyOwner() {
        LibDiamond.enforceIsContractOwner();
        _;
    }

    /// @dev Check if challenge window is active
    function _isInChallengeWindow() private view returns (bool) {
        (bool ok, bytes memory data) = address(this).staticcall(
            abi.encodeWithSignature("isInSettlementChallengeWindow()")
        );
        if (!ok || data.length < 32) return false;
        return abi.decode(data, (bool));
    }

    /**
     * @notice Initialize batch settlement process
     * @param finalPrice The settlement price (6 decimals)
     */
    function initBatchSettlement(uint256 finalPrice) external onlyOwner {
        require(finalPrice > 0, "!price");
        require(!_isInChallengeWindow(), "challenge window");
        
        OrderBookStorage.State storage s = OrderBookStorage.state();
        require(!s.vault.marketSettled(s.marketId), "already settled");

        uint256 positionCount = s.vault.getMarketPositionUserCount(s.marketId);
        
        emit BatchSettlementStarted(s.marketId, finalPrice, s.buyPrices.length + s.sellPrices.length, positionCount);
        
        // Initialize vault batch settlement
        s.vault.initBatchSettlement(s.marketId, finalPrice);
        
        // Reset order cancellation cursor
        s.lastCheckedIndex = 0;
    }

    /**
     * @notice Cancel buy orders in batches
     * @param maxOrders Maximum orders to cancel in this batch
     * @return complete True if all buy orders have been cancelled
     * @return cancelledCount Number of orders cancelled in this batch
     */
    function batchCancelBuyOrders(uint256 maxOrders) external onlyOwner returns (bool complete, uint256 cancelledCount) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        
        uint256 processed = 0;
        uint256 priceIdx = s.lastCheckedIndex;
        
        while (priceIdx < s.buyPrices.length && processed < maxOrders) {
            uint256 price = s.buyPrices[priceIdx];
            OrderBookStorage.PriceLevel storage level = s.buyLevels[price];
            
            if (level.exists) {
                uint256 currentOrderId = level.firstOrderId;
                while (currentOrderId != 0 && processed < maxOrders) {
                    OrderBookStorage.Order storage order = s.orders[currentOrderId];
                    uint256 nextOrderId = order.nextOrderId;
                    
                    if (order.trader != address(0)) {
                        // Update level aggregates
                        if (level.totalAmount > order.amount) {
                            level.totalAmount -= order.amount;
                        } else {
                            level.totalAmount = 0;
                        }
                        
                        // Unreserve margin
                        if (order.isMarginOrder) {
                            bytes32 rid = keccak256(abi.encodePacked(s.marketId, order.trader, currentOrderId));
                            s.vault.unreserveMargin(order.trader, rid);
                            s.vault.unreserveMargin(order.trader, bytes32(currentOrderId));
                        }
                        
                        // Remove from user's order list
                        _removeFromUserOrders(s, order.trader, currentOrderId);
                        
                        emit OrderCancelled(currentOrderId, order.trader, order.price, order.amount, true);
                        
                        delete s.orders[currentOrderId];
                        delete s.cumulativeMarginUsed[currentOrderId];
                        processed++;
                        cancelledCount++;
                    }
                    
                    currentOrderId = nextOrderId;
                }
                
                // If level is empty, clear it
                if (level.firstOrderId == 0 || level.totalAmount == 0) {
                    level.exists = false;
                    level.firstOrderId = 0;
                    level.lastOrderId = 0;
                    level.totalAmount = 0;
                    s.buyPriceExists[price] = false;
                }
            }
            
            // Move to next price level if we exhausted this one
            if (!level.exists || level.firstOrderId == 0) {
                priceIdx++;
            }
        }
        
        s.lastCheckedIndex = priceIdx;
        complete = (priceIdx >= s.buyPrices.length);
        
        if (complete) {
            s.bestBid = 0;
            s.lastCheckedIndex = 0; // Reset for sell side
        }
        
        emit BatchOrderCancellationProgress(cancelledCount, s.buyPrices.length - priceIdx, true);
    }

    /**
     * @notice Cancel sell orders in batches
     * @param maxOrders Maximum orders to cancel in this batch
     * @return complete True if all sell orders have been cancelled
     * @return cancelledCount Number of orders cancelled in this batch
     */
    function batchCancelSellOrders(uint256 maxOrders) external onlyOwner returns (bool complete, uint256 cancelledCount) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        
        uint256 processed = 0;
        uint256 priceIdx = s.lastCheckedIndex;
        
        while (priceIdx < s.sellPrices.length && processed < maxOrders) {
            uint256 price = s.sellPrices[priceIdx];
            OrderBookStorage.PriceLevel storage level = s.sellLevels[price];
            
            if (level.exists) {
                uint256 currentOrderId = level.firstOrderId;
                while (currentOrderId != 0 && processed < maxOrders) {
                    OrderBookStorage.Order storage order = s.orders[currentOrderId];
                    uint256 nextOrderId = order.nextOrderId;
                    
                    if (order.trader != address(0)) {
                        if (level.totalAmount > order.amount) {
                            level.totalAmount -= order.amount;
                        } else {
                            level.totalAmount = 0;
                        }
                        
                        if (order.isMarginOrder) {
                            bytes32 rid = keccak256(abi.encodePacked(s.marketId, order.trader, currentOrderId));
                            s.vault.unreserveMargin(order.trader, rid);
                            s.vault.unreserveMargin(order.trader, bytes32(currentOrderId));
                        }
                        
                        _removeFromUserOrders(s, order.trader, currentOrderId);
                        
                        emit OrderCancelled(currentOrderId, order.trader, order.price, order.amount, false);
                        
                        delete s.orders[currentOrderId];
                        delete s.cumulativeMarginUsed[currentOrderId];
                        processed++;
                        cancelledCount++;
                    }
                    
                    currentOrderId = nextOrderId;
                }
                
                if (level.firstOrderId == 0 || level.totalAmount == 0) {
                    level.exists = false;
                    level.firstOrderId = 0;
                    level.lastOrderId = 0;
                    level.totalAmount = 0;
                    s.sellPriceExists[price] = false;
                }
            }
            
            if (!level.exists || level.firstOrderId == 0) {
                priceIdx++;
            }
        }
        
        s.lastCheckedIndex = priceIdx;
        complete = (priceIdx >= s.sellPrices.length);
        
        if (complete) {
            s.bestAsk = 0;
        }
        
        emit BatchOrderCancellationProgress(cancelledCount, s.sellPrices.length - priceIdx, false);
    }

    /**
     * @notice Run vault batch calculation (Phase 1)
     * @param batchSize Number of users to process
     * @return complete True if all users processed
     */
    function runVaultBatchCalculation(uint256 batchSize) external onlyOwner returns (bool complete) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        return s.vault.batchCalculateTotals(s.marketId, batchSize);
    }

    /**
     * @notice Finalize vault haircut calculation (Phase 2)
     */
    function finalizeVaultHaircut() external onlyOwner {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        s.vault.finalizeHaircutCalculation(s.marketId);
    }

    /**
     * @notice Run vault batch application (Phase 3)
     * @param batchSize Number of users to process
     * @return complete True if all users processed
     */
    function runVaultBatchApplication(uint256 batchSize) external onlyOwner returns (bool complete) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        return s.vault.batchApplySettlements(s.marketId, batchSize);
    }

    /**
     * @notice Complete the settlement (Phase 4)
     */
    function completeSettlement() external onlyOwner {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        s.vault.finalizeBatchSettlement(s.marketId);
    }

    /**
     * @notice Get settlement progress
     * @return buyOrdersRemaining Number of buy price levels remaining
     * @return sellOrdersRemaining Number of sell price levels remaining  
     * @return vaultPhase Current vault settlement phase
     * @return vaultCursor Current vault cursor position
     * @return totalPositions Total positions in market
     */
    function getSettlementProgress() external view returns (
        uint256 buyOrdersRemaining,
        uint256 sellOrdersRemaining,
        uint8 vaultPhase,
        uint256 vaultCursor,
        uint256 totalPositions
    ) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        
        buyOrdersRemaining = s.buyPrices.length > s.lastCheckedIndex ? 
            s.buyPrices.length - s.lastCheckedIndex : 0;
        sellOrdersRemaining = s.sellPrices.length;
        
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

    function _removeFromUserOrders(
        OrderBookStorage.State storage s,
        address trader,
        uint256 orderId
    ) internal {
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
