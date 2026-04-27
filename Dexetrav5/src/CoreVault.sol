// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./CoreVaultStorage.sol";
import "./VaultAnalytics.sol";
import "./PositionManager.sol";
import "./diamond/interfaces/IOBPricingFacet.sol";

interface IERC20Metadata {
    function decimals() external view returns (uint8);
}

interface IGlobalSessionRegistry {
    function chargeSession(
        bytes32 sessionId,
        address trader,
        uint8 methodBit,
        uint256 notional,
        address relayer,
        bytes32[] calldata relayerProof
    ) external;
}

/**
 * @title CoreVault (V2 — UUPS Upgradeable)
 * @dev Manages collateral, positions, and margin. Heavy logic delegated to
 *      LiquidationManager, VaultViewsManager, and SettlementManager.
 */
contract CoreVault is
    CoreVaultStorage,
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;
    using Address for address;

    // ============ Custom Errors ============
    error InvalidImpl();
    error LiqImplNotSet();
    error ViewsImplNotSet();
    error SettlementImplNotSet();
    error InvalidAmount();
    error InvalidAddress();
    error CollateralDecimalsMustBe6();
    error InsufficientAvailable();
    error InsufficientBalance();
    error MarketNotFound();
    error AlreadyReserved();
    error PositionNotFound();
    error UnauthorizedOrderBook();
    error SessionRegistryNotSet();

    // ============ Access Control Roles ============
    bytes32 public constant ORDERBOOK_ROLE = keccak256("ORDERBOOK_ROLE");
    bytes32 public constant SETTLEMENT_ROLE = keccak256("SETTLEMENT_ROLE");
    bytes32 public constant FACTORY_ROLE = keccak256("FACTORY_ROLE");
    bytes32 public constant EXTERNAL_CREDITOR_ROLE = keccak256("EXTERNAL_CREDITOR_ROLE");

    // ============ Constants ============
    uint256 public constant LIQUIDATION_PENALTY_BPS = 1000;
    uint256 public constant SHORT_MARGIN_REQUIREMENT_BPS = 1500;
    uint256 public constant LONG_MARGIN_REQUIREMENT_BPS = 1000;
    uint256 public constant DECIMAL_SCALE = 1e12;
    uint256 public constant TICK_PRECISION = 1e6;

    // ============ Immutable (bytecode, not storage) ============
    IERC20 internal immutable collateralToken;

    // ============ EIP-712 Constants ============
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant TOPUP_TYPEHASH =
        keccak256("TopUp(address user,bytes32 marketId,uint256 amount,uint256 nonce)");
    bytes32 private constant NAME_HASH = keccak256("CoreVault");
    bytes32 private constant VERSION_HASH = keccak256("1");

    // Session top-up method bit (bits 0-5 used by MetaTradeFacet for OB actions)
    uint8 private constant MBIT_TOPUP = 6;

    // ============ Events ============
    event CollateralDeposited(address indexed user, uint256 amount);
    event CollateralWithdrawn(address indexed user, uint256 amount);
    event ExternalCreditAdded(address indexed user, uint256 amount);
    event ExternalCreditRemoved(address indexed user, uint256 amount);
    event MarginLocked(address indexed user, bytes32 indexed marketId, uint256 amount, uint256 totalLockedAfter);
    event MarginReleased(address indexed user, bytes32 indexed marketId, uint256 amount, uint256 totalLockedAfter);
    event MarginToppedUp(address indexed user, bytes32 indexed marketId, uint256 amount);
    event MarginReserved(address indexed user, bytes32 indexed orderId, bytes32 indexed marketId, uint256 amount);
    event MarginUnreserved(address indexed user, bytes32 orderId, uint256 amount);
    event MarketAuthorized(bytes32 indexed marketId, address indexed orderBook);
    event LiquidationExecuted(address indexed user, bytes32 indexed marketId, address indexed liquidator, uint256 totalLoss, uint256 remainingCollateral);
    event MarginConfiscated(address indexed user, uint256 marginAmount, uint256 totalLoss, uint256 penalty, address indexed liquidator);
    event LiquidatorRewardPaid(address indexed liquidator, address indexed liquidatedUser, bytes32 indexed marketId, uint256 rewardAmount, uint256 liquidatorCollateral);
    event MakerLiquidationRewardPaid(address indexed maker, address indexed liquidatedUser, bytes32 indexed marketId, uint256 rewardAmount);
    event PositionUpdated(address indexed user, bytes32 indexed marketId, int256 oldSize, int256 newSize, uint256 entryPrice, uint256 marginLocked);
    event SocializedLossApplied(bytes32 indexed marketId, uint256 lossAmount, address indexed liquidatedUser);
    event UserLossSocialized(address indexed user, uint256 lossAmount, uint256 remainingCollateral);
    event AdlConfigUpdated(uint256 maxCandidates, uint256 maxPositionsPerTx, bool debugEnabled);
    event HaircutApplied(address indexed user, bytes32 indexed marketId, uint256 debitAmount, uint256 collateralAfter);
    event HaircutApplied(bytes32 indexed marketId, uint256 scaleRay, uint256 totalMarginLocked, uint256 totalLiabilities);
    event MarketDisputed(bytes32 indexed marketId, uint256 scaleRay, uint256 minScaleRay);
    event BadDebtRecorded(bytes32 indexed marketId, uint256 amount, address indexed liquidatedUser);
    event BadDebtOffset(bytes32 indexed marketId, uint256 amount, uint256 remainingBadDebt);
    event VaultMarketSettled(bytes32 indexed marketId, uint256 finalPrice, uint256 totalProfit6, uint256 totalLoss6, uint256 badDebt6);
    event DebugIsLiquidatable(
        address indexed user, bytes32 indexed marketId, int256 positionSize, uint256 markPrice,
        uint256 trigger, uint256 oneTick, uint256 notional6, int256 equity6, uint256 maintenance6,
        bool usedFallback, bool result
    );
    event SocializationStarted(bytes32 indexed marketId, uint256 totalLossAmount, address indexed liquidatedUser, uint256 timestamp);
    event ProfitablePositionFound(address indexed user, bytes32 indexed marketId, int256 positionSize, uint256 entryPrice, uint256 markPrice, uint256 unrealizedPnL, uint256 profitScore);
    event AdministrativePositionClosure(address indexed user, bytes32 indexed marketId, uint256 sizeBeforeReduction, uint256 sizeAfterReduction, uint256 realizedProfit, uint256 newEntryPrice);
    event SocializationCompleted(bytes32 indexed marketId, uint256 totalLossCovered, uint256 remainingLoss, uint256 positionsAffected, address indexed liquidatedUser);
    event SocializationFailed(bytes32 indexed marketId, uint256 lossAmount, string reason, address indexed liquidatedUser);
    event DebugProfitCalculation(address indexed user, bytes32 indexed marketId, uint256 entryPrice, uint256 markPrice, int256 positionSize, int256 unrealizedPnL, uint256 profitScore);
    event DebugPositionReduction(address indexed user, bytes32 indexed marketId, uint256 originalSize, uint256 reductionAmount, uint256 newSize, uint256 realizedPnL);
    event DebugSocializationState(bytes32 indexed marketId, uint256 remainingLoss, uint256 totalProfitableUsers, uint256 processedUsers);

    // ============ Structs ============
    struct ProfitablePosition {
        address user;
        int256 positionSize;
        uint256 entryPrice;
        uint256 unrealizedPnL;
        uint256 profitScore;
        bool isLong;
    }

    struct PositionClosureResult {
        bool success;
        uint256 realizedProfit;
        uint256 newPositionSize;
        uint256 newEntryPrice;
        string failureReason;
    }

    // ============ Constructor & Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address _collateralToken) {
        collateralToken = IERC20(_collateralToken);
        uint8 decs;
        try IERC20Metadata(_collateralToken).decimals() returns (uint8 d) { decs = d; } catch { revert CollateralDecimalsMustBe6(); }
        if (decs != 6) revert CollateralDecimalsMustBe6();
        _disableInitializers();
    }

    function initialize(address _admin) external initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);

        baseMmrBps = 1000;
        penaltyMmrBps = 1000;
        maxMmrBps = 2000;
        mmrLiquidityDepthLevels = 1;
        adlMaxCandidates = 50;
        adlMaxPositionsPerTx = 10;
        minSettlementScaleRay = 5e17;
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    // ============ Domain Separator (runtime-computed for proxy compatibility) ============

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(
            abi.encode(EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this))
        );
    }

    // ============ Delegatecall Target Management ============

    function setLiquidationManager(address _impl) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_impl == address(0)) revert InvalidImpl();
        liquidationManager = _impl;
    }

    function setViewsManager(address _impl) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_impl == address(0)) revert InvalidImpl();
        viewsManager = _impl;
    }

    function setSettlementManager(address _impl) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_impl == address(0)) revert InvalidImpl();
        settlementManager = _impl;
    }

    function setSessionRegistry(address _registry) external onlyRole(DEFAULT_ADMIN_ROLE) {
        sessionRegistry = _registry;
    }

    function setFeeRegistry(address _registry) external onlyRole(DEFAULT_ADMIN_ROLE) {
        feeRegistry = _registry;
    }

    // ============ Delegatecall Helpers ============

    function _delegateLiq(bytes memory data) internal returns (bytes memory) {
        address impl = liquidationManager;
        if (impl == address(0)) revert LiqImplNotSet();
        return impl.functionDelegateCall(data);
    }

    function _delegateSettlement(bytes memory data) internal returns (bytes memory) {
        address impl = settlementManager;
        if (impl == address(0)) revert SettlementImplNotSet();
        return impl.functionDelegateCall(data);
    }

    function _delegateView(bytes memory data) internal returns (bytes memory) {
        address impl = viewsManager;
        if (impl == address(0)) revert ViewsImplNotSet();

        bool success;
        uint256 retSize;
        assembly {
            let len := mload(data)
            success := delegatecall(gas(), impl, add(data, 0x20), len, 0, 0)
            retSize := returndatasize()
        }

        bytes memory retData = new bytes(retSize);
        assembly { returndatacopy(add(retData, 0x20), 0, retSize) }

        if (!success) {
            assembly { revert(add(retData, 0x20), retSize) }
        }
        return retData;
    }

    // ============ Collateral Management ============
    // NOTE: Direct hub deposits/withdrawals removed - all collateral flows through cross-chain (Arbitrum)

    function _consumeUserFunds(address user, uint256 amount) internal returns (uint256 fromExtCredit, uint256 fromCollateral) {
        uint256 extBal = userCrossChainCredit[user];
        uint256 fromExt = amount <= extBal ? amount : extBal;
        if (fromExt > 0) { userCrossChainCredit[user] = extBal - fromExt; }
        uint256 remaining = amount - fromExt;
        if (remaining > 0) {
            uint256 collBal = userCollateral[user];
            if (collBal < remaining) revert InsufficientBalance();
            userCollateral[user] = collBal - remaining;
        }
        return (fromExt, remaining);
    }

    function creditExternal(address user, uint256 amount) external onlyRole(EXTERNAL_CREDITOR_ROLE) {
        if (user == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        userCrossChainCredit[user] += amount;
        _ensureUserTracked(user);
        emit ExternalCreditAdded(user, amount);
    }

    function debitExternal(address user, uint256 amount) external onlyRole(EXTERNAL_CREDITOR_ROLE) {
        if (user == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        
        // First debit from positive realized PnL (converted from 18d to 6d)
        int256 realizedPnL18 = userRealizedPnL[user];
        uint256 realizedPnL6 = realizedPnL18 > 0 ? uint256(realizedPnL18 / int256(DECIMAL_SCALE)) : 0;
        uint256 fromPnL = amount <= realizedPnL6 ? amount : realizedPnL6;
        uint256 remaining = amount - fromPnL;
        
        if (fromPnL > 0) {
            userRealizedPnL[user] -= int256(fromPnL * DECIMAL_SCALE);
        }
        
        // Then debit remaining from cross-chain credit
        if (remaining > 0) {
            uint256 bal = userCrossChainCredit[user];
            if (bal < remaining) revert InsufficientBalance();
            userCrossChainCredit[user] = bal - remaining;
        }
        
        emit ExternalCreditRemoved(user, amount);
    }

    // ============ Position Management ============

    function updatePositionWithMargin(
        address user, bytes32 marketId, int256 sizeDelta, uint256 executionPrice, uint256 requiredMargin
    ) external onlyRole(ORDERBOOK_ROLE) nonReentrant {
        // Execute position netting with index mapping for O(1) operations
        PositionManager.NettingResult memory result = PositionManager.executePositionNettingWithIndex(
            userPositions[user], 
            userPositionIndex[user],
            user, 
            marketId, 
            sizeDelta, 
            executionPrice, 
            requiredMargin
        );

        // Update margin caches
        if (result.marginToLock > 0) { 
            totalMarginLocked += result.marginToLock; 
            userTotalMarginLocked[user] += result.marginToLock;
        }
        if (result.marginToRelease > 0) { 
            totalMarginLocked -= result.marginToRelease; 
            if (userTotalMarginLocked[user] >= result.marginToRelease) {
                userTotalMarginLocked[user] -= result.marginToRelease;
            } else {
                userTotalMarginLocked[user] = 0;
            }
        }

        if (result.haircutToConfiscate6 > 0) {
            uint256 haircutTotal6 = result.haircutToConfiscate6;
            uint256 ledger = userSocializedLoss[user];
            if (ledger > 0) {
                userSocializedLoss[user] = haircutTotal6 >= ledger ? 0 : (ledger - haircutTotal6);
            }
            uint256 realizedProfit6 = result.realizedPnL > 0 ? uint256(result.realizedPnL) / DECIMAL_SCALE : 0;
            uint256 appliedFromProfit6 = haircutTotal6 <= realizedProfit6 ? haircutTotal6 : realizedProfit6;
            if (appliedFromProfit6 > 0) {
                int256 applied18 = int256(appliedFromProfit6) * int256(DECIMAL_SCALE);
                if (result.realizedPnL > 0 && applied18 <= result.realizedPnL) {
                    result.realizedPnL = result.realizedPnL - applied18;
                } else if (result.realizedPnL > 0) {
                    result.realizedPnL = 0;
                }
                emit HaircutApplied(user, marketId, appliedFromProfit6, userCollateral[user]);
            }
        }

        if (result.realizedPnL != 0) {
            userRealizedPnL[user] += result.realizedPnL;
            if (result.realizedPnL < 0) {
                int256 loss6Signed = result.realizedPnL / int256(DECIMAL_SCALE);
                uint256 loss6 = uint256(-loss6Signed);
                if (loss6 > 0) {
                    uint256 extBal = userCrossChainCredit[user];
                    uint256 useExt = loss6 <= extBal ? loss6 : extBal;
                    if (useExt > 0) { userCrossChainCredit[user] = extBal - useExt; }
                    uint256 remaining = loss6 - useExt;
                    if (remaining > 0) {
                        uint256 collBal = userCollateral[user];
                        if (collBal >= remaining) {
                            userCollateral[user] = collBal - remaining;
                        } else {
                            userCollateral[user] = 0;
                            marketBadDebt[marketId] += remaining - collBal;
                            emit BadDebtRecorded(marketId, remaining - collBal, user);
                        }
                    }
                }
            }
        }

        if (result.positionClosed) {
            // O(1) market ID removal
            PositionManager.removeMarketIdFromUserWithIndex(userMarketIds[user], userMarketIdIndex[user], marketId);
            // O(1) remove from per-market tracking
            _removeUserFromMarketPositions(user, marketId);
        } else if (!result.positionExists) {
            // O(1) market ID addition
            PositionManager.addMarketIdToUserWithIndex(userMarketIds[user], userMarketIdIndex[user], marketId);
            // O(1) add to per-market tracking
            _addUserToMarketPositions(user, marketId);
        }

        _recomputeAndStoreLiquidationPrice(user, marketId);
    }

    function updatePositionWithLiquidation(
        address user, bytes32 marketId, int256 sizeDelta, uint256 executionPrice, address liquidator
    ) external onlyRole(ORDERBOOK_ROLE) nonReentrant {
        _delegateLiq(abi.encodeWithSelector(this.updatePositionWithLiquidation.selector, user, marketId, sizeDelta, executionPrice, liquidator));
    }

    function _calculateExecutionMargin(int256 amount, uint256 executionPrice) internal pure returns (uint256) {
        uint256 absAmount = uint256(amount >= 0 ? amount : -amount);
        uint256 notionalValue = (absAmount * executionPrice) / (10**18);
        uint256 marginBps = amount >= 0 ? 10000 : 15000;
        return (notionalValue * marginBps) / 10000;
    }

    // ============ View Function Wrappers (delegated to VaultViewsManager) ============

    function getUnifiedMarginSummary(address user) external returns (
        uint256, uint256, uint256, uint256, int256, int256, uint256, bool
    ) {
        bytes memory ret = _delegateView(abi.encodeWithSelector(this.getUnifiedMarginSummary.selector, user));
        return abi.decode(ret, (uint256, uint256, uint256, uint256, int256, int256, uint256, bool));
    }

    function getMarginUtilization(address user) external returns (uint256) {
        bytes memory ret = _delegateView(abi.encodeWithSelector(this.getMarginUtilization.selector, user));
        return abi.decode(ret, (uint256));
    }

    function getMarginSummary(address user) external returns (VaultAnalytics.MarginSummary memory) {
        bytes memory ret = _delegateView(abi.encodeWithSelector(this.getMarginSummary.selector, user));
        return abi.decode(ret, (VaultAnalytics.MarginSummary));
    }

    function getCollateralBreakdown(address user) external returns (uint256, uint256, uint256, uint256) {
        bytes memory ret = _delegateView(abi.encodeWithSelector(this.getCollateralBreakdown.selector, user));
        return abi.decode(ret, (uint256, uint256, uint256, uint256));
    }

    function getAvailableCollateral(address user) public returns (uint256) {
        bytes memory ret = _delegateView(abi.encodeWithSelector(this.getAvailableCollateral.selector, user));
        return abi.decode(ret, (uint256));
    }

    function getTotalMarginUsed(address user) public returns (uint256) {
        bytes memory ret = _delegateView(abi.encodeWithSelector(this.getTotalMarginUsed.selector, user));
        return abi.decode(ret, (uint256));
    }

    function getTotalMarginLockedInMarket(bytes32 marketId) external returns (uint256) {
        bytes memory ret = _delegateView(abi.encodeWithSelector(this.getTotalMarginLockedInMarket.selector, marketId));
        return abi.decode(ret, (uint256));
    }

    function getUserPositions(address user) external view returns (PositionManager.Position[] memory) {
        return userPositions[user];
    }

    function getMarkPrice(bytes32 marketId) public view returns (uint256) {
        return marketMarkPrices[marketId];
    }

    function getPositionSummary(address user, bytes32 marketId) external returns (int256, uint256, uint256) {
        bytes memory ret = _delegateView(abi.encodeWithSelector(this.getPositionSummary.selector, user, marketId));
        return abi.decode(ret, (int256, uint256, uint256));
    }

    function getLiquidationPrice(address user, bytes32 marketId) external returns (uint256, bool) {
        bytes memory ret = _delegateView(abi.encodeWithSelector(this.getLiquidationPrice.selector, user, marketId));
        return abi.decode(ret, (uint256, bool));
    }

    function getPositionEquity(address user, bytes32 marketId) external returns (int256, uint256, bool) {
        bytes memory ret = _delegateView(abi.encodeWithSelector(this.getPositionEquity.selector, user, marketId));
        return abi.decode(ret, (int256, uint256, bool));
    }

    function getPositionFreeMargin(address user, bytes32 marketId) external returns (uint256, uint256, bool) {
        bytes memory ret = _delegateView(abi.encodeWithSelector(this.getPositionFreeMargin.selector, user, marketId));
        return abi.decode(ret, (uint256, uint256, bool));
    }

    function getEffectiveMaintenanceMarginBps(address user, bytes32 marketId) external returns (uint256, uint256, bool) {
        bytes memory ret = _delegateView(abi.encodeWithSelector(this.getEffectiveMaintenanceMarginBps.selector, user, marketId));
        return abi.decode(ret, (uint256, uint256, bool));
    }

    function getEffectiveMaintenanceDetails(address user, bytes32 marketId) external returns (uint256, uint256, uint256, bool) {
        bytes memory ret = _delegateView(abi.encodeWithSelector(this.getEffectiveMaintenanceDetails.selector, user, marketId));
        return abi.decode(ret, (uint256, uint256, uint256, bool));
    }

    function maintenanceMarginBps(bytes32 marketId) external returns (uint256) {
        bytes memory ret = _delegateView(abi.encodeWithSelector(this.maintenanceMarginBps.selector, marketId));
        return abi.decode(ret, (uint256));
    }

    function getUsersWithPositionsInMarket(bytes32 marketId) external returns (address[] memory) {
        bytes memory ret = _delegateView(abi.encodeWithSelector(this.getUsersWithPositionsInMarket.selector, marketId));
        return abi.decode(ret, (address[]));
    }

    function _getWithdrawableCollateral(address user) internal returns (uint256) {
        bytes memory ret = _delegateView(
            abi.encodeWithSelector(this.getWithdrawableCollateral.selector, user)
        );
        return abi.decode(ret, (uint256));
    }

    function getWithdrawableCollateral(address user) external returns (uint256) {
        return _getWithdrawableCollateral(user);
    }

    // ============ Market Authorization ============

    function authorizeMarket(bytes32 marketId, address orderBook) external onlyRole(FACTORY_ROLE) {
        if (orderBook == address(0)) revert InvalidAddress();
        if (marketToOrderBook[marketId] != address(0)) revert AlreadyReserved();
        marketToOrderBook[marketId] = orderBook;
        if (!registeredOrderBooks[orderBook]) {
            registeredOrderBooks[orderBook] = true;
            allOrderBooks.push(orderBook);
        }
        orderBookToMarkets[orderBook].push(marketId);
        emit MarketAuthorized(marketId, orderBook);
    }

    // ============ Admin Functions ============

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ============ Factory Interface Methods ============

    function deductFees(address user, uint256 amount, address recipient) external {
        require(hasRole(FACTORY_ROLE, msg.sender) || hasRole(ORDERBOOK_ROLE, msg.sender), "unauthorized");
        require(amount > 0, "!amount");

        int256 realizedPnL18 = userRealizedPnL[user];
        uint256 realizedPnL6 = realizedPnL18 > 0 ? uint256(realizedPnL18 / int256(DECIMAL_SCALE)) : 0;
        uint256 fromPnL = amount <= realizedPnL6 ? amount : realizedPnL6;
        uint256 remainingAfterPnL = amount - fromPnL;

        if (fromPnL > 0) { userRealizedPnL[user] -= int256(fromPnL * DECIMAL_SCALE); }

        uint256 creditPart = 0;
        uint256 collateralPart = 0;
        if (remainingAfterPnL > 0) {
            (creditPart, collateralPart) = _consumeUserFunds(user, remainingAfterPnL);
        }

        if (creditPart > 0) { userCrossChainCredit[recipient] += creditPart; }
        userCollateral[recipient] += fromPnL + collateralPart;
        if (recipient != address(0)) { _ensureUserTracked(recipient); }
    }

    function transferCollateral(address from, address to, uint256 amount) external onlyRole(ORDERBOOK_ROLE) {
        require(userCollateral[from] >= amount, "!balance");
        userCollateral[from] -= amount;
        userCollateral[to] += amount;
        if (to != address(0)) { _ensureUserTracked(to); }
    }

    function payMakerLiquidationReward(
        address liquidatedUser, bytes32 marketId, address maker, uint256 amount
    ) external onlyRole(ORDERBOOK_ROLE) {
        if (maker == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        address ob = marketToOrderBook[marketId];
        if (ob == address(0) || ob != msg.sender) revert UnauthorizedOrderBook();
        uint256 extBal = userCrossChainCredit[ob];
        uint256 fromExt = amount <= extBal ? amount : extBal;
        if (fromExt > 0) { userCrossChainCredit[ob] = extBal - fromExt; }
        uint256 remaining = amount - fromExt;
        if (remaining > 0) {
            if (userCollateral[ob] < remaining) revert InsufficientBalance();
            userCollateral[ob] -= remaining;
        }
        if (fromExt > 0) { userCrossChainCredit[maker] += fromExt; }
        if (remaining > 0) { userCollateral[maker] += remaining; }
        _ensureUserTracked(maker);
        emit MakerLiquidationRewardPaid(maker, liquidatedUser, marketId, amount);
    }

    // ============ Margin Management ============

    function lockMargin(address user, bytes32 marketId, uint256 amount) external onlyRole(ORDERBOOK_ROLE) {
        if (user == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (marketToOrderBook[marketId] == address(0)) revert MarketNotFound();
        uint256 avail = getAvailableCollateral(user);
        if (avail < amount) revert InsufficientAvailable();
        _increasePositionMargin(user, marketId, amount);
    }

    function releaseMargin(address user, bytes32 marketId, uint256 amount) external onlyRole(ORDERBOOK_ROLE) {
        if (user == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        
        // O(1) position lookup
        uint256 indexPlusOne = userPositionIndex[user][marketId];
        if (indexPlusOne == 0) revert PositionNotFound();
        
        uint256 index = indexPlusOne - 1;
        PositionManager.Position storage position = userPositions[user][index];
        
        if (position.marginLocked < amount) revert InsufficientBalance();
        position.marginLocked -= amount;
        
        // Update caches
        if (userTotalMarginLocked[user] >= amount) {
            userTotalMarginLocked[user] -= amount;
        }
        if (totalMarginLocked >= amount) { totalMarginLocked -= amount; }
        
        emit MarginReleased(user, marketId, amount, position.marginLocked);
        _recomputeAndStoreLiquidationPrice(user, marketId);
    }

    // ============ User Top-Up Interface ============

    function topUpPositionMargin(bytes32 marketId, uint256 amount) external nonReentrant whenNotPaused {
        _topUp(msg.sender, marketId, amount);
    }

    function metaTopUpPositionMargin(
        address user, bytes32 marketId, uint256 amount, uint8 v, bytes32 r, bytes32 s
    ) external nonReentrant whenNotPaused {
        uint256 nonce = topUpNonces[user];
        bytes32 structHash = keccak256(abi.encode(TOPUP_TYPEHASH, user, marketId, amount, nonce));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
        address signer = ecrecover(digest, v, r, s);
        if (signer != user) revert InvalidAddress();
        topUpNonces[user] = nonce + 1;
        _topUp(user, marketId, amount);
    }

    function sessionTopUpPositionMargin(
        bytes32 sessionId, address user, bytes32 marketId, uint256 amount,
        address relayer, bytes32[] calldata relayerProof
    ) external nonReentrant whenNotPaused {
        address reg = sessionRegistry;
        if (reg == address(0)) revert SessionRegistryNotSet();
        IGlobalSessionRegistry(reg).chargeSession(sessionId, user, MBIT_TOPUP, amount, relayer, relayerProof);
        _topUp(user, marketId, amount);
    }

    function _topUp(address user, bytes32 marketId, uint256 amount) internal {
        if (amount == 0) revert InvalidAmount();
        if (marketToOrderBook[marketId] == address(0)) revert MarketNotFound();
        uint256 available = getAvailableCollateral(user);
        if (available < amount) revert InsufficientAvailable();
        _increasePositionMargin(user, marketId, amount);
        emit MarginToppedUp(user, marketId, amount);
    }

    function _increasePositionMargin(address user, bytes32 marketId, uint256 amount) internal {
        // O(1) position lookup
        uint256 indexPlusOne = userPositionIndex[user][marketId];
        if (indexPlusOne == 0) revert PositionNotFound();
        
        uint256 index = indexPlusOne - 1;
        if (userPositions[user][index].size == 0) revert PositionNotFound();
        
        userPositions[user][index].marginLocked += amount;
        
        // Update caches
        userTotalMarginLocked[user] += amount;
        totalMarginLocked += amount;
        
        emit MarginLocked(user, marketId, amount, userPositions[user][index].marginLocked);
        _recomputeAndStoreLiquidationPrice(user, marketId);
    }

    // ============ Margin Reservation (Order Book compat) ============

    function reserveMargin(address user, bytes32 orderId, bytes32 marketId, uint256 amount) external onlyRole(ORDERBOOK_ROLE) {
        if (user == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (marketToOrderBook[marketId] == address(0)) revert MarketNotFound();
        
        // O(1) available check using cached values
        uint256 available = _getAvailableCollateralCached(user);
        if (available < amount) revert InsufficientAvailable();
        
        // O(1) duplicate check
        if (userPendingOrderIndex[user][orderId] != 0) revert AlreadyReserved();
        
        // Add to array and index
        VaultAnalytics.PendingOrder[] storage orders = userPendingOrders[user];
        orders.push(VaultAnalytics.PendingOrder({ orderId: orderId, marginReserved: amount, timestamp: block.timestamp }));
        userPendingOrderIndex[user][orderId] = orders.length;  // index + 1
        
        // Update cached total
        userTotalMarginReserved[user] += amount;
        
        emit MarginReserved(user, orderId, marketId, amount);
    }

    function unreserveMargin(address user, bytes32 orderId) external onlyRole(ORDERBOOK_ROLE) {
        if (user == address(0)) revert InvalidAddress();
        
        // O(1) lookup
        uint256 indexPlusOne = userPendingOrderIndex[user][orderId];
        if (indexPlusOne == 0) return;  // Not found, silent return for idempotency
        
        VaultAnalytics.PendingOrder[] storage orders = userPendingOrders[user];
        uint256 index = indexPlusOne - 1;
        uint256 reserved = orders[index].marginReserved;
        
        // Swap-and-pop removal (O(1))
        uint256 lastIndex = orders.length - 1;
        if (index != lastIndex) {
            VaultAnalytics.PendingOrder storage lastOrder = orders[lastIndex];
            orders[index] = lastOrder;
            userPendingOrderIndex[user][lastOrder.orderId] = indexPlusOne;
        }
        orders.pop();
        userPendingOrderIndex[user][orderId] = 0;
        
        // Update cached total
        if (userTotalMarginReserved[user] >= reserved) {
            userTotalMarginReserved[user] -= reserved;
        } else {
            userTotalMarginReserved[user] = 0;
        }
        
        emit MarginUnreserved(user, orderId, reserved);
    }

    function releaseExcessMargin(address user, bytes32 orderId, uint256 newTotalReservedForOrder) external onlyRole(ORDERBOOK_ROLE) {
        // O(1) lookup
        uint256 indexPlusOne = userPendingOrderIndex[user][orderId];
        if (indexPlusOne == 0) return;  // Not found, silent return
        
        VaultAnalytics.PendingOrder[] storage orders = userPendingOrders[user];
        uint256 index = indexPlusOne - 1;
        uint256 current = orders[index].marginReserved;
        
        if (newTotalReservedForOrder < current) {
            uint256 released = current - newTotalReservedForOrder;
            orders[index].marginReserved = newTotalReservedForOrder;
            
            // Update cached total
            if (userTotalMarginReserved[user] >= released) {
                userTotalMarginReserved[user] -= released;
            }
            
            emit MarginReleased(user, bytes32(0), released, newTotalReservedForOrder);
        } else if (newTotalReservedForOrder > current) {
            uint256 increase = newTotalReservedForOrder - current;
            uint256 available = _getAvailableCollateralCached(user);
            if (available < increase) revert InsufficientAvailable();
            
            orders[index].marginReserved = newTotalReservedForOrder;
            userTotalMarginReserved[user] += increase;
        }
    }

    // ============ OrderBook & Market Registry ============

    function registerOrderBook(address orderBook) external onlyRole(FACTORY_ROLE) {
        if (registeredOrderBooks[orderBook]) revert AlreadyReserved();
        registeredOrderBooks[orderBook] = true;
        allOrderBooks.push(orderBook);
    }

    function assignMarketToOrderBook(bytes32 marketId, address orderBook) external onlyRole(FACTORY_ROLE) {
        if (!registeredOrderBooks[orderBook]) revert UnauthorizedOrderBook();
        marketToOrderBook[marketId] = orderBook;
        orderBookToMarkets[orderBook].push(marketId);
        emit MarketAuthorized(marketId, orderBook);
    }

    function updateMarkPrice(bytes32 marketId, uint256 price) external onlyRole(SETTLEMENT_ROLE) {
        marketMarkPrices[marketId] = price;
    }

    function deregisterOrderBook(address orderBook) external onlyRole(FACTORY_ROLE) {
        require(registeredOrderBooks[orderBook], "!exists");
        registeredOrderBooks[orderBook] = false;
        for (uint256 i = 0; i < allOrderBooks.length; i++) {
            if (allOrderBooks[i] == orderBook) {
                if (i < allOrderBooks.length - 1) { allOrderBooks[i] = allOrderBooks[allOrderBooks.length - 1]; }
                allOrderBooks.pop();
                break;
            }
        }
    }

    // ============ Settlement (delegated to SettlementManager) ============

    function settleMarket(bytes32 marketId, uint256 finalPrice) external nonReentrant {
        _delegateSettlement(abi.encodeWithSelector(this.settleMarket.selector, marketId, finalPrice));
    }

    // ============ Batch Settlement (for large markets) ============

    function initBatchSettlement(bytes32 marketId, uint256 finalPrice) external nonReentrant {
        _delegateSettlement(abi.encodeWithSelector(bytes4(keccak256("initBatchSettlement(bytes32,uint256)")), marketId, finalPrice));
    }

    function batchCalculateTotals(bytes32 marketId, uint256 batchSize) external nonReentrant returns (bool) {
        bytes memory ret = _delegateSettlement(abi.encodeWithSelector(bytes4(keccak256("batchCalculateTotals(bytes32,uint256)")), marketId, batchSize));
        return abi.decode(ret, (bool));
    }

    function finalizeHaircutCalculation(bytes32 marketId) external nonReentrant {
        _delegateSettlement(abi.encodeWithSelector(bytes4(keccak256("finalizeHaircutCalculation(bytes32)")), marketId));
    }

    function batchApplySettlements(bytes32 marketId, uint256 batchSize) external nonReentrant returns (bool) {
        bytes memory ret = _delegateSettlement(abi.encodeWithSelector(bytes4(keccak256("batchApplySettlements(bytes32,uint256)")), marketId, batchSize));
        return abi.decode(ret, (bool));
    }

    function finalizeBatchSettlement(bytes32 marketId) external nonReentrant {
        _delegateSettlement(abi.encodeWithSelector(bytes4(keccak256("finalizeBatchSettlement(bytes32)")), marketId));
    }

    function getBatchSettlementState(bytes32 marketId) external returns (uint8, uint256, uint256, uint256) {
        bytes memory ret = _delegateSettlement(abi.encodeWithSelector(bytes4(keccak256("getBatchSettlementState(bytes32)")), marketId));
        return abi.decode(ret, (uint8, uint256, uint256, uint256));
    }

    function isMarketSettling(bytes32 marketId) external returns (bool) {
        bytes memory ret = _delegateSettlement(abi.encodeWithSelector(bytes4(keccak256("isMarketSettling(bytes32)")), marketId));
        return abi.decode(ret, (bool));
    }

    // ============ Liquidation Under-Control Flag ============

    function setUnderLiquidation(address user, bytes32 marketId, bool state) external onlyRole(ORDERBOOK_ROLE) {
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

    // ============ ADL Configuration ============

    function setAdlConfig(uint256 maxCandidates, uint256 maxPositionsPerTx, bool debugEnabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(maxCandidates > 0 && maxCandidates <= 500, "!cands");
        require(maxPositionsPerTx > 0 && maxPositionsPerTx <= 100, "!pos");
        adlMaxCandidates = maxCandidates;
        adlMaxPositionsPerTx = maxPositionsPerTx;
        adlDebug = debugEnabled;
        emit AdlConfigUpdated(maxCandidates, maxPositionsPerTx, debugEnabled);
    }

    function setMinSettlementScaleRay(uint256 newMinScaleRay) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newMinScaleRay > 0 && newMinScaleRay <= 1e18, "!scale");
        minSettlementScaleRay = newMinScaleRay;
    }

    function setMmrParams(
        uint256 _baseMmrBps, uint256 _penaltyMmrBps, uint256 _maxMmrBps,
        uint256 _scalingSlopeBps, uint256 _liquidityDepthLevels
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
        uint256 _baseMmrBps, uint256 _penaltyMmrBps, uint256 _maxMmrBps,
        uint256 _scalingSlopeBps, uint256 _liquidityDepthLevels, uint256 _priceGapSlopeBps
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

    // ============ Liquidation Interface (delegated to LiquidationManager) ============

    function isLiquidatable(address user, bytes32 marketId, uint256 markPrice) external returns (bool) {
        bytes memory ret = _delegateLiq(abi.encodeWithSelector(this.isLiquidatable.selector, user, marketId, markPrice));
        return abi.decode(ret, (bool));
    }

    function debugEmitIsLiquidatable(address user, bytes32 marketId, uint256 markPrice) external onlyRole(ORDERBOOK_ROLE) {
        _delegateLiq(abi.encodeWithSelector(this.debugEmitIsLiquidatable.selector, user, marketId, markPrice));
    }

    function liquidateShort(address user, bytes32 marketId, address liquidator, uint256 executionPrice) external onlyRole(ORDERBOOK_ROLE) nonReentrant {
        _delegateLiq(abi.encodeWithSelector(this.liquidateShort.selector, user, marketId, liquidator, executionPrice));
    }

    function liquidateLong(address user, bytes32 marketId, address liquidator, uint256 executionPrice) external onlyRole(ORDERBOOK_ROLE) nonReentrant {
        _delegateLiq(abi.encodeWithSelector(this.liquidateLong.selector, user, marketId, liquidator, executionPrice));
    }

    function socializeLoss(bytes32 marketId, uint256 lossAmount, address liquidatedUser) external onlyRole(ORDERBOOK_ROLE) {
        _delegateLiq(abi.encodeWithSelector(this.socializeLoss.selector, marketId, lossAmount, liquidatedUser));
    }

    function liquidateDirect(bytes32 marketId, address trader) external {
        _delegateLiq(abi.encodeWithSelector(this.liquidateDirect.selector, marketId, trader));
    }

    function batchLiquidate(bytes32[] calldata marketIds, address[] calldata traders) external {
        _delegateLiq(abi.encodeWithSelector(this.batchLiquidate.selector, marketIds, traders));
    }

    // ============ Internal: Liquidation Price ============

    function _recomputeAndStoreLiquidationPrice(address user, bytes32 marketId) internal {
        // O(1) position lookup
        uint256 indexPlusOne = userPositionIndex[user][marketId];
        if (indexPlusOne == 0) return;  // No position
        
        PositionManager.Position storage position = userPositions[user][indexPlusOne - 1];
        if (position.size == 0) return;
        
        (uint256 mmrBps, ) = _computeEffectiveMMRBps(user, marketId, position.size);
        uint256 mark = getMarkPrice(marketId);
        if (mark == 0) { mark = position.entryPrice; }
        uint256 absSize = uint256(position.size >= 0 ? position.size : -position.size);
        if (absSize == 0) { position.liquidationPrice = 0; return; }
        if (position.size > 0) {
            position.liquidationPrice = 0;
        } else {
            uint256 marginPerUnit6 = Math.mulDiv(position.marginLocked, 1e18, absSize);
            uint256 numerator = position.entryPrice + marginPerUnit6;
            uint256 denomBps = 10000 + mmrBps;
            position.liquidationPrice = Math.mulDiv(numerator, 10000, denomBps);
        }
    }

    function _computeEffectiveMMRMetrics(address, bytes32 marketId, int256 positionSize)
        internal view returns (uint256 mmrBps, uint256 fillRatio1e18, uint256 gapRatio1e18)
    {
        marketId; positionSize;
        uint256 mmr = baseMmrBps + penaltyMmrBps;
        if (mmr > maxMmrBps) mmr = maxMmrBps;
        return (mmr, 0, 0);
    }

    function _computeEffectiveMMRBps(address user, bytes32 marketId, int256 positionSize)
        internal view returns (uint256 mmrBps, uint256 fillRatio1e18)
    {
        (uint256 m, uint256 f, ) = _computeEffectiveMMRMetrics(user, marketId, positionSize);
        return (m, f);
    }

    // ============ Internal Helpers ============

    /// @dev O(1) available collateral using cached totals
    function _getAvailableCollateralCached(address user) internal view returns (uint256) {
        uint256 total = userCollateral[user] + userCrossChainCredit[user];
        
        // Add positive realized PnL
        int256 realizedPnL = userRealizedPnL[user];
        if (realizedPnL > 0) {
            total += uint256(realizedPnL) / DECIMAL_SCALE;
        }
        
        // Subtract committed margin using cached totals (O(1))
        uint256 committed = userTotalMarginLocked[user] + userTotalMarginReserved[user];
        
        return total > committed ? total - committed : 0;
    }

    function _ensureUserTracked(address user) internal {
        if (!isKnownUser[user]) {
            allKnownUsers.push(user);
            isKnownUser[user] = true;
        }
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

    /// @dev Add user to per-market position tracking (O(1))
    function _addUserToMarketPositions(address user, bytes32 marketId) internal {
        if (marketPositionUserIndex[marketId][user] == 0) {
            marketPositionUsers[marketId].push(user);
            marketPositionUserIndex[marketId][user] = marketPositionUsers[marketId].length;
        }
    }

    /// @dev Remove user from per-market position tracking (O(1))
    function _removeUserFromMarketPositions(address user, bytes32 marketId) internal {
        uint256 idx = marketPositionUserIndex[marketId][user];
        if (idx != 0) {
            uint256 lastIdx = marketPositionUsers[marketId].length;
            if (idx != lastIdx) {
                address lastUser = marketPositionUsers[marketId][lastIdx - 1];
                marketPositionUsers[marketId][idx - 1] = lastUser;
                marketPositionUserIndex[marketId][lastUser] = idx;
            }
            marketPositionUsers[marketId].pop();
            marketPositionUserIndex[marketId][user] = 0;
        }
    }

    /// @dev Get count of users with positions in a market
    function getMarketPositionUserCount(bytes32 marketId) external view returns (uint256) {
        return marketPositionUsers[marketId].length;
    }

    /**
     * @notice Backfill marketPositionUsers for existing positions (admin only)
     * @dev Call this for each market after upgrading to populate the per-market tracking.
     *      Can be called in batches if there are many users.
     * @param marketId The market to backfill
     * @param users Array of users to add to the market's position tracking
     */
    function backfillMarketPositionUsers(
        bytes32 marketId, 
        address[] calldata users
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        for (uint256 i = 0; i < users.length; i++) {
            address user = users[i];
            // Only add if not already tracked and user actually has a position
            if (marketPositionUserIndex[marketId][user] == 0) {
                // Verify user has a position in this market
                uint256 posIdx = userPositionIndex[user][marketId];
                if (posIdx != 0 && userPositions[user][posIdx - 1].size != 0) {
                    marketPositionUsers[marketId].push(user);
                    marketPositionUserIndex[marketId][user] = marketPositionUsers[marketId].length;
                }
            }
        }
    }
}
