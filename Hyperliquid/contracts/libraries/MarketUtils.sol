// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MarketUtils
 * @dev Library for market utility functions to reduce contract size
 */
library MarketUtils {
    
    struct MarketInfo {
        bytes32 marketId;
        address orderBookAddress;
        string symbol;
        string metricId;
        bool isCustomMetric;
        bool isActive;
        uint256 createdAt;
        address creator;
    }

    /**
     * @dev Calculate market ID for traditional markets
     */
    function calculateTraditionalMarketId(string memory symbol) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(symbol, "_MARKET"));
    }

    /**
     * @dev Calculate market ID for custom metric markets
     */
    function calculateCustomMarketId(string memory metricId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(metricId, "_CUSTOM_MARKET"));
    }

    /**
     * @dev Validate symbol for traditional markets
     */
    function validateSymbol(string memory symbol) internal pure {
        bytes memory symbolBytes = bytes(symbol);
        require(symbolBytes.length > 0 && symbolBytes.length <= 20, "MarketUtils: invalid symbol length");
        
        // Check for valid characters (alphanumeric and /)
        for (uint i = 0; i < symbolBytes.length; i++) {
            bytes1 char = symbolBytes[i];
            require(
                (char >= 0x30 && char <= 0x39) || // 0-9
                (char >= 0x41 && char <= 0x5A) || // A-Z
                (char >= 0x61 && char <= 0x7A) || // a-z
                char == 0x2F,                     // /
                "MarketUtils: invalid character in symbol"
            );
        }
    }

    /**
     * @dev Validate metric ID for custom markets
     */
    function validateMetricId(string memory metricId) internal pure {
        bytes memory metricBytes = bytes(metricId);
        require(metricBytes.length > 0 && metricBytes.length <= 50, "MarketUtils: invalid metric ID length");
        
        // Check for valid characters (alphanumeric, underscore, dash)
        for (uint i = 0; i < metricBytes.length; i++) {
            bytes1 char = metricBytes[i];
            require(
                (char >= 0x30 && char <= 0x39) || // 0-9
                (char >= 0x41 && char <= 0x5A) || // A-Z
                (char >= 0x61 && char <= 0x7A) || // a-z
                char == 0x5F ||                   // _
                char == 0x2D,                     // -
                "MarketUtils: invalid character in metric ID"
            );
        }
    }

    /**
     * @dev Filter active markets from a list
     */
    function filterActiveMarkets(
        bytes32[] memory marketIds,
        mapping(bytes32 => MarketInfo) storage markets
    ) internal view returns (bytes32[] memory) {
        uint256 activeCount = 0;
        
        // Count active markets
        for (uint256 i = 0; i < marketIds.length; i++) {
            if (markets[marketIds[i]].isActive) {
                activeCount++;
            }
        }
        
        // Build active markets array
        bytes32[] memory activeMarkets = new bytes32[](activeCount);
        uint256 index = 0;
        
        for (uint256 i = 0; i < marketIds.length; i++) {
            if (markets[marketIds[i]].isActive) {
                activeMarkets[index] = marketIds[i];
                index++;
            }
        }
        
        return activeMarkets;
    }

    /**
     * @dev Filter markets by creator
     */
    function filterMarketsByCreator(
        bytes32[] memory marketIds,
        mapping(bytes32 => MarketInfo) storage markets,
        address creator
    ) internal view returns (bytes32[] memory) {
        uint256 count = 0;
        
        // Count markets by creator
        for (uint256 i = 0; i < marketIds.length; i++) {
            if (markets[marketIds[i]].creator == creator) {
                count++;
            }
        }
        
        // Build creator markets array
        bytes32[] memory creatorMarkets = new bytes32[](count);
        uint256 index = 0;
        
        for (uint256 i = 0; i < marketIds.length; i++) {
            if (markets[marketIds[i]].creator == creator) {
                creatorMarkets[index] = marketIds[i];
                index++;
            }
        }
        
        return creatorMarkets;
    }

    /**
     * @dev Get paginated markets
     */
    function getPaginatedMarkets(
        bytes32[] memory marketIds,
        uint256 offset,
        uint256 limit
    ) internal pure returns (bytes32[] memory) {
        require(offset < marketIds.length, "MarketUtils: offset out of bounds");
        
        uint256 end = offset + limit;
        if (end > marketIds.length) {
            end = marketIds.length;
        }
        
        uint256 length = end - offset;
        bytes32[] memory paginatedMarkets = new bytes32[](length);
        
        for (uint256 i = 0; i < length; i++) {
            paginatedMarkets[i] = marketIds[offset + i];
        }
        
        return paginatedMarkets;
    }
}
