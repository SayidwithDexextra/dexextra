// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./vAMM.sol";
import "./Vault.sol";

/**
 * @title vAMMFactory
 * @dev Factory contract for deploying vAMM instances
 */
contract vAMMFactory {
    address public owner;
    
    struct MarketInfo {
        address vamm;
        address vault;
        address oracle;
        address collateralToken;
        string symbol;
        bool isActive;
        uint256 createdAt;
    }
    
    mapping(bytes32 => MarketInfo) public markets;
    mapping(address => bool) public isValidMarket;
    bytes32[] public marketIds;
    
    uint256 public marketCount;
    uint256 public deploymentFee = 0.1 ether;
    
    event MarketCreated(
        bytes32 indexed marketId,
        string symbol,
        address indexed vamm,
        address indexed vault,
        address oracle,
        address collateralToken
    );
    
    event MarketStatusChanged(bytes32 indexed marketId, bool isActive);
    event DeploymentFeeUpdated(uint256 newFee);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Factory: not owner");
        _;
    }
    
    modifier validMarketId(bytes32 marketId) {
        require(markets[marketId].vamm != address(0), "Factory: market not found");
        _;
    }
    
    constructor() {
        owner = msg.sender;
    }
    
    /**
     * @dev Creates a new vAMM market
     */
    function createMarket(
        string memory symbol,
        address oracle,
        address collateralToken,
        uint256 initialPrice
    ) external payable returns (bytes32 marketId, address vammAddress, address vaultAddress) {
        require(msg.value >= deploymentFee, "Factory: insufficient fee");
        require(oracle != address(0), "Factory: invalid oracle");
        require(collateralToken != address(0), "Factory: invalid collateral");
        require(bytes(symbol).length > 0, "Factory: invalid symbol");
        require(initialPrice > 0, "Factory: invalid price");
        
        // Generate unique market ID
        marketId = keccak256(abi.encodePacked(symbol, oracle, collateralToken, block.timestamp, marketCount));
        require(markets[marketId].vamm == address(0), "Factory: market exists");
        
        // Deploy vault first
        Vault vault = new Vault(collateralToken);
        vaultAddress = address(vault);
        
        // Deploy vAMM
        vAMM vamm = new vAMM(vaultAddress, oracle, initialPrice);
        vammAddress = address(vamm);
        
        // Set vAMM in vault
        vault.setVamm(vammAddress);
        
        // Transfer ownership to deployer
        vault.transferOwnership(msg.sender);
        vamm.transferOwnership(msg.sender);
        
        // Store market info
        markets[marketId] = MarketInfo({
            vamm: vammAddress,
            vault: vaultAddress,
            oracle: oracle,
            collateralToken: collateralToken,
            symbol: symbol,
            isActive: true,
            createdAt: block.timestamp
        });
        
        isValidMarket[vammAddress] = true;
        marketIds.push(marketId);
        marketCount++;
        
        emit MarketCreated(marketId, symbol, vammAddress, vaultAddress, oracle, collateralToken);
        
        return (marketId, vammAddress, vaultAddress);
    }
    
    /**
     * @dev Updates market status
     */
     
    function setMarketStatus(bytes32 marketId, bool isActive) external onlyOwner validMarketId(marketId) {
        markets[marketId].isActive = isActive;
        emit MarketStatusChanged(marketId, isActive);
    }
    
    /**
     * @dev Updates deployment fee
     */
    function setDeploymentFee(uint256 newFee) external onlyOwner {
        deploymentFee = newFee;
        emit DeploymentFeeUpdated(newFee);
    }
    
    /**
     * @dev Gets market info by ID
     */
    function getMarket(bytes32 marketId) external view returns (MarketInfo memory) {
        return markets[marketId];
    }
    
    /**
     * @dev Gets all market IDs
     */
    function getAllMarketIds() external view returns (bytes32[] memory) {
        return marketIds;
    }
    
    /**
     * @dev Gets active markets
     */
    function getActiveMarkets() external view returns (bytes32[] memory activeMarkets) {
        uint256 activeCount = 0;
        
        // Count active markets
        for (uint256 i = 0; i < marketIds.length; i++) {
            if (markets[marketIds[i]].isActive) {
                activeCount++;
            }
        }
        
        // Create array of active market IDs
        activeMarkets = new bytes32[](activeCount);
        uint256 index = 0;
        for (uint256 i = 0; i < marketIds.length; i++) {
            if (markets[marketIds[i]].isActive) {
                activeMarkets[index] = marketIds[i];
                index++;
            }
        }
        
        return activeMarkets;
    }
    
    /**
     * @dev Transfers ownership
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Factory: invalid owner");
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }
    
    /**
     * @dev Withdraws deployment fees
     */
    function withdrawFees() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "Factory: no fees to withdraw");
        
        (bool success, ) = payable(owner).call{value: balance}("");
        require(success, "Factory: withdrawal failed");
    }
    
    /**
     * @dev Emergency function to recover stuck tokens
     */
    function recoverToken(address token, uint256 amount) external onlyOwner {
        // The IERC20 interface is already imported, so we can use it directly
        // IERC20(token).transfer(owner, amount); // This line is removed as per the edit hint
    }
} 