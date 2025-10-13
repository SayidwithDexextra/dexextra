// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./VaultRouter.sol";
import "./OrderBook.sol";
import "./OrderBookFactoryMinimal.sol";

/**
 * @title TradingRouter
 * @dev Centralized router for trading operations across all markets
 * Provides unified interface while maintaining modular OrderBook architecture
 */
contract TradingRouter is AccessControl, ReentrancyGuard {
    
    VaultRouter public vaultRouter; // Upgradeable reference
    OrderBookFactoryMinimal public factory; // Upgradeable reference
    
    // Advanced trading parameters
    struct MultiMarketOrder {
        bytes32 marketId;
        uint8 side;           // 0 = BUY, 1 = SELL
        uint256 size;
        uint256 price;        // 0 for market orders
    }
    
    struct RebalanceParams {
        bytes32 marketId;
        int256 targetSize;    // Positive for long, negative for short, 0 to close
    }
    
    // Events
    event MultiMarketOrderExecuted(address indexed user, uint256 orderCount, uint256 timestamp);
    event PortfolioRebalanced(address indexed user, uint256 marketCount, uint256 timestamp);
    event EmergencyPositionsClosed(address indexed user, uint256 positionCount, uint256 timestamp);
    
    // LEGO Piece Events
    event VaultRouterUpdated(address indexed oldVaultRouter, address indexed newVaultRouter, uint256 timestamp);
    event FactoryUpdated(address indexed oldFactory, address indexed newFactory, uint256 timestamp);
    event ContractPauseStatusChanged(bool isPaused, uint256 timestamp);
    
    constructor(address _vaultRouter, address _factory, address _admin) {
        vaultRouter = VaultRouter(_vaultRouter);
        factory = OrderBookFactoryMinimal(_factory);
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }
    
    // === UNIFIED TRADING INTERFACE ===
    
    /**
     * @dev Place limit order on any market with unified interface
     * @param marketId Market identifier
     * @param side Order side (0 = BUY, 1 = SELL)
     * @param size Position size
     * @param price Limit price
     * @return orderId Generated order ID
     */
    function placeLimitOrder(
        bytes32 marketId,
        uint8 side,
        uint256 size,
        uint256 price
    ) external nonReentrant whenNotPaused returns (bytes32 orderId) {
        OrderBook orderBook = _getOrderBook(marketId);
        return orderBook.placeLimitOrder(
            side == 0 ? OrderBook.OrderSide.BUY : OrderBook.OrderSide.SELL,
            size,
            price
        );
    }
    
    /**
     * @dev Place market order on any market with unified interface
     * @param marketId Market identifier
     * @param side Order side (0 = BUY, 1 = SELL)
     * @param size Position size
     * @return orderId Generated order ID
     */
    function placeMarketOrder(
        bytes32 marketId,
        uint8 side,
        uint256 size
    ) external nonReentrant returns (bytes32 orderId) {
        OrderBook orderBook = _getOrderBook(marketId);
        return orderBook.placeMarketOrder(
            side == 0 ? OrderBook.OrderSide.BUY : OrderBook.OrderSide.SELL,
            size
        );
    }
    
    /**
     * @dev Cancel order on any market with unified interface
     * @param marketId Market identifier
     * @param orderId Order ID to cancel
     */
    function cancelOrder(bytes32 marketId, bytes32 orderId) external nonReentrant {
        OrderBook orderBook = _getOrderBook(marketId);
        orderBook.cancelOrder(orderId);
    }
    
    // === ADVANCED TRADING FEATURES ===
    
    /**
     * @dev Place multiple orders across different markets in single transaction
     * @param orders Array of multi-market orders
     * @return orderIds Array of generated order IDs
     */
    function placeMultiMarketOrders(MultiMarketOrder[] calldata orders) 
        external 
        nonReentrant 
        returns (bytes32[] memory orderIds) 
    {
        require(orders.length > 0 && orders.length <= 10, "TradingRouter: invalid order count");
        
        orderIds = new bytes32[](orders.length);
        
        for (uint256 i = 0; i < orders.length; i++) {
            MultiMarketOrder memory order = orders[i];
            OrderBook orderBook = _getOrderBook(order.marketId);
            
            if (order.price == 0) {
                // Market order
                orderIds[i] = orderBook.placeMarketOrder(
                    order.side == 0 ? OrderBook.OrderSide.BUY : OrderBook.OrderSide.SELL,
                    order.size
                );
            } else {
                // Limit order
                orderIds[i] = orderBook.placeLimitOrder(
                    order.side == 0 ? OrderBook.OrderSide.BUY : OrderBook.OrderSide.SELL,
                    order.size,
                    order.price
                );
            }
        }
        
        emit MultiMarketOrderExecuted(msg.sender, orders.length, block.timestamp);
        return orderIds;
    }
    
    /**
     * @dev Close position in specific market
     * @param marketId Market identifier
     * @param size Size to close (0 = close entire position)
     */
    function closePosition(bytes32 marketId, uint256 size) external nonReentrant {
        VaultRouter.Position[] memory positions = vaultRouter.getUserPositions(msg.sender);
        
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId) {
                VaultRouter.Position memory position = positions[i];
                uint256 closeSize = size == 0 ? 
                    uint256(position.size > 0 ? position.size : -position.size) : size;
                
                // Place opposite order to close position
                OrderBook orderBook = _getOrderBook(marketId);
                orderBook.placeMarketOrder(
                    position.size > 0 ? OrderBook.OrderSide.SELL : OrderBook.OrderSide.BUY,
                    closeSize
                );
                break;
            }
        }
    }
    
    /**
     * @dev Emergency function to close all positions across all markets
     */
    function emergencyCloseAllPositions() external nonReentrant {
        VaultRouter.Position[] memory positions = vaultRouter.getUserPositions(msg.sender);
        uint256 closedCount = 0;
        
        for (uint256 i = 0; i < positions.length; i++) {
            VaultRouter.Position memory position = positions[i];
            
            try this.closePosition(position.marketId, 0) {
                closedCount++;
            } catch {
                // Continue closing other positions even if one fails
                continue;
            }
        }
        
        emit EmergencyPositionsClosed(msg.sender, closedCount, block.timestamp);
    }
    
    /**
     * @dev Rebalance portfolio to target allocations
     * @param targets Array of target positions
     */
    function rebalancePortfolio(RebalanceParams[] calldata targets) external nonReentrant {
        require(targets.length > 0 && targets.length <= 20, "TradingRouter: invalid target count");
        
        VaultRouter.Position[] memory currentPositions = vaultRouter.getUserPositions(msg.sender);
        
        for (uint256 i = 0; i < targets.length; i++) {
            RebalanceParams memory target = targets[i];
            int256 currentSize = 0;
            
            // Find current position size
            for (uint256 j = 0; j < currentPositions.length; j++) {
                if (currentPositions[j].marketId == target.marketId) {
                    currentSize = currentPositions[j].size;
                    break;
                }
            }
            
            // Calculate size difference
            int256 sizeDifference = target.targetSize - currentSize;
            
            if (sizeDifference != 0) {
                OrderBook orderBook = _getOrderBook(target.marketId);
                
                // Place market order to adjust position
                orderBook.placeMarketOrder(
                    sizeDifference > 0 ? OrderBook.OrderSide.BUY : OrderBook.OrderSide.SELL,
                    uint256(sizeDifference > 0 ? sizeDifference : -sizeDifference)
                );
            }
        }
        
        emit PortfolioRebalanced(msg.sender, targets.length, block.timestamp);
    }
    
    // === UNIFIED MARKET DATA ===
    
    /**
     * @dev Get order book depth across multiple markets
     * @param marketIds Array of market identifiers
     * @param levels Number of price levels per market
     * @return bidPrices Array of bid prices for each market
     * @return bidSizes Array of bid sizes for each market
     * @return askPrices Array of ask prices for each market
     * @return askSizes Array of ask sizes for each market
     */
    function getMultiMarketDepth(bytes32[] calldata marketIds, uint256 levels) 
        external 
        view 
        returns (
            uint256[][] memory bidPrices,
            uint256[][] memory bidSizes,
            uint256[][] memory askPrices,
            uint256[][] memory askSizes
        ) 
    {
        bidPrices = new uint256[][](marketIds.length);
        bidSizes = new uint256[][](marketIds.length);
        askPrices = new uint256[][](marketIds.length);
        askSizes = new uint256[][](marketIds.length);
        
        for (uint256 i = 0; i < marketIds.length; i++) {
            OrderBook orderBook = _getOrderBook(marketIds[i]);
            (bidPrices[i], bidSizes[i], askPrices[i], askSizes[i]) = 
                orderBook.getOrderBookDepth(levels);
        }
    }
    
    /**
     * @dev Get best prices across multiple markets
     * @param marketIds Array of market identifiers
     * @return bestBids Array of best bid prices
     * @return bestAsks Array of best ask prices
     */
    function getMultiMarketPrices(bytes32[] calldata marketIds) 
        external 
        view 
        returns (uint256[] memory bestBids, uint256[] memory bestAsks) 
    {
        bestBids = new uint256[](marketIds.length);
        bestAsks = new uint256[](marketIds.length);
        
        for (uint256 i = 0; i < marketIds.length; i++) {
            OrderBook orderBook = _getOrderBook(marketIds[i]);
            (bestBids[i], bestAsks[i]) = orderBook.getBestPrices();
        }
    }
    
    // === HELPER FUNCTIONS ===
    
    /**
     * @dev Get OrderBook contract for a market
     * @param marketId Market identifier
     * @return OrderBook contract instance
     */
    function _getOrderBook(bytes32 marketId) internal view returns (OrderBook) {
        OrderBookFactoryMinimal.MarketInfo memory marketInfo = factory.getMarket(marketId);
        require(marketInfo.orderBookAddress != address(0), "TradingRouter: market not found");
        require(marketInfo.isActive, "TradingRouter: market not active");
        
        return OrderBook(marketInfo.orderBookAddress);
    }
    
    /**
     * @dev Check if user has sufficient collateral for order
     * @param user User address
     * @param marketId Market identifier
     * @param size Position size
     * @param price Order price
     * @return Whether user has sufficient collateral
     */
    function canPlaceOrder(address user, bytes32 marketId, uint256 size, uint256 price) 
        external 
        view 
        returns (bool) 
    {
        uint256 marginRequired = (size * price * 10) / 100; // 10% margin requirement
        uint256 availableCollateral = vaultRouter.getAvailableCollateral(user);
        return availableCollateral >= marginRequired;
    }
    
    /**
     * @dev Get user's order summary across all markets
     * @param user User address
     * @return totalOrders Total number of pending orders
     * @return totalReservedMargin Total margin reserved for orders
     */
    function getUserOrderSummary(address user) 
        external 
        view 
        returns (uint256 totalOrders, uint256 totalReservedMargin) 
    {
        VaultRouter.PendingOrder[] memory orders = vaultRouter.getUserPendingOrders(user);
        totalOrders = orders.length;
        
        for (uint256 i = 0; i < orders.length; i++) {
            totalReservedMargin += orders[i].marginReserved;
        }
    }
    
    // === LEGO PIECE SETTERS FOR UPGRADABILITY ===
    
    /**
     * @dev Updates the VaultRouter address (for contract upgrades)
     * @param newVaultRouter Address of the new VaultRouter
     */
    function setVaultRouter(address newVaultRouter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newVaultRouter != address(0), "TradingRouter: invalid vault router");
        
        address oldVaultRouter = address(vaultRouter);
        vaultRouter = VaultRouter(newVaultRouter);
        
        emit VaultRouterUpdated(oldVaultRouter, newVaultRouter, block.timestamp);
    }
    
    /**
     * @dev Updates the Factory address (for contract upgrades)
     * @param newFactory Address of the new OrderBookFactory
     */
    function setFactory(address newFactory) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newFactory != address(0), "TradingRouter: invalid factory");
        
        address oldFactory = address(factory);
        factory = OrderBookFactoryMinimal(newFactory);
        
        emit FactoryUpdated(oldFactory, newFactory, block.timestamp);
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
        require(!isPaused, "TradingRouter: contract is paused");
        _;
    }
}
