// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title VaultRouter
 * @dev Centralized vault for handling collateral, portfolio management, and settlement
 * Serves as the main interface between users and the orderbook system
 */
contract VaultRouter is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;
    
    bytes32 public constant ORDERBOOK_ROLE = keccak256("ORDERBOOK_ROLE");
    bytes32 public constant SETTLEMENT_ROLE = keccak256("SETTLEMENT_ROLE");
    
    IERC20 public collateralToken; // Mock USDC (upgradeable)
    
    // Portfolio tracking structures
    struct MarginSummary {
        uint256 totalCollateral;      // Total deposited collateral
        uint256 marginUsed;           // Margin locked in open positions
        uint256 marginReserved;       // Margin reserved for pending orders
        uint256 availableCollateral;  // Free collateral
        int256 realizedPnL;          // Realized profit/loss
        int256 unrealizedPnL;        // Unrealized profit/loss
        int256 portfolioValue;       // Total portfolio value
    }
    
    struct Position {
        bytes32 marketId;
        int256 size;                 // Positive for long, negative for short
        uint256 entryPrice;          // Price at which position was opened
        uint256 marginLocked;        // Margin locked for this position
        uint256 timestamp;           // When position was opened
    }
    
    struct PendingOrder {
        bytes32 orderId;
        bytes32 marketId;
        uint256 marginReserved;
        uint256 timestamp;
    }
    
    // User data mappings
    mapping(address => uint256) public userCollateral;
    mapping(address => int256) public userRealizedPnL;
    mapping(address => Position[]) public userPositions;
    mapping(address => PendingOrder[]) public userPendingOrders;
    mapping(address => mapping(bytes32 => uint256)) public userMarginByMarket;
    
    // Market data
    mapping(bytes32 => uint256) public marketMarkPrices;
    mapping(bytes32 => bool) public authorizedMarkets;
    
    // Events
    event CollateralDeposited(address indexed user, uint256 amount, uint256 newBalance);
    event CollateralWithdrawn(address indexed user, uint256 amount, uint256 newBalance);
    event MarginLocked(address indexed user, bytes32 indexed marketId, uint256 amount);
    event MarginReleased(address indexed user, bytes32 indexed marketId, uint256 amount);
    event MarginReserved(address indexed user, bytes32 indexed orderId, uint256 amount);
    event MarginUnreserved(address indexed user, bytes32 indexed orderId, uint256 amount);
    event PositionUpdated(address indexed user, bytes32 indexed marketId, int256 size, uint256 entryPrice);
    event PnLRealized(address indexed user, bytes32 indexed marketId, int256 pnl);
    event PortfolioUpdated(address indexed user, int256 portfolioValue, uint256 availableCollateral, uint256 timestamp);
    event MarkPriceUpdated(bytes32 indexed marketId, uint256 newPrice, uint256 timestamp);
    
    // LEGO Piece Events
    event CollateralTokenUpdated(address indexed oldToken, address indexed newToken, uint256 timestamp);
    event CollateralMigrationRequired(address indexed user, uint256 amount, address indexed oldToken, address indexed newToken);
    event ContractPauseStatusChanged(bool isPaused, uint256 timestamp);
    
    constructor(address _collateralToken, address _admin) {
        collateralToken = IERC20(_collateralToken);
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(SETTLEMENT_ROLE, _admin);
    }
    
    /**
     * @dev Deposits collateral to the vault
     * @param amount Amount of collateral to deposit
     */
    function depositCollateral(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "VaultRouter: amount must be positive");
        
        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        userCollateral[msg.sender] += amount;
        
        emit CollateralDeposited(msg.sender, amount, userCollateral[msg.sender]);
        _emitPortfolioUpdate(msg.sender);
    }
    
    /**
     * @dev Withdraws available collateral from the vault
     * @param amount Amount of collateral to withdraw
     */
    function withdrawCollateral(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "VaultRouter: amount must be positive");
        
        uint256 available = getAvailableCollateral(msg.sender);
        require(
            amount <= available, 
            string(abi.encodePacked(
                "VaultRouter: insufficient collateral for withdrawal. Requested: ",
                Strings.toString(amount),
                ", Available: ",
                Strings.toString(available),
                ", Total Collateral: ",
                Strings.toString(userCollateral[msg.sender]),
                ", Margin Used: ",
                Strings.toString(getTotalMarginUsed(msg.sender)),
                ", Margin Reserved: ",
                Strings.toString(getTotalMarginReserved(msg.sender))
            ))
        );
        
        userCollateral[msg.sender] -= amount;
        collateralToken.safeTransfer(msg.sender, amount);
        
        emit CollateralWithdrawn(msg.sender, amount, userCollateral[msg.sender]);
        _emitPortfolioUpdate(msg.sender);
    }
    
    /**
     * @dev Locks margin for a position (called by orderbook)
     * @param user User address
     * @param marketId Market identifier
     * @param amount Amount of margin to lock
     */
    function lockMargin(address user, bytes32 marketId, uint256 amount) external onlyRole(ORDERBOOK_ROLE) {
        require(authorizedMarkets[marketId], "VaultRouter: unauthorized market");
        
        uint256 available = getAvailableCollateral(user);
        require(
            available >= amount, 
            string(abi.encodePacked(
                "VaultRouter: insufficient collateral for margin lock. Required: ",
                Strings.toString(amount),
                ", Available: ",
                Strings.toString(available)
            ))
        );
        
        userMarginByMarket[user][marketId] += amount;
        emit MarginLocked(user, marketId, amount);
        _emitPortfolioUpdate(user);
    }
    
    /**
     * @dev Releases margin from a position (called by orderbook)
     * @param user User address
     * @param marketId Market identifier
     * @param amount Amount of margin to release
     */
    function releaseMargin(address user, bytes32 marketId, uint256 amount) external onlyRole(ORDERBOOK_ROLE) {
        require(userMarginByMarket[user][marketId] >= amount, "VaultRouter: insufficient margin locked");
        
        userMarginByMarket[user][marketId] -= amount;
        emit MarginReleased(user, marketId, amount);
        _emitPortfolioUpdate(user);
    }
    
    /**
     * @dev Reserves margin for a pending order (called by orderbook)
     * @param user User address
     * @param orderId Order identifier
     * @param marketId Market identifier
     * @param amount Amount of margin to reserve
     */
    function reserveMargin(address user, bytes32 orderId, bytes32 marketId, uint256 amount) external onlyRole(ORDERBOOK_ROLE) {
        require(authorizedMarkets[marketId], "VaultRouter: unauthorized market");
        
        uint256 available = getAvailableCollateral(user);
        require(
            available >= amount, 
            string(abi.encodePacked(
                "VaultRouter: insufficient collateral for margin reservation. Required: ",
                Strings.toString(amount),
                ", Available: ",
                Strings.toString(available),
                ", Total Collateral: ",
                Strings.toString(userCollateral[user]),
                ", Margin Used: ",
                Strings.toString(getTotalMarginUsed(user)),
                ", Margin Reserved: ",
                Strings.toString(getTotalMarginReserved(user))
            ))
        );
        
        userPendingOrders[user].push(PendingOrder({
            orderId: orderId,
            marketId: marketId,
            marginReserved: amount,
            timestamp: block.timestamp
        }));
        
        emit MarginReserved(user, orderId, amount);
        _emitPortfolioUpdate(user);
    }
    
    /**
     * @dev Unreserves margin from a cancelled/filled order (called by orderbook)
     * @param user User address
     * @param orderId Order identifier
     */
    function unreserveMargin(address user, bytes32 orderId) external onlyRole(ORDERBOOK_ROLE) {
        PendingOrder[] storage orders = userPendingOrders[user];
        
        for (uint256 i = 0; i < orders.length; i++) {
            if (orders[i].orderId == orderId) {
                uint256 amount = orders[i].marginReserved;
                
                // Remove order by swapping with last element
                orders[i] = orders[orders.length - 1];
                orders.pop();
                
                emit MarginUnreserved(user, orderId, amount);
                _emitPortfolioUpdate(user);
                return;
            }
        }
        revert("VaultRouter: order not found");
    }
    
    /**
     * @dev Updates user position (called by orderbook)
     * @param user User address
     * @param marketId Market identifier
     * @param sizeDelta Change in position size
     * @param entryPrice Entry price for the position change
     */
    function updatePosition(address user, bytes32 marketId, int256 sizeDelta, uint256 entryPrice) external onlyRole(ORDERBOOK_ROLE) {
        require(authorizedMarkets[marketId], "VaultRouter: unauthorized market");
        
        Position[] storage positions = userPositions[user];
        
        // Find existing position for this market
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId) {
                positions[i].size += sizeDelta;
                
                // Update entry price based on position change
                if (sizeDelta != 0) {
                    // Weighted average entry price calculation
                    uint256 existingNotional = uint256(positions[i].size > 0 ? positions[i].size : -positions[i].size) * positions[i].entryPrice;
                    uint256 newNotional = uint256(sizeDelta > 0 ? sizeDelta : -sizeDelta) * entryPrice;
                    uint256 totalSize = uint256(positions[i].size > 0 ? positions[i].size : -positions[i].size);
                    
                    if (totalSize > 0) {
                        positions[i].entryPrice = (existingNotional + newNotional) / totalSize;
                    }
                }
                
                // Remove position if size becomes zero
                if (positions[i].size == 0) {
                    positions[i] = positions[positions.length - 1];
                    positions.pop();
                }
                
                emit PositionUpdated(user, marketId, positions[i].size, entryPrice);
                _emitPortfolioUpdate(user);
                return;
            }
        }
        
        // Create new position if none exists
        if (sizeDelta != 0) {
            positions.push(Position({
                marketId: marketId,
                size: sizeDelta,
                entryPrice: entryPrice,
                marginLocked: 0, // This will be set by lockMargin
                timestamp: block.timestamp
            }));
            
            emit PositionUpdated(user, marketId, sizeDelta, entryPrice);
            _emitPortfolioUpdate(user);
        }
    }
    
    /**
     * @dev Realizes PnL for a user (called during settlement)
     * @param user User address
     * @param marketId Market identifier
     * @param pnl Profit/loss to realize
     */
    function realizePnL(address user, bytes32 marketId, int256 pnl) external onlyRole(SETTLEMENT_ROLE) {
        userRealizedPnL[user] += pnl;
        emit PnLRealized(user, marketId, pnl);
        _emitPortfolioUpdate(user);
    }
    
    /**
     * @dev Updates mark price for a market (called by price oracle or settlement)
     * @param marketId Market identifier
     * @param markPrice New mark price
     */
    function updateMarkPrice(bytes32 marketId, uint256 markPrice) external onlyRole(SETTLEMENT_ROLE) {
        marketMarkPrices[marketId] = markPrice;
        emit MarkPriceUpdated(marketId, markPrice, block.timestamp);
    }
    
    /**
     * @dev Authorizes a market for trading
     * @param marketId Market identifier
     * @param authorized Whether the market is authorized
     */
    function setMarketAuthorization(bytes32 marketId, bool authorized) external onlyRole(DEFAULT_ADMIN_ROLE) {
        authorizedMarkets[marketId] = authorized;
    }
    
    // === LEGO PIECE SETTERS FOR UPGRADABILITY ===
    
    /**
     * @dev Updates the collateral token address (for contract upgrades)
     * @param newCollateralToken Address of the new collateral token
     */
    function setCollateralToken(address newCollateralToken) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newCollateralToken != address(0), "VaultRouter: invalid collateral token");
        
        address oldToken = address(collateralToken);
        collateralToken = IERC20(newCollateralToken);
        
        emit CollateralTokenUpdated(oldToken, newCollateralToken, block.timestamp);
    }
    
    /**
     * @dev Emergency function to migrate user collateral to new token
     * @param users Array of user addresses to migrate
     * @param newToken New collateral token address
     */
    function migrateCollateral(address[] calldata users, address newToken) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newToken != address(0), "VaultRouter: invalid token");
        require(users.length > 0 && users.length <= 100, "VaultRouter: invalid user count");
        
        IERC20 oldToken = collateralToken;
        IERC20 newCollateralToken = IERC20(newToken);
        
        for (uint256 i = 0; i < users.length; i++) {
            address user = users[i];
            uint256 balance = userCollateral[user];
            
            if (balance > 0) {
                // Transfer old tokens back to user
                oldToken.safeTransfer(user, balance);
                
                // User needs to approve and deposit new tokens manually
                // This ensures they have control over the migration process
                emit CollateralMigrationRequired(user, balance, address(oldToken), newToken);
            }
        }
        
        // Update the collateral token
        collateralToken = newCollateralToken;
        emit CollateralTokenUpdated(address(oldToken), newToken, block.timestamp);
    }
    
    /**
     * @dev Pause status for emergency situations
     */
    bool public isPaused;
    
    function setPaused(bool paused) external onlyRole(DEFAULT_ADMIN_ROLE) {
        isPaused = paused;
        emit ContractPauseStatusChanged(paused, block.timestamp);
    }
    
    modifier whenNotPaused() {
        require(!isPaused, "VaultRouter: contract is paused");
        _;
    }
    
    // === FRONT-END FRIENDLY GETTERS ===
    
    /**
     * @dev Gets total portfolio value for a user
     * @param user User address
     * @return Portfolio value (collateral + realized PnL + unrealized PnL)
     */
    function getPortfolioValue(address user) public view returns (int256) {
        int256 unrealizedPnL = getUnrealizedPnL(user);
        return int256(userCollateral[user]) + userRealizedPnL[user] + unrealizedPnL;
    }
    
    /**
     * @dev Gets available collateral for a user
     * @param user User address
     * @return Available collateral (not locked or reserved)
     */
    function getAvailableCollateral(address user) public view returns (uint256) {
        uint256 totalCollateral = userCollateral[user];
        uint256 marginUsed = getTotalMarginUsed(user);
        uint256 marginReserved = getTotalMarginReserved(user);
        
        uint256 totalLocked = marginUsed + marginReserved;
        return totalCollateral > totalLocked ? totalCollateral - totalLocked : 0;
    }
    
    /**
     * @dev Gets comprehensive margin summary for a user
     * @param user User address
     * @return MarginSummary struct with all portfolio details
     */
    function getMarginSummary(address user) external view returns (MarginSummary memory) {
        int256 unrealizedPnL = getUnrealizedPnL(user);
        
        return MarginSummary({
            totalCollateral: userCollateral[user],
            marginUsed: getTotalMarginUsed(user),
            marginReserved: getTotalMarginReserved(user),
            availableCollateral: getAvailableCollateral(user),
            realizedPnL: userRealizedPnL[user],
            unrealizedPnL: unrealizedPnL,
            portfolioValue: getPortfolioValue(user)
        });
    }
    
    /**
     * @dev Gets unrealized PnL for a user across all positions
     * @param user User address
     * @return Total unrealized PnL
     */
    function getUnrealizedPnL(address user) public view returns (int256) {
        Position[] memory positions = userPositions[user];
        int256 totalUnrealizedPnL = 0;
        
        for (uint256 i = 0; i < positions.length; i++) {
            Position memory position = positions[i];
            uint256 markPrice = marketMarkPrices[position.marketId];
            
            if (markPrice > 0 && position.size != 0) {
                // Calculate PnL: (markPrice - entryPrice) * size
                int256 priceDiff = int256(markPrice) - int256(position.entryPrice);
                int256 positionPnL = (priceDiff * position.size) / int256(position.entryPrice);
                totalUnrealizedPnL += positionPnL;
            }
        }
        
        return totalUnrealizedPnL;
    }
    
    /**
     * @dev Gets total margin used across all positions
     * @param user User address
     * @return Total margin used
     */
    function getTotalMarginUsed(address user) public view returns (uint256) {
        Position[] memory positions = userPositions[user];
        uint256 totalMargin = 0;
        
        for (uint256 i = 0; i < positions.length; i++) {
            totalMargin += userMarginByMarket[user][positions[i].marketId];
        }
        
        return totalMargin;
    }
    
    /**
     * @dev Gets total margin reserved for pending orders
     * @param user User address
     * @return Total margin reserved
     */
    function getTotalMarginReserved(address user) public view returns (uint256) {
        PendingOrder[] memory orders = userPendingOrders[user];
        uint256 totalReserved = 0;
        
        for (uint256 i = 0; i < orders.length; i++) {
            totalReserved += orders[i].marginReserved;
        }
        
        return totalReserved;
    }
    
    /**
     * @dev Gets all positions for a user
     * @param user User address
     * @return Array of user positions
     */
    function getUserPositions(address user) external view returns (Position[] memory) {
        return userPositions[user];
    }
    
    /**
     * @dev Gets all pending orders for a user
     * @param user User address
     * @return Array of user pending orders
     */
    function getUserPendingOrders(address user) external view returns (PendingOrder[] memory) {
        return userPendingOrders[user];
    }
    
    /**
     * @dev Internal function to emit portfolio update events
     * @param user User address
     */
    function _emitPortfolioUpdate(address user) internal {
        emit PortfolioUpdated(
            user,
            getPortfolioValue(user),
            getAvailableCollateral(user),
            block.timestamp
        );
    }
}
