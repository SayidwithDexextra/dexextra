// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IOBCrossHealFacet {
    /// @notice Clear up to `maxIterations` crossing orders from a crossed book.
    /// @dev No-op (cheap) when the book is healthy. Permissionless.
    /// @return stillCrossed True if the book remains crossed after this call.
    function sweepCrossedBook(uint256 maxIterations) external returns (bool stillCrossed);
}
