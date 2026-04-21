// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title BatchSettlementStorage
 * @notice ERC-7201 namespaced storage for batch settlement state.
 *         Uses a separate storage namespace to avoid consuming slots in CoreVaultStorage.
 *         This allows batch settlement to be added without impacting the tight bytecode limit.
 *
 * @dev Storage slot computed as:
 *      keccak256(abi.encode(uint256(keccak256("corevault.batchsettlement")) - 1)) & ~bytes32(uint256(0xff))
 */
library BatchSettlementStorage {
    /// @custom:storage-location erc7201:corevault.batchsettlement
    bytes32 internal constant STORAGE_SLOT = 
        0x8a35acfbc15ff81a39ae7d344fd709f28e8600b4aa8c65c6b64bfe7fe36bd100;

    /// @notice Settlement phases
    uint8 internal constant PHASE_NONE = 0;
    uint8 internal constant PHASE_CALCULATING = 1;
    uint8 internal constant PHASE_HAIRCUT_DONE = 2;
    uint8 internal constant PHASE_APPLYING = 3;
    uint8 internal constant PHASE_COMPLETE = 4;

    /// @notice Batch settlement state for a single market
    struct BatchState {
        uint8 phase;                    // Current settlement phase (0-4)
        uint256 finalPrice;             // Settlement price (6 decimals)
        uint256 cursor;                 // Current index in marketPositionUsers array
        uint256 totalLiabilities6;      // Sum of profitable position payouts (USDC 6 decimals)
        uint256 losersCapacity6;        // Sum of what losing positions can pay (USDC 6 decimals)
        uint256 marketTotalMarginLocked6; // Total margin locked in this market
        uint256 scaleRay;               // Haircut scale factor (1e18 = no haircut)
        uint256 totalProfit6;           // Running total of profits paid out
        uint256 totalLoss6;             // Running total of losses collected
        uint256 badDebt6;               // Running total of bad debt (losses exceeding collateral)
    }

    /// @notice Main storage layout
    struct Layout {
        // Batch state per market
        mapping(bytes32 => BatchState) settlements;
        
        // Lock to prevent trading during settlement
        mapping(bytes32 => bool) marketSettling;
    }

    /// @notice Get the storage layout at the namespaced slot
    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = STORAGE_SLOT;
        assembly {
            l.slot := slot
        }
    }

    /// @notice Get batch state for a specific market
    function getState(bytes32 marketId) internal view returns (BatchState storage) {
        return layout().settlements[marketId];
    }

    /// @notice Check if a market is currently being settled
    function isSettling(bytes32 marketId) internal view returns (bool) {
        return layout().marketSettling[marketId];
    }

    /// @notice Set the settling flag for a market
    function setSettling(bytes32 marketId, bool settling) internal {
        layout().marketSettling[marketId] = settling;
    }

    /// @notice Reset batch state for a market
    function resetState(bytes32 marketId) internal {
        BatchState storage state = layout().settlements[marketId];
        state.phase = PHASE_NONE;
        state.finalPrice = 0;
        state.cursor = 0;
        state.totalLiabilities6 = 0;
        state.losersCapacity6 = 0;
        state.marketTotalMarginLocked6 = 0;
        state.scaleRay = 0;
        state.totalProfit6 = 0;
        state.totalLoss6 = 0;
        state.badDebt6 = 0;
    }
}
