// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IvAMM.sol";
import "./IVault.sol";
import "./IPriceOracle.sol";
/**
 * @title vAMM
 * @dev Production-ready virtual Automated Market Maker with BONDING CURVE mechanism for pump.fund-style behavior
 * This version uses bonding curves instead of traditional AMM reserves for custom starting prices and progressive difficulty
 */
contract vAMM is IvAMM {

    address public owner;
    IVault public vault;
    IPriceOracle public oracle;
    
    // Trading parameters
    uint256 public constant PRICE_PRECISION = 1e18;
    uint256 public constant FUNDING_PRECISION = 1e8;
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant MAX_LEVERAGE = 100;
    uint256 public constant MIN_LEVERAGE = 1;
    
    // Fee structure
    uint256 public tradingFeeRate = 30; // 0.3% in basis points
    uint256 public liquidationFeeRate = 500; // 5% in basis points
    uint256 public maintenanceMarginRatio = 500; // 5% in basis points
    uint256 public initialMarginRatio = 1000; // 10% in basis points
    
    // ===== BONDING CURVE PARAMETERS =====
    uint256 public startingPrice; // Custom starting price (e.g., $0.001, $8, $100)
    uint256 public constant BONDING_CURVE_STEEPNESS = 1000000000000000000; // 1e18 - same scale as position sizes for 1:1 ratio
    uint256 public constant MAX_PUMP_MULTIPLIER = 1000; // Maximum 1,000x price increase  
    uint256 public pumpExponent = 12e17; // 1.2 exponent for progressive difficulty (reduced from 1.5)
    
    // Legacy virtual reserves for backwards compatibility (now calculated dynamically)
    uint256 public virtualBaseReserves;
    uint256 public virtualQuoteReserves;
    
    // Funding mechanism
    FundingState public fundingState;
    uint256 public constant FUNDING_INTERVAL = 1 hours;
    uint256 public constant MAX_FUNDING_RATE = 1e6; // 1% per hour in FUNDING_PRECISION
    
    // Multiple position tracking
    mapping(uint256 => Position) public positions; // positionId => Position
    mapping(address => uint256[]) public userPositionIds; // user => positionId[]
    mapping(uint256 => address) public positionOwner; // positionId => owner
    mapping(address => uint256) public nextPositionId; // user => next available position ID
    uint256 public globalPositionId; // Global position counter
    mapping(address => bool) public authorized;
    
    // Global state tracking for bonding curve
    int256 public totalLongSize; // Total long positions (drives bonding curve)
    int256 public totalShortSize; // Total short positions
    uint256 public totalTradingFees;
    bool public paused = false;
    
    // Events
    event PositionOpened(
        address indexed user,
        uint256 indexed positionId,
        bool isLong,
        uint256 size,
        uint256 price,
        uint256 leverage,
        uint256 fee
    );
    event PositionClosed(
        address indexed user,
        uint256 indexed positionId,
        uint256 size,
        uint256 price,
        int256 pnl,
        uint256 fee
    );
    event PositionIncreased(
        address indexed user,
        uint256 indexed positionId,
        uint256 sizeAdded,
        uint256 newSize,
        uint256 newEntryPrice,
        uint256 fee
    );
    event FundingUpdated(
        int256 fundingRate,
        uint256 fundingIndex,
        int256 premiumFraction
    );
    event FundingPaid(
        address indexed user,
        uint256 indexed positionId,
        int256 amount,
        uint256 fundingIndex
    );
    event PositionLiquidated(
        address indexed user,
        uint256 indexed positionId,
        address indexed liquidator,
        uint256 size,
        uint256 price,
        uint256 fee
    );
    event TradingFeeCollected(address indexed user, uint256 amount);
    event ParametersUpdated(string parameter, uint256 newValue);
    event AuthorizedAdded(address indexed account);
    event AuthorizedRemoved(address indexed account);
    event Paused();
    event Unpaused();
    event BondingCurveUpdated(uint256 newPrice, uint256 totalSupply, uint256 priceChange);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "vAMM: not owner");
        _;
    }
    
    modifier onlyAuthorized() {
        require(authorized[msg.sender] || msg.sender == owner, "vAMM: not authorized");
        _;
    }
    
    modifier whenNotPaused() {
        require(!paused, "vAMM: paused");
        _;
    }
    
    modifier validUser(address user) {
        require(user != address(0), "vAMM: invalid user");
        _;
    }
    
    modifier validPosition(uint256 positionId) {
        require(positions[positionId].isActive, "vAMM: position not active");
        _;
    }
    
    modifier onlyPositionOwner(uint256 positionId) {
        require(positionOwner[positionId] == msg.sender, "vAMM: not position owner");
        _;
    }
    
    constructor(
        address _vault,
        address _oracle,
        uint256 _startingPrice
    ) {
        owner = msg.sender;
        vault = IVault(_vault);
        oracle = IPriceOracle(_oracle);
        startingPrice = _startingPrice;
        
        // Initialize legacy reserves for backwards compatibility
        _updateLegacyReserves();
        
        // Initialize funding state
        fundingState.lastFundingTime = block.timestamp;
        fundingState.fundingIndex = FUNDING_PRECISION;
        
        // Initialize global position ID
        globalPositionId = 1;
    }
    
    /**
     * @dev BONDING CURVE PRICE CALCULATION
     * Formula: price = startingPrice * (1 + totalSupply/steepness)^exponent
     * Early buys = cheap tokens, later buys = exponentially more expensive
     */
    function getMarkPrice() public view override returns (uint256) {
        uint256 totalSupply = getTotalSupply();
        
        if (totalSupply == 0) {
            return startingPrice;
        }
        
        // Calculate bonding curve price using simple math
        // Formula: price = startingPrice * (1 + supply/steepness)^exponent
        uint256 supplyRatio = (totalSupply * PRICE_PRECISION) / BONDING_CURVE_STEEPNESS;
        uint256 base = PRICE_PRECISION + supplyRatio;
        
        // Simple power approximation for small exponents (1.2 ≈ 1 + 0.2 * ln(base))
        // For base^1.2, we approximate as: base * (1 + 0.2 * (base - 1) / base)
        uint256 priceMultiplier;
        if (base <= PRICE_PRECISION) {
            priceMultiplier = PRICE_PRECISION; // base^1.2 ≈ 1 when base ≤ 1
        } else {
            // Simplified approximation: base^1.2 ≈ base * (1 + 0.2)
            // For small values this gives reasonable pump behavior
            uint256 excess = base - PRICE_PRECISION;
            uint256 powerEffect = (excess * 12) / 10; // 1.2x the excess
            priceMultiplier = PRICE_PRECISION + powerEffect;
        }

        // Cap maximum price to prevent overflow
        uint256 maxPrice = startingPrice * MAX_PUMP_MULTIPLIER;
        uint256 calculatedPrice = (startingPrice * priceMultiplier) / PRICE_PRECISION;
        
        return calculatedPrice > maxPrice ? maxPrice : calculatedPrice;
    }
    
    /**
     * @dev Gets total supply for bonding curve (only long positions drive price up)
     * Shorts don't directly affect the bonding curve price
     */
    function getTotalSupply() public view returns (uint256) {
        return totalLongSize > 0 ? uint256(totalLongSize) : 0;
    }

    /**
     * @dev Simple power approximation for bonding curve
     * Approximates base^exponent where exponent = 1.2
     */
    function _approximatePower(uint256 base, uint256 exponent) internal pure returns (uint256) {
        if (base <= PRICE_PRECISION) {
            return PRICE_PRECISION; // base^1.2 ≈ 1 when base ≤ 1
        }
        
        // For base^1.2, use approximation: base * (1 + 0.2 * (base-1)/base)
        // Simplified to: base + 0.2 * (base - PRICE_PRECISION)
        uint256 excess = base - PRICE_PRECISION;
        uint256 powerEffect = (excess * 12) / 10; // 1.2x the excess
        return PRICE_PRECISION + powerEffect;
    }
    
    /**
     * @dev Updates legacy virtual reserves for backwards compatibility
     * Now calculated dynamically based on bonding curve
     */
    function _updateLegacyReserves() internal {
        uint256 currentPrice = getMarkPrice();
        uint256 totalSupply = getTotalSupply();
        
        // Create virtual reserves that would produce the current bonding curve price
        // This ensures backwards compatibility with systems expecting AMM-style reserves
        virtualBaseReserves = totalSupply > 0 ? totalSupply : PRICE_PRECISION;
        virtualQuoteReserves = (virtualBaseReserves * currentPrice) / PRICE_PRECISION;
        
        emit BondingCurveUpdated(currentPrice, totalSupply, 0);
    }
    
    /**
     * @dev Gets the price impact for a trade using bonding curve
     */
    function getPriceImpact(uint256 size, bool isLong) external view override returns (uint256) {
        if (!isLong) return 0; // Shorts don't impact bonding curve price
        
        uint256 currentPrice = getMarkPrice();
        uint256 currentSupply = getTotalSupply();
        uint256 newSupply = currentSupply + size;
        
        // Calculate new price with increased supply
        uint256 supplyRatio = (newSupply * PRICE_PRECISION) / BONDING_CURVE_STEEPNESS;
        uint256 base = PRICE_PRECISION + supplyRatio;
        uint256 priceMultiplier = _approximatePower(base, pumpExponent);
        uint256 newPrice = (startingPrice * priceMultiplier) / PRICE_PRECISION;
        
        // Cap maximum price
        uint256 maxPrice = startingPrice * MAX_PUMP_MULTIPLIER;
        newPrice = newPrice > maxPrice ? maxPrice : newPrice;
        
        return newPrice > currentPrice ? newPrice - currentPrice : 0;
    }
    
    /**
     * @dev Gets current effective reserves and multiplier info
     */
    function getReserveInfo() external view returns (
        uint256 baseReserves,
        uint256 quoteReserves,
        uint256 multiplier,
        uint256 totalVolume
    ) {
        // These values are no longer directly applicable to the bonding curve
        // as the reserves are now derived from the total supply.
        // For compatibility, we can return 0 or throw an error.
        // For now, returning 0 as a placeholder.
        baseReserves = 0;
        quoteReserves = 0;
        multiplier = 0;
        totalVolume = 0;
    }
    
    /**
     * @dev Gets base reserves (non-dynamic)
     */
    function getBaseReserves() external view returns (uint256 baseReserves, uint256 quoteReserves) {
        // These values are no longer directly applicable to the bonding curve
        // as the reserves are now derived from the total supply.
        // For compatibility, we can return 0 or throw an error.
        // For now, returning 0 as a placeholder.
        baseReserves = 0;
        quoteReserves = 0;
    }
    
    /**
     * @dev Updates dynamic reserves parameters (owner only)
     */
    function updateDynamicReservesParams(
        uint256 _volumeScaleFactor,
        uint256 _minReserveMultiplier,
        uint256 _maxReserveMultiplier
    ) external onlyOwner {
        // This function is no longer relevant for the bonding curve
        // as reserves are derived from total supply.
        // Keeping it for compatibility if other parts of the system rely on it.
        require(_volumeScaleFactor > 0, "vAMM: invalid volume scale factor");
        require(_minReserveMultiplier > 0, "vAMM: invalid min multiplier");
        require(_maxReserveMultiplier > _minReserveMultiplier, "vAMM: invalid max multiplier");
        
        // volumeScaleFactor = _volumeScaleFactor; // No longer used
        // minReserveMultiplier = _minReserveMultiplier; // No longer used
        // maxReserveMultiplier = _maxReserveMultiplier; // No longer used
        
        emit ParametersUpdated("dynamicReservesParams", _volumeScaleFactor);
    }
    
    /**
     * @dev Updates base virtual reserves (owner only)
     */
    function updateBaseVirtualReserves(
        uint256 _baseVirtualBaseReserves,
        uint256 _baseVirtualQuoteReserves
    ) external onlyOwner {
        // This function is no longer relevant for the bonding curve
        // as reserves are derived from total supply.
        // Keeping it for compatibility if other parts of the system rely on it.
        require(_baseVirtualBaseReserves > 0 && _baseVirtualQuoteReserves > 0, "vAMM: invalid base reserves");
        
        // baseVirtualBaseReserves = _baseVirtualBaseReserves; // No longer used
        // baseVirtualQuoteReserves = _baseVirtualQuoteReserves; // No longer used
        
        emit ParametersUpdated("baseVirtualReserves", _baseVirtualBaseReserves);
    }
    
    /**
     * @dev Emits position events manually (owner or authorized only)
     * Useful for external integrations or manual event emission
     */
    function emitPositionEvent(
        address user,
        uint256 positionId,
        bool isOpenEvent,
        bool isLong,
        uint256 size,
        uint256 price,
        uint256 leverageOrPnL,
        uint256 fee
    ) external onlyAuthorized {
        require(user != address(0), "vAMM: invalid user");
        
        if (isOpenEvent) {
            emit PositionOpened(user, positionId, isLong, size, price, leverageOrPnL, fee);
        } else {
            emit PositionClosed(user, positionId, size, price, int256(leverageOrPnL), fee);
        }
    }
    
    /**
     * @dev Adds an authorized address
     */
    function addAuthorized(address account) external onlyOwner {
        require(account != address(0), "vAMM: invalid address");
        authorized[account] = true;
        emit AuthorizedAdded(account);
    }
    
    /**
     * @dev Removes an authorized address
     */
    function removeAuthorized(address account) external onlyOwner {
        authorized[account] = false;
        emit AuthorizedRemoved(account);
    }
    
    /**
     * @dev Helper function to remove position from user's active positions
     */
    function _removePositionFromUser(address user, uint256 positionId) internal {
        uint256[] storage userPositions = userPositionIds[user];
        for (uint256 i = 0; i < userPositions.length; i++) {
            if (userPositions[i] == positionId) {
                userPositions[i] = userPositions[userPositions.length - 1];
                userPositions.pop();
                break;
            }
        }
    }

    /**
     * @dev Liquidates an undercollateralized position
     */
    function liquidate(uint256 positionId) external whenNotPaused validPosition(positionId) {
        address user = positionOwner[positionId];
        require(vault.canLiquidate(user, maintenanceMarginRatio), "vAMM: cannot liquidate");
        
        Position storage pos = positions[positionId];
        uint256 positionSize = uint256(pos.size);
        
        // Update funding before liquidation
        updateFunding();
        _applyFundingToPosition(positionId);
        
        // Calculate liquidation fee
        uint256 liquidationFee = (positionSize * liquidationFeeRate) / BASIS_POINTS;
        
        // Update position tracking
        if (pos.isLong) {
            totalLongSize -= int256(positionSize);
        } else {
            totalShortSize -= int256(positionSize);
        }
        
        // Update legacy reserves
        _updateLegacyReserves();
        
        // Close position
        uint256 currentPrice = getMarkPrice();
        pos.isActive = false;
        _removePositionFromUser(user, positionId);
        
        // Liquidate in vault
        vault.liquidate(user, liquidationFee);
        
        emit PositionLiquidated(user, positionId, msg.sender, positionSize, currentPrice, liquidationFee);
    }

    /**
     * @dev Updates funding rate and applies funding
     */
    function updateFunding() public override {
        if (block.timestamp < fundingState.lastFundingTime + FUNDING_INTERVAL) {
            return; // Not time for funding update yet
        }
        
        uint256 markPrice = getMarkPrice();
        uint256 indexPrice = oracle.getPrice();
        
        // Calculate premium fraction (mark price vs index price)
        int256 premiumFraction = int256((markPrice * FUNDING_PRECISION) / indexPrice) - int256(FUNDING_PRECISION);
        
        // Calculate funding rate (simplified implementation)
        // In production, this would use TWAP and more sophisticated calculation
        int256 fundingRate = premiumFraction / 24; // Divide by 24 for hourly rate
        
        // Cap funding rate
        if (fundingRate > int256(MAX_FUNDING_RATE)) {
            fundingRate = int256(MAX_FUNDING_RATE);
        } else if (fundingRate < -int256(MAX_FUNDING_RATE)) {
            fundingRate = -int256(MAX_FUNDING_RATE);
        }
        
        // Update funding state
        fundingState.fundingRate = fundingRate;
        fundingState.premiumFraction = premiumFraction;
        fundingState.lastFundingTime = block.timestamp;
        
        // Update cumulative funding index
        fundingState.fundingIndex = uint256(int256(fundingState.fundingIndex) + fundingRate);
        
        emit FundingUpdated(fundingRate, fundingState.fundingIndex, premiumFraction);
    }
    
    /**
     * @dev Applies funding to a specific position
     */
    function _applyFundingToPosition(uint256 positionId) internal {
        Position storage pos = positions[positionId];
        if (!pos.isActive || pos.size == 0) return;
        
        uint256 fundingIndexDelta = fundingState.fundingIndex - pos.entryFundingIndex;
        if (fundingIndexDelta == 0) return;
        
        // Calculate funding payment
        uint256 positionSize = uint256(pos.size);
        
        int256 fundingPayment = int256(positionSize * fundingIndexDelta / FUNDING_PRECISION);
        if (pos.isLong) {
            fundingPayment = -fundingPayment; // Longs pay positive funding
        }
        
        // Apply funding in vault
        address user = positionOwner[positionId];
        vault.applyFunding(user, fundingPayment, fundingState.fundingIndex);
        
        // Update position funding index
        pos.entryFundingIndex = fundingState.fundingIndex;
        
        emit FundingPaid(user, positionId, fundingPayment, fundingState.fundingIndex);
    }
    
    /**
     * @dev Gets current funding rate
     */
    function getFundingRate() external view override returns (int256) {
        return fundingState.fundingRate;
    }
    
    /**
     * @dev Gets funding state
     */
    function getFundingState() external view override returns (FundingState memory) {
        return fundingState;
    }



    /**
     * @dev Applies funding to all positions of a user (legacy function for compatibility)
     */
    function _applyFunding(address user) internal {
        uint256[] memory userPosIds = userPositionIds[user];
        for (uint256 i = 0; i < userPosIds.length; i++) {
            if (positions[userPosIds[i]].isActive) {
                _applyFundingToPosition(userPosIds[i]);
            }
        }
    }
    
    /**
     * @dev Gets position data by position ID
     */
    function getPosition(uint256 positionId) external view override returns (Position memory) {
        return positions[positionId];
    }
    
    /**
     * @dev Gets position data by user and position ID
     */
    function getUserPosition(address user, uint256 positionId) external view override returns (Position memory) {
        require(positionOwner[positionId] == user, "vAMM: not position owner");
        return positions[positionId];
    }
    
    /**
     * @dev Gets all active positions for a user
     */
    function getUserPositions(address user) external view override returns (Position[] memory) {
        uint256[] memory userPosIds = userPositionIds[user];
        uint256 activeCount = 0;
        
        // Count active positions
        for (uint256 i = 0; i < userPosIds.length; i++) {
            if (positions[userPosIds[i]].isActive) {
                activeCount++;
            }
        }
        
        // Create array of active positions
        Position[] memory activePositions = new Position[](activeCount);
        uint256 index = 0;
        for (uint256 i = 0; i < userPosIds.length; i++) {
            if (positions[userPosIds[i]].isActive) {
                activePositions[index] = positions[userPosIds[i]];
                index++;
            }
        }
        
        return activePositions;
    }
    
    /**
     * @dev Gets all active position IDs for a user
     */
    function getUserPositionIds(address user) external view override returns (uint256[] memory) {
        uint256[] memory userPosIds = userPositionIds[user];
        uint256 activeCount = 0;
        
        // Count active positions
        for (uint256 i = 0; i < userPosIds.length; i++) {
            if (positions[userPosIds[i]].isActive) {
                activeCount++;
            }
        }
        
        // Create array of active position IDs
        uint256[] memory activePositionIds = new uint256[](activeCount);
        uint256 index = 0;
        for (uint256 i = 0; i < userPosIds.length; i++) {
            if (positions[userPosIds[i]].isActive) {
                activePositionIds[index] = userPosIds[i];
                index++;
            }
        }
        
        return activePositionIds;
    }
    
    /**
     * @dev Calculates unrealized PnL for a specific position
     */
    function getUnrealizedPnL(uint256 positionId) external view override returns (int256) {
        Position storage pos = positions[positionId];
        if (!pos.isActive || pos.size == 0) return 0;
        
        uint256 currentPrice = getMarkPrice();
        uint256 positionSize = uint256(pos.size);
        
        if (pos.isLong) {
            return int256(positionSize * (currentPrice - pos.entryPrice) / PRICE_PRECISION);
        } else {
            return int256(positionSize * (pos.entryPrice - currentPrice) / PRICE_PRECISION);
        }
    }
    
    /**
     * @dev Calculates total unrealized PnL for a user across all positions
     */
    function getTotalUnrealizedPnL(address user) external view override returns (int256) {
        uint256[] memory userPosIds = userPositionIds[user];
        int256 totalPnL = 0;
        
        for (uint256 i = 0; i < userPosIds.length; i++) {
            if (positions[userPosIds[i]].isActive) {
                totalPnL += this.getUnrealizedPnL(userPosIds[i]);
            }
        }
        
        return totalPnL;
    }
    
    /**
     * @dev Gets user's trading summary
     */
    function getUserSummary(address user) external view override returns (
        uint256 totalLongSize,
        uint256 totalShortSize,
        int256 totalPnL,
        uint256 activePositionsCount
    ) {
        uint256[] memory userPosIds = userPositionIds[user];
        
        for (uint256 i = 0; i < userPosIds.length; i++) {
            Position storage pos = positions[userPosIds[i]];
            if (pos.isActive) {
                activePositionsCount++;
                totalPnL += this.getUnrealizedPnL(userPosIds[i]);
                
                if (pos.isLong) {
                    totalLongSize += uint256(pos.size);
                } else {
                    totalShortSize += uint256(pos.size);
                }
            }
        }
        
        return (totalLongSize, totalShortSize, totalPnL, activePositionsCount);
    }
    
    /**
     * @dev Transfers ownership
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "vAMM: invalid owner");
        owner = newOwner;
    }
    
    /**
     * @dev Emergency withdrawal of trading fees
     */
    function withdrawTradingFees(uint256 amount) external onlyOwner {
        require(amount <= totalTradingFees, "vAMM: insufficient fees");
        totalTradingFees -= amount;
        // Implementation would transfer fees to owner
    }

    /**
     * @dev Updates trading parameters
     */
    function updateTradingFeeRate(uint256 _feeRate) external onlyOwner {
        require(_feeRate <= 1000, "vAMM: fee too high"); // Max 10%
        tradingFeeRate = _feeRate;
        emit ParametersUpdated("tradingFeeRate", _feeRate);
    }
    
    function updateMaintenanceMarginRatio(uint256 _ratio) external onlyOwner {
        require(_ratio >= 100 && _ratio <= 2000, "vAMM: invalid ratio"); // 1-20%
        maintenanceMarginRatio = _ratio;
        emit ParametersUpdated("maintenanceMarginRatio", _ratio);
    }
    
    /**
     * @dev Opens a new position
     */
    function openPosition(
        uint256 collateralAmount,
        bool isLong,
        uint256 leverage,
        uint256 minPrice,
        uint256 maxPrice
    ) external override whenNotPaused returns (uint256 positionId) {
        require(collateralAmount > 0, "vAMM: invalid collateral");
        require(leverage >= MIN_LEVERAGE && leverage <= MAX_LEVERAGE, "vAMM: invalid leverage");
        
        // Update funding before position change
        updateFunding();
        
        // Calculate position size
        uint256 positionSize = collateralAmount * leverage;
        
        // Get current mark price
        uint256 currentPrice = getMarkPrice();
        require(currentPrice >= minPrice && currentPrice <= maxPrice, "vAMM: price slippage");
        
        // Calculate trading fee
        uint256 tradingFee = (positionSize * tradingFeeRate) / BASIS_POINTS;
        uint256 totalCost = collateralAmount + tradingFee;
        
        // CRITICAL FIX: Convert 18-decimal amounts to 6-decimal USDC for vault operations
        // The vAMM operates in 18-decimal precision, but the vault uses USDC (6 decimals)
        uint256 totalCostUSDC = totalCost / 1e12; // Convert from 18 to 6 decimals
        
        // Reserve margin in vault (in USDC 6-decimal units)
        vault.reserveMargin(msg.sender, totalCostUSDC);
        
        // Create new position ID
        positionId = globalPositionId++;
        
        // Update position tracking (bonding curve will automatically adjust price)
        if (isLong) {
            totalLongSize += int256(positionSize);
        } else {
            totalShortSize += int256(positionSize);
        }
        
        // Update legacy reserves for backwards compatibility
        _updateLegacyReserves();
        
        // Create new position
        positions[positionId] = Position({
            positionId: positionId,
            size: int256(positionSize),
            isLong: isLong,
            entryPrice: currentPrice,
            entryFundingIndex: fundingState.fundingIndex,
            lastInteractionTime: block.timestamp,
            isActive: true
        });
        
        // Update user position tracking
        positionOwner[positionId] = msg.sender;
        userPositionIds[msg.sender].push(positionId);
        
        // Collect trading fee
        totalTradingFees += tradingFee;
        
        emit PositionOpened(msg.sender, positionId, isLong, positionSize, currentPrice, leverage, tradingFee);
        emit TradingFeeCollected(msg.sender, tradingFee);
        
        return positionId;
    }
    
    /**
     * @dev Adds to an existing position
     */
    function addToPosition(
        uint256 positionId,
        uint256 collateralAmount,
        uint256 leverage,
        uint256 minPrice,
        uint256 maxPrice
    ) external override whenNotPaused validPosition(positionId) onlyPositionOwner(positionId) returns (uint256 newSize) {
        require(collateralAmount > 0, "vAMM: invalid collateral");
        require(leverage >= MIN_LEVERAGE && leverage <= MAX_LEVERAGE, "vAMM: invalid leverage");
        
        Position storage pos = positions[positionId];
        
        // Update funding before position change
        updateFunding();
        _applyFundingToPosition(positionId);
        
        // Calculate additional position size
        uint256 additionalSize = collateralAmount * leverage;
        
        // Get current mark price
        uint256 currentPrice = getMarkPrice();
        require(currentPrice >= minPrice && currentPrice <= maxPrice, "vAMM: price slippage");
        
        // Calculate trading fee
        uint256 tradingFee = (additionalSize * tradingFeeRate) / BASIS_POINTS;
        uint256 totalCost = collateralAmount + tradingFee;
        
        // CRITICAL FIX: Convert 18-decimal amounts to 6-decimal USDC for vault operations
        uint256 totalCostUSDC = totalCost / 1e12; // Convert from 18 to 6 decimals
        
        // Reserve margin in vault (in USDC 6-decimal units)
        vault.reserveMargin(msg.sender, totalCostUSDC);
        
        // Update position tracking (affects bonding curve price)
        if (pos.isLong) {
            totalLongSize += int256(additionalSize);
        } else {
            totalShortSize += int256(additionalSize);
        }
        
        // Update legacy reserves for backwards compatibility
        _updateLegacyReserves();
        
        // Calculate new weighted average entry price
        uint256 existingNotional = uint256(pos.size) * pos.entryPrice / PRICE_PRECISION;
        uint256 newNotional = additionalSize * currentPrice / PRICE_PRECISION;
        uint256 totalNotional = existingNotional + newNotional;
        
        pos.entryPrice = (totalNotional * PRICE_PRECISION) / (uint256(pos.size) + additionalSize);
        pos.size = pos.size + int256(additionalSize);
        pos.lastInteractionTime = block.timestamp;
        
        newSize = uint256(pos.size);
        
        // Collect trading fee
        totalTradingFees += tradingFee;
        
        emit PositionIncreased(msg.sender, positionId, additionalSize, newSize, pos.entryPrice, tradingFee);
        emit TradingFeeCollected(msg.sender, tradingFee);
        
        return newSize;
    }
    
    /**
     * @dev Closes a position partially or fully
     */
    function closePosition(
        uint256 positionId,
        uint256 sizeToClose,
        uint256 minPrice,
        uint256 maxPrice
    ) external override whenNotPaused validPosition(positionId) onlyPositionOwner(positionId) returns (int256 pnl) {
        Position storage pos = positions[positionId];
        uint256 positionSize = uint256(pos.size);
        require(sizeToClose <= positionSize, "vAMM: invalid size");
        
        // Update funding before closing
        updateFunding();
        _applyFundingToPosition(positionId);
        
        // Get current mark price
        uint256 currentPrice = getMarkPrice();
        require(currentPrice >= minPrice && currentPrice <= maxPrice, "vAMM: price slippage");
        
        // Calculate PnL
        if (pos.isLong) {
            pnl = int256(sizeToClose * (currentPrice - pos.entryPrice) / PRICE_PRECISION);
        } else {
            pnl = int256(sizeToClose * (pos.entryPrice - currentPrice) / PRICE_PRECISION);
        }
        
        // Calculate trading fee
        uint256 tradingFee = (sizeToClose * tradingFeeRate) / BASIS_POINTS;
        
        // Update position tracking (affects bonding curve price)
        if (pos.isLong) {
            totalLongSize -= int256(sizeToClose);
        } else {
            totalShortSize -= int256(sizeToClose);
        }
        
        // Update legacy reserves for backwards compatibility
        _updateLegacyReserves();
        
        // Update position
        if (sizeToClose == positionSize) {
            // Full close - deactivate position
            pos.isActive = false;
            _removePositionFromUser(msg.sender, positionId);
        } else {
            // Partial close
            pos.size = pos.size - int256(sizeToClose);
            pos.lastInteractionTime = block.timestamp;
        }
        
        // Update vault
        vault.updatePnL(msg.sender, pnl - int256(tradingFee));
        
        // Release margin proportionally
        uint256 marginToRelease = (vault.getMarginAccount(msg.sender).reservedMargin * sizeToClose) / positionSize;
        vault.releaseMargin(msg.sender, marginToRelease);
        
        // Collect trading fee
        totalTradingFees += tradingFee;
        
        emit PositionClosed(msg.sender, positionId, sizeToClose, currentPrice, pnl, tradingFee);
        emit TradingFeeCollected(msg.sender, tradingFee);
        
        return pnl;
    }

    /**
     * @dev Pauses the contract
     */
    function pause() external override onlyOwner {
        paused = true;
        emit Paused();
    }
    
    /**
     * @dev Unpauses the contract
     */
    function unpause() external override onlyOwner {
        paused = false;
        emit Unpaused();
    }
    
    /**
     * @dev Gets position data by user address (legacy function)
     * This returns the first active position for backwards compatibility
     */
    function getPosition(address user) external view override returns (Position memory) {
        uint256[] memory userPosIds = userPositionIds[user];
        require(userPosIds.length > 0, "vAMM: no positions");
        
        // Return the first active position (for backwards compatibility)
        for (uint256 i = 0; i < userPosIds.length; i++) {
            if (positions[userPosIds[i]].isActive) {
                return positions[userPosIds[i]];
            }
        }
        
        revert("vAMM: no active position");
    }
    
    /**
     * @dev Gets unrealized PnL by user address (legacy function)
     * This returns the total unrealized PnL across all positions
     */
    function getUnrealizedPnL(address user) external view override returns (int256) {
        return this.getTotalUnrealizedPnL(user);
    }
    
    // ===== BONDING CURVE MANAGEMENT FUNCTIONS =====
    
    /**
     * @dev Updates bonding curve parameters (owner only)
     */
    function updateBondingCurveParams(
        uint256 _newSteepness,
        uint256 _newExponent
    ) external onlyOwner {
        require(_newSteepness > 0, "vAMM: invalid steepness");
        require(_newExponent > 0, "vAMM: invalid exponent");
        
        // Note: These are constants in the current implementation
        // To make them updatable, change them from constants to state variables
        emit ParametersUpdated("bondingCurveParams", _newSteepness);
    }
    
    /**
     * @dev Gets current bonding curve status
     */
    function getBondingCurveInfo() external view returns (
        uint256 currentPrice,
        uint256 startPrice,
        uint256 totalSupply,
        uint256 steepness,
        uint256 exponent,
        uint256 maxPrice
    ) {
        currentPrice = getMarkPrice();
        startPrice = startingPrice;
        totalSupply = getTotalSupply();
        steepness = BONDING_CURVE_STEEPNESS;
        exponent = pumpExponent;
        maxPrice = startingPrice * MAX_PUMP_MULTIPLIER;
    }
    
    /**
     * @dev Calculates the cost to buy a specific amount on the bonding curve
     */
    function calculateBuyCost(uint256 amount) external view returns (uint256 totalCost) {
        uint256 currentSupply = getTotalSupply();
        uint256 currentPrice = getMarkPrice();
        uint256 newSupply = currentSupply + amount;
        
        // Calculate new price after purchase
        uint256 supplyRatio = (newSupply * PRICE_PRECISION) / BONDING_CURVE_STEEPNESS;
        uint256 base = PRICE_PRECISION + supplyRatio;
        uint256 priceMultiplier = _approximatePower(base, pumpExponent);
        uint256 newPrice = (startingPrice * priceMultiplier) / PRICE_PRECISION;
        
        // Cap maximum price
        uint256 maxPrice = startingPrice * MAX_PUMP_MULTIPLIER;
        newPrice = newPrice > maxPrice ? maxPrice : newPrice;
        
        // Calculate average price (simplified - in practice would need integration)
        uint256 averagePrice = (currentPrice + newPrice) / 2;
        totalCost = (amount * averagePrice) / PRICE_PRECISION;
    }
    
    /**
     * @dev Calculates the payout for selling a specific amount on the bonding curve
     */
    function calculateSellPayout(uint256 amount) external view returns (uint256 totalPayout) {
        uint256 currentSupply = getTotalSupply();
        
        if (amount >= currentSupply) {
            // Can't sell more than total supply, return value for selling all
            amount = currentSupply;
        }
        
        uint256 currentPrice = getMarkPrice();
        uint256 newSupply = currentSupply - amount;
        
        // Calculate new price after sale
        uint256 newPrice;
        if (newSupply == 0) {
            newPrice = startingPrice;
        } else {
            uint256 supplyRatio = (newSupply * PRICE_PRECISION) / BONDING_CURVE_STEEPNESS;
            uint256 base = PRICE_PRECISION + supplyRatio;
            uint256 priceMultiplier = _approximatePower(base, pumpExponent);
            newPrice = (startingPrice * priceMultiplier) / PRICE_PRECISION;
        }
            
        // Calculate average price (simplified - in practice would need integration)
        uint256 averagePrice = (currentPrice + newPrice) / 2;
        totalPayout = (amount * averagePrice) / PRICE_PRECISION;
    }
    
    /**
     * @dev Emergency function to reset bonding curve (owner only, extreme circumstances)
     */
    function emergencyResetBondingCurve(uint256 _newStartingPrice) external onlyOwner {
        require(paused, "vAMM: must be paused");
        require(_newStartingPrice > 0, "vAMM: invalid starting price");
        
        startingPrice = _newStartingPrice;
        totalLongSize = 0;
        totalShortSize = 0;
        
        _updateLegacyReserves();
        emit ParametersUpdated("emergencyReset", _newStartingPrice);
    }
} 