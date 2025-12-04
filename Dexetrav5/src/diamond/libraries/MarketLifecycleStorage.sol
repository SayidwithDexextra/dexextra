// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library MarketLifecycleStorage {
    // Dedicated diamond storage slot to avoid collisions with other facets
    bytes32 internal constant STORAGE_SLOT = keccak256("dexextra.market.lifecycle.storage.v1");

    struct State {
        // One-time initialization at market creation (T0 + 365 days)
        uint256 settlementTimestamp;

        // Cached when signaled; derived as settlementTimestamp - 30 days
        uint256 rolloverWindowStart;
        bool rolloverWindowStarted;

        // Cached when signaled; derived as settlementTimestamp - 24 hours
        uint256 challengeWindowStart;
        bool challengeWindowStarted;

        // Lineage pointers
        address parentMarket; // zero for genesis
        address childMarket;  // zero until set

        // Testing controls (owner-only)
        bool testingMode;                  // when true, allow overrides/force operations
        uint256 rolloverLeadTimeOverride;  // seconds; 0 means use default 30d
        uint256 challengeLeadTimeOverride; // seconds; 0 means use default 24h
    }

    function state() internal pure returns (State storage s) {
        bytes32 slot = STORAGE_SLOT;
        assembly {
            s.slot := slot
        }
    }
}


