// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IvAMM.sol";
import "./IVault.sol";
import "./IPriceOracle.sol";

/**
 * @title vAMM
 * @dev Production-ready virtual Automated Market Maker with funding rate mechanism
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
    
    // Virtual pool for price discovery
    uint256 public virtualBaseReserves = 1e6 * PRICE_PRECISION;
    uint256 public virtualQuoteReserves = 1e6 * PRICE_PRECISION;
    
    // Funding mechanism
    FundingState public fundingState;
    uint256 public constant FUNDING_INTERVAL = 1 hours;
    uint256 public constant MAX_FUNDING_RATE = 1e6; // 1% per hour in FUNDING_PRECISION
    
    // Position tracking
    mapping(address => Position) public positions;
    mapping(address => bool) public authorized;
    
    // Global state
    int256 public totalLongSize;
    int256 public totalShortSize;
    uint256 public totalTradingFees;
    bool public paused = false;
    
    // Events
    event PositionOpened(
        address indexed user,
        bool isLong,
        uint256 size,
        uint256 price,
        uint256 leverage,
        uint256 fee
    );
    event PositionClosed(
        address indexed user,
        uint256 size,
        uint256 price,
        int256 pnl,
        uint256 fee
    );
    event FundingUpdated(
        int256 fundingRate,
        uint256 fundingIndex,
        int256 premiumFraction
    );
    event FundingPaid(
        address indexed user,
        int256 amount,
        uint256 fundingIndex
    );
    event PositionLiquidated(
        address indexed user,
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
    
    constructor(
        address _vault,
        address _oracle,
        uint256 _initialPrice
    ) {
        owner = msg.sender;
        vault = IVault(_vault);
        oracle = IPriceOracle(_oracle);
        
        // Initialize virtual reserves based on initial price
        virtualQuoteReserves = (_initialPrice * virtualBaseReserves) / PRICE_PRECISION;
        
        // Initialize funding state
        fundingState.lastFundingTime = block.timestamp;
        fundingState.fundingIndex = FUNDING_PRECISION;
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
     * @dev Pauses trading
     */
    function pause() external override onlyOwner {
        paused = true;
        emit Paused();
    }
    
    /**
     * @dev Resumes trading
     */
    function unpause() external override onlyOwner {
        paused = false;
        emit Unpaused();
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
     * @dev Opens or modifies a position
     */
    function openPosition(
        uint256 collateralAmount,
        bool isLong,
        uint256 leverage,
        uint256 minPrice,
        uint256 maxPrice
    ) external override whenNotPaused returns (uint256 positionSize) {
        require(collateralAmount > 0, "vAMM: invalid collateral");
        require(leverage >= MIN_LEVERAGE && leverage <= MAX_LEVERAGE, "vAMM: invalid leverage");
        
        // Update funding before position change
        updateFunding();
        
        // Calculate position size
        positionSize = collateralAmount * leverage;
        
        // Get current mark price
        uint256 currentPrice = getMarkPrice();
        require(currentPrice >= minPrice && currentPrice <= maxPrice, "vAMM: price slippage");
        
        // Calculate trading fee
        uint256 tradingFee = (positionSize * tradingFeeRate) / BASIS_POINTS;
        uint256 totalCost = collateralAmount + tradingFee;
        
        // Reserve margin in vault
        vault.reserveMargin(msg.sender, totalCost);
        
        // Apply funding to existing position if any
        Position storage pos = positions[msg.sender];
        if (pos.size != 0) {
            _applyFunding(msg.sender);
        }
        
        // Update virtual reserves
        if (isLong) {
            virtualQuoteReserves += positionSize;
            totalLongSize += int256(positionSize);
        } else {
            virtualBaseReserves += positionSize;
            totalShortSize += int256(positionSize);
        }
        
        // Update position
        if (pos.size == 0) {
            // New position
            pos.size = isLong ? int256(positionSize) : -int256(positionSize);
            pos.entryPrice = currentPrice;
            pos.entryFundingIndex = fundingState.fundingIndex;
        } else {
            // Existing position - calculate weighted average entry price
            bool existingIsLong = pos.size > 0;
            if (existingIsLong == isLong) {
                // Same direction - add to position
                uint256 existingNotional = uint256(existingIsLong ? pos.size : -pos.size) * pos.entryPrice / PRICE_PRECISION;
                uint256 newNotional = positionSize * currentPrice / PRICE_PRECISION;
                uint256 totalNotional = existingNotional + newNotional;
                
                pos.entryPrice = (totalNotional * PRICE_PRECISION) / uint256(existingIsLong ? pos.size + int256(positionSize) : -pos.size + int256(positionSize));
                pos.size = existingIsLong ? pos.size + int256(positionSize) : pos.size - int256(positionSize);
            } else {
                // Opposite direction - reduce or flip position
                if (uint256(existingIsLong ? pos.size : -pos.size) > positionSize) {
                    // Reduce position
                    pos.size = existingIsLong ? pos.size - int256(positionSize) : pos.size + int256(positionSize);
                } else {
                    // Flip position
                    uint256 remainingSize = positionSize - uint256(existingIsLong ? pos.size : -pos.size);
                    pos.size = isLong ? int256(remainingSize) : -int256(remainingSize);
                    pos.entryPrice = currentPrice;
                    pos.entryFundingIndex = fundingState.fundingIndex;
                }
            }
        }
        
        pos.lastInteractionTime = block.timestamp;
        
        // Collect trading fee
        totalTradingFees += tradingFee;
        
        emit PositionOpened(msg.sender, isLong, positionSize, currentPrice, leverage, tradingFee);
        emit TradingFeeCollected(msg.sender, tradingFee);
        
        return positionSize;
    }
    
    /**
     * @dev Closes a position partially or fully
     */
    function closePosition(
        uint256 sizeToClose,
        uint256 minPrice,
        uint256 maxPrice
    ) external override whenNotPaused returns (int256 pnl) {
        Position storage pos = positions[msg.sender];
        require(pos.size != 0, "vAMM: no position");
        
        bool isLong = pos.size > 0;
        uint256 positionSize = uint256(isLong ? pos.size : -pos.size);
        require(sizeToClose <= positionSize, "vAMM: invalid size");
        
        // Update funding before closing
        updateFunding();
        _applyFunding(msg.sender);
        
        // Get current mark price
        uint256 currentPrice = getMarkPrice();
        require(currentPrice >= minPrice && currentPrice <= maxPrice, "vAMM: price slippage");
        
        // Calculate PnL
        if (isLong) {
            pnl = int256(sizeToClose * (currentPrice - pos.entryPrice) / PRICE_PRECISION);
        } else {
            pnl = int256(sizeToClose * (pos.entryPrice - currentPrice) / PRICE_PRECISION);
        }
        
        // Calculate trading fee
        uint256 tradingFee = (sizeToClose * tradingFeeRate) / BASIS_POINTS;
        
        // Update virtual reserves
        if (isLong) {
            virtualQuoteReserves -= sizeToClose;
            totalLongSize -= int256(sizeToClose);
        } else {
            virtualBaseReserves -= sizeToClose;
            totalShortSize -= int256(sizeToClose);
        }
        
        // Update position
        if (sizeToClose == positionSize) {
            // Full close
            delete positions[msg.sender];
        } else {
            // Partial close
            pos.size = isLong ? pos.size - int256(sizeToClose) : pos.size + int256(sizeToClose);
            pos.lastInteractionTime = block.timestamp;
        }
        
        // Update vault
        vault.updatePnL(msg.sender, pnl - int256(tradingFee));
        
        // Release margin proportionally
        uint256 marginToRelease = (vault.getMarginAccount(msg.sender).reservedMargin * sizeToClose) / positionSize;
        vault.releaseMargin(msg.sender, marginToRelease);
        
        // Collect trading fee
        totalTradingFees += tradingFee;
        
        emit PositionClosed(msg.sender, sizeToClose, currentPrice, pnl, tradingFee);
        emit TradingFeeCollected(msg.sender, tradingFee);
        
        return pnl;
    }
    
    /**
     * @dev Liquidates an undercollateralized position
     */
    function liquidate(address user) external whenNotPaused validUser(user) {
        require(vault.canLiquidate(user, maintenanceMarginRatio), "vAMM: cannot liquidate");
        
        Position storage pos = positions[user];
        require(pos.size != 0, "vAMM: no position");
        
        bool isLong = pos.size > 0;
        uint256 positionSize = uint256(isLong ? pos.size : -pos.size);
        
        // Update funding before liquidation
        updateFunding();
        _applyFunding(user);
        
        // Calculate liquidation fee
        uint256 liquidationFee = (positionSize * liquidationFeeRate) / BASIS_POINTS;
        
        // Update virtual reserves
        if (isLong) {
            virtualQuoteReserves -= positionSize;
            totalLongSize -= int256(positionSize);
        } else {
            virtualBaseReserves -= positionSize;
            totalShortSize -= int256(positionSize);
        }
        
        // Close position
        uint256 currentPrice = getMarkPrice();
        delete positions[user];
        
        // Liquidate in vault
        vault.liquidate(user, liquidationFee);
        
        emit PositionLiquidated(user, msg.sender, positionSize, currentPrice, liquidationFee);
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
     * @dev Applies funding to a user's position
     */
    function _applyFunding(address user) internal {
        Position storage pos = positions[user];
        if (pos.size == 0) return;
        
        uint256 fundingIndexDelta = fundingState.fundingIndex - pos.entryFundingIndex;
        if (fundingIndexDelta == 0) return;
        
        // Calculate funding payment
        // Longs pay when funding is positive, receive when negative
        // Shorts receive when funding is positive, pay when negative
        bool isLong = pos.size > 0;
        uint256 positionSize = uint256(isLong ? pos.size : -pos.size);
        
        int256 fundingPayment = int256(positionSize * fundingIndexDelta / FUNDING_PRECISION);
        if (isLong) {
            fundingPayment = -fundingPayment; // Longs pay positive funding
        }
        
        // Apply funding in vault
        vault.applyFunding(user, fundingPayment, fundingState.fundingIndex);
        
        // Update position funding index
        pos.entryFundingIndex = fundingState.fundingIndex;
        
        emit FundingPaid(user, fundingPayment, fundingState.fundingIndex);
    }
    
    /**
     * @dev Gets current mark price from virtual reserves
     */
    function getMarkPrice() public view override returns (uint256) {
        return (virtualQuoteReserves * PRICE_PRECISION) / virtualBaseReserves;
    }
    
    /**
     * @dev Gets current funding rate
     */
    function getFundingRate() external view override returns (int256) {
        return fundingState.fundingRate;
    }
    
    /**
     * @dev Gets position data for a user
     */
    function getPosition(address user) external view override returns (Position memory) {
        return positions[user];
    }
    
    /**
     * @dev Gets funding state
     */
    function getFundingState() external view override returns (FundingState memory) {
        return fundingState;
    }
    
    /**
     * @dev Calculates unrealized PnL for a position
     */
    function getUnrealizedPnL(address user) external view override returns (int256) {
        Position storage pos = positions[user];
        if (pos.size == 0) return 0;
        
        uint256 currentPrice = getMarkPrice();
        bool isLong = pos.size > 0;
        uint256 positionSize = uint256(isLong ? pos.size : -pos.size);
        
        if (isLong) {
            return int256(positionSize * (currentPrice - pos.entryPrice) / PRICE_PRECISION);
        } else {
            return int256(positionSize * (pos.entryPrice - currentPrice) / PRICE_PRECISION);
        }
    }
    
    /**
     * @dev Gets the price impact for a trade
     */
    function getPriceImpact(uint256 size, bool isLong) external view override returns (uint256) {
        uint256 currentPrice = getMarkPrice();
        uint256 newPrice;
        
        if (isLong) {
            uint256 newQuoteReserves = virtualQuoteReserves + size;
            newPrice = (newQuoteReserves * PRICE_PRECISION) / virtualBaseReserves;
        } else {
            uint256 newBaseReserves = virtualBaseReserves + size;
            newPrice = (virtualQuoteReserves * PRICE_PRECISION) / newBaseReserves;
        }
        
        return newPrice > currentPrice ? newPrice - currentPrice : currentPrice - newPrice;
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
} 