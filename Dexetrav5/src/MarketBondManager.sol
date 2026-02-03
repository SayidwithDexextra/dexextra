// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @notice Holds “market creation bonds” and enforces safe market deactivation.
 *
 * Design goals:
 * - Keep FuturesMarketFactory bytecode growth minimal by pushing logic here.
 * - Use CoreVault's internal accounting (via `deductFees`) to move value into/out of this contract.
 * - Enforce a conservative "unused market" rule for creator deactivation:
 *   - no trades
 *   - no active (open) orders
 *   - no margin locked (no open positions)
 *
 * IMPORTANT:
 * - This contract must be granted `FACTORY_ROLE` on CoreVault so it can call `deductFees`.
 * - FuturesMarketFactory must be configured to call this contract.
 */

interface ICoreVaultBondLedger {
    function deductFees(address user, uint256 amount, address recipient) external;
    function getAvailableCollateral(address user) external view returns (uint256);
}

interface IOBViewFacetForBond {
    function marketStatic() external view returns (address vault, bytes32 marketId, bool useVWAP, uint256 vwapWindow);
    function getActiveOrdersCount() external view returns (uint256 buyCount, uint256 sellCount);
    function totalMarginLockedInMarket() external view returns (uint256 totalLocked6);
}

interface IOBTradeStatsFacetForBond {
    function getTradeStatistics() external view returns (uint256 totalTrades, uint256 totalVolume, uint256 totalFees);
}

