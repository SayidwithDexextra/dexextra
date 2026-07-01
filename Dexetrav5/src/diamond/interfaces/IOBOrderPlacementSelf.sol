// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Subset of OBOrderPlacementFacet's `onlySelf` entrypoints used by OBCrossHealFacet
///         to re-submit a crossing order through the audited placement/matching paths.
///         These are only callable from within the diamond (msg.sender == address(this)).
interface IOBOrderPlacementSelf {
    function cancelOrderBy(address trader, uint256 orderId) external;

    function placeMarginLimitOrderBy(address trader, uint256 price, uint256 amount, bool isBuy)
        external
        returns (uint256 orderId);
}
