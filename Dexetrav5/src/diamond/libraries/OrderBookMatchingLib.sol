// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./OrderBookStorage.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/// @title OrderBookMatchingLib
/// @notice Library containing price linked list operations and helper functions
/// @dev Extracted from OBOrderPlacementFacet to reduce contract size
library OrderBookMatchingLib {
    using Math for uint256;

    /// @dev O(1) find new best bid using sorted linked list. Falls back to O(n) scan if linked list not initialized.
    function findNewBestBid(OrderBookStorage.State storage s) internal view returns (uint256) {
        uint256 current = s.buyPriceHead;
        if (current != 0) {
            while (current != 0) {
                if (s.buyLevels[current].exists) return current;
                current = s.buyPriceNext[current];
            }
            return 0;
        }
        uint256 nb = 0;
        for (uint256 i = 0; i < s.buyPrices.length; i++) {
            if (s.buyLevels[s.buyPrices[i]].exists && s.buyPrices[i] > nb) nb = s.buyPrices[i];
        }
        return nb;
    }
    
    /// @dev O(1) find new best ask using sorted linked list. Falls back to O(n) scan if linked list not initialized.
    function findNewBestAsk(OrderBookStorage.State storage s) internal view returns (uint256) {
        uint256 current = s.sellPriceHead;
        if (current != 0) {
            while (current != 0) {
                if (s.sellLevels[current].exists) return current;
                current = s.sellPriceNext[current];
            }
            return 0;
        }
        uint256 na = 0;
        for (uint256 i = 0; i < s.sellPrices.length; i++) {
            if (s.sellLevels[s.sellPrices[i]].exists) {
                if (na == 0 || s.sellPrices[i] < na) na = s.sellPrices[i];
            }
        }
        return na;
    }
    
    /// @dev O(1) get next sell price using linked list pointer. Falls back to O(n) if not initialized.
    function getNextSellPrice(OrderBookStorage.State storage s, uint256 currentPrice) internal view returns (uint256) {
        uint256 next = s.sellPriceNext[currentPrice];
        if (next != 0 || s.sellPriceHead != 0) {
            while (next != 0) {
                if (s.sellLevels[next].exists) return next;
                next = s.sellPriceNext[next];
            }
            return 0;
        }
        uint256 result = 0;
        for (uint256 i = 0; i < s.sellPrices.length; i++) {
            if (s.sellLevels[s.sellPrices[i]].exists && s.sellPrices[i] > currentPrice) {
                if (result == 0 || s.sellPrices[i] < result) result = s.sellPrices[i];
            }
        }
        return result;
    }
    
    /// @dev O(1) get previous buy price using linked list pointer. Falls back to O(n) if not initialized.
    function getPrevBuyPrice(OrderBookStorage.State storage s, uint256 currentPrice) internal view returns (uint256) {
        uint256 prev = s.buyPriceNext[currentPrice];
        if (prev != 0 || s.buyPriceHead != 0) {
            while (prev != 0) {
                if (s.buyLevels[prev].exists) return prev;
                prev = s.buyPriceNext[prev];
            }
            return 0;
        }
        uint256 result = 0;
        for (uint256 i = 0; i < s.buyPrices.length; i++) {
            if (s.buyLevels[s.buyPrices[i]].exists && s.buyPrices[i] < currentPrice && s.buyPrices[i] > result) {
                result = s.buyPrices[i];
            }
        }
        return result;
    }

    /// @dev Insert a buy price into sorted linked list (descending order: highest first)
    function insertBuyPriceIntoLinkedList(OrderBookStorage.State storage s, uint256 price) internal {
        if (s.buyPriceHead == 0) {
            s.buyPriceHead = price;
            return;
        }
        if (price > s.buyPriceHead) {
            s.buyPriceNext[price] = s.buyPriceHead;
            s.buyPricePrev[s.buyPriceHead] = price;
            s.buyPriceHead = price;
            return;
        }
        uint256 current = s.buyPriceHead;
        while (s.buyPriceNext[current] != 0 && s.buyPriceNext[current] > price) {
            current = s.buyPriceNext[current];
        }
        uint256 nextPrice = s.buyPriceNext[current];
        s.buyPriceNext[current] = price;
        s.buyPricePrev[price] = current;
        s.buyPriceNext[price] = nextPrice;
        if (nextPrice != 0) {
            s.buyPricePrev[nextPrice] = price;
        }
    }
    
    /// @dev Insert a sell price into sorted linked list (ascending order: lowest first)
    function insertSellPriceIntoLinkedList(OrderBookStorage.State storage s, uint256 price) internal {
        if (s.sellPriceHead == 0) {
            s.sellPriceHead = price;
            return;
        }
        if (price < s.sellPriceHead) {
            s.sellPriceNext[price] = s.sellPriceHead;
            s.sellPricePrev[s.sellPriceHead] = price;
            s.sellPriceHead = price;
            return;
        }
        uint256 current = s.sellPriceHead;
        while (s.sellPriceNext[current] != 0 && s.sellPriceNext[current] < price) {
            current = s.sellPriceNext[current];
        }
        uint256 nextPrice = s.sellPriceNext[current];
        s.sellPriceNext[current] = price;
        s.sellPricePrev[price] = current;
        s.sellPriceNext[price] = nextPrice;
        if (nextPrice != 0) {
            s.sellPricePrev[nextPrice] = price;
        }
    }

    /// @dev Remove a buy price from the sorted linked list
    function removeBuyPriceFromLinkedList(OrderBookStorage.State storage s, uint256 price) internal {
        uint256 prevPrice = s.buyPricePrev[price];
        uint256 nextPrice = s.buyPriceNext[price];
        
        if (prevPrice != 0) {
            s.buyPriceNext[prevPrice] = nextPrice;
        } else {
            s.buyPriceHead = nextPrice;
        }
        
        if (nextPrice != 0) {
            s.buyPricePrev[nextPrice] = prevPrice;
        }
        
        s.buyPricePrev[price] = 0;
        s.buyPriceNext[price] = 0;
    }
    
    /// @dev Remove a sell price from the sorted linked list
    function removeSellPriceFromLinkedList(OrderBookStorage.State storage s, uint256 price) internal {
        uint256 prevPrice = s.sellPricePrev[price];
        uint256 nextPrice = s.sellPriceNext[price];
        
        if (prevPrice != 0) {
            s.sellPriceNext[prevPrice] = nextPrice;
        } else {
            s.sellPriceHead = nextPrice;
        }
        
        if (nextPrice != 0) {
            s.sellPricePrev[nextPrice] = prevPrice;
        }
        
        s.sellPricePrev[price] = 0;
        s.sellPriceNext[price] = 0;
    }

    /// @dev Calculate margin required for an order
    function calculateMarginRequired(OrderBookStorage.State storage s, uint256 amount, uint256 price, bool isBuy) internal view returns (uint256) {
        if (amount == 0) return 0;
        uint256 notional = Math.mulDiv(amount, price, 1e18);
        uint256 marginBps = isBuy ? s.marginRequirementBps : 15000;
        return Math.mulDiv(notional, marginBps, 10000);
    }

    /// @dev O(1) removal using userOrderIndex mapping for indexed lookup
    function removeOrderFromUserList(OrderBookStorage.State storage s, address user, uint256 orderId) internal {
        uint256 indexPlusOne = s.userOrderIndex[user][orderId];
        if (indexPlusOne == 0) {
            return;
        }
        
        uint256 index = indexPlusOne - 1;
        uint256[] storage lst = s.userOrders[user];
        uint256 lastIndex = lst.length - 1;
        
        if (index != lastIndex) {
            uint256 lastOrderId = lst[lastIndex];
            lst[index] = lastOrderId;
            s.userOrderIndex[user][lastOrderId] = indexPlusOne;
        }
        
        lst.pop();
        s.userOrderIndex[user][orderId] = 0;
    }
    
    /// @dev Add order to user's list with O(1) index tracking
    function addOrderToUserList(OrderBookStorage.State storage s, address user, uint256 orderId) internal {
        s.userOrders[user].push(orderId);
        s.userOrderIndex[user][orderId] = s.userOrders[user].length;
    }

    /// @dev O(1) order removal using doubly-linked list with prevOrderId
    /// @notice Falls back to O(n) traversal for legacy orders where prevOrderId was not set
    function removeOrderFromLevel(OrderBookStorage.State storage s, uint256 orderId, uint256 price, bool isBuy) internal {
        OrderBookStorage.PriceLevel storage level = isBuy ? s.buyLevels[price] : s.sellLevels[price];
        OrderBookStorage.Order storage order = s.orders[orderId];
        if (level.totalAmount > order.amount) { level.totalAmount -= order.amount; } else { level.totalAmount = 0; }
        
        uint256 prevId = order.prevOrderId;
        uint256 nextId = order.nextOrderId;
        
        // Handle legacy orders: prevOrderId=0 but order is not first in list
        // This happens for orders created before prevOrderId was added to the struct
        if (prevId == 0 && level.firstOrderId != orderId) {
            // O(n) fallback: traverse to find the previous order
            prevId = level.firstOrderId;
            while (prevId != 0 && s.orders[prevId].nextOrderId != orderId) {
                prevId = s.orders[prevId].nextOrderId;
            }
        }
        
        if (prevId != 0) {
            s.orders[prevId].nextOrderId = nextId;
        } else {
            level.firstOrderId = nextId;
        }
        
        if (nextId != 0) {
            s.orders[nextId].prevOrderId = prevId;
        } else {
            level.lastOrderId = prevId;
        }
        
        order.prevOrderId = 0;
        order.nextOrderId = 0;
        
        if (level.totalAmount == 0) {
            level.exists = false;
            level.firstOrderId = 0;
            level.lastOrderId = 0;
        }
    }
}
