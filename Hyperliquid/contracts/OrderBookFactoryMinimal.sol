// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./OrderBook.sol";
import "./VaultRouter.sol";

/**
 * @title OrderBookFactoryMinimal
 * @dev Minimal factory contract for deploying OrderBook instances
 * Focused only on core functionality to minimize contract size
 */
contract OrderBookFactoryMinimal is Ownable {
    
    struct MarketInfo {
        address orderBookAddress;
        string symbol;
        bool isActive;
        address creator;
    }
    
    // Core registry
    mapping(bytes32 => MarketInfo) public markets;
    mapping(string => bytes32) public symbolToMarketId;
    bytes32[] public allMarketIds;
    
    VaultRouter public vaultRouter;
    uint256 public marketCreationFee = 0.1 ether;
    
    // Events
    event MarketCreated(bytes32 indexed marketId, address indexed orderBookAddress, string symbol);
    
    constructor(address _vaultRouter, address _owner) Ownable(_owner) {
        require(_vaultRouter != address(0), "Invalid vault router");
        vaultRouter = VaultRouter(_vaultRouter);
    }

    /**
     * @dev Create a traditional market
     */
    function createTraditionalMarket(string memory symbol) 
        external 
        payable
        onlyOwner
        returns (bytes32 marketId)
    {
        require(msg.value >= marketCreationFee, "Insufficient fee");
        require(bytes(symbol).length > 0 && bytes(symbol).length <= 20, "Invalid symbol");
        
        marketId = keccak256(abi.encodePacked(symbol, "_MARKET"));
        require(markets[marketId].orderBookAddress == address(0), "Market exists");
        
        // Deploy OrderBook
        OrderBook orderBook = new OrderBook(
            marketId,
            symbol,
            "",
            false,
            address(vaultRouter),
            msg.sender
        );
        
        // Store market
        markets[marketId] = MarketInfo({
            orderBookAddress: address(orderBook),
            symbol: symbol,
            isActive: true,
            creator: msg.sender
        });
        
        symbolToMarketId[symbol] = marketId;
        allMarketIds.push(marketId);
        
        emit MarketCreated(marketId, address(orderBook), symbol);
        
        return marketId;
    }

    /**
     * @dev Set market status
     */
    function setMarketStatus(bytes32 marketId, bool isActive) external onlyOwner {
        require(markets[marketId].orderBookAddress != address(0), "Market not found");
        markets[marketId].isActive = isActive;
    }

    /**
     * @dev Set creation fee
     */
    function setMarketCreationFee(uint256 newFee) external onlyOwner {
        marketCreationFee = newFee;
    }

    /**
     * @dev Update vault router
     */
    function setVaultRouter(address newVaultRouter) external onlyOwner {
        require(newVaultRouter != address(0), "Invalid address");
        vaultRouter = VaultRouter(newVaultRouter);
    }

    /**
     * @dev Withdraw fees
     */
    function withdrawFees() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No fees");
        
        (bool success, ) = payable(owner()).call{value: balance}("");
        require(success, "Transfer failed");
    }

    // === VIEW FUNCTIONS ===

    function getMarket(bytes32 marketId) external view returns (MarketInfo memory) {
        return markets[marketId];
    }

    function getMarketBySymbol(string memory symbol) external view returns (bytes32) {
        return symbolToMarketId[symbol];
    }

    function getAllMarkets() external view returns (bytes32[] memory) {
        return allMarketIds;
    }

    function getTotalMarkets() external view returns (uint256) {
        return allMarketIds.length;
    }
}
