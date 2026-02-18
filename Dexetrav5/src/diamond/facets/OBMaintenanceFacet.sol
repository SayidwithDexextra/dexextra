// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../libraries/LibDiamond.sol";
import "../libraries/OrderBookStorage.sol";

/**
 * @title OBMaintenanceFacet
 * @notice Admin-only helpers intentionally separated from OBOrderPlacementFacet
 *         to keep hot-path facet bytecode under the EIP-170 size limit.
 */
contract OBMaintenanceFacet {
    using OrderBookStorage for OrderBookStorage.State;

    event PriceLevelPruned(uint256 price, bool isBuy);

    modifier onlyOwner() {
        LibDiamond.enforceIsContractOwner();
        _;
    }

    /**
     * @dev Admin helper: rebuild user order index mapping for an address in batches.
     *      Safe to call multiple times; intended for large existing arrays.
     */
    function adminRebuildUserOrderIndex(address user, uint256 start, uint256 end) external onlyOwner {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        uint256[] storage lst = s.userOrders[user];
        if (start >= lst.length) return;
        uint256 to = end;
        if (to > lst.length) to = lst.length;
        for (uint256 i = start; i < to; i++) {
            s.userOrderIndex[user][lst[i]] = i + 1;
        }
    }

    /**
     * @dev Admin helper: compact the historical buyPrices/sellPrices arrays by removing tombstones.
     *      Linked-list pointers are not rebuilt here; this is purely for storage hygiene.
     */
    function defragPriceLevels() external onlyOwner {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        _defragPriceArray(s, true);
        _defragPriceArray(s, false);
    }

    /**
     * @dev Admin-only: set the active buy price-level linked list explicitly.
     *      Required for safely upgrading existing live markets to linked-list traversal.
     *
     * @param pricesDesc Active BUY prices in STRICTLY descending order (bestBid first).
     */
    function adminSetBuyPriceList(uint256[] calldata pricesDesc) external onlyOwner {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        if (pricesDesc.length == 0) {
            s.bestBid = 0;
            return;
        }
        for (uint256 i = 0; i < pricesDesc.length; i++) {
            uint256 p = pricesDesc[i];
            OrderBookStorage.PriceLevel storage level = s.buyLevels[p];
            require(level.exists && level.totalAmount > 0, "OB: dead buy level");
            if (i > 0) require(p < pricesDesc[i - 1], "OB: buy list not desc");
            delete s.buyPriceNext[p];
            delete s.buyPricePrev[p];
        }
        for (uint256 j = 0; j < pricesDesc.length; j++) {
            uint256 p2 = pricesDesc[j];
            uint256 higher = j == 0 ? 0 : pricesDesc[j - 1];
            uint256 lower = (j + 1 == pricesDesc.length) ? 0 : pricesDesc[j + 1];
            s.buyPriceNext[p2] = higher;
            s.buyPricePrev[p2] = lower;
        }
        s.bestBid = pricesDesc[0];
    }

    /**
     * @dev Admin-only: set the active sell price-level linked list explicitly.
     * @param pricesAsc Active SELL prices in STRICTLY ascending order (bestAsk first).
     */
    function adminSetSellPriceList(uint256[] calldata pricesAsc) external onlyOwner {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        if (pricesAsc.length == 0) {
            s.bestAsk = 0;
            return;
        }
        for (uint256 i = 0; i < pricesAsc.length; i++) {
            uint256 p = pricesAsc[i];
            OrderBookStorage.PriceLevel storage level = s.sellLevels[p];
            require(level.exists && level.totalAmount > 0, "OB: dead sell level");
            if (i > 0) require(p > pricesAsc[i - 1], "OB: sell list not asc");
            delete s.sellPriceNext[p];
            delete s.sellPricePrev[p];
        }
        for (uint256 j = 0; j < pricesAsc.length; j++) {
            uint256 p2 = pricesAsc[j];
            uint256 lower = j == 0 ? 0 : pricesAsc[j - 1];
            uint256 higher = (j + 1 == pricesAsc.length) ? 0 : pricesAsc[j + 1];
            s.sellPricePrev[p2] = lower;
            s.sellPriceNext[p2] = higher;
        }
        s.bestAsk = pricesAsc[0];
    }

    /**
     * @notice View helper: returns active BUY price levels (unsorted).
     * @dev This is intended for off-chain scripts to auto-initialize the linked list.
     *      It may revert if the historical array is extremely large (memory limits).
     */
    function getActiveBuyPrices() external view returns (uint256[] memory prices) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        uint256[] storage arr = s.buyPrices;
        uint256 count = 0;
        for (uint256 i = 0; i < arr.length; i++) {
            uint256 p = arr[i];
            OrderBookStorage.PriceLevel storage level = s.buyLevels[p];
            if (level.exists && level.totalAmount > 0) count++;
        }
        prices = new uint256[](count);
        uint256 w = 0;
        for (uint256 j = 0; j < arr.length; j++) {
            uint256 p2 = arr[j];
            OrderBookStorage.PriceLevel storage level2 = s.buyLevels[p2];
            if (level2.exists && level2.totalAmount > 0) {
                prices[w] = p2;
                w++;
            }
        }
    }

    /**
     * @notice View helper: returns active SELL price levels (unsorted).
     */
    function getActiveSellPrices() external view returns (uint256[] memory prices) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        uint256[] storage arr = s.sellPrices;
        uint256 count = 0;
        for (uint256 i = 0; i < arr.length; i++) {
            uint256 p = arr[i];
            OrderBookStorage.PriceLevel storage level = s.sellLevels[p];
            if (level.exists && level.totalAmount > 0) count++;
        }
        prices = new uint256[](count);
        uint256 w = 0;
        for (uint256 j = 0; j < arr.length; j++) {
            uint256 p2 = arr[j];
            OrderBookStorage.PriceLevel storage level2 = s.sellLevels[p2];
            if (level2.exists && level2.totalAmount > 0) {
                prices[w] = p2;
                w++;
            }
        }
    }

    function _defragPriceArray(OrderBookStorage.State storage s, bool isBuy) private {
        uint256 writeIdx = 0;
        uint256[] storage arr = isBuy ? s.buyPrices : s.sellPrices;
        for (uint256 readIdx = 0; readIdx < arr.length; readIdx++) {
            uint256 price = arr[readIdx];
            OrderBookStorage.PriceLevel storage level = isBuy ? s.buyLevels[price] : s.sellLevels[price];
            bool alive = level.exists && level.totalAmount > 0;
            if (alive) {
                arr[writeIdx] = price;
                writeIdx++;
            } else {
                if (isBuy) s.buyPriceExists[price] = false;
                else s.sellPriceExists[price] = false;
                emit PriceLevelPruned(price, isBuy);
            }
        }
        while (arr.length > writeIdx) {
            arr.pop();
        }
        if (isBuy) {
            while (s.bestBid != 0 && !s.buyLevels[s.bestBid].exists) {
                s.bestBid = s.buyPricePrev[s.bestBid];
            }
        } else {
            while (s.bestAsk != 0 && !s.sellLevels[s.bestAsk].exists) {
                s.bestAsk = s.sellPriceNext[s.bestAsk];
            }
        }
    }
}

