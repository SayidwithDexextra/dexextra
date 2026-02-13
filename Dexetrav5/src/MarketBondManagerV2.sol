// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @notice MarketBondManagerV2
 *
 * Goals vs V1:
 * - Make the authorized FuturesMarketFactory adjustable (not immutable).
 * - Add an owner-only, one-time migration/import path to copy bond state from an old manager,
 *   and (optionally) move the CoreVault-held bond balances from old manager -> this manager
 *   so refunds continue to work after cutover.
 *
 * IMPORTANT:
 * - This contract must be granted `FACTORY_ROLE` on CoreVault so it can call `deductFees`.
 * - Your FuturesMarketFactory must be configured to call this contract (set `bondManager`).
 */

interface ICoreVaultBondLedgerV2 {
    function deductFees(address user, uint256 amount, address recipient) external;
    function getAvailableCollateral(address user) external view returns (uint256);
}

interface IOBViewFacetForBondV2 {
    function marketStatic() external view returns (address vault, bytes32 marketId, bool useVWAP, uint256 vwapWindow);
    function getActiveOrdersCount() external view returns (uint256 buyCount, uint256 sellCount);
    function totalMarginLockedInMarket() external view returns (uint256 totalLocked6);
}

interface IOBTradeStatsFacetForBondV2 {
    function getTradeStatistics() external view returns (uint256 totalTrades, uint256 totalVolume, uint256 totalFees);
}

interface IOldMarketBondManagerV1 {
    function vault() external view returns (address);
    function bondByMarket(bytes32 marketId) external view returns (address creator, uint96 amount, bool refunded);
}

contract MarketBondManagerV2 {
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
    error MigrationSourceInvalid();

    // ============ Events ============
    event OwnerUpdated(address indexed oldOwner, address indexed newOwner);
    event FactoryUpdated(address indexed oldFactory, address indexed newFactory);
    event DefaultBondUpdated(uint256 defaultBondAmount, uint256 minBondAmount, uint256 maxBondAmount);
    event PenaltyConfigUpdated(uint256 penaltyBps, address indexed recipient);
    event BondPenaltyCollected(bytes32 indexed marketId, address indexed recipient, uint256 feeAmount);
    event BondPosted(bytes32 indexed marketId, address indexed creator, uint256 amount);
    event BondRefunded(bytes32 indexed marketId, address indexed creator, uint256 amount);
    event BondImported(
        bytes32 indexed marketId,
        address indexed oldManager,
        address indexed creator,
        uint256 amount,
        bool refunded,
        bool fundsMoved
    );

    // ============ Storage ============
    ICoreVaultBondLedgerV2 public immutable vault;
    address public factory;
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
        uint96 amount;   // refundable amount (6 decimals)
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
        vault = ICoreVaultBondLedgerV2(_vault);
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

    function setFactory(address newFactory) external onlyOwner {
        if (newFactory == address(0)) revert InvalidAddress();
        address old = factory;
        factory = newFactory;
        emit FactoryUpdated(old, newFactory);
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

    // ============ Migration / Import ============
    /**
     * @notice Import bond state from a V1 manager for a list of marketIds.
     *
     * @dev This copies the stored `bondByMarket` fields (creator, refundable amount, refunded flag)
     *      from the old manager into this manager.
     *
     *      If `moveFunds` is true, it will also move the refundable bond value held inside CoreVault
     *      from `oldManager` to `address(this)` using CoreVault ledger accounting:
     *        vault.deductFees(oldManager, amount, address(this))
     *
     *      This is required if you plan to use this manager to refund bonds for those imported markets,
     *      because refunds debit from `address(this)`'s CoreVault balance.
     */
    function importBondsFromV1(address oldManager, bytes32[] calldata marketIds, bool moveFunds) external onlyOwner {
        if (oldManager == address(0)) revert InvalidAddress();

        // Best-effort sanity: ensure both managers point at the same CoreVault.
        // (Prevents accidentally importing from a different deployment.)
        address oldVault = IOldMarketBondManagerV1(oldManager).vault();
        if (oldVault != address(vault)) revert MigrationSourceInvalid();

        uint256 len = marketIds.length;
        for (uint256 i = 0; i < len; ) {
            bytes32 marketId = marketIds[i];
            BondInfo storage cur = bondByMarket[marketId];
            if (cur.creator != address(0)) revert BondAlreadyRecorded();

            (address creator, uint96 amount, bool refunded) = IOldMarketBondManagerV1(oldManager).bondByMarket(marketId);
            if (creator == address(0)) revert BondNotFound();

            bondByMarket[marketId] = BondInfo({creator: creator, amount: amount, refunded: refunded});

            bool didMove = false;
            if (moveFunds && !refunded && amount != 0) {
                // Move CoreVault-held refundable balance from oldManager -> this manager.
                // Requires this manager to have FACTORY_ROLE or ORDERBOOK_ROLE on CoreVault.
                vault.deductFees(oldManager, uint256(amount), address(this));
                didMove = true;
            }

            emit BondImported(marketId, oldManager, creator, uint256(amount), refunded, didMove);
            unchecked { ++i; }
        }
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

        if (vault.getAvailableCollateral(creator) < amount) revert InsufficientAvailable();

        vault.deductFees(creator, amount, address(this));

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

        if (!(caller == b.creator || caller == owner)) revert NotCreatorOrOwner();

        (, bytes32 obMarketId,,) = IOBViewFacetForBondV2(orderBook).marketStatic();
        if (obMarketId != marketId) revert MarketMismatch();

        (uint256 totalTrades,,) = IOBTradeStatsFacetForBondV2(orderBook).getTradeStatistics();
        (uint256 buyLevels, uint256 sellLevels) = IOBViewFacetForBondV2(orderBook).getActiveOrdersCount();
        uint256 totalLocked6 = IOBViewFacetForBondV2(orderBook).totalMarginLockedInMarket();
        if (totalTrades != 0 || buyLevels != 0 || sellLevels != 0 || totalLocked6 != 0) revert MarketHasActivity();

        vault.deductFees(address(this), uint256(b.amount), b.creator);

        b.refunded = true;
        emit BondRefunded(marketId, b.creator, uint256(b.amount));
    }
}

