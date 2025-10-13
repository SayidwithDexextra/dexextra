// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./OrderBook.sol";
import "./VaultRouter.sol";
import "./libraries/MarketUtils.sol";

/**
 * @title OrderBookFactoryOptimized
 * @dev Optimized factory contract for deploying and managing OrderBook instances
 * Reduced size by using libraries and removing redundant functionality
 */
contract OrderBookFactoryOptimized is AccessControl, ReentrancyGuard {
    using MarketUtils for bytes32[];
    using MarketUtils for string;

    bytes32 public constant MARKET_CREATOR_ROLE = keccak256("MARKET_CREATOR_ROLE");
    
    // Core market registry
    mapping(bytes32 => MarketUtils.MarketInfo) public markets;
    mapping(string => bytes32) public symbolToMarketId;
    bytes32[] public allMarketIds;
    
    VaultRouter public vaultRouter;
    
    // Configuration
    uint256 public marketCreationFee = 0.1 ether;
    
    // Events
    event MarketCreated(
        bytes32 indexed marketId,
        address indexed orderBookAddress,
        string symbol,
        address indexed creator
    );
    
    event MarketStatusChanged(bytes32 indexed marketId, bool isActive);
    event MarketCreationFeeChanged(uint256 oldFee, uint256 newFee);
    event VaultRouterUpdated(address oldRouter, address newRouter);

    constructor(address _vaultRouter, address _admin) {
        require(_vaultRouter != address(0), "Invalid vault router");
        require(_admin != address(0), "Invalid admin");
        
        vaultRouter = VaultRouter(_vaultRouter);
        
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(MARKET_CREATOR_ROLE, _admin);
    }

    /**
     * @dev Create a traditional market (e.g., ETH/USD, BTC/USD)
     */
    function createTraditionalMarket(string memory symbol) 
        external 
        payable
        onlyRole(MARKET_CREATOR_ROLE)
        nonReentrant
        returns (bytes32 marketId)
    {
        require(msg.value >= marketCreationFee, "Insufficient creation fee");
        symbol.validateSymbol();
        
        marketId = MarketUtils.calculateTraditionalMarketId(symbol);
        require(markets[marketId].orderBookAddress == address(0), "Market already exists");
        
        // Deploy OrderBook contract
        OrderBook orderBook = new OrderBook(
            marketId,
            symbol,
            "", // No metricId for traditional markets
            false, // Not a custom metric
            address(vaultRouter),
            msg.sender // Admin role goes to creator
        );
        
        // Store market info
        markets[marketId] = MarketUtils.MarketInfo({
            marketId: marketId,
            orderBookAddress: address(orderBook),
            symbol: symbol,
            metricId: "",
            isCustomMetric: false,
            isActive: true,
            createdAt: block.timestamp,
            creator: msg.sender
        });
        
        symbolToMarketId[symbol] = marketId;
        allMarketIds.push(marketId);
        
        emit MarketCreated(marketId, address(orderBook), symbol, msg.sender);
        
        return marketId;
    }

    /**
     * @dev Create a custom metric market
     */
    function createCustomMetricMarket(string memory symbol, string memory metricId) 
        external 
        payable
        onlyRole(MARKET_CREATOR_ROLE)
        nonReentrant
        returns (bytes32 marketId)
    {
        require(msg.value >= marketCreationFee, "Insufficient creation fee");
        symbol.validateSymbol();
        metricId.validateMetricId();
        
        marketId = MarketUtils.calculateCustomMarketId(metricId);
        require(markets[marketId].orderBookAddress == address(0), "Market already exists");
        
        // Deploy OrderBook contract
        OrderBook orderBook = new OrderBook(
            marketId,
            symbol,
            metricId,
            true, // Is a custom metric
            address(vaultRouter),
            msg.sender // Admin role goes to creator
        );
        
        // Store market info
        markets[marketId] = MarketUtils.MarketInfo({
            marketId: marketId,
            orderBookAddress: address(orderBook),
            symbol: symbol,
            metricId: metricId,
            isCustomMetric: true,
            isActive: true,
            createdAt: block.timestamp,
            creator: msg.sender
        });
        
        symbolToMarketId[symbol] = marketId;
        allMarketIds.push(marketId);
        
        emit MarketCreated(marketId, address(orderBook), symbol, msg.sender);
        
        return marketId;
    }

    /**
     * @dev Set market active status
     */
    function setMarketStatus(bytes32 marketId, bool isActive) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(markets[marketId].orderBookAddress != address(0), "Market not found");
        markets[marketId].isActive = isActive;
        emit MarketStatusChanged(marketId, isActive);
    }

    /**
     * @dev Set market creation fee
     */
    function setMarketCreationFee(uint256 newFee) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 oldFee = marketCreationFee;
        marketCreationFee = newFee;
        emit MarketCreationFeeChanged(oldFee, newFee);
    }

    /**
     * @dev Update vault router
     */
    function setVaultRouter(address newVaultRouter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newVaultRouter != address(0), "Invalid vault router");
        address oldRouter = address(vaultRouter);
        vaultRouter = VaultRouter(newVaultRouter);
        emit VaultRouterUpdated(oldRouter, newVaultRouter);
    }

    /**
     * @dev Withdraw creation fees
     */
    function withdrawCreationFees() external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 balance = address(this).balance;
        require(balance > 0, "No fees to withdraw");
        
        (bool success, ) = payable(msg.sender).call{value: balance}("");
        require(success, "Transfer failed");
    }

    // === VIEW FUNCTIONS ===

    /**
     * @dev Get market info
     */
    function getMarket(bytes32 marketId) external view returns (MarketUtils.MarketInfo memory) {
        return markets[marketId];
    }

    /**
     * @dev Get market by symbol
     */
    function getMarketBySymbol(string memory symbol) external view returns (bytes32) {
        return symbolToMarketId[symbol];
    }

    /**
     * @dev Get all markets
     */
    function getAllMarkets() external view returns (bytes32[] memory) {
        return allMarketIds;
    }

    /**
     * @dev Get active markets
     */
    function getActiveMarkets() external view returns (bytes32[] memory) {
        return allMarketIds.filterActiveMarkets(markets);
    }

    /**
     * @dev Get markets by creator
     */
    function getMarketsByCreator(address creator) external view returns (bytes32[] memory) {
        return allMarketIds.filterMarketsByCreator(markets, creator);
    }

    /**
     * @dev Get total markets count
     */
    function getTotalMarkets() external view returns (uint256) {
        return allMarketIds.length;
    }

    /**
     * @dev Get markets with pagination
     */
    function getMarketsPaginated(uint256 offset, uint256 limit) 
        external 
        view 
        returns (bytes32[] memory) 
    {
        return MarketUtils.getPaginatedMarkets(allMarketIds, offset, limit);
    }
}
