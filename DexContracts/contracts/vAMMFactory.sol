// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./vAMM.sol";
import "./Vault.sol";

/**
 * @title vAMMFactory
 * @dev Factory contract for deploying BONDING CURVE vAMM instances with custom pricing
 * Now supports pump.fund-style markets with configurable starting prices
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
        uint256 startingPrice; // Custom starting price for bonding curve
        MarketType marketType; // Type of market (pump, standard, blue-chip)
    }
    
    enum MarketType {
        PUMP,      // Ultra-pump style: $0.001 starting price
        STANDARD,  // Normal style: $1-10 starting price  
        BLUE_CHIP  // High-value style: $100+ starting price
    }
    
    mapping(bytes32 => MarketInfo) public markets;
    mapping(address => bool) public isValidMarket;
    bytes32[] public marketIds;
    
    uint256 public marketCount;
    uint256 public deploymentFee = 0.1 ether;
    
    // Predefined bonding curve templates
    mapping(MarketType => uint256) public defaultStartingPrices;
    
    event MarketCreated(
        bytes32 indexed marketId,
        string symbol,
        address indexed vamm,
        address indexed vault,
        address oracle,
        address collateralToken,
        uint256 startingPrice,
        MarketType marketType
    );
    
    event MarketStatusChanged(bytes32 indexed marketId, bool isActive);
    event DeploymentFeeUpdated(uint256 newFee);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event BondingCurveMarketCreated(
        bytes32 indexed marketId,
        string symbol,
        uint256 startingPrice,
        MarketType marketType,
        string description
    );

    event ContractDeployed(
        bytes32 indexed marketId,
        address indexed contractAddress,
        string contractType,
        bytes constructorArgs
    );
    
    modifier onlyOwner() {
        require(msg.sender == owner, "!owner");
        _;
    }
    
    modifier validMarketId(bytes32 marketId) {
        require(markets[marketId].vamm != address(0), "!found");
        _;
    }
    
    constructor() {
        owner = msg.sender;
        
        // Set default starting prices for different market types
        defaultStartingPrices[MarketType.PUMP] = 1e15;     // $0.001 (maximum pump potential)
        defaultStartingPrices[MarketType.STANDARD] = 1e18;  // $1.00 (balanced)
        defaultStartingPrices[MarketType.BLUE_CHIP] = 100e18; // $100.00 (stable/premium)
    }
    
    /**
     * @dev Creates a new bonding curve vAMM market with custom starting price
     */
    function createMarket(
        string memory symbol,
        address oracle,
        address collateralToken,
        uint256 startingPrice
    ) external payable returns (bytes32 marketId, address vammAddress, address vaultAddress) {
        require(msg.value >= deploymentFee, "!fee");
        require(oracle != address(0), "!oracle");
        require(collateralToken != address(0), "!collateral");
        require(bytes(symbol).length > 0, "!symbol");
        require(startingPrice > 0, "!price");
        
        // Determine market type based on starting price
        MarketType marketType = _determineMarketType(startingPrice);
        
        return _createMarketInternal(symbol, oracle, collateralToken, startingPrice, marketType);
    }
    

    
    /**
     * @dev Internal function to create markets
     */
    function _createMarketInternal(
        string memory symbol,
        address oracle,
        address collateralToken,
        uint256 startingPrice,
        MarketType marketType
    ) internal returns (bytes32 marketId, address vammAddress, address vaultAddress) {
        require(oracle != address(0), "!oracle");
        require(collateralToken != address(0), "!collateral");
        require(bytes(symbol).length > 0, "!symbol");
        require(startingPrice > 0, "!price");
        
        // Generate unique market ID
        marketId = keccak256(abi.encodePacked(symbol, oracle, collateralToken, block.timestamp, marketCount));
        require(markets[marketId].vamm == address(0), "!exists");
        
        // Deploy contracts first
        Vault vault = new Vault(collateralToken);
        vaultAddress = address(vault);
        
        vAMM vamm = new vAMM(vaultAddress, oracle, startingPrice);
        vammAddress = address(vamm);
        
        // Configure contracts
        vault.setVamm(vammAddress);
        vault.transferOwnership(msg.sender);
        vamm.transferOwnership(msg.sender);
        
        // Update state after all external calls (effects)
        marketCount++;
        marketIds.push(marketId);
        isValidMarket[vammAddress] = true;
        
        // Store market info
        markets[marketId] = MarketInfo({
            vamm: vammAddress,
            vault: vaultAddress,
            oracle: oracle,
            collateralToken: collateralToken,
            symbol: symbol,
            isActive: true,
            createdAt: block.timestamp,
            startingPrice: startingPrice,
            marketType: marketType
        });
        
        // Emit events
        emit MarketCreated(marketId, symbol, vammAddress, vaultAddress, oracle, collateralToken, startingPrice, marketType);
        emit ContractDeployed(marketId, vaultAddress, "Vault", abi.encode(collateralToken));
        emit ContractDeployed(marketId, vammAddress, "BondingCurveVAMM", abi.encode(vaultAddress, oracle, startingPrice));
        
        // Emit special event for bonding curve markets
        emit BondingCurveMarketCreated(marketId, symbol, startingPrice, marketType, "");
        
        return (marketId, vammAddress, vaultAddress);
    }
    
    /**
     * @dev Determines market type based on starting price
     */
    function _determineMarketType(uint256 startingPrice) internal pure returns (MarketType) {
        if (startingPrice <= 1e16) { // <= $0.01
            return MarketType.PUMP;
        } else if (startingPrice <= 10e18) { // <= $10.00
            return MarketType.STANDARD;
        } else {
            return MarketType.BLUE_CHIP; // > $10.00
        }
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
     * @dev Transfers ownership
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "!owner");
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }
    
    /**
     * @dev Withdraws deployment fees
     */
    function withdrawFees() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "!balance");
        
        (bool success, ) = payable(owner).call{value: balance}("");
        require(success, "!withdraw");
    }
    

} 