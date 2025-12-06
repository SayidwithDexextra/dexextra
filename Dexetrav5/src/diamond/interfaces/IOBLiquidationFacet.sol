// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IOBLiquidationFacet {
    function pokeLiquidations() external;
    function onMarkPriceUpdate(uint256 newMarkPrice) external;
}


