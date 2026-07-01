// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../libraries/OrderBookStorage.sol";
import "../interfaces/IOBOrderPlacementSelf.sol";

/**
 * @title OBCrossHealFacet
 * @notice Permissionlessly clears a "crossed book" (best bid >= best ask) that can arise when an
 *         incoming order hits the per-order match cap (MAX_MATCHES_PER_ORDER in OBOrderPlacementFacet)
 *         and its unfilled remainder rests at a price that crosses the opposite side.
 *
 * @dev    The heal re-submits the crossing (aggressor) order through the existing, audited placement
 *         entrypoints `cancelOrderBy` + `placeMarginLimitOrderBy`. This reuses all matching, margin,
 *         fee and position logic verbatim and emits ONLY the events the off-chain indexer already
 *         consumes as definitive book state: OrderCancelled -> TradeRecorded -> OrderPlaced/OrderRested.
 *         It deliberately does NOT rely on OrderModified (the indexer has no handler for it).
 *
 *         cancel + re-submit happen as two self-calls inside a single iteration; if the re-submit
 *         reverts, the whole iteration reverts and the cancel is rolled back, so an aggressor can
 *         never be lost.
 *
 *         This facet is shared by every DiamondRegistry market via FacetRegistry; per-market state
 *         lives in OrderBookStorage.state().
 */
contract OBCrossHealFacet {
    using OrderBookStorage for OrderBookStorage.State;

    /// @notice Emitted once per heal iteration that re-submits a crossing order.
    event CrossBookHealed(uint256 indexed oldOrderId, address indexed aggressor, uint256 price, uint256 amount, bool isBuy);

    /// @dev Stop iterating when remaining gas drops below this floor. Each iteration triggers one
    ///      <=50-match cycle, so this guarantees a call never runs out of gas mid-iteration.
    uint256 private constant GAS_FLOOR = 600_000;

    /// @dev Hard ceiling on iterations per call regardless of caller input (bounds worst-case gas).
    uint256 private constant MAX_ITER = 32;

    /**
     * @notice Clear up to `maxIterations` crossing orders. Cheap no-op when the book is healthy.
     * @param maxIterations Caller hint; clamped to (0, MAX_ITER]. The auto-heal hot-path hook passes 1.
     * @return stillCrossed True if the book is still crossed after this call (more sweeps needed).
     */
    function sweepCrossedBook(uint256 maxIterations) external returns (bool stillCrossed) {
        OrderBookStorage.State storage s = OrderBookStorage.state();

        // Never operate on a settled market. Challenge-window enforcement is inherited from
        // placeMarginLimitOrderBy's marketActive modifier (it reverts, rolling back the iteration).
        if (s.vault.marketSettled(s.marketId)) {
            return _isCrossed(s);
        }

        uint256 iters = maxIterations;
        if (iters == 0 || iters > MAX_ITER) iters = MAX_ITER;

        for (uint256 i = 0; i < iters; i++) {
            if (gasleft() < GAS_FLOOR) break;
            if (!_healOne(s)) break; // book healthy (or desynced head) -> nothing to do
        }
        return _isCrossed(s);
    }

    /// @dev Re-submits a single crossing order. Returns true iff an aggressor was re-submitted.
    function _healOne(OrderBookStorage.State storage s) private returns (bool) {
        // Authoritative best prices come from the sorted linked-list heads (highest buy / lowest sell),
        // which are reliable even if the cached bestBid/bestAsk scalars have desynced.
        uint256 bid = s.buyPriceHead;
        uint256 ask = s.sellPriceHead;
        if (bid == 0 || ask == 0 || bid < ask) return false; // healthy book

        uint256 buyHead = s.buyLevels[bid].firstOrderId;
        uint256 sellHead = s.sellLevels[ask].firstOrderId;
        if (buyHead == 0 || sellHead == 0) return false; // desynced level head; let normal flow prune it

        OrderBookStorage.Order storage buyAgg = s.orders[buyHead];
        OrderBookStorage.Order storage sellAgg = s.orders[sellHead];

        // Aggressor = the order that arrived later (newer timestamp). It becomes the taker and
        // executes at the older resting order's price, preserving price-time priority. Ties favor buy.
        bool aggIsBuy = buyAgg.timestamp >= sellAgg.timestamp;
        OrderBookStorage.Order storage agg = aggIsBuy ? buyAgg : sellAgg;

        uint256 aggId = agg.orderId;
        address aggTrader = agg.trader;
        uint256 aggPrice = agg.price;
        uint256 aggAmount = agg.amount;
        if (aggTrader == address(0) || aggAmount == 0) return false; // defensive

        // Cancel-in-place (emits OrderCancelled, releases reserved margin) then re-submit the same
        // order (re-matches <=50 and re-rests, emitting TradeRecorded + OrderPlaced/OrderRested).
        IOBOrderPlacementSelf(address(this)).cancelOrderBy(aggTrader, aggId);
        IOBOrderPlacementSelf(address(this)).placeMarginLimitOrderBy(aggTrader, aggPrice, aggAmount, aggIsBuy);

        emit CrossBookHealed(aggId, aggTrader, aggPrice, aggAmount, aggIsBuy);
        return true;
    }

    function _isCrossed(OrderBookStorage.State storage s) private view returns (bool) {
        uint256 bid = s.buyPriceHead;
        uint256 ask = s.sellPriceHead;
        return bid != 0 && ask != 0 && bid >= ask;
    }
}
