// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/ICentralizedVault.sol";

/**
 * @title CentralizedVault
 * @dev Centralized vault supporting multiple VAMM contracts with unified collateral management
 */

// Safe ERC20 interface with proper error handling
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

// SafeERC20 library for safe token transfers
library SafeERC20 {
    function safeTransfer(IERC20 token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(token.transfer.selector, to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "SafeERC20: transfer failed");
    }

    function safeTransferFrom(IERC20 token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(token.transferFrom.selector, from, to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "SafeERC20: transferFrom failed");
    }
}

contract CentralizedVault is ICentralizedVault {
    using SafeERC20 for IERC20;

    // Access control
    address public factory;
    address public owner;
    bool public paused;

    // Collateral token (USDC)
    IERC20 public immutable collateralToken;

    // User accounts
    mapping(address => MarginAccount) public marginAccounts;
    mapping(address => mapping(address => VAMMAllocation)) public vammAllocations;

    // VAMM management
    mapping(address => bool) public authorizedVAMMs;
    mapping(address => string) public vammCategories;
    address[] public allVAMMs;

    // Global state
    uint256 public totalCollateralDeposited;
    uint256 public totalReservedMargin;
    int256 public totalUnrealizedPnL;
    uint256 public activeUserCount;

    // Risk parameters
    uint256 public constant MAINTENANCE_MARGIN_RATIO = 500; // 5%
    uint256 public constant LIQUIDATION_PENALTY = 1000;    // 10%
    uint256 public constant MAX_UTILIZATION = 9000;        // 90%
    uint256 public constant PRECISION = 10000;

    // Events already defined in interface

    modifier onlyFactory() {
        require(msg.sender == factory, "CentralizedVault: only factory");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "CentralizedVault: only owner");
        _;
    }

    modifier onlyAuthorizedVAMM() {
        require(authorizedVAMMs[msg.sender], "CentralizedVault: unauthorized VAMM");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "CentralizedVault: paused");
        _;
    }

    constructor(address _collateralToken, address _factory) {
        // VALIDATION: Collateral token address must be a valid deployed contract
        // FAILS: When _collateralToken is zero address (0x0000...0000)
        // SUCCEEDS: When _collateralToken is a valid ERC20 contract address
        // REASONING: Zero address cannot hold a deployed contract. If zero address is passed,
        // all future token operations (transfers, approvals) will fail silently or revert.
        // The vault depends entirely on this token for collateral management.
        require(
            _collateralToken != address(0), 
            "CentralizedVault: Collateral token address cannot be zero - must be valid ERC20 contract address for USDC or similar stablecoin"
        );
        
        // VALIDATION: Factory address must be a valid deployed contract address
        // FAILS: When _factory is zero address (0x0000...0000)
        // SUCCEEDS: When _factory points to deployed MetricVAMMFactory contract
        // REASONING: The vault grants exclusive VAMM authorization permissions to the factory.
        // If factory address is zero, no VAMMs can ever be authorized, making the entire
        // system non-functional. All authorizeVAMM calls would come from zero address.
        require(
            _factory != address(0), 
            "CentralizedVault: Factory address cannot be zero - must be valid MetricVAMMFactory contract for VAMM authorization"
        );
        
        collateralToken = IERC20(_collateralToken);
        factory = _factory;
        owner = msg.sender;
    }

    // === COLLATERAL MANAGEMENT ===

    function depositCollateral(uint256 amount) external override whenNotPaused {
        // VALIDATION: Deposit amount must be greater than zero
        // FAILS: When amount = 0 (zero deposit attempts)
        // SUCCEEDS: When amount > 0 (any positive USDC amount)
        // REASONING: Zero deposits serve no purpose and waste gas. They don't increase user's
        // collateral balance, available margin, or provide any trading capacity. Zero deposits
        // could also be used to spam the system with meaningless transactions. Additionally,
        // some ERC20 tokens may have edge cases with zero-value transfers.
        require(
            amount > 0, 
            "CentralizedVault: Deposit amount must be greater than zero - cannot deposit zero collateral as it provides no trading capacity"
        );
        
        MarginAccount storage account = marginAccounts[msg.sender];
        
        // Track if this is a new user
        if (account.totalCollateral == 0) {
            activeUserCount++;
        }

        // Transfer collateral
        collateralToken.safeTransferFrom(msg.sender, address(this), amount);

        // Update account
        account.totalCollateral += amount;
        account.availableCollateral += amount;
        account.lastUpdateTime = block.timestamp;

        // Update global state
        totalCollateralDeposited += amount;

        emit CollateralDeposited(msg.sender, amount, account.totalCollateral);
    }

    function withdrawCollateral(uint256 amount) external override whenNotPaused {
        // VALIDATION: Withdrawal amount must be greater than zero
        // FAILS: When amount = 0 (attempting zero withdrawal)
        // SUCCEEDS: When amount > 0 (any positive withdrawal amount)
        // REASONING: Zero withdrawals are meaningless operations that waste gas and provide
        // no benefit to the user. They don't reduce collateral or return any funds.
        // Zero withdrawals could be used for spam attacks on the system.
        require(
            amount > 0, 
            "CentralizedVault: Withdrawal amount must be greater than zero - cannot withdraw zero collateral as it provides no benefit"
        );
        
        MarginAccount storage account = marginAccounts[msg.sender];
        
        // VALIDATION: User must have sufficient available collateral for withdrawal
        // FAILS: When user's availableCollateral < requested withdrawal amount
        // SUCCEEDS: When user has enough free (non-reserved) collateral to cover withdrawal
        // REASONING: Users can only withdraw collateral that is not currently backing active
        // positions. Reserved margin is locked for position maintenance and cannot be withdrawn.
        // Attempting to withdraw more than available would leave positions under-collateralized.
        require(
            account.availableCollateral >= amount, 
            "CentralizedVault: Insufficient available collateral - requested withdrawal exceeds non-reserved balance (some collateral locked in active positions)"
        );

        // Check if withdrawal maintains minimum margin
        uint256 newAvailable = account.availableCollateral - amount;
        
        // VALIDATION: Withdrawal must not violate maintenance margin requirements for active positions
        // FAILS: When user has active positions AND post-withdrawal margin ratio < 5% maintenance threshold
        // SUCCEEDS: When user has no positions (reservedMargin = 0) OR margin ratio stays above 5%
        // REASONING: Even available collateral provides backstop for position losses. If unrealized PnL
        // turns negative, available collateral covers the losses. Withdrawing too much available collateral
        // could push the user below maintenance margin, triggering liquidation risk.
        require(
            account.reservedMargin == 0 || 
            _calculateMarginRatio(msg.sender, newAvailable) >= MAINTENANCE_MARGIN_RATIO,
            "CentralizedVault: Withdrawal would violate maintenance margin - post-withdrawal margin ratio would fall below 5% minimum threshold, risking liquidation"
        );

        // Update account
        account.totalCollateral -= amount;
        account.availableCollateral -= amount;
        account.lastUpdateTime = block.timestamp;

        // Update global state
        totalCollateralDeposited -= amount;

        // Check if user has no more collateral
        if (account.totalCollateral == 0) {
            activeUserCount--;
        }

        // Transfer collateral
        collateralToken.safeTransfer(msg.sender, amount);

        emit CollateralWithdrawn(msg.sender, amount, account.totalCollateral);
    }

    // === VAMM AUTHORIZATION ===

    function authorizeVAMM(address vamm, string calldata category) external override onlyFactory {
        // VALIDATION: VAMM address must be a valid deployed contract address
        // FAILS: When vamm address is zero address (0x0000...0000)
        // SUCCEEDS: When vamm points to deployed SpecializedMetricVAMM contract
        // REASONING: Zero address cannot hold deployed contract code. Authorizing zero address
        // would create phantom VAMM in system that cannot execute any functions. All margin
        // reservations, PnL updates, and position operations would fail when called from zero address.
        require(
            vamm != address(0), 
            "CentralizedVault: VAMM address cannot be zero - must be valid deployed SpecializedMetricVAMM contract for position management"
        );
        
        // VALIDATION: VAMM must not be previously authorized to prevent duplicate authorization
        // FAILS: When the vamm address already exists in authorizedVAMMs mapping (already true)
        // SUCCEEDS: When vamm is new and not previously authorized (mapping value is false)
        // REASONING: Duplicate authorization creates inconsistent state where same VAMM appears
        // multiple times in allVAMMs array but only once in mapping. This breaks iteration logic
        // and creates accounting discrepancies in VAMM counting and management functions.
        require(
            !authorizedVAMMs[vamm], 
            "CentralizedVault: VAMM already authorized - cannot re-authorize same contract address (would create duplicate entries)"
        );

        authorizedVAMMs[vamm] = true;
        vammCategories[vamm] = category;
        allVAMMs.push(vamm);

        emit VAMMAuthorized(vamm, category);
    }

    function deauthorizeVAMM(address vamm, string calldata reason) external override onlyFactory {
        require(authorizedVAMMs[vamm], "CentralizedVault: not authorized");

        authorizedVAMMs[vamm] = false;
        
        // Remove from array
        for (uint256 i = 0; i < allVAMMs.length; i++) {
            if (allVAMMs[i] == vamm) {
                allVAMMs[i] = allVAMMs[allVAMMs.length - 1];
                allVAMMs.pop();
                break;
            }
        }

        emit VAMMDeauthorized(vamm, reason);
    }

    function isAuthorizedVAMM(address vamm) external view override returns (bool) {
        return authorizedVAMMs[vamm];
    }

    // === POSITION MANAGEMENT ===

    function reserveMargin(address user, uint256 amount) external override onlyAuthorizedVAMM whenNotPaused {
        // VALIDATION: Margin reservation amount must be greater than zero
        // FAILS: When amount = 0 (attempting to reserve zero margin)
        // SUCCEEDS: When amount > 0 (positive margin amount to reserve)
        // REASONING: Zero margin reservations serve no purpose for position backing. They don't
        // provide any collateral security for trades and waste gas. Zero reservations could
        // also be used to spam the system and manipulate position counters without actual value.
        require(
            amount > 0, 
            "CentralizedVault: Margin reservation amount must be greater than zero - cannot reserve zero margin as it provides no position backing"
        );
        
        MarginAccount storage account = marginAccounts[user];
        
        // VALIDATION: User must have sufficient available collateral to reserve the requested margin
        // FAILS: When user's availableCollateral < amount requested for reservation
        // SUCCEEDS: When user has enough free collateral to cover the margin requirement
        // REASONING: Margin reservation moves collateral from 'available' to 'reserved' status.
        // Reserved margin backs active positions and cannot be withdrawn. If insufficient
        // available collateral exists, the position cannot be properly collateralized, creating
        // systemic risk and potential liquidation issues.
        require(
            account.availableCollateral >= amount, 
            "CentralizedVault: Insufficient available collateral for margin reservation - user lacks free collateral to back new position"
        );

        // Update user account
        account.availableCollateral -= amount;
        account.reservedMargin += amount;
        account.lastUpdateTime = block.timestamp;

        // Update VAMM allocation
        VAMMAllocation storage allocation = vammAllocations[user][msg.sender];
        allocation.reservedMargin += amount;
        allocation.activePositions++;

        // Update global state
        totalReservedMargin += amount;

        emit MarginReserved(user, msg.sender, amount);
    }

    function releaseMargin(address user, uint256 amount) external override onlyAuthorizedVAMM {
        // VALIDATION: Margin release amount must be greater than zero
        // FAILS: When amount = 0 (attempting to release zero margin)
        // SUCCEEDS: When amount > 0 (positive margin amount to release)
        // REASONING: Zero margin releases are meaningless operations that provide no benefit.
        // They don't free up any collateral for withdrawal or new positions. Zero releases
        // waste gas and could be used for system spam without providing value.
        require(
            amount > 0, 
            "CentralizedVault: Margin release amount must be greater than zero - cannot release zero margin as it frees no collateral"
        );
        
        MarginAccount storage account = marginAccounts[user];
        
        // STORAGE REFERENCE: Get direct storage reference to this specific VAMM's allocation for the user
        // This creates a pointer to vammAllocations[user][msg.sender] storage location for efficient read/write
        // msg.sender = the calling VAMM contract, user = the trader whose margin is being released
        // Each VAMM maintains separate allocation tracking per user (reserved margin, PnL, active positions)
        // Using storage reference avoids gas costs of repeated mapping lookups and enables direct modifications
        VAMMAllocation storage allocation = vammAllocations[user][msg.sender];
        
        // VALIDATION: VAMM must have sufficient reserved margin allocated for this user to release
        // FAILS: When allocation.reservedMargin < amount requested for release
        // SUCCEEDS: When the calling VAMM has enough reserved margin for this user to release
        // REASONING: Each VAMM tracks its own margin allocation per user. Cannot release more
        // margin than this specific VAMM has reserved. Attempting over-release would create
        // negative margin allocation, breaking accounting and potentially allowing double-spending
        // of margin across multiple VAMMs.
        require(
            allocation.reservedMargin >= amount, 
            "CentralizedVault: Insufficient reserved margin for release - requesting VAMM has not reserved enough margin for this user"
        );

        // Update user account
        account.availableCollateral += amount;
        account.reservedMargin -= amount;
        account.lastUpdateTime = block.timestamp;

        // Update VAMM allocation
        allocation.reservedMargin -= amount;
        if (allocation.activePositions > 0) {
            allocation.activePositions--;
        }

        // Update global state
        totalReservedMargin -= amount;

        emit MarginReleased(user, msg.sender, amount);
    }

    function updatePnL(address user, int256 pnlDelta) external override onlyAuthorizedVAMM {
        MarginAccount storage account = marginAccounts[user];
        VAMMAllocation storage allocation = vammAllocations[user][msg.sender];

        // Update user account
        account.unrealizedPnL += pnlDelta;
        account.lastUpdateTime = block.timestamp;

        // Update VAMM allocation
        allocation.unrealizedPnL += pnlDelta;

        // Update global state
        totalUnrealizedPnL += pnlDelta;

        emit PnLUpdated(user, msg.sender, pnlDelta, account.unrealizedPnL);
    }

    function applyFunding(address user, int256 fundingPayment) external override onlyAuthorizedVAMM {
        MarginAccount storage account = marginAccounts[user];
        VAMMAllocation storage allocation = vammAllocations[user][msg.sender];

        // Update user account
        account.unrealizedPnL += fundingPayment;
        account.lastUpdateTime = block.timestamp;

        // Update VAMM allocation
        allocation.unrealizedPnL += fundingPayment;
        allocation.lastFundingUpdate = block.timestamp;

        // Update global state
        totalUnrealizedPnL += fundingPayment;

        emit FundingApplied(user, msg.sender, fundingPayment);
    }

    // === RISK MANAGEMENT ===

    function checkLiquidationRisk(address user) external view override returns (
        bool atRisk,
        uint256 totalExposure,
        uint256 marginRatio,
        address[] memory riskiestVAMMs
    ) {
        MarginAccount storage account = marginAccounts[user];
        
        // EARLY EXIT: If user has no active positions (zero reserved margin), they cannot be at liquidation risk
        // This optimization avoids unnecessary calculations for users without trading activity
        // Returns: not at risk (false), zero exposure, maximum margin ratio (100%), and empty VAMM array
        if (account.reservedMargin == 0) {
            return (false, 0, PRECISION, new address[](0));
        }

        marginRatio = _calculateMarginRatio(user, account.availableCollateral);
        atRisk = marginRatio < MAINTENANCE_MARGIN_RATIO;
        totalExposure = account.reservedMargin;

        // Find riskiest VAMMs (simplified - could be more sophisticated)
        riskiestVAMMs = new address[](allVAMMs.length);
        uint256 count = 0;
        
        for (uint256 i = 0; i < allVAMMs.length; i++) {
            address vamm = allVAMMs[i];
            VAMMAllocation storage allocation = vammAllocations[user][vamm];
            if (allocation.activePositions > 0 && allocation.unrealizedPnL < 0) {
                riskiestVAMMs[count] = vamm;
                count++;
            }
        }

        // Resize array
        assembly {
            mstore(riskiestVAMMs, count)
        }

        return (atRisk, totalExposure, marginRatio, riskiestVAMMs);
    }

    function liquidateUser(address user) external override onlyAuthorizedVAMM returns (uint256 totalLoss) {
        (bool atRisk,,,) = this.checkLiquidationRisk(user);
        
        // VALIDATION: User must be at liquidation risk before liquidation can proceed
        // FAILS: When user's margin ratio is above maintenance threshold (not at risk)
        // SUCCEEDS: When user's margin ratio falls below 5% maintenance requirement
        // REASONING: Liquidation is a protective mechanism to prevent losses exceeding collateral.
        // Liquidating healthy positions (above maintenance margin) would be unfair to users
        // and could be exploited maliciously. Only positions genuinely at risk of insolvency
        // should face liquidation to protect the system and other users.
        require(
            atRisk, 
            "CentralizedVault: User not at liquidation risk - margin ratio above maintenance threshold, liquidation not justified"
        );

        MarginAccount storage account = marginAccounts[user];
        
        // Calculate liquidation penalty
        uint256 penalty = (account.reservedMargin * LIQUIDATION_PENALTY) / PRECISION;
        totalLoss = penalty;

        // Apply penalty to user's collateral
        if (account.totalCollateral >= penalty) {
            account.totalCollateral -= penalty;
            account.availableCollateral = account.totalCollateral > account.reservedMargin 
                ? account.totalCollateral - account.reservedMargin 
                : 0;
        } else {
            totalLoss = account.totalCollateral;
            account.totalCollateral = 0;
            account.availableCollateral = 0;
        }

        account.lastUpdateTime = block.timestamp;

        // Collect liquidated VAMMs for event
        address[] memory liquidatedVAMMs = new address[](allVAMMs.length);
        uint256 count = 0;
        
        for (uint256 i = 0; i < allVAMMs.length; i++) {
            address vamm = allVAMMs[i];
            if (vammAllocations[user][vamm].activePositions > 0) {
                liquidatedVAMMs[count] = vamm;
                count++;
            }
        }

        // Resize array
        assembly {
            mstore(liquidatedVAMMs, count)
        }

        emit GlobalLiquidation(user, totalLoss, liquidatedVAMMs);
        
        return totalLoss;
    }

    function canOpenPosition(address user, uint256 additionalMargin) external view override returns (bool) {
        MarginAccount storage account = marginAccounts[user];
        
        if (account.availableCollateral < additionalMargin) {
            return false;
        }

        // Check if adding this margin would exceed max utilization
        uint256 newReserved = account.reservedMargin + additionalMargin;
        uint256 newAvailable = account.availableCollateral - additionalMargin;
        uint256 newMarginRatio = _calculateMarginRatio(user, newAvailable);

        return newMarginRatio >= MAINTENANCE_MARGIN_RATIO;
    }

    // === QUERY FUNCTIONS ===

    function getAvailableMargin(address user) external view override returns (uint256) {
        return marginAccounts[user].availableCollateral;
    }

    function getTotalMargin(address user) external view override returns (int256) {
        MarginAccount storage account = marginAccounts[user];
        return int256(account.totalCollateral) + account.unrealizedPnL;
    }

    function getMarginAccount(address user) external view override returns (MarginAccount memory) {
        return marginAccounts[user];
    }

    function getVAMMAllocation(address user, address vamm) external view override returns (VAMMAllocation memory) {
        return vammAllocations[user][vamm];
    }

    function getPortfolioSummary(address user) external view override returns (
        uint256 totalCollateral,
        uint256 availableMargin,
        int256 unrealizedPnL,
        uint256 marginRatio,
        uint256 activeVAMMs
    ) {
        MarginAccount storage account = marginAccounts[user];
        
        totalCollateral = account.totalCollateral;
        availableMargin = account.availableCollateral;
        unrealizedPnL = account.unrealizedPnL;
        marginRatio = _calculateMarginRatio(user, availableMargin);
        
        // Count active VAMMs
        for (uint256 i = 0; i < allVAMMs.length; i++) {
            if (vammAllocations[user][allVAMMs[i]].activePositions > 0) {
                activeVAMMs++;
            }
        }

        return (totalCollateral, availableMargin, unrealizedPnL, marginRatio, activeVAMMs);
    }

    function getGlobalRiskMetrics() external view override returns (GlobalRiskMetrics memory) {
        uint256 utilizationRatio = totalCollateralDeposited > 0 
            ? (totalReservedMargin * PRECISION) / totalCollateralDeposited 
            : 0;

        return GlobalRiskMetrics({
            totalCollateral: totalCollateralDeposited,
            totalReservedMargin: totalReservedMargin,
            totalUnrealizedPnL: totalUnrealizedPnL,
            utilizationRatio: utilizationRatio,
            activeUsers: activeUserCount
        });
    }

    function getTotalValueLocked() external view override returns (uint256) {
        return totalCollateralDeposited;
    }

    function getVAMMCount() external view override returns (uint256) {
        return allVAMMs.length;
    }

    function getAllAuthorizedVAMMs() external view override returns (address[] memory) {
        return allVAMMs;
    }

    function getCollateralToken() external view override returns (address) {
        return address(collateralToken);
    }

    // === INTERNAL FUNCTIONS ===

    function _calculateMarginRatio(address user, uint256 availableCollateral) internal view returns (uint256) {
        MarginAccount storage account = marginAccounts[user];
        
        if (account.reservedMargin == 0) {
            return PRECISION;
        }

        int256 netWorth = int256(account.totalCollateral) + account.unrealizedPnL;
        if (netWorth <= 0) {
            return 0;
        }

        return (uint256(netWorth) * PRECISION) / account.reservedMargin;
    }

    // === ADMIN FUNCTIONS ===

    function pause() external onlyOwner {
        paused = true;
    }

    function unpause() external onlyOwner {
        paused = false;
    }

    function setFactory(address newFactory) external onlyOwner {
        require(newFactory != address(0), "CentralizedVault: invalid factory");
        factory = newFactory;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "CentralizedVault: invalid owner");
        owner = newOwner;
    }

    // === EMERGENCY FUNCTIONS ===

    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        require(paused, "CentralizedVault: not paused");
        IERC20(token).safeTransfer(owner, amount);
    }
} 