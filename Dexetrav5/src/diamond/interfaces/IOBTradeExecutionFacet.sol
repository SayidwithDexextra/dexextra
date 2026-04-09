// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../libraries/OrderBookStorage.sol";

interface IOBTradeExecutionFacet {
    function obExecuteTrade(
        address buyer,
        address seller,
        uint256 price,
        uint256 amount,
        bool buyerMargin,
        bool sellerMargin,
        bool buyerIsTaker
    ) external;
    
    /// @notice Execute multiple trades in a single batch for gas efficiency
    /// @param taker The address of the taker (aggressor)
    /// @param takerIsBuy True if taker is buying, false if selling
    /// @param takerIsMargin True if taker order is a margin order
    /// @param matches Array of pending matches to execute
    function obExecuteTradeBatch(
        address taker,
        bool takerIsBuy,
        bool takerIsMargin,
        OrderBookStorage.PendingMatch[] calldata matches
    ) external;
}



