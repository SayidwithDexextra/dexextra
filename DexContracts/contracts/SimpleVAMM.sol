// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ISimpleVAMM.sol";
import "./ISimpleVault.sol";
import "./ISimplePriceOracle.sol";

/**
 * @title SimpleVAMM
 * @dev Simplified traditional futures vAMM with sensitive price discovery
 * Both longs and shorts affect price equally - true futures market behavior
 */
contract SimpleVAMM is ISimpleVAMM {
    address public owner;
    ISimpleVault public vault;
    ISimplePriceOracle public oracle;
    
    // Trading parameters
    uint256 public constant PRICE_PRECISION = 1e18;
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant MAX_LEVERAGE = 50;
    uint256 public constant MIN_LEVERAGE = 1;
    
    // Simplified fee structure
    uint256 public tradingFeeRate = 30; // 0.3%
    uint256 public maintenanceMarginRatio = 500; // 5%
    
    // SENSITIVE PRICE DISCOVERY - Much smaller reserves for high sensitivity
    uint256 public baseVirtualBaseReserves = 100 * PRICE_PRECISION; // 100x smaller than legacy
    uint256 public baseVirtualQuoteReserves = 100 * PRICE_PRECISION; // 100x smaller than legacy
    
    // Sensitive dynamic reserves - lower scale factor = more price movement
    uint256 public volumeScaleFactor = 50; // 20x more sensitive than legacy (was 1000)
    uint256 public minReserveMultiplier = 1e18; // Minimum 1x
    uint256 public maxReserveMultiplier = 10e18; // Maximum 10x (was 100x)
    
    // Position tracking - traditional futures style
    mapping(uint256 => Position) public positions;
    mapping(address => uint256[]) public userPositionIds;
    mapping(uint256 => address) public positionOwner;
    uint256 public globalPositionId = 1;
    
    // Global state - both longs and shorts affect price
    int256 public totalLongSize;
    int256 public totalShortSize;
    int256 public netPosition; // totalLongSize - totalShortSize
    
    // Events
    event PositionOpened(address indexed user, uint256 indexed positionId, bool isLong, uint256 size, uint256 price, uint256 leverage);
    event PositionClosed(address indexed user, uint256 indexed positionId, uint256 size, uint256 price, int256 pnl);
    event PriceUpdated(uint256 newPrice, int256 netPosition);
    
    constructor(address _vault, address _oracle, uint256 _initialPrice) {
        owner = msg.sender;
        vault = ISimpleVault(_vault);
        oracle = ISimplePriceOracle(_oracle);
        
        // Initialize reserves based on initial price
        baseVirtualQuoteReserves = (_initialPrice * baseVirtualBaseReserves) / PRICE_PRECISION;
    }
    
    /**
     * @dev Traditional futures price calculation with high sensitivity
     * Both longs and shorts affect the virtual reserves equally
     */
    function getMarkPrice() public view override returns (uint256) {
        (uint256 baseReserves, uint256 quoteReserves) = getEffectiveReserves();
        return (quoteReserves * PRICE_PRECISION) / baseReserves;
    }
    
    /**
     * @dev Calculates sensitive virtual reserves based on net position
     * Traditional futures: net long position = price up, net short = price down
     */
    function getEffectiveReserves() public view returns (uint256 baseReserves, uint256 quoteReserves) {
        // Calculate total trading volume for dynamic scaling
        uint256 totalVolume = uint256(totalLongSize >= 0 ? totalLongSize : -totalLongSize) + 
                              uint256(totalShortSize >= 0 ? totalShortSize : -totalShortSize);
        
        // Dynamic multiplier - more volume = more liquidity but still sensitive
        uint256 dynamicMultiplier = minReserveMultiplier;
        if (totalVolume > 0) {
            uint256 volumeMultiplier = (totalVolume * PRICE_PRECISION) / volumeScaleFactor;
            dynamicMultiplier = volumeMultiplier > minReserveMultiplier ? volumeMultiplier : minReserveMultiplier;
            dynamicMultiplier = dynamicMultiplier < maxReserveMultiplier ? dynamicMultiplier : maxReserveMultiplier;
        }
        
        // Apply multiplier to base reserves
        baseReserves = (baseVirtualBaseReserves * dynamicMultiplier) / PRICE_PRECISION;
        quoteReserves = (baseVirtualQuoteReserves * dynamicMultiplier) / PRICE_PRECISION;
        
        // CRITICAL: Apply net position impact (traditional futures behavior)
        // Net long position reduces base reserves (pushes price up)
        // Net short position increases base reserves (pushes price down)
        if (netPosition > 0) {
            // Net long - reduce base reserves to increase price
            uint256 impact = uint256(netPosition) / 10; // Reduced impact divisor for more sensitivity
            baseReserves = baseReserves > impact ? baseReserves - impact : baseReserves / 2;
        } else if (netPosition < 0) {
            // Net short - increase base reserves to decrease price
            uint256 impact = uint256(-netPosition) / 10; // Reduced impact divisor for more sensitivity
            baseReserves += impact;
        }
    }
    
    /**
     * @dev Gets price impact for a trade (traditional futures style)
     */
    function getPriceImpact(uint256 size, bool isLong) external view override returns (uint256) {
        uint256 currentPrice = getMarkPrice();
        (uint256 baseReserves, uint256 quoteReserves) = getEffectiveReserves();
        
        uint256 newPrice;
        if (isLong) {
            // Long increases net position - reduces base reserves
            uint256 impact = size / 10; // High sensitivity
            uint256 newBaseReserves = baseReserves > impact ? baseReserves - impact : baseReserves / 2;
            newPrice = (quoteReserves * PRICE_PRECISION) / newBaseReserves;
        } else {
            // Short decreases net position - increases base reserves
            uint256 impact = size / 10; // High sensitivity
            uint256 newBaseReserves = baseReserves + impact;
            newPrice = (quoteReserves * PRICE_PRECISION) / newBaseReserves;
        }
        
        return newPrice > currentPrice ? newPrice - currentPrice : currentPrice - newPrice;
    }
    
    /**
     * @dev Opens a new position (simplified)
     */
    function openPosition(
        uint256 collateralAmount,
        bool isLong,
        uint256 leverage,
        uint256 minPrice,
        uint256 maxPrice
    ) external override returns (uint256 positionId) {
        require(collateralAmount > 0, "Invalid collateral");
        require(leverage >= MIN_LEVERAGE && leverage <= MAX_LEVERAGE, "Invalid leverage");
        
        uint256 positionSize = collateralAmount * leverage;
        uint256 currentPrice = getMarkPrice();
        require(currentPrice >= minPrice && currentPrice <= maxPrice, "Price slippage");
        
        // Simple fee calculation
        uint256 tradingFee = (positionSize * tradingFeeRate) / BASIS_POINTS;
        uint256 totalCost = collateralAmount + tradingFee;
        
        // Reserve margin in vault (simplified)
        vault.reserveMargin(msg.sender, totalCost);
        
        // Create position
        positionId = globalPositionId++;
        
        // Update position tracking - TRADITIONAL FUTURES STYLE
        if (isLong) {
            totalLongSize += int256(positionSize);
        } else {
            totalShortSize += int256(positionSize);
        }
        
        // Update net position (this affects price immediately)
        netPosition = totalLongSize - totalShortSize;
        
        // Store position
        positions[positionId] = Position({
            positionId: positionId,
            size: int256(positionSize),
            isLong: isLong,
            entryPrice: currentPrice,
            entryFundingIndex: 0, // Simplified - no funding for now
            lastInteractionTime: block.timestamp,
            isActive: true
        });
        
        positionOwner[positionId] = msg.sender;
        userPositionIds[msg.sender].push(positionId);
        
        emit PositionOpened(msg.sender, positionId, isLong, positionSize, currentPrice, leverage);
        emit PriceUpdated(getMarkPrice(), netPosition);
        
        return positionId;
    }
    
    /**
     * @dev Closes a position (simplified)
     */
    function closePosition(
        uint256 positionId,
        uint256 sizeToClose,
        uint256 minPrice,
        uint256 maxPrice
    ) external override returns (int256 pnl) {
        require(positionOwner[positionId] == msg.sender, "Not position owner");
        
        Position storage pos = positions[positionId];
        require(pos.isActive, "Position not active");
        
        uint256 positionSize = uint256(pos.size);
        require(sizeToClose <= positionSize, "Invalid size");
        
        uint256 currentPrice = getMarkPrice();
        require(currentPrice >= minPrice && currentPrice <= maxPrice, "Price slippage");
        
        // Calculate PnL (traditional futures)
        if (pos.isLong) {
            pnl = int256(sizeToClose * (currentPrice - pos.entryPrice) / PRICE_PRECISION);
        } else {
            pnl = int256(sizeToClose * (pos.entryPrice - currentPrice) / PRICE_PRECISION);
        }
        
        // Update position tracking - TRADITIONAL FUTURES STYLE
        if (pos.isLong) {
            totalLongSize -= int256(sizeToClose);
        } else {
            totalShortSize -= int256(sizeToClose);
        }
        
        // Update net position (affects price immediately)
        netPosition = totalLongSize - totalShortSize;
        
        // Update or close position
        if (sizeToClose == positionSize) {
            pos.isActive = false;
            _removePositionFromUser(msg.sender, positionId);
        } else {
            pos.size = pos.size - int256(sizeToClose);
        }
        
        // Simple fee
        uint256 tradingFee = (sizeToClose * tradingFeeRate) / BASIS_POINTS;
        
        // Update vault with PnL
        vault.updatePnL(msg.sender, pnl - int256(tradingFee));
        
        // Release margin proportionally
        uint256 marginToRelease = (vault.getReservedMargin(msg.sender) * sizeToClose) / positionSize;
        vault.releaseMargin(msg.sender, marginToRelease);
        
        emit PositionClosed(msg.sender, positionId, sizeToClose, currentPrice, pnl);
        emit PriceUpdated(getMarkPrice(), netPosition);
        
        return pnl;
    }
    
    /**
     * @dev Helper to remove position from user's list
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
     * @dev Get user's active positions
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
     * @dev Calculate unrealized PnL for a position
     */
    function getUnrealizedPnL(uint256 positionId) external view override returns (int256) {
        Position storage pos = positions[positionId];
        if (!pos.isActive) return 0;
        
        uint256 currentPrice = getMarkPrice();
        uint256 positionSize = uint256(pos.size);
        
        if (pos.isLong) {
            return int256(positionSize * (currentPrice - pos.entryPrice) / PRICE_PRECISION);
        } else {
            return int256(positionSize * (pos.entryPrice - currentPrice) / PRICE_PRECISION);
        }
    }
    
    /**
     * @dev Get position by ID
     */
    function getPosition(uint256 positionId) external view override returns (Position memory) {
        return positions[positionId];
    }
    
    /**
     * @dev Get market summary
     */
    function getMarketSummary() external view returns (
        uint256 markPrice,
        int256 netPositionSize,
        uint256 totalLongSizeUint,
        uint256 totalShortSizeUint,
        uint256 baseReserves,
        uint256 quoteReserves
    ) {
        markPrice = getMarkPrice();
        netPositionSize = netPosition;
        totalLongSizeUint = uint256(totalLongSize);
        totalShortSizeUint = uint256(totalShortSize);
        (baseReserves, quoteReserves) = getEffectiveReserves();
    }
    
    /**
     * @dev Admin function to update sensitivity (testing only)
     */
    function updateSensitivity(uint256 _volumeScaleFactor) external {
        require(msg.sender == owner, "Not owner");
        require(_volumeScaleFactor > 0 && _volumeScaleFactor <= 1000, "Invalid scale");
        volumeScaleFactor = _volumeScaleFactor;
    }
    
    /**
     * @dev Transfer ownership
     */
    function transferOwnership(address newOwner) external {
        require(msg.sender == owner, "Not owner");
        require(newOwner != address(0), "Invalid owner");
        owner = newOwner;
    }
} 