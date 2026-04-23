// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../libraries/LibDiamond.sol";
import "../libraries/OrderBookStorage.sol";
import "../interfaces/ICoreVault.sol";

contract OBSettlementFacet {
    using OrderBookStorage for OrderBookStorage.State;

    // Mirror event for consistency with placement facet
    event OrderCancelled(uint256 indexed orderId, address indexed trader, uint256 price, uint256 amount, bool isBuy);

    modifier onlyOwner() {
        LibDiamond.enforceIsContractOwner();
        _;
    }

    /// @dev Returns true if the challenge window is currently active on-chain.
    ///      Safe to call even if MarketLifecycleFacet is not installed (returns false).
    function _isInChallengeWindow() private view returns (bool) {
        (bool ok, bytes memory data) = address(this).staticcall(
            abi.encodeWithSignature("isInSettlementChallengeWindow()")
        );
        if (!ok || data.length < 32) return false;
        return abi.decode(data, (bool));
    }

    /// @dev Check if we've reached the settlement timestamp (or dev mode is enabled).
    ///      Returns true if no lifecycle is configured (backwards compatible).
    function _isPastSettlementTimestamp() private view returns (bool) {
        // Check if dev mode is enabled - bypass timestamp check for testing
        (bool devOk, bytes memory devData) = address(this).staticcall(
            abi.encodeWithSignature("isLifecycleDevMode()")
        );
        if (devOk && devData.length >= 32 && abi.decode(devData, (bool))) {
            return true; // Dev mode bypasses timestamp check
        }
        
        (bool ok, bytes memory data) = address(this).staticcall(
            abi.encodeWithSignature("getSettlementTimestamp()")
        );
        if (!ok || data.length < 32) return true; // If no lifecycle, allow settlement
        uint256 settlementTs = abi.decode(data, (uint256));
        if (settlementTs == 0) return true; // If not set, allow settlement
        return block.timestamp >= settlementTs;
    }

    /**
     * @dev Settle this order book's market at the provided final price.
     *      Oracle-agnostic: price is provided by caller.
     *      Reverts if the challenge window is still active.
     */
    function settleMarket(uint256 finalPrice) external {
        require(finalPrice > 0, "OB: !price");
        require(_isPastSettlementTimestamp(), "OB: before settlement time");
        require(!_isInChallengeWindow(), "OB: challenge window active");
        OrderBookStorage.State storage s = OrderBookStorage.state();
        // 1) Cancel all resting orders and release their reserved margin before settlement
        //    Perform inline to preserve owner auth and avoid cross-facet msg.sender issues
        //    BUY SIDE
        for (uint256 i = 0; i < s.buyPrices.length; i++) {
            uint256 price = s.buyPrices[i];
            OrderBookStorage.PriceLevel storage level = s.buyLevels[price];
            if (!level.exists) { continue; }
            uint256 currentOrderId = level.firstOrderId;
            while (currentOrderId != 0) {
                OrderBookStorage.Order storage order = s.orders[currentOrderId];
                uint256 nextOrderId = order.nextOrderId;
                if (order.trader != address(0)) {
                    // Update level aggregates
                    if (level.totalAmount > order.amount) { level.totalAmount -= order.amount; } else { level.totalAmount = 0; }
                    // Unreserve margin for margin orders
                    if (order.isMarginOrder) {
                        bytes32 rid = keccak256(abi.encodePacked(s.marketId, order.trader, currentOrderId));
                        s.vault.unreserveMargin(order.trader, rid);
                        s.vault.unreserveMargin(order.trader, bytes32(currentOrderId));
                    }
                    // Remove from user's order list
                    uint256[] storage lst = s.userOrders[order.trader];
                    for (uint256 ui = 0; ui < lst.length; ui++) { if (lst[ui] == currentOrderId) { if (ui < lst.length - 1) { lst[ui] = lst[lst.length - 1]; } lst.pop(); break; } }
                    emit OrderCancelled(currentOrderId, order.trader, order.price, order.amount, order.isBuy);
                    delete s.orders[currentOrderId];
                    delete s.cumulativeMarginUsed[currentOrderId];
                }
                currentOrderId = nextOrderId;
            }
            // Clear level metadata
            level.exists = false; level.firstOrderId = 0; level.lastOrderId = 0; level.totalAmount = 0;
            s.buyPriceExists[price] = false;
        }
        s.bestBid = 0;
        //    SELL SIDE
        for (uint256 j = 0; j < s.sellPrices.length; j++) {
            uint256 price2 = s.sellPrices[j];
            OrderBookStorage.PriceLevel storage level2 = s.sellLevels[price2];
            if (!level2.exists) { continue; }
            uint256 currentOrderId2 = level2.firstOrderId;
            while (currentOrderId2 != 0) {
                OrderBookStorage.Order storage order2 = s.orders[currentOrderId2];
                uint256 nextOrderId2 = order2.nextOrderId;
                if (order2.trader != address(0)) {
                    if (level2.totalAmount > order2.amount) { level2.totalAmount -= order2.amount; } else { level2.totalAmount = 0; }
                    if (order2.isMarginOrder) {
                        bytes32 rid2 = keccak256(abi.encodePacked(s.marketId, order2.trader, currentOrderId2));
                        s.vault.unreserveMargin(order2.trader, rid2);
                        s.vault.unreserveMargin(order2.trader, bytes32(currentOrderId2));
                    }
                    uint256[] storage lst2 = s.userOrders[order2.trader];
                    for (uint256 ui2 = 0; ui2 < lst2.length; ui2++) { if (lst2[ui2] == currentOrderId2) { if (ui2 < lst2.length - 1) { lst2[ui2] = lst2[lst2.length - 1]; } lst2.pop(); break; } }
                    emit OrderCancelled(currentOrderId2, order2.trader, order2.price, order2.amount, order2.isBuy);
                    delete s.orders[currentOrderId2];
                    delete s.cumulativeMarginUsed[currentOrderId2];
                }
                currentOrderId2 = nextOrderId2;
            }
            level2.exists = false; level2.firstOrderId = 0; level2.lastOrderId = 0; level2.totalAmount = 0;
            s.sellPriceExists[price2] = false;
        }
        s.bestAsk = 0;
        // 2) Call into vault to settle positions at final price
        s.vault.settleMarket(s.marketId, finalPrice);
    }

    /**
     * @dev View settlement status from the vault for this market.
     */
    function isSettled() external view returns (bool) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        return s.vault.marketSettled(s.marketId);
    }
}