contract MarketBondManager {
    // ============ Errors ============
    error OnlyOwner();
    error OnlyFactory();
    error InvalidAddress();
    error InvalidBondAmount();
    error BondNotConfigured();
    error BondAlreadyRecorded();
    error BondNotFound();
    error NotCreatorOrOwner();
    error MarketMismatch();
    error MarketHasActivity();
    error BondAlreadyRefunded();
    error InsufficientAvailable();
    error InvalidPenaltyBps();

    // ============ Events ============
    event OwnerUpdated(address indexed oldOwner, address indexed newOwner);
    event DefaultBondUpdated(uint256 defaultBondAmount, uint256 minBondAmount, uint256 maxBondAmount);
    event PenaltyConfigUpdated(uint256 penaltyBps, address indexed recipient);
    event BondPenaltyCollected(bytes32 indexed marketId, address indexed recipient, uint256 feeAmount);
    event BondPosted(bytes32 indexed marketId, address indexed creator, uint256 amount);
    event BondRefunded(bytes32 indexed marketId, address indexed creator, uint256 amount);

    // ============ Storage ============
    ICoreVaultBondLedger public immutable vault;
    address public immutable factory;
    address public owner;

    uint256 public defaultBondAmount; // 6 decimals (USDC precision in CoreVault)
    uint256 public minBondAmount;     // inclusive
    uint256 public maxBondAmount;     // inclusive (0 = no max)
    // Penalty charged at market creation, applied against the bond principal.
    // Example: 200 bps (2%) ⇒ bond=100 ⇒ fee=2 ⇒ refundable=98.
    uint16 public creationPenaltyBps; // 0..10000
    address public penaltyRecipient;

    struct BondInfo {
        address creator;
        uint96 amount;   // up to ~7.9e28, plenty for 6-decimals USDC amounts
        bool refunded;
    }

    mapping(bytes32 => BondInfo) public bondByMarket;

    constructor(
        address _vault,
        address _factory,
        address _owner,
        uint256 _defaultBondAmount,
        uint256 _minBondAmount,
        uint256 _maxBondAmount
    ) {
        if (_vault == address(0) || _factory == address(0) || _owner == address(0)) revert InvalidAddress();
        vault = ICoreVaultBondLedger(_vault);
        factory = _factory;
        owner = _owner;
        defaultBondAmount = _defaultBondAmount;
        minBondAmount = _minBondAmount;
        maxBondAmount = _maxBondAmount;
        // Default: penalties (if enabled) go to the owner/treasury.
        penaltyRecipient = _owner;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier onlyFactory() {
        if (msg.sender != factory) revert OnlyFactory();
        _;
    }

    // ============ Admin ============
    function setOwner(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        address old = owner;
        owner = newOwner;
        emit OwnerUpdated(old, newOwner);
    }

    function setBondConfig(uint256 _defaultBondAmount, uint256 _minBondAmount, uint256 _maxBondAmount) external onlyOwner {
        defaultBondAmount = _defaultBondAmount;
        minBondAmount = _minBondAmount;
        maxBondAmount = _maxBondAmount;
        emit DefaultBondUpdated(_defaultBondAmount, _minBondAmount, _maxBondAmount);
    }

    function setPenaltyConfig(uint256 penaltyBps, address recipient) external onlyOwner {
        if (penaltyBps > 10_000) revert InvalidPenaltyBps();
        if (penaltyBps != 0 && recipient == address(0)) revert InvalidAddress();
        creationPenaltyBps = uint16(penaltyBps);
        penaltyRecipient = recipient;
        emit PenaltyConfigUpdated(penaltyBps, recipient);
    }

    // ============ Factory Hooks ============
    /**
     * @dev Called by FuturesMarketFactory AFTER marketId is computed (and collision-checked),
     *      and BEFORE deploying/registering the new OrderBook.
     *
     * Pulls bond value from `creator` (via CoreVault accounting) into this contract's CoreVault balance.
     */
    function onMarketCreate(bytes32 marketId, address creator) external onlyFactory {
        if (creator == address(0)) revert InvalidAddress();
        BondInfo storage b = bondByMarket[marketId];
        if (b.creator != address(0)) revert BondAlreadyRecorded();

        uint256 amount = defaultBondAmount; // gross bond

        if (amount == 0) revert BondNotConfigured();
        if (amount < minBondAmount) revert InvalidBondAmount();
        if (maxBondAmount != 0 && amount > maxBondAmount) revert InvalidBondAmount();

        // Ensure bond consumes only *available* trading balance:
        // (collateral + ext credit + realized PnL) - (locked margin + reserved margin + haircuts)
        if (vault.getAvailableCollateral(creator) < amount) revert InsufficientAvailable();

        // Move gross bond value from creator -> this contract using CoreVault ledger accounting.
        vault.deductFees(creator, amount, address(this));

        // Apply creation penalty immediately and only keep the refundable remainder.
        uint256 fee = (amount * uint256(creationPenaltyBps)) / 10_000;
        uint256 refundable = amount - fee;
        if (fee != 0) {
            address recipient = penaltyRecipient;
            if (recipient == address(0)) revert InvalidAddress();
            vault.deductFees(address(this), fee, recipient);
            emit BondPenaltyCollected(marketId, recipient, fee);
        }

        bondByMarket[marketId] = BondInfo({creator: creator, amount: uint96(refundable), refunded: false});
        emit BondPosted(marketId, creator, amount);
    }

    /**
     * @dev Called by FuturesMarketFactory BEFORE it de-registers and untracks a market.
     *
     * Enforces a conservative "unused market" rule (no trades, no open orders, no margin locked)
     * then refunds the bond back to the original creator.
     */
    function onMarketDeactivate(bytes32 marketId, address orderBook, address caller) external onlyFactory {
        BondInfo storage b = bondByMarket[marketId];
        if (b.creator == address(0)) revert BondNotFound();
        if (b.refunded) revert BondAlreadyRefunded();

        // Allow creator, or manager owner (admin override)
        if (!(caller == b.creator || caller == owner)) revert NotCreatorOrOwner();

        // Verify the orderbook actually corresponds to this marketId
        (, bytes32 obMarketId,,) = IOBViewFacetForBond(orderBook).marketStatic();
        if (obMarketId != marketId) revert MarketMismatch();

        // Enforce "unused market" condition
        (uint256 totalTrades,,) = IOBTradeStatsFacetForBond(orderBook).getTradeStatistics();
        (uint256 buyLevels, uint256 sellLevels) = IOBViewFacetForBond(orderBook).getActiveOrdersCount();
        uint256 totalLocked6 = IOBViewFacetForBond(orderBook).totalMarginLockedInMarket();
        if (totalTrades != 0 || buyLevels != 0 || sellLevels != 0 || totalLocked6 != 0) revert MarketHasActivity();

        // Refund bond: move value from this contract -> creator using CoreVault ledger accounting.
        // NOTE: This contract must have `FACTORY_ROLE` on CoreVault for this to succeed.
        vault.deductFees(address(this), uint256(b.amount), b.creator);

        b.refunded = true;
        emit BondRefunded(marketId, b.creator, uint256(b.amount));
    }
}

