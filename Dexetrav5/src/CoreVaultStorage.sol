// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "./VaultAnalytics.sol";
import "./PositionManager.sol";

/**
 * @title CoreVaultStorage
 * @notice Shared storage layout for CoreVault and all its delegatecall targets
 *         (LiquidationManager, VaultViewsManager, SettlementManager).
 *
 *         CRITICAL: Variable declaration order determines slot assignment.
 *         Any change here MUST be mirrored across ALL inheriting contracts.
 *         Append-only after deployment; never reorder or remove variables.
 *
 *         `collateralToken` is intentionally excluded — it is `immutable` (bytecode-only)
 *         and declared independently in each contract that needs it.
 *
 *         OpenZeppelin v5 base contracts (AccessControl, ReentrancyGuard, Pausable,
 *         UUPSUpgradeable) use ERC-7201 namespaced storage and do NOT consume
 *         regular slots, so inheriting them in CoreVault does not shift this layout.
 */
abstract contract CoreVaultStorage {
    // ============ Delegatecall Target Addresses ============
    address internal liquidationManager;    // slot 0
    address internal viewsManager;          // slot 1
    address internal settlementManager;     // slot 2
    address public sessionRegistry;         // slot 3

    // ============ Core User Data ============
    mapping(address => uint256) public userCollateral;                                  // slot 4
    mapping(address => uint256) public userCrossChainCredit;                            // slot 5
    mapping(address => int256) public userRealizedPnL;                                  // slot 6
    mapping(address => PositionManager.Position[]) public userPositions;                // slot 7
    mapping(address => VaultAnalytics.PendingOrder[]) public userPendingOrders;         // slot 8
    mapping(address => bytes32[]) public userMarketIds;                                 // slot 9
    mapping(address => uint256) public userSocializedLoss;                              // slot 10

    // ============ User Tracking ============
    address[] public allKnownUsers;                                                     // slot 11
    mapping(address => bool) internal isKnownUser;                                      // slot 12

    // ============ Market Management ============
    mapping(bytes32 => address) public marketToOrderBook;                               // slot 13
    mapping(address => mapping(bytes32 => bool)) public isUnderLiquidationPosition;     // slot 14

    // ============ Gasless Top-Up ============
    mapping(address => uint256) public topUpNonces;                                     // slot 15

    // ============ Liquidation Anchors ============
    mapping(address => mapping(bytes32 => uint256)) internal liquidationAnchorPrice;    // slot 16
    mapping(address => mapping(bytes32 => uint256)) internal liquidationAnchorTimestamp; // slot 17

    // ============ OrderBook Registry ============
    mapping(address => bool) public registeredOrderBooks;                               // slot 18
    mapping(address => bytes32[]) internal orderBookToMarkets;                          // slot 19
    address[] internal allOrderBooks;                                                    // slot 20

    // ============ Market State ============
    mapping(bytes32 => uint256) public marketMarkPrices;                                // slot 21
    mapping(bytes32 => uint256) public marketBadDebt;                                   // slot 22
    mapping(bytes32 => bool) public marketSettled;                                      // slot 23
    mapping(bytes32 => bool) public marketDisputed;                                     // slot 24

    // ============ Dynamic Maintenance Margin (MMR) Parameters ============
    uint256 public baseMmrBps;                                                          // slot 25
    uint256 public penaltyMmrBps;                                                       // slot 26
    uint256 public maxMmrBps;                                                           // slot 27
    uint256 public scalingSlopeBps;                                                     // slot 28
    uint256 public priceGapSlopeBps;                                                    // slot 29
    uint256 public mmrLiquidityDepthLevels;                                             // slot 30

    // ============ ADL Gas & Debug Controls ============
    uint256 internal adlMaxCandidates;                                                  // slot 31
    uint256 internal adlMaxPositionsPerTx;                                              // slot 32
    bool internal adlDebug;                                                             // slot 33
    uint256 internal minSettlementScaleRay;                                             // slot 34

    // ============ Global Stats ============
    uint256 public totalCollateralDeposited;                                            // slot 35
    uint256 public totalMarginLocked;                                                   // slot 36
}
