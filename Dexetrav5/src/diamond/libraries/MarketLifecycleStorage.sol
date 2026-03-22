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

        // Lifecycle progression metadata (added in v2; append-only for diamond safety)
        uint256 lifecycleDurationSeconds;   // Derived at initialization: settlementTimestamp - init time
        uint256 challengeWindowDuration;    // Derived from lifecycle duration (or override in testing)
        bool lifecycleSettled;              // Final lifecycle stage reached (UI-guidance state)
        bool lifecycleDevMode;              // When true, permissionless sync can advance stages without time gates
        bool lifecycleLinking;              // Reentrancy guard for cross-market lineage linking

        // Evidence commitment (v3; append-only)
        bytes32 proposedEvidenceHash;       // keccak256 of the Wayback URL used as evidence for the proposed price
        string proposedEvidenceUrl;         // The full Wayback URL itself, stored for on-chain discoverability

        // Settlement challenge bond (v3; append-only)
        uint256 challengeBondAmount;        // Required bond to challenge (6 decimals, configurable by owner)
        address challenger;                 // Address that posted the bond
        uint256 challengedPrice;            // Alternative settlement price proposed by challenger
        uint256 challengeBondEscrowed;      // Actual amount escrowed from challenger
        bool challengeActive;               // True while a challenge is posted and unresolved
        bool challengeResolved;             // True after refund or slash
        bool challengerWon;                 // Outcome: true = refunded, false = slashed
        address challengeSlashRecipient;    // Treasury address that receives slashed bonds
    }

    function state() internal pure returns (State storage s) {
        bytes32 slot = STORAGE_SLOT;
        assembly {
            s.slot := slot
        }
    }
}


