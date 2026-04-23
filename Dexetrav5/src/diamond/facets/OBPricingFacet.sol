// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../libraries/OrderBookStorage.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

contract OBPricingFacet {
    using Math for uint256;
    using OrderBookStorage for OrderBookStorage.State;

    event VWAPConfigUpdated(uint256 timeWindow, uint256 minVolume, bool useVWAP);

    function calculateMarkPrice() external view returns (uint256) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        return _calculateMarkPrice(s);
    }

    function getBestPrices() external view returns (uint256 bidPrice, uint256 askPrice) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        return (s.bestBid, s.bestAsk);
    }

    function isBookCrossed() external view returns (bool crossed) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        return s.bestBid != 0 && s.bestAsk != 0 && s.bestBid >= s.bestAsk;
    }

    function getOrderBookDepth(uint256 levels)
        external
        view
        returns (uint256[] memory bidPrices, uint256[] memory bidAmounts, uint256[] memory askPrices, uint256[] memory askAmounts)
    {
        // Use linked list traversal (gas-optimized storage no longer uses price arrays)
        return this.getOrderBookDepthFromPointers(levels);
    }

    function getOrderBookDepthFromPointers(uint256 levels)
        external
        view
        returns (uint256[] memory bidPrices, uint256[] memory bidAmounts, uint256[] memory askPrices, uint256[] memory askAmounts)
    {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        // Bids: walk from buyPriceHead (linked list head) downward
        // NOTE: Use buyPriceHead instead of bestBid - bestBid may not be connected to linked list
        uint256[] memory tmpBidPrices = new uint256[](levels);
        uint256[] memory tmpBidAmounts = new uint256[](levels);
        uint256 bCount = 0;
        uint256 p = s.buyPriceHead;
        while (bCount < levels && p != 0) {
            OrderBookStorage.PriceLevel storage lvl = s.buyLevels[p];
            if (lvl.exists && lvl.totalAmount > 0 && lvl.firstOrderId != 0) {
                tmpBidPrices[bCount] = p;
                tmpBidAmounts[bCount] = lvl.totalAmount;
                bCount++;
            }
            p = _getPrevBuyPrice(s, p);
        }
        bidPrices = new uint256[](bCount);
        bidAmounts = new uint256[](bCount);
        for (uint256 i = 0; i < bCount; i++) { bidPrices[i] = tmpBidPrices[i]; bidAmounts[i] = tmpBidAmounts[i]; }

        // Asks: walk from sellPriceHead (linked list head) upward
        // NOTE: Use sellPriceHead instead of bestAsk - bestAsk may not be connected to linked list
        uint256[] memory tmpAskPrices = new uint256[](levels);
        uint256[] memory tmpAskAmounts = new uint256[](levels);
        uint256 aCount = 0;
        uint256 p2 = s.sellPriceHead;
        while (aCount < levels && p2 != 0) {
            OrderBookStorage.PriceLevel storage lvl2 = s.sellLevels[p2];
            if (lvl2.exists && lvl2.totalAmount > 0 && lvl2.firstOrderId != 0) {
                tmpAskPrices[aCount] = p2;
                tmpAskAmounts[aCount] = lvl2.totalAmount;
                aCount++;
            }
            p2 = _getNextSellPrice(s, p2);
        }
        askPrices = new uint256[](aCount);
        askAmounts = new uint256[](aCount);
        for (uint256 j = 0; j < aCount; j++) { askPrices[j] = tmpAskPrices[j]; askAmounts[j] = tmpAskAmounts[j]; }
    }

    function getSpread() external view returns (uint256 spread) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        if (s.bestBid == 0 || s.bestAsk == 0) return 0;
        return s.bestAsk > s.bestBid ? s.bestAsk - s.bestBid : 0;
    }

    function getMarketPriceData() external view returns (
        uint256 midPrice,
        uint256 bestBidPrice,
        uint256 bestAskPrice,
        uint256 lastTradePriceReturn,
        uint256 markPrice,
        uint256 spread,
        uint256 spreadBps,
        bool isValid
    ) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        bestBidPrice = s.bestBid;
        bestAskPrice = s.bestAsk;
        lastTradePriceReturn = s.lastTradePrice;
        if (s.bestBid > 0 && s.bestAsk > 0) {
            midPrice = (s.bestBid / 2) + (s.bestAsk / 2) + ((s.bestBid % 2 + s.bestAsk % 2) / 2);
            spread = s.bestAsk > s.bestBid ? s.bestAsk - s.bestBid : 0;
            spreadBps = midPrice > 0 ? (spread * 10000) / midPrice : 0;
            isValid = true;
        } else if (s.bestBid > 0) {
            midPrice = s.bestBid; isValid = true;
        } else if (s.bestAsk > 0) {
            midPrice = s.bestAsk; isValid = true;
        } else {
            midPrice = 1000000; isValid = false;
        }
        markPrice = _calculateMarkPrice(s);
    }

    function configureVWAP(uint256 _timeWindow, uint256 _minVolume, bool _useVWAP) external {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        require(_timeWindow > 0 && _timeWindow <= 86400, "Invalid time window");
        s.vwapTimeWindow = _timeWindow;
        s.minVolumeForVWAP = _minVolume;
        s.useVWAPForMarkPrice = _useVWAP;
        emit VWAPConfigUpdated(_timeWindow, _minVolume, _useVWAP);
    }

    function _calculateMarkPrice(OrderBookStorage.State storage s) internal view returns (uint256) {
        if (s.bestBid > 0 && s.bestAsk > 0) {
            uint256 mid = (s.bestBid / 2) + (s.bestAsk / 2) + ((s.bestBid % 2 + s.bestAsk % 2) / 2);
            if (s.useVWAPForMarkPrice) {
                (uint256 vwap4, uint256 used, bool ok) = _lastUpToFourTradeVWAP(s);
                if (ok && vwap4 > 0 && used > 0) {
                    uint256 wBps = _hybridWeightBps(used);
                    if (wBps > 0) {
                        uint256 left = Math.mulDiv(mid, 10000 - wBps, 10000);
                        uint256 right = Math.mulDiv(vwap4, wBps, 10000);
                        return left + right;
                    }
                }
            }
            return mid;
        }
        // one-sided/empty: try 2-trade VWAP fallback then last/side best
        if (s.useVWAPForMarkPrice) {
            (uint256 vwap2, bool ok2) = _lastTwoTradeVWAP(s);
            if (ok2 && vwap2 > 0) { return vwap2; }
        }
        if (s.lastTradePrice > 0) {
            // Match legacy behavior: when trades exist, prefer simple average of last two prices if available
            if (s.totalTradeCount >= 2) {
                uint256 p1 = s.trades[s.totalTradeCount].price;
                uint256 p2 = s.trades[s.totalTradeCount - 1].price;
                return (p1 / 2) + (p2 / 2) + ((p1 % 2 + p2 % 2) / 2);
            }
            return s.lastTradePrice;
        }
        if (s.bestBid > 0) return s.bestBid;
        if (s.bestAsk > 0) return s.bestAsk;
        return 1000000;
    }

    function _lastTwoTradeVWAP(OrderBookStorage.State storage s) internal view returns (uint256 vwap, bool ok) {
        if (s.totalTradeCount < 2) return (0, false);
        OrderBookStorage.Trade storage t1 = s.trades[s.totalTradeCount];
        OrderBookStorage.Trade storage t2 = s.trades[s.totalTradeCount - 1];
        // Staleness guard to match legacy behavior
        if (s.vwapTimeWindow > 0) {
            uint256 cutoff = block.timestamp - s.vwapTimeWindow;
            if (t1.timestamp < cutoff || t2.timestamp < cutoff) {
                return (0, false);
            }
        }
        uint256 amountSum = t1.amount + t2.amount; if (amountSum == 0) return (0, false);
        if (t1.price >= t2.price) {
            uint256 priceDelta = t1.price - t2.price;
            uint256 weighted = Math.mulDiv(priceDelta, t1.amount, amountSum);
            return (t2.price + weighted, true);
        } else {
            uint256 priceDelta2 = t2.price - t1.price;
            uint256 weighted2 = Math.mulDiv(priceDelta2, t1.amount, amountSum);
            return (t2.price - weighted2, true);
        }
    }

    function _lastUpToFourTradeVWAP(OrderBookStorage.State storage s) internal view returns (uint256 vwap, uint256 tradesUsed, bool ok) {
        if (s.totalTradeCount == 0) return (0, 0, false);
        uint256 maxToUse = s.totalTradeCount < 4 ? s.totalTradeCount : 4;
        uint256 amountSum = 0;
        uint256 running = 0;
        uint256 used = 0;
        for (uint256 i = s.totalTradeCount; i >= 1 && used < maxToUse; i--) {
            OrderBookStorage.Trade storage t = s.trades[i];
            if (t.amount == 0) { if (i == 1) break; else continue; }
            if (amountSum == 0) { running = t.price; amountSum = t.amount; used++; }
            else {
                uint256 newDenom = amountSum + t.amount;
                if (t.price >= running) {
                    uint256 delta = t.price - running;
                    uint256 weighted = Math.mulDiv(delta, t.amount, newDenom);
                    running = running + weighted;
                } else {
                    uint256 delta2 = running - t.price;
                    uint256 weighted2 = Math.mulDiv(delta2, t.amount, newDenom);
                    running = running - weighted2;
                }
                amountSum = newDenom; used++;
            }
            if (i == 1) break;
        }
        if (amountSum == 0 || used == 0) return (0, 0, false);
        return (running, used, true);
    }

    function _hybridWeightBps(uint256 tradesUsed) internal pure returns (uint256) {
        if (tradesUsed == 0) return 0;
        if (tradesUsed == 1) return 2000;
        if (tradesUsed == 2) return 3000;
        if (tradesUsed == 3) return 4000;
        return 5000;
    }

    function _getNextSellPrice(OrderBookStorage.State storage s, uint256 currentPrice) private view returns (uint256) {
        // Use linked list pointer (ascending order: next = higher price)
        return s.sellPriceNext[currentPrice];
    }
    
    function _getPrevBuyPrice(OrderBookStorage.State storage s, uint256 currentPrice) private view returns (uint256) {
        // Use linked list pointer (descending order: next = lower price)
        return s.buyPriceNext[currentPrice];
    }
}


