// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @notice Lightweight emitter that mirrors the event signatures used by the order book.
 * @dev Handy for wiring external pipelines (Alchemy webhook, Supabase ingest, etc).
 */
contract MockOrderBookEvents {
    event LiquidationCompleted(
        address indexed trader,
        uint256 liquidationsTriggered,
        string method,
        int256 startSize,
        int256 remainingSize
    );

    event TradeRecorded(
        bytes32 indexed marketId,
        address indexed buyer,
        address indexed seller,
        uint256 price,
        uint256 amount,
        uint256 buyerFee,
        uint256 sellerFee,
        uint256 timestamp,
        uint256 liquidationPrice
    );

    event PriceUpdated(uint256 lastTradePrice, uint256 currentMarkPrice);

    function emitLiquidationCompleted(
        address trader,
        uint256 liquidationsTriggered,
        string calldata method,
        int256 startSize,
        int256 remainingSize
    ) external {
        emit LiquidationCompleted(trader, liquidationsTriggered, method, startSize, remainingSize);
    }

    function emitTradeRecorded(
        bytes32 marketId,
        address buyer,
        address seller,
        uint256 price,
        uint256 amount,
        uint256 buyerFee,
        uint256 sellerFee,
        uint256 liquidationPrice
    ) external {
        emit TradeRecorded(
            marketId,
            buyer,
            seller,
            price,
            amount,
            buyerFee,
            sellerFee,
            block.timestamp,
            liquidationPrice
        );
    }

    function emitPriceUpdated(uint256 lastTradePrice, uint256 currentMarkPrice) external {
        emit PriceUpdated(lastTradePrice, currentMarkPrice);
    }
}






