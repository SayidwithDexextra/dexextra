// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../libraries/OrderBookStorage.sol";
import "../libraries/LibDiamond.sol";

/// @title OBAdminViewFacet
/// @notice Admin and view functions for order book state management
/// @dev Extracted from OBOrderPlacementFacet to reduce contract size
contract OBAdminViewFacet {
    modifier onlyOwner() {
        LibDiamond.enforceIsContractOwner();
        _;
    }

    /// @notice Admin-only: Initialize the sorted price linked lists from existing price arrays
    /// @dev Call this once after upgrading to populate buyPriceHead/sellPriceHead and linked list pointers
    /// @param sortedBuyPrices Buy prices sorted in descending order (highest first)
    /// @param sortedSellPrices Sell prices sorted in ascending order (lowest first)
    function initializePriceLinkedLists(uint256[] calldata sortedBuyPrices, uint256[] calldata sortedSellPrices) external onlyOwner {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        
        if (sortedBuyPrices.length > 0) {
            s.buyPriceHead = sortedBuyPrices[0];
            for (uint256 i = 0; i < sortedBuyPrices.length; i++) {
                uint256 price = sortedBuyPrices[i];
                if (i > 0) {
                    s.buyPricePrev[price] = sortedBuyPrices[i - 1];
                }
                if (i < sortedBuyPrices.length - 1) {
                    s.buyPriceNext[price] = sortedBuyPrices[i + 1];
                }
            }
        }
        
        if (sortedSellPrices.length > 0) {
            s.sellPriceHead = sortedSellPrices[0];
            for (uint256 i = 0; i < sortedSellPrices.length; i++) {
                uint256 price = sortedSellPrices[i];
                if (i > 0) {
                    s.sellPricePrev[price] = sortedSellPrices[i - 1];
                }
                if (i < sortedSellPrices.length - 1) {
                    s.sellPriceNext[price] = sortedSellPrices[i + 1];
                }
            }
        }
    }
    
    /// @notice View function to get buy prices array for migration scripts
    function getBuyPrices() external view returns (uint256[] memory) {
        return OrderBookStorage.state().buyPrices;
    }
    
    /// @notice View function to get sell prices array for migration scripts
    function getSellPrices() external view returns (uint256[] memory) {
        return OrderBookStorage.state().sellPrices;
    }
    
    /// @notice View function to check if a buy level exists
    function getBuyLevelExists(uint256 price) external view returns (bool) {
        return OrderBookStorage.state().buyLevels[price].exists;
    }
    
    /// @notice View function to check if a sell level exists
    function getSellLevelExists(uint256 price) external view returns (bool) {
        return OrderBookStorage.state().sellLevels[price].exists;
    }

    /// @notice Get the current buy price linked list head
    function getBuyPriceHead() external view returns (uint256) {
        return OrderBookStorage.state().buyPriceHead;
    }

    /// @notice Get the current sell price linked list head
    function getSellPriceHead() external view returns (uint256) {
        return OrderBookStorage.state().sellPriceHead;
    }

    /// @notice Get the next buy price in the linked list
    function getBuyPriceNext(uint256 price) external view returns (uint256) {
        return OrderBookStorage.state().buyPriceNext[price];
    }

    /// @notice Get the previous buy price in the linked list
    function getBuyPricePrev(uint256 price) external view returns (uint256) {
        return OrderBookStorage.state().buyPricePrev[price];
    }

    /// @notice Get the next sell price in the linked list
    function getSellPriceNext(uint256 price) external view returns (uint256) {
        return OrderBookStorage.state().sellPriceNext[price];
    }

    /// @notice Get the previous sell price in the linked list
    function getSellPricePrev(uint256 price) external view returns (uint256) {
        return OrderBookStorage.state().sellPricePrev[price];
    }
}
