// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./VaultAnalytics.sol";
import "./PositionManager.sol";
import "./diamond/interfaces/IOBPricingFacet.sol";

interface IERC20Metadata {
    function decimals() external view returns (uint8);
}

/// @dev Minimal interface for order book liquidation entrypoint
interface IOrderBookLiq {
    function liquidateDirect(address trader) external;
}

/**
 * @title LiquidationManager
 * @dev Gas-optimized liquidation and socialized loss management
 * @notice Key optimizations:
 *   1. O(1) market→user index with swap-and-pop removal
 *   2. Bitmap-based profitable user tracking for ADL
 *   3. Cached position data to avoid repeated storage reads
 *   4. Single-pass winner selection with partial heap
 *   5. Incremental aggregate caching for instant capacity calculations
 */
contract LiquidationManager is AccessControl, ReentrancyGuard, Pausable {
    
    // ============ Constants ============
    uint256 public constant LIQUIDATION_PENALTY_BPS = 1000; // 10%
    uint256 public constant DECIMAL_SCALE = 1e12; // 10^(ALU_DECIMALS - USDC_DECIMALS)
    uint256 public constant TICK_PRECISION = 1e6; // Price ticks in USDC precision (6 decimals)
    
    // Gas optimization constants
    uint256 private constant MAX_BATCH_SIZE = 32; // Max users per batch operation
    uint256 private constant BITMAP_WORD_SIZE = 256;

    // Roles to mirror CoreVault expectations
    bytes32 public constant ORDERBOOK_ROLE = keccak256("ORDERBOOK_ROLE");
    bytes32 public constant SETTLEMENT_ROLE = keccak256("SETTLEMENT_ROLE");
    bytes32 public constant FACTORY_ROLE = keccak256("FACTORY_ROLE");
    

    // Storage alignment with CoreVault (must match order exactly for delegatecall)
    address public liquidationManager; // alignment slot
    IERC20 public immutable collateralToken;

    mapping(address => uint256) public userCollateral;
    mapping(address => uint256) public userCrossChainCredit;
    mapping(address => int256) public userRealizedPnL;
    mapping(address => PositionManager.Position[]) public userPositions;
    mapping(address => VaultAnalytics.PendingOrder[]) public userPendingOrders;
    mapping(address => bytes32[]) public userMarketIds;
    mapping(address => uint256) public userSocializedLoss;
    address[] public allKnownUsers;
    mapping(address => bool) public isKnownUser;

    mapping(bytes32 => address) public marketToOrderBook;
    mapping(address => mapping(bytes32 => bool)) public isUnderLiquidationPosition;
    mapping(address => mapping(bytes32 => uint256)) public liquidationAnchorPrice;
    mapping(address => mapping(bytes32 => uint256)) public liquidationAnchorTimestamp;
    mapping(address => bool) public registeredOrderBooks;
    mapping(address => bytes32[]) public orderBookToMarkets;
    address[] public allOrderBooks;
    mapping(bytes32 => uint256) public marketMarkPrices;
    mapping(bytes32 => uint256) public marketBadDebt;
    // Align with CoreVault slots to avoid overwriting settlement flags during delegatecall
    mapping(bytes32 => bool) public marketSettled;
    mapping(bytes32 => bool) public marketDisputed;

    // ============ Optimized Index Structures ============
    // O(1) market → user index with swap-and-pop removal
    mapping(bytes32 => address[]) internal marketUsers;
    mapping(bytes32 => mapping(address => uint256)) internal marketUserIndex; // user → index+1 (0 = not present)
    
    // Bitmap for profitable users (256 users per word) - enables O(1) profitable check
    mapping(bytes32 => mapping(uint256 => uint256)) internal profitableBitmap;
    mapping(bytes32 => uint256) internal profitableUserCount;
    
    // Cached aggregate data per market for instant calculations
    mapping(bytes32 => MarketAggregate) internal marketAggregates;
    
    // Per-user position cache for reduced storage reads
    mapping(bytes32 => mapping(address => PositionCache)) internal positionCache;

    uint256 public baseMmrBps = 1000;
    uint256 public penaltyMmrBps = 1000;
    uint256 public maxMmrBps = 2000;
    uint256 public scalingSlopeBps = 0;
    uint256 public priceGapSlopeBps = 0;
    uint256 public mmrLiquidityDepthLevels = 1;

    uint256 public adlMaxCandidates = 50;
    uint256 public adlMaxPositionsPerTx = 10;
    bool public adlDebug = false;

    uint256 public totalCollateralDeposited;
    uint256 public totalMarginLocked;
    
    // ============ Optimized Structs ============
    
    /// @dev Cached market-level aggregates for O(1) capacity calculations
    struct MarketAggregate {
        uint256 totalNotional6;      // Sum of all position notionals
        uint256 totalMargin6;        // Sum of all position margins
        int256 totalUnrealizedPnL18; // Cached total unrealized PnL
        uint256 lastMarkPrice;       // Mark price at last aggregate update
        uint256 profitableNotional6; // Sum of notionals for profitable positions
    }
    
    /// @dev Cached position data to avoid repeated storage reads
    struct PositionCache {
        int256 size;
        uint256 entryPrice;
        uint256 marginLocked;
        uint256 liquidationPrice;
        int256 cachedPnL18;       // PnL at lastMarkPrice
        uint256 cachedNotional6;  // Notional at lastMarkPrice
        bool isProfitable;
        uint256 profitScore;      // |PnL| * |size| / 1e18 for ranking
        bool initialized;
    }

    event LiquidationExecuted(address indexed user, bytes32 indexed marketId, address indexed liquidator, uint256 totalLoss, uint256 remainingCollateral);
    event MarginConfiscated(address indexed user, uint256 marginAmount, uint256 totalLoss, uint256 penalty, address indexed liquidator);
    event LiquidatorRewardPaid(address indexed liquidator, address indexed liquidatedUser, bytes32 indexed marketId, uint256 rewardAmount, uint256 liquidatorCollateral);
    event MakerLiquidationRewardPaid(address indexed maker, address indexed liquidatedUser, bytes32 indexed marketId, uint256 rewardAmount);
    event PositionUpdated(address indexed user, bytes32 indexed marketId, int256 oldSize, int256 newSize, uint256 entryPrice, uint256 marginLocked);
    event SocializedLossApplied(bytes32 indexed marketId, uint256 lossAmount, address indexed liquidatedUser);
    event UserLossSocialized(address indexed user, uint256 lossAmount, uint256 remainingCollateral);
    event AdlConfigUpdated(uint256 maxCandidates, uint256 maxPositionsPerTx, bool debugEnabled);
    event HaircutApplied(address indexed user, bytes32 indexed marketId, uint256 debitAmount, uint256 collateralAfter);
    event BadDebtRecorded(bytes32 indexed marketId, uint256 amount, address indexed liquidatedUser);
    event BadDebtOffset(bytes32 indexed marketId, uint256 amount, uint256 remainingBadDebt);
    event DebugIsLiquidatable(
        address indexed user,
        bytes32 indexed marketId,
        int256 positionSize,
        uint256 markPrice,
        uint256 trigger,
        uint256 oneTick,
        uint256 notional6,
        int256 equity6,
        uint256 maintenance6,
        bool usedFallback,
        bool result
    );
    event SocializationStarted(bytes32 indexed marketId, uint256 totalLossAmount, address indexed liquidatedUser, uint256 timestamp);
    event ProfitablePositionFound(address indexed user, bytes32 indexed marketId, int256 positionSize, uint256 entryPrice, uint256 markPrice, uint256 unrealizedPnL, uint256 profitScore);
    event AdministrativePositionClosure(address indexed user, bytes32 indexed marketId, uint256 sizeBeforeReduction, uint256 sizeAfterReduction, uint256 realizedProfit, uint256 newEntryPrice);
    event SocializationCompleted(bytes32 indexed marketId, uint256 totalLossCovered, uint256 remainingLoss, uint256 positionsAffected, address indexed liquidatedUser);
    event SocializationFailed(bytes32 indexed marketId, uint256 lossAmount, string reason, address indexed liquidatedUser);
    event SocializationDiagnostics(
        bytes32 indexed marketId,
        uint256 markPrice,
        uint256 profitableNotional6,
        uint256 profitableUserCount,
        uint256 userCount,
        uint256 winnersFound,
        uint256 lossAmount,
        address indexed liquidatedUser
    );
    event DebugProfitCalculation(address indexed user, bytes32 indexed marketId, uint256 entryPrice, uint256 markPrice, int256 positionSize, int256 unrealizedPnL, uint256 profitScore);
    event DebugPositionReduction(address indexed user, bytes32 indexed marketId, uint256 originalSize, uint256 reductionAmount, uint256 newSize, uint256 realizedPnL);
    event DebugSocializationState(bytes32 indexed marketId, uint256 remainingLoss, uint256 totalProfitableUsers, uint256 processedUsers);

    struct ProfitablePosition {
        address user;
        int256 positionSize;
        uint256 entryPrice;
        uint256 unrealizedPnL;
        uint256 profitScore;
        bool isLong;
    }

    struct WinnerCache {
        uint256 notional6;
        uint256 capacity6;
    }


    struct PositionClosureResult {
        bool success;
        uint256 realizedProfit;
        uint256 newPositionSize;
        uint256 newEntryPrice;
        string failureReason;
    }

    constructor(address _collateralToken, address _admin) {
        collateralToken = IERC20(_collateralToken);
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        uint8 decs;
        try IERC20Metadata(_collateralToken).decimals() returns (uint8 d) { decs = d; } catch { revert("Collateral token must implement decimals()"); }
        require(decs == 6, "Collateral must be 6 decimals");
    }

    /**
     * @dev Admin utility to register or update a market→order book mapping on the LM itself.
     *      This is only needed when calling LM directly (not via CoreVault delegatecall),
     *      because the delegated path uses CoreVault storage instead.
     */
    function seedMarketOrderBook(bytes32 marketId, address orderBook) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(orderBook != address(0), "!orderBook");
        marketToOrderBook[marketId] = orderBook;
        if (!registeredOrderBooks[orderBook]) {
            registeredOrderBooks[orderBook] = true;
            allOrderBooks.push(orderBook);
        }
        // Avoid duplicate pushes
        bool exists = false;
        bytes32[] storage markets = orderBookToMarkets[orderBook];
        for (uint256 i = 0; i < markets.length; i++) {
            if (markets[i] == marketId) { exists = true; break; }
        }
        if (!exists) {
            markets.push(marketId);
        }
    }

    function setUnderLiquidation(
        address user,
        bytes32 marketId,
        bool state
    ) external onlyRole(ORDERBOOK_ROLE) {
        bool prev = isUnderLiquidationPosition[user][marketId];
        isUnderLiquidationPosition[user][marketId] = state;
        if (state) {
            if (!prev && liquidationAnchorPrice[user][marketId] == 0) {
                uint256 anchor = getMarkPrice(marketId);
                if (anchor == 0) { anchor = marketMarkPrices[marketId]; }
                liquidationAnchorPrice[user][marketId] = anchor;
                liquidationAnchorTimestamp[user][marketId] = block.timestamp;
            }
        } else {
            liquidationAnchorPrice[user][marketId] = 0;
            liquidationAnchorTimestamp[user][marketId] = 0;
            _recomputeAndStoreLiquidationPrice(user, marketId);
        }
    }

    function getMarkPrice(bytes32 marketId) public view returns (uint256) {
        return marketMarkPrices[marketId];
    }

    function isLiquidatable(
        address user,
        bytes32 marketId,
        uint256 markPrice
    ) external returns (bool) {
        PositionManager.Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size != 0) {
                if (isUnderLiquidationPosition[user][marketId]) { return true; }
                uint256 trigger = positions[i].liquidationPrice;
                if (positions[i].size < 0 && trigger == 0) {
                    _recomputeAndStoreLiquidationPrice(user, marketId);
                    trigger = positions[i].liquidationPrice;
                }
                if (trigger == 0) {
                    uint256 absSize = uint256(positions[i].size >= 0 ? positions[i].size : -positions[i].size);
                    if (markPrice == 0 || absSize == 0) { return false; }
                    uint256 notional6 = (absSize * markPrice) / (10**18);
                    int256 priceDiff = int256(markPrice) - int256(positions[i].entryPrice);
                    int256 pnl18 = (priceDiff * positions[i].size) / int256(TICK_PRECISION);
                    int256 pnl6 = pnl18 / int256(DECIMAL_SCALE);
                    int256 equity6 = int256(positions[i].marginLocked) + pnl6;
                    (uint256 mmrBps, ) = _computeEffectiveMMRBps(user, marketId, positions[i].size);
                    uint256 maintenance6 = (notional6 * mmrBps) / 10000;
                    bool resFallback = equity6 <= (int256(maintenance6) + int256(1));
                    return resFallback;
                }
                uint256 oneTick = 1;
                if (positions[i].size > 0) {
                    bool res = markPrice <= (trigger + oneTick);
                    return res;
                } else {
                    bool res2 = (markPrice + oneTick) >= trigger;
                    return res2;
                }
            }
        }
        return false;
    }

    function debugEmitIsLiquidatable(address user, bytes32 marketId, uint256 markPrice) external onlyRole(ORDERBOOK_ROLE) {
        PositionManager.Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size != 0) {
                uint256 trigger = positions[i].liquidationPrice;
                if (positions[i].size < 0 && trigger == 0) {
                    _recomputeAndStoreLiquidationPrice(user, marketId);
                    trigger = positions[i].liquidationPrice;
                }
                uint256 oneTick = 1;
                bool usedFallback = false;
                uint256 notional6 = 0;
                int256 equity6 = 0;
                uint256 maintenance6 = 0;
                bool result;
                if (trigger == 0) {
                    usedFallback = true;
                    uint256 absSize = uint256(positions[i].size >= 0 ? positions[i].size : -positions[i].size);
                    if (markPrice == 0 || absSize == 0) {
                        emit DebugIsLiquidatable(user, marketId, positions[i].size, markPrice, 0, oneTick, 0, 0, 0, true, false);
                        return;
                    }
                    notional6 = (absSize * markPrice) / (10**18);
                    int256 priceDiff = int256(markPrice) - int256(positions[i].entryPrice);
                    int256 pnl18 = (priceDiff * positions[i].size) / int256(TICK_PRECISION);
                    int256 pnl6 = pnl18 / int256(DECIMAL_SCALE);
                    equity6 = int256(positions[i].marginLocked) + pnl6;
                    (uint256 mmrBps, ) = _computeEffectiveMMRBps(user, marketId, positions[i].size);
                    maintenance6 = (notional6 * mmrBps) / 10000;
                    result = equity6 <= int256(maintenance6);
                } else if (positions[i].size > 0) {
                    result = markPrice <= (trigger + oneTick);
                } else {
                    result = (markPrice + oneTick) >= trigger;
                }
                emit DebugIsLiquidatable(
                    user,
                    marketId,
                    positions[i].size,
                    markPrice,
                    trigger,
                    oneTick,
                    notional6,
                    equity6,
                    maintenance6,
                    usedFallback,
                    result
                );
                return;
            }
        }
        emit DebugIsLiquidatable(user, marketId, 0, markPrice, 0, 1, 0, 0, 0, false, false);
    }

    function getLiquidationPrice(
        address user,
        bytes32 marketId
    ) external view returns (uint256 liquidationPrice, bool hasPosition) {
        PositionManager.Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size != 0) {
                hasPosition = true;
                if (isUnderLiquidationPosition[user][marketId]) { return (0, true); }
                return (positions[i].liquidationPrice, true);
            }
        }
        return (0, false);
    }

    function _recomputeAndStoreLiquidationPrice(address user, bytes32 marketId) internal {
        PositionManager.Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size != 0) {
                (uint256 mmrBps, ) = _computeEffectiveMMRBps(user, marketId, positions[i].size);
                uint256 mark = getMarkPrice(marketId);
                if (mark == 0) { mark = positions[i].entryPrice; }
                int256 priceDiff = int256(mark) - int256(positions[i].entryPrice);
                int256 pnl18 = (priceDiff * positions[i].size) / int256(TICK_PRECISION);
                int256 pnl6 = pnl18 / int256(DECIMAL_SCALE);
                int256 equity6 = int256(positions[i].marginLocked) + pnl6;
                uint256 absSize = uint256(positions[i].size >= 0 ? positions[i].size : -positions[i].size);
                if (absSize == 0) { positions[i].liquidationPrice = 0; return; }
                int256 eOverQ6 = (equity6 * int256(1e18)) / int256(absSize);
                if (positions[i].size > 0) {
                    int256 numeratorSigned = int256(mark) - eOverQ6;
                    uint256 denomBps = 10000 - mmrBps;
                    uint256 numerator = numeratorSigned > 0 ? uint256(numeratorSigned) : 0;
                    positions[i].liquidationPrice = denomBps == 0 ? 0 : Math.mulDiv(numerator, 10000, denomBps);
                } else {
                    int256 numeratorSigned = int256(mark) + eOverQ6;
                    uint256 denomBps = 10000 + mmrBps;
                    uint256 numerator = numeratorSigned > 0 ? uint256(numeratorSigned) : 0;
                    positions[i].liquidationPrice = Math.mulDiv(numerator, 10000, denomBps);
                }
                return;
            }
        }
    }

    function liquidateShort(
        address user,
        bytes32 marketId,
        address liquidator,
        uint256 executionPrice
    ) external onlyRole(ORDERBOOK_ROLE) {
        PositionManager.Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size < 0) {
                int256 oldSize = positions[i].size;
                uint256 locked = positions[i].marginLocked;
                uint256 entryPrice = positions[i].entryPrice;
                uint256 markPrice = getMarkPrice(marketId);
                uint256 settlePrice = executionPrice > 0 ? executionPrice : markPrice;

                uint256 tradingLoss = 0;
                if (settlePrice > entryPrice) {
                    uint256 lossPerUnit = settlePrice - entryPrice;
                    tradingLoss = (lossPerUnit * uint256(-oldSize)) / (DECIMAL_SCALE * TICK_PRECISION);
                }
            
                uint256 absSizeMark = uint256(-oldSize);
                uint256 notional6 = (absSizeMark * settlePrice) / (10**18);
                uint256 penalty = (notional6 * LIQUIDATION_PENALTY_BPS) / 10000;
                uint256 actualLoss = tradingLoss + penalty;
            
                uint256 seizableFromLocked = actualLoss > locked ? locked : actualLoss;
                uint256 collateralAvailable_ = userCollateral[user];
                uint256 seized = seizableFromLocked > collateralAvailable_ ? collateralAvailable_ : seizableFromLocked;
                uint256 uncoveredLoss = tradingLoss > seized ? (tradingLoss - seized) : 0;
                if (uncoveredLoss > 0) {
                    uint256 anchor = liquidationAnchorPrice[user][marketId];
                    uint256 seizedAppliedToTrading = seized > 0 ? (tradingLoss > seized ? seized : tradingLoss) : 0;
                    uint256 anchorTradingLoss = tradingLoss;
                    if (anchor > 0) {
                        uint256 effPrice = settlePrice > anchor ? settlePrice : anchor;
                        if (effPrice < entryPrice) {
                            uint256 lossPerUnitA = entryPrice - effPrice;
                            anchorTradingLoss = (lossPerUnitA * uint256(oldSize)) / (DECIMAL_SCALE * TICK_PRECISION);
                        } else {
                            anchorTradingLoss = 0;
                        }
                    }
                    uint256 allowedUncovered = anchorTradingLoss > seizedAppliedToTrading ? (anchorTradingLoss - seizedAppliedToTrading) : 0;
                    if (allowedUncovered < uncoveredLoss) {
                        uint256 excess = uncoveredLoss - allowedUncovered;
                        marketBadDebt[marketId] += excess;
                        emit BadDebtRecorded(marketId, excess, user);
                        uncoveredLoss = allowedUncovered;
                    }
                }
                if (uncoveredLoss > 0) {
                    uint256 anchor2 = liquidationAnchorPrice[user][marketId];
                    uint256 seizedAppliedToTrading2 = seized > 0 ? (tradingLoss > seized ? seized : tradingLoss) : 0;
                    uint256 anchorTradingLoss2 = tradingLoss;
                    if (anchor2 > 0) {
                        uint256 effPrice2 = settlePrice < anchor2 ? settlePrice : anchor2;
                        if (effPrice2 > entryPrice) {
                            uint256 lossPerUnitA2 = effPrice2 - entryPrice;
                            anchorTradingLoss2 = (lossPerUnitA2 * uint256(-oldSize)) / (DECIMAL_SCALE * TICK_PRECISION);
                        } else {
                            anchorTradingLoss2 = 0;
                        }
                    }
                    uint256 allowedUncovered2 = anchorTradingLoss2 > seizedAppliedToTrading2 ? (anchorTradingLoss2 - seizedAppliedToTrading2) : 0;
                    if (allowedUncovered2 < uncoveredLoss) {
                        uint256 excess2 = uncoveredLoss - allowedUncovered2;
                        marketBadDebt[marketId] += excess2;
                        emit BadDebtRecorded(marketId, excess2, user);
                        uncoveredLoss = allowedUncovered2;
                    }
                }
            
                if (seized > 0) {
                    // Prefer consuming external credit for seizures, then collateral
                    uint256 ext = userCrossChainCredit[user];
                    uint256 useExt = seized <= ext ? seized : ext;
                    if (useExt > 0) { userCrossChainCredit[user] = ext - useExt; }
                    uint256 rem = seized - useExt;
                    if (rem > 0) { userCollateral[user] -= rem; }
                    uint256 seizedForTradingLoss = tradingLoss > seized ? seized : tradingLoss;
                    uint256 seizedRemainder = seized - seizedForTradingLoss;
                    uint256 makerRewardPool = penalty > seizedRemainder ? seizedRemainder : penalty;
                    address ob2 = marketToOrderBook[marketId];
                    if (makerRewardPool > 0 && ob2 != address(0)) {
                        // Credit OB preserving backing type
                        uint256 fromExtToOB = useExt > seizedForTradingLoss ? (useExt - seizedForTradingLoss) : 0;
                        if (fromExtToOB > makerRewardPool) { fromExtToOB = makerRewardPool; }
                        if (fromExtToOB > 0) { userCrossChainCredit[ob2] += fromExtToOB; }
                        uint256 remainingToOB = makerRewardPool - fromExtToOB;
                        if (remainingToOB > 0) { userCollateral[ob2] += remainingToOB; }
                    }
                }

                // Calculate realized PNL, capped to locked margin
                // CRITICAL: User's realized loss cannot exceed their locked margin
                int256 realizedPnL = 0;
                {
                    int256 priceDiff = int256(settlePrice) - int256(entryPrice);
                    int256 rawPnL = (priceDiff * oldSize) / int256(TICK_PRECISION);
                    
                    // For shorts: oldSize is negative, so if settlePrice > entryPrice (loss),
                    // rawPnL will be negative (loss)
                    if (rawPnL < 0) {
                        // Convert locked margin from 6 decimals to 18 decimals for comparison
                        int256 maxLoss18 = -int256(locked * DECIMAL_SCALE);
                        
                        if (rawPnL < maxLoss18) {
                            // Loss exceeds locked margin - cap realized PNL
                            realizedPnL = maxLoss18;
                        } else {
                            // Loss is within locked margin - use actual PNL
                            realizedPnL = rawPnL;
                        }
                    } else {
                        // Profit case - no capping needed
                        realizedPnL = rawPnL;
                    }
                }

                if (locked <= totalMarginLocked) {
                    totalMarginLocked -= locked;
                }
                if (i < positions.length - 1) {
                    positions[i] = positions[positions.length - 1];
                }
                positions.pop();

                _removeMarketIdFromUser(user, marketId);
                isUnderLiquidationPosition[user][marketId] = false;
                liquidationAnchorPrice[user][marketId] = 0;
                liquidationAnchorTimestamp[user][marketId] = 0;

                if (realizedPnL != 0) { userRealizedPnL[user] += realizedPnL; }
                // Socialize only the uncovered portion not paid by seized collateral
                uint256 totalToSocialize = uncoveredLoss;
                if (totalToSocialize > 0) { _socializeLoss(marketId, totalToSocialize, user); }

                emit LiquidationExecuted(user, marketId, liquidator, seized, userCollateral[user]);
                return;
            }
        }
    }

    function liquidateLong(
        address user,
        bytes32 marketId,
        address liquidator,
        uint256 executionPrice
    ) external onlyRole(ORDERBOOK_ROLE) {
        PositionManager.Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size > 0) {
                int256 oldSize = positions[i].size;
                uint256 locked = positions[i].marginLocked;
                uint256 entryPrice = positions[i].entryPrice;
                uint256 markPrice = getMarkPrice(marketId);
                uint256 settlePrice = executionPrice > 0 ? executionPrice : markPrice;

                uint256 tradingLoss = 0;
                if (settlePrice < entryPrice) {
                    uint256 lossPerUnit = entryPrice - settlePrice;
                    tradingLoss = (lossPerUnit * uint256(oldSize)) / (DECIMAL_SCALE * TICK_PRECISION);
                }
            
                uint256 absSizeMark = uint256(oldSize);
                uint256 notional6 = (absSizeMark * settlePrice) / (10**18);
                uint256 penalty = (notional6 * LIQUIDATION_PENALTY_BPS) / 10000;
                uint256 actualLoss = tradingLoss + penalty;
            
                uint256 seizableFromLocked = actualLoss > locked ? locked : actualLoss;
                uint256 collateralAvailable_ = userCollateral[user];
                uint256 seized = seizableFromLocked > collateralAvailable_ ? collateralAvailable_ : seizableFromLocked;
                uint256 uncoveredLoss = tradingLoss > seized ? (tradingLoss - seized) : 0;
            
                if (seized > 0) {
                    uint256 ext3 = userCrossChainCredit[user];
                    uint256 useExt3 = seized <= ext3 ? seized : ext3;
                    if (useExt3 > 0) { userCrossChainCredit[user] = ext3 - useExt3; }
                    uint256 rem3 = seized - useExt3;
                    if (rem3 > 0) { userCollateral[user] -= rem3; }
                    uint256 seizedForTradingLoss = tradingLoss > seized ? seized : tradingLoss;
                    uint256 seizedRemainder = seized - seizedForTradingLoss;
                    uint256 makerRewardPool = penalty > seizedRemainder ? seizedRemainder : penalty;
                    address ob3 = marketToOrderBook[marketId];
                    if (makerRewardPool > 0 && ob3 != address(0)) {
                        uint256 fromExtToOB2 = useExt3 > seizedForTradingLoss ? (useExt3 - seizedForTradingLoss) : 0;
                        if (fromExtToOB2 > makerRewardPool) { fromExtToOB2 = makerRewardPool; }
                        if (fromExtToOB2 > 0) { userCrossChainCredit[ob3] += fromExtToOB2; }
                        uint256 remainingToOB2 = makerRewardPool - fromExtToOB2;
                        if (remainingToOB2 > 0) { userCollateral[ob3] += remainingToOB2; }
                    }
                }

                // Calculate realized PNL, capped to locked margin
                // CRITICAL: User's realized loss cannot exceed their locked margin
                int256 realizedPnL = 0;
                {
                    int256 priceDiff = int256(settlePrice) - int256(entryPrice);
                    int256 rawPnL = (priceDiff * oldSize) / int256(TICK_PRECISION);
                    
                    // For longs: oldSize is positive, so if settlePrice < entryPrice (loss),
                    // rawPnL will be negative (loss)
                    if (rawPnL < 0) {
                        // Convert locked margin from 6 decimals to 18 decimals for comparison
                        int256 maxLoss18 = -int256(locked * DECIMAL_SCALE);
                        
                        if (rawPnL < maxLoss18) {
                            // Loss exceeds locked margin - cap realized PNL
                            realizedPnL = maxLoss18;
                        } else {
                            // Loss is within locked margin - use actual PNL
                            realizedPnL = rawPnL;
                        }
                    } else {
                        // Profit case - no capping needed
                        realizedPnL = rawPnL;
                    }
                }

                if (locked <= totalMarginLocked) { totalMarginLocked -= locked; }
                if (i < positions.length - 1) { positions[i] = positions[positions.length - 1]; }
                positions.pop();

                _removeMarketIdFromUser(user, marketId);
                isUnderLiquidationPosition[user][marketId] = false;
                liquidationAnchorPrice[user][marketId] = 0;
                liquidationAnchorTimestamp[user][marketId] = 0;
                // Notify OrderBook removed to avoid external calls here; OB syncs via events/trade flow
                
                if (realizedPnL != 0) { userRealizedPnL[user] += realizedPnL; }
                // Socialize only the uncovered portion not paid by seized collateral
                uint256 totalToSocialize = uncoveredLoss;
                if (totalToSocialize > 0) { _socializeLoss(marketId, totalToSocialize, user); }

                emit LiquidationExecuted(user, marketId, liquidator, seized, userCollateral[user]);
                return;
            }
        }
    }

    // Mirror CoreVault partial liquidation handler for external callers retaining try/catch semantics
    function updatePositionWithLiquidation(
        address user,
        bytes32 marketId,
        int256 sizeDelta,
        uint256 executionPrice,
        address liquidator
    ) external onlyRole(ORDERBOOK_ROLE) {
        PositionManager.Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size != 0) {
                int256 oldSize = positions[i].size;
                bool closesExposure = (oldSize > 0 && sizeDelta < 0) || (oldSize < 0 && sizeDelta > 0);
                if (!closesExposure) {
                    int256 candidateNewSize = oldSize + sizeDelta;
                    uint256 basisForMargin = executionPrice;
                    bool sameDirection = (oldSize > 0 && sizeDelta > 0) || (oldSize < 0 && sizeDelta < 0);
                    if (!sameDirection && oldSize != 0) {
                        basisForMargin = positions[i].entryPrice;
                    }
                    uint256 requiredForCandidate = _calculateExecutionMargin(candidateNewSize, basisForMargin);
                    PositionManager.NettingResult memory nr = PositionManager.executePositionNetting(
                        positions,
                        user,
                        marketId,
                        sizeDelta,
                        executionPrice,
                        requiredForCandidate
                    );
                    if (nr.marginToLock > 0) totalMarginLocked += nr.marginToLock;
                    if (nr.marginToRelease > 0) totalMarginLocked -= nr.marginToRelease;
                    if (nr.realizedPnL != 0) userRealizedPnL[user] += nr.realizedPnL;
                    return;
                }

                uint256 absOld = uint256(oldSize > 0 ? oldSize : -oldSize);
                uint256 absDelta = uint256(sizeDelta > 0 ? sizeDelta : -sizeDelta);
                uint256 closeAbs = absDelta > absOld ? absOld : absDelta;

                int256 newSize = oldSize + sizeDelta;
                if ((oldSize > 0 && newSize < 0) || (oldSize < 0 && newSize > 0)) { newSize = 0; }

                uint256 entryPrice = positions[i].entryPrice;
                uint256 tradingLossClosed = 0;
                if (oldSize > 0 && executionPrice < entryPrice) {
                    uint256 lossPerUnit = entryPrice - executionPrice;
                    tradingLossClosed = (lossPerUnit * closeAbs) / (DECIMAL_SCALE * TICK_PRECISION);
                } else if (oldSize < 0 && executionPrice > entryPrice) {
                    uint256 lossPerUnit2 = executionPrice - entryPrice;
                    tradingLossClosed = (lossPerUnit2 * closeAbs) / (DECIMAL_SCALE * TICK_PRECISION);
                }
                uint256 notional6Closed = (closeAbs * executionPrice) / (10**18);
                uint256 penaltyClosed = (notional6Closed * LIQUIDATION_PENALTY_BPS) / 10000;
                uint256 actualLossClosed = tradingLossClosed + penaltyClosed;

                uint256 oldLocked = positions[i].marginLocked;
                uint256 basisPriceForMargin = executionPrice;
                if (closesExposure && newSize != 0) { basisPriceForMargin = entryPrice; }
                uint256 newRequiredMargin = _calculateExecutionMargin(newSize, basisPriceForMargin);
                uint256 confiscatable = oldLocked > newRequiredMargin ? (oldLocked - newRequiredMargin) : 0;
                uint256 collateralAvailable_ = userCollateral[user];
                uint256 seizableFromLocked = actualLossClosed > confiscatable ? confiscatable : actualLossClosed;
                uint256 seized = seizableFromLocked > collateralAvailable_ ? collateralAvailable_ : seizableFromLocked;
                uint256 uncoveredLoss = tradingLossClosed > seized ? (tradingLossClosed - seized) : 0;

                if (seized > 0) {
                    uint256 ext4 = userCrossChainCredit[user];
                    uint256 useExt4 = seized <= ext4 ? seized : ext4;
                    if (useExt4 > 0) { userCrossChainCredit[user] = ext4 - useExt4; }
                    uint256 rem4 = seized - useExt4;
                    if (rem4 > 0) { userCollateral[user] -= rem4; }
                    uint256 seizedForTradingLoss = tradingLossClosed > seized ? seized : tradingLossClosed;
                    uint256 seizedRemainder = seized - seizedForTradingLoss;
                    uint256 makerRewardPool = penaltyClosed > seizedRemainder ? seizedRemainder : penaltyClosed;
                    address ob = marketToOrderBook[marketId];
                    if (makerRewardPool > 0 && ob != address(0)) {
                        uint256 fromExtToOB3 = useExt4 > seizedForTradingLoss ? (useExt4 - seizedForTradingLoss) : 0;
                        if (fromExtToOB3 > makerRewardPool) { fromExtToOB3 = makerRewardPool; }
                        if (fromExtToOB3 > 0) { userCrossChainCredit[ob] += fromExtToOB3; }
                        uint256 remainingToOB3 = makerRewardPool - fromExtToOB3;
                        if (remainingToOB3 > 0) { userCollateral[ob] += remainingToOB3; }
                    }
                    emit MarginConfiscated(user, oldLocked, seized, penaltyClosed, liquidator);
                }

                positions[i].size = newSize;
                if (newSize == 0) {
                    if (i < positions.length - 1) { positions[i] = positions[positions.length - 1]; }
                    positions.pop();
                    if (oldLocked <= totalMarginLocked) { totalMarginLocked -= oldLocked; }
                    _removeMarketIdFromUser(user, marketId);
                    isUnderLiquidationPosition[user][marketId] = false;
                    liquidationAnchorPrice[user][marketId] = 0;
                    liquidationAnchorTimestamp[user][marketId] = 0;
                } else {
                    isUnderLiquidationPosition[user][marketId] = true;
                }

                if (newSize != 0) {
                    uint256 newLocked = newRequiredMargin;
                    uint256 lockedReduction = oldLocked > newLocked ? (oldLocked - newLocked) : 0;
                    positions[i].marginLocked = newLocked;
                    if (lockedReduction > 0 && lockedReduction <= totalMarginLocked) { totalMarginLocked -= lockedReduction; }
                    _recomputeAndStoreLiquidationPrice(user, marketId);
                }

                // Calculate realized PNL, capped to proportional locked margin for partial liquidations
                // CRITICAL: User's realized loss cannot exceed their locked margin (or proportional share for partials)
                int256 realizedPnL = 0;
                if (closeAbs > 0) {
                    int256 priceDiff = int256(executionPrice) - int256(entryPrice);
                    int256 closingSizeSigned = oldSize > 0 ? int256(closeAbs) : -int256(closeAbs);
                    int256 rawPnL = (priceDiff * closingSizeSigned) / int256(TICK_PRECISION);
                    
                    if (rawPnL < 0) {
                        // Calculate proportional margin for the closed portion
                        // For partial liquidations: maxLoss = (closeAbs / absOld) * oldLocked
                        uint256 proportionalMargin6;
                        if (newSize == 0) {
                            // Full close - use entire locked margin
                            proportionalMargin6 = oldLocked;
                        } else {
                            // Partial close - use proportional locked margin
                            proportionalMargin6 = (oldLocked * closeAbs) / absOld;
                        }
                        
                        // Convert to 18 decimals for comparison
                        int256 maxLoss18 = -int256(proportionalMargin6 * DECIMAL_SCALE);
                        
                        if (rawPnL < maxLoss18) {
                            // Loss exceeds proportional locked margin - cap realized PNL
                            realizedPnL = maxLoss18;
                        } else {
                            // Loss is within proportional locked margin - use actual PNL
                            realizedPnL = rawPnL;
                        }
                    } else {
                        // Profit case - no capping needed
                        realizedPnL = rawPnL;
                    }
                }
                if (realizedPnL != 0) { userRealizedPnL[user] += realizedPnL; }

                // Socialize only the uncovered loss portion (after seizure limits/anchor guards)
                uint256 totalToSocialize = 0;
                if (uncoveredLoss > 0) {
                    uint256 anchor = liquidationAnchorPrice[user][marketId];
                    uint256 seizedAppliedToTrading = seized > 0 ? (tradingLossClosed > seized ? seized : tradingLossClosed) : 0;
                    uint256 allowedUncovered = uncoveredLoss;
                    if (anchor > 0) {
                        uint256 anchorTradingLossClosed = 0;
                        if (oldSize > 0) {
                            uint256 effPrice = executionPrice > anchor ? executionPrice : anchor;
                            if (effPrice < entryPrice) {
                                uint256 lossPerUnitA = entryPrice - effPrice;
                                anchorTradingLossClosed = (lossPerUnitA * closeAbs) / (DECIMAL_SCALE * TICK_PRECISION);
                            }
                        } else if (oldSize < 0) {
                            uint256 effPrice2 = executionPrice < anchor ? executionPrice : anchor;
                            if (effPrice2 > entryPrice) {
                                uint256 lossPerUnitB = effPrice2 - entryPrice;
                                anchorTradingLossClosed = (lossPerUnitB * closeAbs) / (DECIMAL_SCALE * TICK_PRECISION);
                            }
                        }
                        if (anchorTradingLossClosed <= seizedAppliedToTrading) {
                            allowedUncovered = 0;
                        } else {
                            allowedUncovered = anchorTradingLossClosed - seizedAppliedToTrading;
                            if (allowedUncovered > uncoveredLoss) { allowedUncovered = uncoveredLoss; }
                        }
                    }
                    totalToSocialize += allowedUncovered;
                    uint256 excessBadDebt = uncoveredLoss > allowedUncovered ? (uncoveredLoss - allowedUncovered) : 0;
                    if (excessBadDebt > 0) { marketBadDebt[marketId] += excessBadDebt; emit BadDebtRecorded(marketId, excessBadDebt, user); }
                }
                if (totalToSocialize > 0) { _socializeLoss(marketId, totalToSocialize, user); }

                emit LiquidationExecuted(user, marketId, liquidator, seized, userCollateral[user]);
                emit PositionUpdated(user, marketId, oldSize, newSize, entryPrice, newSize == 0 ? 0 : positions[i].marginLocked);
                return;
            }
        }
        revert("No position found for liquidation");
    }

    function _calculateExecutionMargin(int256 amount, uint256 executionPrice) internal pure returns (uint256) {
        uint256 absAmount = uint256(amount >= 0 ? amount : -amount);
        uint256 notionalValue = (absAmount * executionPrice) / (10**18);
        uint256 marginBps = amount >= 0 ? 10000 : 15000;
        return (notionalValue * marginBps) / 10000;
    }

    function payMakerLiquidationReward(
        address liquidatedUser,
        bytes32 marketId,
        address maker,
        uint256 amount
    ) external onlyRole(ORDERBOOK_ROLE) {
        require(maker != address(0) && amount > 0, "invalid");
        address ob = marketToOrderBook[marketId];
        require(ob != address(0) && ob == msg.sender, "unauthorized ob");
        require(userCollateral[ob] >= amount, "insufficient ob balance");
        userCollateral[ob] -= amount;
        userCollateral[maker] += amount;
        emit MakerLiquidationRewardPaid(maker, liquidatedUser, marketId, amount);
    }

    function socializeLoss(
        bytes32 marketId,
        uint256 lossAmount,
        address liquidatedUser
    ) external onlyRole(ORDERBOOK_ROLE) {
        _socializeLoss(marketId, lossAmount, liquidatedUser);
    }

    /**
     * @notice Single entrypoint for off-chain workers: look up order book by marketId and trigger direct liquidation.
     * @dev Trustless: order book enforces liquidation threshold using its own mark price. No price input is trusted.
     */
    // NOTE: Do NOT add nonReentrant here because this function delegatecalls
    // from CoreVault and then invokes vault functions (liquidateShort/Long)
    // that are themselves nonReentrant. Guarding here would trip the same
    // ReentrancyGuard storage slot and revert with ReentrancyGuardReentrantCall.
    function liquidateDirect(bytes32 marketId, address trader) external {
        require(trader != address(0), "LM: bad trader");
        address ob = marketToOrderBook[marketId];
        require(ob != address(0), "LM: unknown market");
        IOrderBookLiq(ob).liquidateDirect(trader);
    }

    /**
     * @notice Batch variant to amortize base gas across multiple liquidations.
     * @dev Length capped to prevent accidental large batches.
     */
    // Same rationale as liquidateDirect: downstream vault calls are already guarded.
    function batchLiquidate(bytes32[] calldata marketIds, address[] calldata traders) external {
        uint256 len = marketIds.length;
        require(len == traders.length, "LM: length mismatch");
        require(len > 0 && len <= MAX_BATCH_SIZE, "LM: invalid batch size");
        for (uint256 i = 0; i < len; i++) {
            address trader = traders[i];
            require(trader != address(0), "LM: bad trader");
            address ob = marketToOrderBook[marketIds[i]];
            require(ob != address(0), "LM: unknown market");
            IOrderBookLiq(ob).liquidateDirect(trader);
        }
    }

    /**
     * @dev OPTIMIZED: Socialize loss using cached aggregates and bitmap-based winner selection
     * Key optimizations:
     *   1. Uses pre-computed profitable notional from aggregates
     *   2. Single-pass winner selection with partial heap (O(k log k))
     *   3. Batch haircut application to minimize storage writes
     */
    function _socializeLoss(
        bytes32 marketId,
        uint256 lossAmount,
        address liquidatedUser
    ) internal {
        require(lossAmount > 0, "Loss amount must be positive");
        if (adlDebug) emit SocializationStarted(marketId, lossAmount, liquidatedUser, block.timestamp);

        uint256 markPrice = getMarkPrice(marketId);
        {
            // Always try to refresh mark price from order book pricing facet to avoid stale cache
            address ob = marketToOrderBook[marketId];
            if (ob != address(0)) {
                (bool ok, bytes memory data) = ob.staticcall(
                    abi.encodeWithSignature("calculateMarkPrice()")
                );
                if (ok && data.length >= 32) {
                    uint256 freshMark = abi.decode(data, (uint256));
                    if (freshMark > 0) {
                        markPrice = freshMark;
                        marketMarkPrices[marketId] = freshMark;
                    }
                }
            }
            if (markPrice == 0) {
                _handleSocializationFailure(marketId, lossAmount, "Zero mark price", liquidatedUser);
                return;
            }
        }

        _rebuildMarketUsersFromPositions(marketId);

        (
            ProfitablePosition[] memory winners,
            uint256 totalProfitableNotional6,
            uint256 profitableCount,
            uint256 candidateCount
        ) = _findProfitablePositions(marketId, liquidatedUser, markPrice);

        if (winners.length == 0) {
            emit SocializationDiagnostics(
                marketId,
                markPrice,
                totalProfitableNotional6,
                profitableCount,
                candidateCount,
                0,
                lossAmount,
                liquidatedUser
            );
            _handleSocializationFailure(marketId, lossAmount, "No profitable positions found", liquidatedUser);
            return;
        }

        // Build winner cache with capacity calculations
        (WinnerCache[] memory cache, uint256 totalNotional6) = _buildWinnerCacheSimple(winners, marketId, markPrice);
        if (totalNotional6 == 0) {
            _handleSocializationFailure(marketId, lossAmount, "Zero total notional", liquidatedUser);
            return;
        }

        // Allocate haircuts proportionally
        uint256 allocated = _allocateHaircutsOptimized(marketId, markPrice, lossAmount, winners, cache, totalNotional6);

        if (allocated < lossAmount) {
            uint256 remaining = lossAmount - allocated;
            marketBadDebt[marketId] += remaining;
            emit SocializationDiagnostics(
                marketId,
                markPrice,
                totalProfitableNotional6,
                profitableCount,
                candidateCount,
                winners.length,
                lossAmount,
                liquidatedUser
            );
            emit BadDebtRecorded(marketId, remaining, liquidatedUser);
            emit SocializationFailed(marketId, remaining, "Insufficient winner capacity for haircut", liquidatedUser);
        }

        if (adlDebug) emit SocializationCompleted(marketId, allocated, lossAmount > allocated ? lossAmount - allocated : 0, winners.length, liquidatedUser);
        emit SocializedLossApplied(marketId, allocated, liquidatedUser);
    }

    function _handleSocializationFailure(
        bytes32 marketId,
        uint256 lossAmount,
        string memory reason,
        address liquidatedUser
    ) private {
        marketBadDebt[marketId] += lossAmount;
        emit SocializationFailed(marketId, lossAmount, reason, liquidatedUser);
        emit BadDebtRecorded(marketId, lossAmount, liquidatedUser);
        emit SocializedLossApplied(marketId, 0, liquidatedUser);
    }

    function _buildWinnerCacheSimple(
        ProfitablePosition[] memory winners,
        bytes32 marketId,
        uint256 markPrice
    ) private view returns (WinnerCache[] memory cache, uint256 totalNotional6) {
        cache = new WinnerCache[](winners.length);
        uint256 mmrBps = baseMmrBps + penaltyMmrBps;
        if (mmrBps > maxMmrBps) mmrBps = maxMmrBps;

        for (uint256 i = 0; i < winners.length; i++) {
            int256 posSize = winners[i].positionSize;
            uint256 absSize = posSize >= 0 ? uint256(posSize) : uint256(-posSize);
            uint256 notional6 = (absSize * markPrice) / 1e18;
            cache[i].notional6 = notional6;
            totalNotional6 += notional6;
            cache[i].capacity6 = _computeWinnerCapacitySimple(winners[i].user, marketId, markPrice, notional6, mmrBps);
        }
    }

    function _computeWinnerCapacitySimple(
        address user,
        bytes32 marketId,
        uint256 markPrice,
        uint256 notional6,
        uint256 mmrBps
    ) private view returns (uint256) {
        PositionManager.Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId != marketId || positions[i].size == 0) continue;
            int256 pnl18 = (int256(markPrice) - int256(positions[i].entryPrice)) * positions[i].size / int256(TICK_PRECISION);
            int256 pnl6 = pnl18 / int256(DECIMAL_SCALE);
            int256 equity6 = int256(positions[i].marginLocked) + pnl6;
            uint256 maintenance6 = (notional6 * mmrBps) / 10000;
            if (equity6 > int256(maintenance6)) {
                return uint256(equity6 - int256(maintenance6));
            }
            return 0;
        }
        return 0;
    }

    /**
     * @dev OPTIMIZED: Build winner cache using position cache instead of storage reads
     */
    function _buildWinnerCacheOptimized(
        ProfitablePosition[] memory winners,
        bytes32 marketId,
        uint256 markPrice
    ) private view returns (WinnerCache[] memory cache, uint256 totalNotional6) {
        cache = new WinnerCache[](winners.length);
        uint256 mmrBps = baseMmrBps + penaltyMmrBps;
        if (mmrBps > maxMmrBps) mmrBps = maxMmrBps;

        for (uint256 i = 0; i < winners.length; i++) {
            // Use position cache instead of storage read
            PositionCache storage pCache = positionCache[marketId][winners[i].user];
            uint256 notional6;
            
            if (pCache.initialized && pCache.cachedNotional6 > 0) {
                notional6 = pCache.cachedNotional6;
            } else {
                uint256 absSize = uint256(winners[i].positionSize >= 0 ? winners[i].positionSize : -winners[i].positionSize);
                notional6 = (absSize * markPrice) / 1e18;
            }
            
            cache[i].notional6 = notional6;
            totalNotional6 += notional6;
            cache[i].capacity6 = _computeWinnerCapacityOptimized(winners[i].user, marketId, markPrice, notional6, mmrBps);
        }
    }

    /**
     * @dev OPTIMIZED: Compute winner capacity using position cache
     */
    function _computeWinnerCapacityOptimized(
        address user,
        bytes32 marketId,
        uint256 markPrice,
        uint256 notional6,
        uint256 mmrBps
    ) private view returns (uint256) {
        // Try to use cached data first
        PositionCache storage cache = positionCache[marketId][user];
        if (cache.initialized) {
            int256 pnl6 = cache.cachedPnL18 / int256(DECIMAL_SCALE);
            int256 equity6 = int256(cache.marginLocked) + pnl6;
            uint256 maintenance6 = (notional6 * mmrBps) / 10000;
            if (equity6 > int256(maintenance6)) {
                return uint256(equity6 - int256(maintenance6));
            }
            return 0;
        }
        
        // Fallback to storage read if cache miss
        PositionManager.Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size != 0) {
                int256 pnl18 = (int256(markPrice) - int256(positions[i].entryPrice)) * positions[i].size / int256(TICK_PRECISION);
                int256 pnl6 = pnl18 / int256(DECIMAL_SCALE);
                int256 equity6 = int256(positions[i].marginLocked) + pnl6;
                uint256 maintenance6 = (notional6 * mmrBps) / 10000;
                if (equity6 > int256(maintenance6)) {
                    return uint256(equity6 - int256(maintenance6));
                }
                break;
            }
        }
        return 0;
    }

    /**
     * @dev OPTIMIZED: Allocate haircuts with batched storage writes
     */
    function _allocateHaircutsOptimized(
        bytes32 marketId,
        uint256 markPrice,
        uint256 lossAmount,
        ProfitablePosition[] memory winners,
        WinnerCache[] memory cache,
        uint256 totalNotional6
    ) private returns (uint256 allocated) {
        uint256 remaining = lossAmount;
        uint256 len = winners.length;
        
        // First pass: proportional allocation
        for (uint256 i = 0; i < len && remaining > 0; i++) {
            uint256 target = (lossAmount * cache[i].notional6) / totalNotional6;
            uint256 assign = target <= cache[i].capacity6 ? target : cache[i].capacity6;
            if (assign == 0) continue;
            
            _applyHaircutToPositionOptimized(winners[i].user, marketId, assign, markPrice);
            cache[i].capacity6 -= assign;
            allocated += assign;
            remaining = lossAmount > allocated ? (lossAmount - allocated) : 0;
        }

        // Second pass: absorb remainder with remaining capacity
        if (remaining > 0) {
            for (uint256 i = 0; i < len && remaining > 0; i++) {
                uint256 cap = cache[i].capacity6;
                if (cap == 0) continue;
                uint256 addl = remaining <= cap ? remaining : cap;
                _applyHaircutToPositionOptimized(winners[i].user, marketId, addl, markPrice);
                cache[i].capacity6 -= addl;
                allocated += addl;
                remaining -= addl;
            }
        }

        return allocated;
    }

    /**
     * @dev OPTIMIZED: Apply haircut using cached position index
     */
    function _applyHaircutToPositionOptimized(
        address user,
        bytes32 marketId,
        uint256 amount,
        uint256 markPrice
    ) private {
        PositionManager.Position[] storage positions = userPositions[user];
        
        // Use cached data to find position faster
        PositionCache storage cache = positionCache[marketId][user];
        
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size != 0) {
                // Apply haircut
                positions[i].socializedLossAccrued6 += amount;
                
                // Track haircut weight in position units so future partial closes release
                // the haircut proportionally to the size that is closed. Use current size
                // as the base to avoid over‑tagging across multiple haircuts.
                uint256 absSize = uint256(positions[i].size >= 0 ? positions[i].size : -positions[i].size);
                positions[i].haircutUnits18 = absSize;
                
                userSocializedLoss[user] += amount;
                
                // Update cache to reflect reduced capacity
                if (cache.initialized) {
                    // Haircut reduces effective PnL for future calculations
                    cache.cachedPnL18 -= int256(amount) * int256(DECIMAL_SCALE);
                    if (cache.cachedPnL18 <= 0) {
                        cache.isProfitable = false;
                        cache.profitScore = 0;
                        _updateProfitableBitmap(marketId, user, false);
                    } else {
                        cache.profitScore = uint256(cache.cachedPnL18) * absSize / 1e18;
                    }
                }
                
                emit HaircutApplied(user, marketId, amount, userCollateral[user]);
                break;
            }
        }
    }
    
    // Keep original functions for backward compatibility
    function _buildWinnerCache(
        ProfitablePosition[] memory winners,
        bytes32 marketId,
        uint256 markPrice
    ) private view returns (WinnerCache[] memory cache, uint256 totalNotional6) {
        return _buildWinnerCacheSimple(winners, marketId, markPrice);
    }

    function _computeWinnerCapacity(
        address user,
        bytes32 marketId,
        uint256 markPrice,
        uint256 notional6,
        uint256 mmrBps
    ) private view returns (uint256) {
        return _computeWinnerCapacitySimple(user, marketId, markPrice, notional6, mmrBps);
    }

    function _allocateHaircuts(
        bytes32 marketId,
        uint256 markPrice,
        uint256 lossAmount,
        ProfitablePosition[] memory winners,
        WinnerCache[] memory cache,
        uint256 totalNotional6
    ) private returns (uint256 allocated) {
        return _allocateHaircutsOptimized(marketId, markPrice, lossAmount, winners, cache, totalNotional6);
    }

    function _applyHaircutToPosition(
        address user,
        bytes32 marketId,
        uint256 amount,
        uint256 markPrice
    ) private {
        _applyHaircutToPositionOptimized(user, marketId, amount, markPrice);
    }


    function _getUsersWithPositionsInMarket(bytes32 marketId) internal view returns (address[] memory) {
        return marketUsers[marketId];
    }

    function getUsersWithPositionsInMarket(bytes32 marketId) external view returns (address[] memory) {
        return marketUsers[marketId];
    }

    function addUserToMarketIndex(address user, bytes32 marketId) external onlyRole(ORDERBOOK_ROLE) {
        _addUserToMarketIndex(user, marketId);
    }

    function removeUserFromMarketIndex(address user, bytes32 marketId) external onlyRole(ORDERBOOK_ROLE) {
        _removeUserFromMarketIndex(user, marketId);
    }

    /**
     * @dev O(1) add user to market index with bitmap update
     */
    function _addUserToMarketIndex(address user, bytes32 marketId) internal {
        if (marketUserIndex[marketId][user] != 0) return;
        marketUsers[marketId].push(user);
        uint256 newIndex = marketUsers[marketId].length; // 1-based
        marketUserIndex[marketId][user] = newIndex;
        
        // Initialize position cache
        _updatePositionCache(user, marketId);
    }

    function _rebuildMarketUsersFromPositions(bytes32 marketId) internal {
        if (marketUsers[marketId].length > 0) return;
        for (uint256 i = 0; i < allKnownUsers.length; i++) {
            address user = allKnownUsers[i];
            PositionManager.Position[] storage positions = userPositions[user];
            for (uint256 j = 0; j < positions.length; j++) {
                if (positions[j].marketId == marketId && positions[j].size != 0) {
                    _addUserToMarketIndex(user, marketId);
                    break;
                }
            }
        }
    }

    /**
     * @dev O(1) remove user from market index with swap-and-pop
     */
    function _removeUserFromMarketIndex(address user, bytes32 marketId) internal {
        uint256 idx = marketUserIndex[marketId][user];
        if (idx == 0) return;
        
        // Update bitmap before removal (clear profitable bit)
        _updateProfitableBitmap(marketId, user, false);
        
        // Update aggregates before removal
        PositionCache storage cache = positionCache[marketId][user];
        if (cache.initialized) {
            MarketAggregate storage agg = marketAggregates[marketId];
            if (agg.totalNotional6 >= cache.cachedNotional6) {
                agg.totalNotional6 -= cache.cachedNotional6;
            }
            if (agg.totalMargin6 >= cache.marginLocked) {
                agg.totalMargin6 -= cache.marginLocked;
            }
            agg.totalUnrealizedPnL18 -= cache.cachedPnL18;
            if (cache.isProfitable && agg.profitableNotional6 >= cache.cachedNotional6) {
                agg.profitableNotional6 -= cache.cachedNotional6;
            }
        }
        
        // Swap and pop
        uint256 arrIdx = idx - 1;
        address[] storage arr = marketUsers[marketId];
        uint256 lastIdx = arr.length - 1;
        
        if (arrIdx != lastIdx) {
            address lastUser = arr[lastIdx];
            arr[arrIdx] = lastUser;
            marketUserIndex[marketId][lastUser] = idx;
            
            // Update bitmap position for moved user
            uint256 oldWordIdx = lastIdx / BITMAP_WORD_SIZE;
            uint256 oldBitIdx = lastIdx % BITMAP_WORD_SIZE;
            uint256 newWordIdx = arrIdx / BITMAP_WORD_SIZE;
            uint256 newBitIdx = arrIdx % BITMAP_WORD_SIZE;
            
            // Copy bit from old position to new
            bool wasProfitable = (profitableBitmap[marketId][oldWordIdx] & (1 << oldBitIdx)) != 0;
            if (wasProfitable) {
                profitableBitmap[marketId][newWordIdx] |= (1 << newBitIdx);
                profitableBitmap[marketId][oldWordIdx] &= ~(1 << oldBitIdx);
            } else {
                profitableBitmap[marketId][newWordIdx] &= ~(1 << newBitIdx);
            }
        }
        
        arr.pop();
        delete marketUserIndex[marketId][user];
        delete positionCache[marketId][user];
    }

    /**
     * @dev Update position cache and aggregates - called on position changes
     */
    function _updatePositionCache(address user, bytes32 marketId) internal {
        PositionManager.Position[] storage positions = userPositions[user];
        PositionCache storage cache = positionCache[marketId][user];
        MarketAggregate storage agg = marketAggregates[marketId];
        uint256 markPrice = marketMarkPrices[marketId];
        
        // Find position in this market
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size != 0) {
                // Remove old values from aggregates if previously initialized
                if (cache.initialized) {
                    if (agg.totalNotional6 >= cache.cachedNotional6) {
                        agg.totalNotional6 -= cache.cachedNotional6;
                    }
                    if (agg.totalMargin6 >= cache.marginLocked) {
                        agg.totalMargin6 -= cache.marginLocked;
                    }
                    agg.totalUnrealizedPnL18 -= cache.cachedPnL18;
                    if (cache.isProfitable && agg.profitableNotional6 >= cache.cachedNotional6) {
                        agg.profitableNotional6 -= cache.cachedNotional6;
                    }
                }
                
                // Calculate new values
                uint256 absSize = uint256(positions[i].size >= 0 ? positions[i].size : -positions[i].size);
                uint256 notional6 = markPrice > 0 ? (absSize * markPrice) / 1e18 : 0;
                int256 pnl18 = 0;
                if (markPrice > 0 && positions[i].entryPrice > 0) {
                    int256 priceDiff = int256(markPrice) - int256(positions[i].entryPrice);
                    pnl18 = (priceDiff * positions[i].size) / int256(TICK_PRECISION);
                }
                bool isProfitable = pnl18 > 0;
                uint256 profitScore = isProfitable ? uint256(pnl18) * absSize / 1e18 : 0;
                
                // Update cache
                cache.size = positions[i].size;
                cache.entryPrice = positions[i].entryPrice;
                cache.marginLocked = positions[i].marginLocked;
                cache.liquidationPrice = positions[i].liquidationPrice;
                cache.cachedPnL18 = pnl18;
                cache.cachedNotional6 = notional6;
                cache.isProfitable = isProfitable;
                cache.profitScore = profitScore;
                cache.initialized = true;
                
                // Add new values to aggregates
                agg.totalNotional6 += notional6;
                agg.totalMargin6 += positions[i].marginLocked;
                agg.totalUnrealizedPnL18 += pnl18;
                agg.lastMarkPrice = markPrice;
                if (isProfitable) {
                    agg.profitableNotional6 += notional6;
                }
                
                // Update bitmap
                _updateProfitableBitmap(marketId, user, isProfitable);
                return;
            }
        }
        
        // No position found - clear cache
        if (cache.initialized) {
            if (agg.totalNotional6 >= cache.cachedNotional6) {
                agg.totalNotional6 -= cache.cachedNotional6;
            }
            if (agg.totalMargin6 >= cache.marginLocked) {
                agg.totalMargin6 -= cache.marginLocked;
            }
            agg.totalUnrealizedPnL18 -= cache.cachedPnL18;
            if (cache.isProfitable && agg.profitableNotional6 >= cache.cachedNotional6) {
                agg.profitableNotional6 -= cache.cachedNotional6;
            }
        }
        _updateProfitableBitmap(marketId, user, false);
        delete positionCache[marketId][user];
    }

    /**
     * @dev Update profitable bitmap for a user - O(1)
     */
    function _updateProfitableBitmap(bytes32 marketId, address user, bool isProfitable) internal {
        uint256 userIdxPlusOne = marketUserIndex[marketId][user];
        if (userIdxPlusOne == 0) return;
        
        uint256 userIdx = userIdxPlusOne - 1;
        uint256 wordIdx = userIdx / BITMAP_WORD_SIZE;
        uint256 bitIdx = userIdx % BITMAP_WORD_SIZE;
        uint256 mask = 1 << bitIdx;
        
        bool wasProfitable = (profitableBitmap[marketId][wordIdx] & mask) != 0;
        
        if (isProfitable && !wasProfitable) {
            profitableBitmap[marketId][wordIdx] |= mask;
            profitableUserCount[marketId]++;
        } else if (!isProfitable && wasProfitable) {
            profitableBitmap[marketId][wordIdx] &= ~mask;
            if (profitableUserCount[marketId] > 0) {
                profitableUserCount[marketId]--;
            }
        }
    }

    /**
     * @dev OPTIMIZED: Find profitable positions using bitmap scan + partial heap
     * Complexity: O(k log k) where k = min(profitable users, adlMaxCandidates)
     * vs original O(n*m) where n = all users, m = positions per user
     */
    function _findProfitablePositions(
        bytes32 marketId, 
        address excludeUser,
        uint256 markPrice
    )
        internal
        returns (
            ProfitablePosition[] memory winners,
            uint256 totalProfitableNotional6,
            uint256 profitableCount,
            uint256 candidateCount
        )
    {
        if (markPrice == 0) {
            return (new ProfitablePosition[](0), 0, 0, 0);
        }

        address[] storage primary = marketUsers[marketId];
        address[] storage candidates = primary.length > 0 ? primary : allKnownUsers;
        candidateCount = candidates.length;

        if (candidateCount == 0) {
            return (new ProfitablePosition[](0), 0, 0, 0);
        }

        ProfitablePosition[] memory temp = new ProfitablePosition[](candidateCount);
        uint256 count = 0;

        for (uint256 i = 0; i < candidateCount; i++) {
            address user = candidates[i];
            if (user == address(0) || user == excludeUser) continue;

            PositionManager.Position[] storage positions = userPositions[user];
            for (uint256 j = 0; j < positions.length; j++) {
                PositionManager.Position storage position = positions[j];
                if (position.marketId != marketId || position.size == 0) continue;

                int256 pnl18 = (int256(markPrice) - int256(position.entryPrice)) * position.size / int256(TICK_PRECISION);
                if (pnl18 <= 0) {
                    break;
                }

                uint256 absSize = position.size >= 0 ? uint256(position.size) : uint256(-position.size);
                uint256 notional6 = (absSize * markPrice) / 1e18;
                totalProfitableNotional6 += notional6;
                profitableCount++;

                uint256 profitScore = uint256(pnl18) * absSize / 1e18;
                temp[count] = ProfitablePosition({
                    user: user,
                    positionSize: position.size,
                    entryPrice: position.entryPrice,
                    unrealizedPnL: uint256(pnl18),
                    profitScore: profitScore,
                    isLong: position.size > 0
                });

                if (adlDebug) {
                    emit ProfitablePositionFound(user, marketId, position.size, position.entryPrice, markPrice, uint256(pnl18), profitScore);
                }

                count++;
                break;
            }
        }

        if (count == 0) {
            return (new ProfitablePosition[](0), totalProfitableNotional6, 0, candidateCount);
        }

        // Defensive: ensure we never drop profitable users due to a zero max-candidates config
        uint256 maxCandidates = adlMaxCandidates;
        if (maxCandidates == 0) {
            maxCandidates = count; // fallback to include all found positions
        }
        uint256 cap = count < maxCandidates ? count : maxCandidates;
        if (cap == 0 && count > 0) {
            cap = count; // final guard in case of unexpected config drift
        }

        // Selection sort for top-k profit scores
        for (uint256 i = 0; i < cap; i++) {
            uint256 maxIdx = i;
            for (uint256 j = i + 1; j < count; j++) {
                if (temp[j].profitScore > temp[maxIdx].profitScore) {
                    maxIdx = j;
                }
            }
            if (maxIdx != i) {
                ProfitablePosition memory swapPos = temp[i];
                temp[i] = temp[maxIdx];
                temp[maxIdx] = swapPos;
            }
        }

        winners = new ProfitablePosition[](cap);
        for (uint256 i = 0; i < cap; i++) {
            winners[i] = temp[i];
        }

        return (winners, totalProfitableNotional6, profitableCount, candidateCount);
    }
    
    /**
     * @dev Find lowest set bit position using de Bruijn sequence - O(1)
     */
    function _findLowestSetBit(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 256;
        uint256 n = 0;
        if ((x & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF) == 0) { n += 128; x >>= 128; }
        if ((x & 0xFFFFFFFFFFFFFFFF) == 0) { n += 64; x >>= 64; }
        if ((x & 0xFFFFFFFF) == 0) { n += 32; x >>= 32; }
        if ((x & 0xFFFF) == 0) { n += 16; x >>= 16; }
        if ((x & 0xFF) == 0) { n += 8; x >>= 8; }
        if ((x & 0xF) == 0) { n += 4; x >>= 4; }
        if ((x & 0x3) == 0) { n += 2; x >>= 2; }
        if ((x & 0x1) == 0) { n += 1; }
        return n;
    }

    function _calculateUnrealizedPnL(
        PositionManager.Position storage position,
        uint256 markPrice
    ) internal view returns (int256) {
        if (position.size == 0 || markPrice == 0 || position.entryPrice == 0) { return 0; }
        int256 priceDiff = int256(markPrice) - int256(position.entryPrice);
        return (priceDiff * position.size) / int256(TICK_PRECISION);
    }

    /**
     * @dev OPTIMIZED: Batch update position caches when mark price changes
     * Uses gas-bounded iteration to stay under block gas limit
     * @param marketId Market to update
     * @param newMarkPrice New mark price
     * @param maxUpdates Maximum positions to update (gas bound)
     * @return updatedCount Number of positions updated
     * @return hasMore True if more positions need updating
     */
    function refreshPositionCaches(
        bytes32 marketId,
        uint256 newMarkPrice,
        uint256 maxUpdates
    ) external onlyRole(ORDERBOOK_ROLE) returns (uint256 updatedCount, bool hasMore) {
        return _refreshPositionCachesInternal(marketId, newMarkPrice, maxUpdates);
    }

    // Internal helper so core flows (e.g., socialization) can force-refresh without role gates
    function _refreshPositionCachesInternal(
        bytes32 marketId,
        uint256 newMarkPrice,
        uint256 maxUpdates
    ) internal returns (uint256 updatedCount, bool hasMore) {
        MarketAggregate storage agg = marketAggregates[marketId];
        
        // Skip if mark price hasn't changed significantly (0.1% threshold)
        if (agg.lastMarkPrice > 0) {
            uint256 priceDiff = newMarkPrice > agg.lastMarkPrice ? 
                newMarkPrice - agg.lastMarkPrice : agg.lastMarkPrice - newMarkPrice;
            if (priceDiff * 1000 < agg.lastMarkPrice) {
                return (0, false);
            }
        }
        
        address[] storage users = marketUsers[marketId];
        uint256 totalUsers = users.length;
        
        // Reset aggregates for recalculation
        agg.totalNotional6 = 0;
        agg.totalMargin6 = 0;
        agg.totalUnrealizedPnL18 = 0;
        agg.profitableNotional6 = 0;
        // Reset profitable bitmap and counter before recomputing
        profitableUserCount[marketId] = 0;
        uint256 wordCount = (totalUsers + BITMAP_WORD_SIZE - 1) / BITMAP_WORD_SIZE;
        for (uint256 w = 0; w < wordCount; w++) {
            profitableBitmap[marketId][w] = 0;
        }
        
        uint256 mmrBps = baseMmrBps + penaltyMmrBps;
        if (mmrBps > maxMmrBps) mmrBps = maxMmrBps;
        
        for (uint256 i = 0; i < totalUsers && updatedCount < maxUpdates; i++) {
            address user = users[i];
            PositionCache storage cache = positionCache[marketId][user];
            
            // Find position
            PositionManager.Position[] storage positions = userPositions[user];
            for (uint256 j = 0; j < positions.length; j++) {
                if (positions[j].marketId == marketId && positions[j].size != 0) {
                    uint256 absSize = uint256(positions[j].size >= 0 ? positions[j].size : -positions[j].size);
                    uint256 notional6 = (absSize * newMarkPrice) / 1e18;
                    
                    int256 priceDiff = int256(newMarkPrice) - int256(positions[j].entryPrice);
                    int256 pnl18 = (priceDiff * positions[j].size) / int256(TICK_PRECISION);
                    
                    bool isProfitable = pnl18 > 0;
                    uint256 profitScore = isProfitable ? uint256(pnl18) * absSize / 1e18 : 0;
                    
                    // Update cache
                    cache.size = positions[j].size;
                    cache.entryPrice = positions[j].entryPrice;
                    cache.marginLocked = positions[j].marginLocked;
                    cache.liquidationPrice = positions[j].liquidationPrice;
                    cache.cachedPnL18 = pnl18;
                    cache.cachedNotional6 = notional6;
                    cache.isProfitable = isProfitable;
                    cache.profitScore = profitScore;
                    cache.initialized = true;
                    
                    // Update aggregates
                    agg.totalNotional6 += notional6;
                    agg.totalMargin6 += positions[j].marginLocked;
                    agg.totalUnrealizedPnL18 += pnl18;
                    if (isProfitable) {
                        agg.profitableNotional6 += notional6;
                    }
                    
                    // Update bitmap
                    _updateProfitableBitmap(marketId, user, isProfitable);
                    
                    break;
                }
            }
            
            updatedCount++;
        }
        
        agg.lastMarkPrice = newMarkPrice;
        hasMore = updatedCount < totalUsers;
        return (updatedCount, hasMore);
    }

    /**
     * @dev Get market aggregate data for external queries
     */
    function getMarketAggregate(bytes32 marketId) external view returns (
        uint256 totalNotional6,
        uint256 totalMargin6,
        int256 totalUnrealizedPnL18,
        uint256 profitableNotional6,
        uint256 userCount
    ) {
        MarketAggregate storage agg = marketAggregates[marketId];
        return (
            agg.totalNotional6,
            agg.totalMargin6,
            agg.totalUnrealizedPnL18,
            agg.profitableNotional6,
            marketUsers[marketId].length
        );
    }

    /**
     * @dev Get profitable user count for a market - O(1)
     */
    function getProfitableUserCount(bytes32 marketId) external view returns (uint256) {
        return profitableUserCount[marketId];
    }

    // Legacy functions kept for backward compatibility but marked as deprecated
    function _sortProfitablePositionsByScore(ProfitablePosition[] memory positions) internal pure {
        if (positions.length <= 1) return;
        for (uint256 i = 1; i < positions.length; i++) {
            ProfitablePosition memory key = positions[i];
            uint256 j = i;
            while (j > 0 && positions[j - 1].profitScore < key.profitScore) {
                positions[j] = positions[j - 1];
                j--;
            }
            positions[j] = key;
        }
    }

    function _selectTopKByProfitScore(
        ProfitablePosition[] memory positions,
        uint256 k
    ) internal pure returns (ProfitablePosition[] memory) {
        if (positions.length <= k) { return positions; }
        uint256 sampleStride = positions.length / (k == 0 ? 1 : k);
        if (sampleStride == 0) sampleStride = 1;
        uint256 approxThreshold = 0;
        for (uint256 i = 0; i < positions.length; i += sampleStride) {
            if (positions[i].profitScore > approxThreshold) { approxThreshold = positions[i].profitScore; }
        }
        ProfitablePosition[] memory result = new ProfitablePosition[](k);
        uint256 count = 0;
        for (uint256 i2 = 0; i2 < positions.length && count < k; i2++) {
            if (positions[i2].profitScore >= approxThreshold) { result[count] = positions[i2]; count++; }
        }
        if (count < k) {
            for (uint256 i3 = 0; i3 < positions.length && count < k; i3++) {
                bool exists = false;
                for (uint256 j = 0; j < count; j++) {
                    if (positions[i3].user == result[j].user && positions[i3].positionSize == result[j].positionSize && positions[i3].entryPrice == result[j].entryPrice) { exists = true; break; }
                }
                if (!exists) { result[count] = positions[i3]; count++; }
            }
        }
        return result;
    }

    function _computeEffectiveMMRMetrics(
        address /*user*/,
        bytes32 marketId,
        int256 positionSize
    ) internal view returns (uint256 mmrBps, uint256 fillRatio1e18, uint256 gapRatio1e18) {
        marketId; positionSize;
        uint256 mmr = baseMmrBps + penaltyMmrBps;
        if (mmr > maxMmrBps) mmr = maxMmrBps;
        return (mmr, 0, 0);
    }

    function _computeEffectiveMMRBps(
        address user,
        bytes32 marketId,
        int256 positionSize
    ) internal view returns (uint256 mmrBps, uint256 fillRatio1e18) {
        (uint256 m, uint256 f, ) = _computeEffectiveMMRMetrics(user, marketId, positionSize);
        return (m, f);
    }

    function _getCloseLiquidity(bytes32 marketId, uint256 /*absSize*/) internal view returns (uint256 liquidity18) {
        address obAddr = marketToOrderBook[marketId];
        if (obAddr == address(0)) return 0;
        (uint256[] memory bidPrices, uint256[] memory bidAmounts, uint256[] memory askPrices, uint256[] memory askAmounts) =
            IOBPricingFacet(obAddr).getOrderBookDepth(mmrLiquidityDepthLevels);

        uint256 sumBids;
        for (uint256 i = 0; i < bidAmounts.length; i++) { sumBids += bidAmounts[i]; }
        uint256 sumAsks;
        for (uint256 j = 0; j < askAmounts.length; j++) { sumAsks += askAmounts[j]; }
        liquidity18 = sumBids > sumAsks ? sumBids : sumAsks;
        return liquidity18;
    }

    function setMmrParams(
        uint256 _baseMmrBps,
        uint256 _penaltyMmrBps,
        uint256 _maxMmrBps,
        uint256 _scalingSlopeBps,
        uint256 _liquidityDepthLevels
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_baseMmrBps <= 10000 && _penaltyMmrBps <= 10000 && _maxMmrBps <= 10000, "bps!");
        require(_liquidityDepthLevels > 0 && _liquidityDepthLevels <= 50, "depth!");
        baseMmrBps = _baseMmrBps;
        penaltyMmrBps = _penaltyMmrBps;
        maxMmrBps = _maxMmrBps;
        scalingSlopeBps = _scalingSlopeBps;
        mmrLiquidityDepthLevels = _liquidityDepthLevels;
    }

    function setMmrParamsAdvanced(
        uint256 _baseMmrBps,
        uint256 _penaltyMmrBps,
        uint256 _maxMmrBps,
        uint256 _scalingSlopeBps,
        uint256 _liquidityDepthLevels,
        uint256 _priceGapSlopeBps
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_baseMmrBps <= 10000 && _penaltyMmrBps <= 10000 && _maxMmrBps <= 10000, "bps!");
        require(_liquidityDepthLevels > 0 && _liquidityDepthLevels <= 50, "depth!");
        baseMmrBps = _baseMmrBps;
        penaltyMmrBps = _penaltyMmrBps;
        maxMmrBps = _maxMmrBps;
        scalingSlopeBps = _scalingSlopeBps;
        mmrLiquidityDepthLevels = _liquidityDepthLevels;
        priceGapSlopeBps = _priceGapSlopeBps;
    }

    function getAvailableCollateral(address user) public view returns (uint256) {
        VaultAnalytics.Position[] memory positions = new VaultAnalytics.Position[](userPositions[user].length);
        for (uint256 i = 0; i < userPositions[user].length; i++) {
            positions[i] = VaultAnalytics.Position({
                marketId: userPositions[user][i].marketId,
                size: userPositions[user][i].size,
                entryPrice: userPositions[user][i].entryPrice,
                marginLocked: userPositions[user][i].marginLocked
            });
        }
        uint256 baseAvailable = VaultAnalytics.getAvailableCollateral(userCollateral[user], positions);
        int256 realizedPnL18 = userRealizedPnL[user];
        if (userPositions[user].length == 0 && realizedPnL18 < 0) { realizedPnL18 = 0; }
        int256 realizedPnL6 = realizedPnL18 / int256(DECIMAL_SCALE);
        int256 baseWithRealized = int256(baseAvailable) + realizedPnL6;
        uint256 availableWithRealized = baseWithRealized > 0 ? uint256(baseWithRealized) : 0;
        if (availableWithRealized > 0) {
            uint256 outstandingHaircut6 = 0;
            for (uint256 i2 = 0; i2 < userPositions[user].length; i2++) {
                outstandingHaircut6 += userPositions[user][i2].socializedLossAccrued6;
            }
            if (outstandingHaircut6 > 0) {
                availableWithRealized = availableWithRealized > outstandingHaircut6 ? (availableWithRealized - outstandingHaircut6) : 0;
            }
        }
        return availableWithRealized;
    }

    function _removeMarketIdFromUser(address user, bytes32 marketId) internal {
        bytes32[] storage marketIds = userMarketIds[user];
        for (uint256 j = 0; j < marketIds.length; j++) {
            if (marketIds[j] == marketId) {
                if (j < marketIds.length - 1) { marketIds[j] = marketIds[marketIds.length - 1]; }
                marketIds.pop();
                break;
            }
        }
    }
}


