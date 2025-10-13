// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./OrderBook.sol";
import "./VaultRouter.sol";

/**
 * @title OrderBookFactory
 * @dev Factory contract for deploying and managing OrderBook instances
 * Supports both traditional price-based markets and custom metric markets
 */
contract OrderBookFactory is AccessControl, ReentrancyGuard {
    bytes32 public constant MARKET_CREATOR_ROLE = keccak256("MARKET_CREATOR_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    
    struct MarketInfo {
        bytes32 marketId;
        address orderBookAddress;
        string symbol;
        string metricId;
        bool isCustomMetric;
        bool isActive;
        uint256 createdAt;
        address creator;
    }
    
    VaultRouter public vaultRouter; // Upgradeable reference
    
    // Market registry
    mapping(bytes32 => MarketInfo) public markets;
    mapping(string => bytes32) public symbolToMarketId;
    mapping(string => bytes32) public metricToMarketId;
    bytes32[] public allMarketIds;
    
    // Market categories
    bytes32[] public traditionalMarkets;    // Price-based markets (ETH/USD, BTC/USD)
    bytes32[] public customMetricMarkets;   // Custom metric markets (world population, etc.)
    
    // Market statistics
    mapping(bytes32 => uint256) public marketVolume24h;
    mapping(bytes32 => uint256) public marketOpenInterest;
    mapping(address => uint256) public creatorFeeEarned;
    
    // Configuration
    uint256 public marketCreationFee = 0.1 ether; // Fee to create a market
    uint256 public creatorFeeRate = 100; // 1% in basis points (100/10000)
    
    // Events
    event MarketCreated(
        bytes32 indexed marketId,
        address indexed orderBook,
        string symbol,
        string metricId,
        bool isCustomMetric,
        address indexed creator,
        uint256 timestamp
    );
    event MarketStatusChanged(bytes32 indexed marketId, bool isActive, uint256 timestamp);
    event MarketVolumeUpdated(bytes32 indexed marketId, uint256 volume24h, uint256 timestamp);
    event CreatorFeeDistributed(address indexed creator, bytes32 indexed marketId, uint256 amount);
    
    // LEGO Piece Events
    event VaultRouterUpdated(address indexed oldVaultRouter, address indexed newVaultRouter, uint256 timestamp);
    event ContractPauseStatusChanged(bool isPaused, uint256 timestamp);
    
    constructor(address _vaultRouter, address _admin) {
        vaultRouter = VaultRouter(_vaultRouter);
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(MARKET_CREATOR_ROLE, _admin);
        _grantRole(ORACLE_ROLE, _admin);
    }
    
    /**
     * @dev Creates a new traditional price-based market (e.g., ETH/USD, BTC/USD)
     * @param symbol Market symbol (e.g., "ETH/USD")
     * @return marketId The generated market ID
     * @return orderBookAddress Address of the deployed OrderBook contract
     */
    function createTraditionalMarket(string memory symbol) 
        external 
        payable 
        onlyRole(MARKET_CREATOR_ROLE) 
        whenNotPaused
        returns (bytes32 marketId, address orderBookAddress) 
    {
        require(msg.value >= marketCreationFee, "OrderBookFactory: insufficient fee");
        require(bytes(symbol).length > 0, "OrderBookFactory: empty symbol");
        
        marketId = keccak256(abi.encodePacked("traditional", symbol, block.timestamp));
        require(markets[marketId].orderBookAddress == address(0), "OrderBookFactory: market exists");
        require(symbolToMarketId[symbol] == bytes32(0), "OrderBookFactory: symbol exists");
        
        // Deploy new OrderBook contract
        OrderBook orderBook = new OrderBook(
            marketId,
            symbol,
            "", // No metricId for traditional markets
            false, // Not a custom metric
            address(vaultRouter),
            msg.sender // Admin role goes to creator
        );
        
        orderBookAddress = address(orderBook);
        
        // Register market
        markets[marketId] = MarketInfo({
            marketId: marketId,
            orderBookAddress: orderBookAddress,
            symbol: symbol,
            metricId: "",
            isCustomMetric: false,
            isActive: true,
            createdAt: block.timestamp,
            creator: msg.sender
        });
        
        symbolToMarketId[symbol] = marketId;
        allMarketIds.push(marketId);
        traditionalMarkets.push(marketId);
        
        // Authorize market in VaultRouter
        vaultRouter.setMarketAuthorization(marketId, true);
        
        // Grant OrderBook role to the new contract
        vaultRouter.grantRole(vaultRouter.ORDERBOOK_ROLE(), orderBookAddress);
        
        emit MarketCreated(marketId, orderBookAddress, symbol, "", false, msg.sender, block.timestamp);
        
        return (marketId, orderBookAddress);
    }
    
    /**
     * @dev Creates a new custom metric market (e.g., world population, Spotify listeners)
     * @param symbol Market symbol (e.g., "WORLD_POP")
     * @param metricId Unique metric identifier (e.g., "world_population")
     * @return marketId The generated market ID
     * @return orderBookAddress Address of the deployed OrderBook contract
     */
    function createCustomMetricMarket(string memory symbol, string memory metricId) 
        external 
        payable 
        onlyRole(MARKET_CREATOR_ROLE) 
        returns (bytes32 marketId, address orderBookAddress) 
    {
        require(msg.value >= marketCreationFee, "OrderBookFactory: insufficient fee");
        require(bytes(symbol).length > 0, "OrderBookFactory: empty symbol");
        require(bytes(metricId).length > 0, "OrderBookFactory: empty metricId");
        
        marketId = keccak256(abi.encodePacked("custom", symbol, metricId, block.timestamp));
        require(markets[marketId].orderBookAddress == address(0), "OrderBookFactory: market exists");
        require(symbolToMarketId[symbol] == bytes32(0), "OrderBookFactory: symbol exists");
        require(metricToMarketId[metricId] == bytes32(0), "OrderBookFactory: metricId exists");
        
        // Deploy new OrderBook contract
        OrderBook orderBook = new OrderBook(
            marketId,
            symbol,
            metricId,
            true, // Is a custom metric
            address(vaultRouter),
            msg.sender // Admin role goes to creator
        );
        
        orderBookAddress = address(orderBook);
        
        // Register market
        markets[marketId] = MarketInfo({
            marketId: marketId,
            orderBookAddress: orderBookAddress,
            symbol: symbol,
            metricId: metricId,
            isCustomMetric: true,
            isActive: true,
            createdAt: block.timestamp,
            creator: msg.sender
        });
        
        symbolToMarketId[symbol] = marketId;
        metricToMarketId[metricId] = marketId;
        allMarketIds.push(marketId);
        customMetricMarkets.push(marketId);
        
        // Authorize market in VaultRouter
        vaultRouter.setMarketAuthorization(marketId, true);
        
        // Grant OrderBook role to the new contract
        vaultRouter.grantRole(vaultRouter.ORDERBOOK_ROLE(), orderBookAddress);
        
        emit MarketCreated(marketId, orderBookAddress, symbol, metricId, true, msg.sender, block.timestamp);
        
        return (marketId, orderBookAddress);
    }
    
    /**
     * @dev Batch creates multiple traditional markets
     * @param symbols Array of market symbols
     * @return marketIds Array of generated market IDs
     * @return orderBookAddresses Array of deployed OrderBook addresses
     */
    function batchCreateTraditionalMarkets(string[] memory symbols) 
        external 
        payable 
        onlyRole(MARKET_CREATOR_ROLE) 
        returns (bytes32[] memory marketIds, address[] memory orderBookAddresses) 
    {
        require(msg.value >= marketCreationFee * symbols.length, "OrderBookFactory: insufficient fee");
        
        marketIds = new bytes32[](symbols.length);
        orderBookAddresses = new address[](symbols.length);
        
        for (uint256 i = 0; i < symbols.length; i++) {
            (marketIds[i], orderBookAddresses[i]) = _createTraditionalMarketInternal(symbols[i]);
        }
        
        return (marketIds, orderBookAddresses);
    }
    
    /**
     * @dev Sets market active status
     * @param marketId Market identifier
     * @param isActive Whether the market should be active
     */
    function setMarketStatus(bytes32 marketId, bool isActive) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(markets[marketId].orderBookAddress != address(0), "OrderBookFactory: market not found");
        
        markets[marketId].isActive = isActive;
        vaultRouter.setMarketAuthorization(marketId, isActive);
        
        emit MarketStatusChanged(marketId, isActive, block.timestamp);
    }
    
    /**
     * @dev Updates market creation fee
     * @param newFee New market creation fee
     */
    function setMarketCreationFee(uint256 newFee) external onlyRole(DEFAULT_ADMIN_ROLE) {
        marketCreationFee = newFee;
    }
    
    /**
     * @dev Updates creator fee rate
     * @param newFeeRate New creator fee rate in basis points
     */
    function setCreatorFeeRate(uint256 newFeeRate) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newFeeRate <= 1000, "OrderBookFactory: fee rate too high"); // Max 10%
        creatorFeeRate = newFeeRate;
    }
    
    /**
     * @dev Distributes fees to market creators (called by settlement system)
     * @param marketId Market identifier
     * @param totalFees Total fees collected
     */
    function distributeFees(bytes32 marketId, uint256 totalFees) external onlyRole(ORACLE_ROLE) {
        MarketInfo memory market = markets[marketId];
        require(market.orderBookAddress != address(0), "OrderBookFactory: market not found");
        
        uint256 creatorFee = (totalFees * creatorFeeRate) / 10000;
        if (creatorFee > 0) {
            creatorFeeEarned[market.creator] += creatorFee;
            emit CreatorFeeDistributed(market.creator, marketId, creatorFee);
        }
    }
    
    /**
     * @dev Allows creators to claim their earned fees
     */
    function claimCreatorFees() external nonReentrant {
        uint256 fees = creatorFeeEarned[msg.sender];
        require(fees > 0, "OrderBookFactory: no fees to claim");
        
        creatorFeeEarned[msg.sender] = 0;
        payable(msg.sender).transfer(fees);
    }
    
    /**
     * @dev Withdraws accumulated creation fees (admin only)
     */
    function withdrawCreationFees() external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 balance = address(this).balance;
        require(balance > 0, "OrderBookFactory: no fees to withdraw");
        
        payable(msg.sender).transfer(balance);
    }
    
    // === LEGO PIECE SETTERS FOR UPGRADABILITY ===
    
    /**
     * @dev Updates the VaultRouter address (for contract upgrades)
     * @param newVaultRouter Address of the new VaultRouter
     */
    function setVaultRouter(address newVaultRouter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newVaultRouter != address(0), "OrderBookFactory: invalid vault router");
        
        address oldVaultRouter = address(vaultRouter);
        vaultRouter = VaultRouter(newVaultRouter);
        
        emit VaultRouterUpdated(oldVaultRouter, newVaultRouter, block.timestamp);
    }
    
    /**
     * @dev Updates VaultRouter reference for existing markets
     * @param marketIds Array of market IDs to update
     * @param newVaultRouter New VaultRouter address
     */
    function updateMarketsVaultRouter(bytes32[] calldata marketIds, address newVaultRouter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newVaultRouter != address(0), "OrderBookFactory: invalid vault router");
        require(marketIds.length > 0 && marketIds.length <= 50, "OrderBookFactory: invalid market count");
        
        for (uint256 i = 0; i < marketIds.length; i++) {
            MarketInfo memory marketInfo = markets[marketIds[i]];
            require(marketInfo.orderBookAddress != address(0), "OrderBookFactory: market not found");
            
            // Note: This would require OrderBook to have a setVaultRouter function
            // OrderBook(marketInfo.orderBookAddress).setVaultRouter(newVaultRouter);
        }
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
        require(!isPaused, "OrderBookFactory: contract is paused");
        _;
    }
    
    /**
     * @dev Emergency function to pause/unpause all markets
     * @param paused Whether to pause all markets
     */
    function setGlobalPause(bool paused) external onlyRole(DEFAULT_ADMIN_ROLE) {
        for (uint256 i = 0; i < allMarketIds.length; i++) {
            bytes32 marketId = allMarketIds[i];
            markets[marketId].isActive = !paused;
            vaultRouter.setMarketAuthorization(marketId, !paused);
            emit MarketStatusChanged(marketId, !paused, block.timestamp);
        }
    }
    
    // === VIEW FUNCTIONS ===
    
    /**
     * @dev Gets market information by ID
     * @param marketId Market identifier
     * @return Market information
     */
    function getMarket(bytes32 marketId) external view returns (MarketInfo memory) {
        return markets[marketId];
    }
    
    /**
     * @dev Gets market ID by symbol
     * @param symbol Market symbol
     * @return Market identifier
     */
    function getMarketBySymbol(string memory symbol) external view returns (bytes32) {
        return symbolToMarketId[symbol];
    }
    
    /**
     * @dev Gets market ID by metric ID
     * @param metricId Metric identifier
     * @return Market identifier
     */
    function getMarketByMetric(string memory metricId) external view returns (bytes32) {
        return metricToMarketId[metricId];
    }
    
    /**
     * @dev Gets all market IDs
     * @return Array of all market IDs
     */
    function getAllMarkets() external view returns (bytes32[] memory) {
        return allMarketIds;
    }
    
    /**
     * @dev Gets all traditional market IDs
     * @return Array of traditional market IDs
     */
    function getTraditionalMarkets() external view returns (bytes32[] memory) {
        return traditionalMarkets;
    }
    
    /**
     * @dev Gets all custom metric market IDs
     * @return Array of custom metric market IDs
     */
    function getCustomMetricMarkets() external view returns (bytes32[] memory) {
        return customMetricMarkets;
    }
    
    /**
     * @dev Gets active markets
     * @return Array of active market IDs
     */
    function getActiveMarkets() external view returns (bytes32[] memory) {
        uint256 activeCount = 0;
        
        // Count active markets
        for (uint256 i = 0; i < allMarketIds.length; i++) {
            if (markets[allMarketIds[i]].isActive) {
                activeCount++;
            }
        }
        
        // Create array of active markets
        bytes32[] memory activeMarkets = new bytes32[](activeCount);
        uint256 index = 0;
        
        for (uint256 i = 0; i < allMarketIds.length; i++) {
            if (markets[allMarketIds[i]].isActive) {
                activeMarkets[index] = allMarketIds[i];
                index++;
            }
        }
        
        return activeMarkets;
    }
    
    /**
     * @dev Gets markets created by a specific creator
     * @param creator Creator address
     * @return Array of market IDs created by the creator
     */
    function getMarketsByCreator(address creator) external view returns (bytes32[] memory) {
        uint256 count = 0;
        
        // Count markets by creator
        for (uint256 i = 0; i < allMarketIds.length; i++) {
            if (markets[allMarketIds[i]].creator == creator) {
                count++;
            }
        }
        
        // Create array of markets by creator
        bytes32[] memory creatorMarkets = new bytes32[](count);
        uint256 index = 0;
        
        for (uint256 i = 0; i < allMarketIds.length; i++) {
            if (markets[allMarketIds[i]].creator == creator) {
                creatorMarkets[index] = allMarketIds[i];
                index++;
            }
        }
        
        return creatorMarkets;
    }
    
    /**
     * @dev Gets total number of markets
     * @return Total market count
     */
    function getTotalMarkets() external view returns (uint256) {
        return allMarketIds.length;
    }
    
    /**
     * @dev Gets paginated market list
     * @param offset Starting index
     * @param limit Number of markets to return
     * @return marketIds Array of market IDs
     * @return marketInfos Array of market information
     */
    function getMarketsPaginated(uint256 offset, uint256 limit) 
        external 
        view 
        returns (bytes32[] memory marketIds, MarketInfo[] memory marketInfos) 
    {
        require(offset < allMarketIds.length, "OrderBookFactory: offset out of bounds");
        
        uint256 end = offset + limit;
        if (end > allMarketIds.length) {
            end = allMarketIds.length;
        }
        
        uint256 length = end - offset;
        marketIds = new bytes32[](length);
        marketInfos = new MarketInfo[](length);
        
        for (uint256 i = 0; i < length; i++) {
            bytes32 marketId = allMarketIds[offset + i];
            marketIds[i] = marketId;
            marketInfos[i] = markets[marketId];
        }
        
        return (marketIds, marketInfos);
    }
    
    // === INTERNAL FUNCTIONS ===
    
    /**
     * @dev Internal function to create traditional market (used by batch creation)
     */
    function _createTraditionalMarketInternal(string memory symbol) 
        internal 
        returns (bytes32 marketId, address orderBookAddress) 
    {
        require(bytes(symbol).length > 0, "OrderBookFactory: empty symbol");
        
        marketId = keccak256(abi.encodePacked("traditional", symbol, block.timestamp));
        require(markets[marketId].orderBookAddress == address(0), "OrderBookFactory: market exists");
        require(symbolToMarketId[symbol] == bytes32(0), "OrderBookFactory: symbol exists");
        
        // Deploy new OrderBook contract
        OrderBook orderBook = new OrderBook(
            marketId,
            symbol,
            "",
            false,
            address(vaultRouter),
            msg.sender
        );
        
        orderBookAddress = address(orderBook);
        
        // Register market
        markets[marketId] = MarketInfo({
            marketId: marketId,
            orderBookAddress: orderBookAddress,
            symbol: symbol,
            metricId: "",
            isCustomMetric: false,
            isActive: true,
            createdAt: block.timestamp,
            creator: msg.sender
        });
        
        symbolToMarketId[symbol] = marketId;
        allMarketIds.push(marketId);
        traditionalMarkets.push(marketId);
        
        // Authorize market in VaultRouter
        vaultRouter.setMarketAuthorization(marketId, true);
        
        // Grant OrderBook role to the new contract
        vaultRouter.grantRole(vaultRouter.ORDERBOOK_ROLE(), orderBookAddress);
        
        emit MarketCreated(marketId, orderBookAddress, symbol, "", false, msg.sender, block.timestamp);
        
        return (marketId, orderBookAddress);
    }
}
