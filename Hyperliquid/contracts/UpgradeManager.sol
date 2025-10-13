// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./VaultRouter.sol";
import "./OrderBookFactoryMinimal.sol";
import "./TradingRouter.sol";

/**
 * @title UpgradeManager
 * @dev Centralized manager for upgrading contract addresses across the entire protocol
 * Makes the contracts work like LEGO pieces that can be easily swapped out
 */
contract UpgradeManager is AccessControl, ReentrancyGuard {
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    
    // Core contract references
    VaultRouter public vaultRouter;
    OrderBookFactoryMinimal public factory;
    TradingRouter public tradingRouter;
    address public collateralToken;
    
    // Upgrade tracking
    struct UpgradeRecord {
        address oldContract;
        address newContract;
        string contractType;
        uint256 timestamp;
        address upgrader;
        string reason;
    }
    
    UpgradeRecord[] public upgradeHistory;
    mapping(address => bool) public authorizedContracts;
    
    // Emergency controls
    bool public upgradesEnabled = true;
    uint256 public upgradeDelay = 0; // Can be set for production timelock
    
    // Events
    event ContractUpgraded(
        string indexed contractType,
        address indexed oldContract,
        address indexed newContract,
        address upgrader,
        string reason,
        uint256 timestamp
    );
    event UpgradeDelayChanged(uint256 oldDelay, uint256 newDelay);
    event UpgradesToggled(bool enabled);
    event BatchUpgradeExecuted(uint256 upgradeCount, uint256 timestamp);
    
    constructor(
        address _vaultRouter,
        address _factory,
        address _tradingRouter,
        address _collateralToken,
        address _admin
    ) {
        vaultRouter = VaultRouter(_vaultRouter);
        factory = OrderBookFactoryMinimal(_factory);
        tradingRouter = TradingRouter(_tradingRouter);
        collateralToken = _collateralToken;
        
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(UPGRADER_ROLE, _admin);
        
        // Mark initial contracts as authorized
        authorizedContracts[_vaultRouter] = true;
        authorizedContracts[_factory] = true;
        authorizedContracts[_tradingRouter] = true;
        authorizedContracts[_collateralToken] = true;
    }
    
    // === INDIVIDUAL CONTRACT UPGRADES ===
    
    /**
     * @dev Upgrade the collateral token (e.g., MockUSDC)
     * @param newCollateralToken Address of new collateral token
     * @param reason Reason for the upgrade
     */
    function upgradeCollateralToken(address newCollateralToken, string memory reason) 
        external 
        onlyRole(UPGRADER_ROLE) 
        whenUpgradesEnabled 
    {
        require(newCollateralToken != address(0), "UpgradeManager: invalid address");
        require(newCollateralToken != collateralToken, "UpgradeManager: same address");
        
        address oldToken = collateralToken;
        
        // Update VaultRouter
        vaultRouter.setCollateralToken(newCollateralToken);
        
        // Update our reference
        collateralToken = newCollateralToken;
        
        // Record upgrade
        _recordUpgrade(oldToken, newCollateralToken, "CollateralToken", reason);
        
        emit ContractUpgraded(
            "CollateralToken",
            oldToken,
            newCollateralToken,
            msg.sender,
            reason,
            block.timestamp
        );
    }
    
    /**
     * @dev Upgrade the VaultRouter contract
     * @param newVaultRouter Address of new VaultRouter
     * @param reason Reason for the upgrade
     */
    function upgradeVaultRouter(address newVaultRouter, string memory reason) 
        external 
        onlyRole(UPGRADER_ROLE) 
        whenUpgradesEnabled 
    {
        require(newVaultRouter != address(0), "UpgradeManager: invalid address");
        require(newVaultRouter != address(vaultRouter), "UpgradeManager: same address");
        
        address oldVaultRouter = address(vaultRouter);
        
        // Update Factory reference
        factory.setVaultRouter(newVaultRouter);
        
        // Update TradingRouter reference
        tradingRouter.setVaultRouter(newVaultRouter);
        
        // Update our reference
        vaultRouter = VaultRouter(newVaultRouter);
        
        // Record upgrade
        _recordUpgrade(oldVaultRouter, newVaultRouter, "VaultRouter", reason);
        
        emit ContractUpgraded(
            "VaultRouter",
            oldVaultRouter,
            newVaultRouter,
            msg.sender,
            reason,
            block.timestamp
        );
    }
    
    /**
     * @dev Upgrade the OrderBookFactory contract
     * @param newFactory Address of new Factory
     * @param reason Reason for the upgrade
     */
    function upgradeFactory(address newFactory, string memory reason) 
        external 
        onlyRole(UPGRADER_ROLE) 
        whenUpgradesEnabled 
    {
        require(newFactory != address(0), "UpgradeManager: invalid address");
        require(newFactory != address(factory), "UpgradeManager: same address");
        
        address oldFactory = address(factory);
        
        // Update TradingRouter reference
        tradingRouter.setFactory(newFactory);
        
        // Update our reference
        factory = OrderBookFactoryMinimal(newFactory);
        
        // Record upgrade
        _recordUpgrade(oldFactory, newFactory, "OrderBookFactory", reason);
        
        emit ContractUpgraded(
            "OrderBookFactory",
            oldFactory,
            newFactory,
            msg.sender,
            reason,
            block.timestamp
        );
    }
    
    /**
     * @dev Upgrade the TradingRouter contract
     * @param newTradingRouter Address of new TradingRouter
     * @param reason Reason for the upgrade
     */
    function upgradeTradingRouter(address newTradingRouter, string memory reason) 
        external 
        onlyRole(UPGRADER_ROLE) 
        whenUpgradesEnabled 
    {
        require(newTradingRouter != address(0), "UpgradeManager: invalid address");
        require(newTradingRouter != address(tradingRouter), "UpgradeManager: same address");
        
        address oldTradingRouter = address(tradingRouter);
        
        // Update our reference
        tradingRouter = TradingRouter(newTradingRouter);
        
        // Record upgrade
        _recordUpgrade(oldTradingRouter, newTradingRouter, "TradingRouter", reason);
        
        emit ContractUpgraded(
            "TradingRouter",
            oldTradingRouter,
            newTradingRouter,
            msg.sender,
            reason,
            block.timestamp
        );
    }
    
    // === BATCH UPGRADES ===
    
    struct BatchUpgrade {
        string contractType;    // "CollateralToken", "VaultRouter", etc.
        address newAddress;
        string reason;
    }
    
    /**
     * @dev Execute multiple upgrades in a single transaction
     * @param upgrades Array of upgrades to execute
     */
    function batchUpgrade(BatchUpgrade[] calldata upgrades) 
        external 
        onlyRole(UPGRADER_ROLE) 
        whenUpgradesEnabled 
        nonReentrant 
    {
        require(upgrades.length > 0 && upgrades.length <= 10, "UpgradeManager: invalid upgrade count");
        
        for (uint256 i = 0; i < upgrades.length; i++) {
            BatchUpgrade memory upgrade = upgrades[i];
            
            if (keccak256(bytes(upgrade.contractType)) == keccak256(bytes("CollateralToken"))) {
                this.upgradeCollateralToken(upgrade.newAddress, upgrade.reason);
            } else if (keccak256(bytes(upgrade.contractType)) == keccak256(bytes("VaultRouter"))) {
                this.upgradeVaultRouter(upgrade.newAddress, upgrade.reason);
            } else if (keccak256(bytes(upgrade.contractType)) == keccak256(bytes("OrderBookFactory"))) {
                this.upgradeFactory(upgrade.newAddress, upgrade.reason);
            } else if (keccak256(bytes(upgrade.contractType)) == keccak256(bytes("TradingRouter"))) {
                this.upgradeTradingRouter(upgrade.newAddress, upgrade.reason);
            } else {
                revert("UpgradeManager: unknown contract type");
            }
        }
        
        emit BatchUpgradeExecuted(upgrades.length, block.timestamp);
    }
    
    // === EMERGENCY CONTROLS ===
    
    /**
     * @dev Pause all contracts in emergency
     */
    function emergencyPauseAll() external onlyRole(DEFAULT_ADMIN_ROLE) {
        vaultRouter.setPaused(true);
        // Note: OrderBookFactoryMinimal doesn't have setPaused - skip for now
        tradingRouter.setPaused(true);
    }
    
    /**
     * @dev Resume all contracts
     */
    function resumeAll() external onlyRole(DEFAULT_ADMIN_ROLE) {
        vaultRouter.setPaused(false);
        // Note: OrderBookFactoryMinimal doesn't have setPaused - skip for now
        tradingRouter.setPaused(false);
    }
    
    /**
     * @dev Enable/disable upgrades
     * @param enabled Whether upgrades should be enabled
     */
    function setUpgradesEnabled(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        upgradesEnabled = enabled;
        emit UpgradesToggled(enabled);
    }
    
    /**
     * @dev Set upgrade delay for production safety
     * @param delay Delay in seconds
     */
    function setUpgradeDelay(uint256 delay) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(delay <= 7 days, "UpgradeManager: delay too long");
        
        uint256 oldDelay = upgradeDelay;
        upgradeDelay = delay;
        
        emit UpgradeDelayChanged(oldDelay, delay);
    }
    
    // === VIEW FUNCTIONS ===
    
    /**
     * @dev Get all contract addresses
     * @return vaultRouterAddr Current vault router address
     * @return factoryAddr Current factory address
     * @return tradingRouterAddr Current trading router address
     * @return collateralTokenAddr Current collateral token address
     */
    function getAllContracts() external view returns (
        address vaultRouterAddr,
        address factoryAddr,
        address tradingRouterAddr,
        address collateralTokenAddr
    ) {
        return (
            address(vaultRouter),
            address(factory),
            address(tradingRouter),
            collateralToken
        );
    }
    
    /**
     * @dev Get upgrade history
     * @param start Starting index
     * @param limit Number of records to return
     * @return Array of upgrade records
     */
    function getUpgradeHistory(uint256 start, uint256 limit) 
        external 
        view 
        returns (UpgradeRecord[] memory) 
    {
        require(start < upgradeHistory.length, "UpgradeManager: start out of bounds");
        
        uint256 end = start + limit;
        if (end > upgradeHistory.length) {
            end = upgradeHistory.length;
        }
        
        uint256 length = end - start;
        UpgradeRecord[] memory records = new UpgradeRecord[](length);
        
        for (uint256 i = 0; i < length; i++) {
            records[i] = upgradeHistory[start + i];
        }
        
        return records;
    }
    
    /**
     * @dev Get total number of upgrades
     * @return Total upgrade count
     */
    function getUpgradeCount() external view returns (uint256) {
        return upgradeHistory.length;
    }
    
    /**
     * @dev Check if all contracts are operational
     * @return vaultRouterHealthy Whether vault router is healthy
     * @return factoryHealthy Whether factory is healthy
     * @return tradingRouterHealthy Whether trading router is healthy
     * @return systemHealthy Whether all contracts are unpaused and functional
     */
    function systemHealthCheck() external view returns (
        bool vaultRouterHealthy,
        bool factoryHealthy,
        bool tradingRouterHealthy,
        bool systemHealthy
    ) {
        vaultRouterHealthy = !vaultRouter.isPaused();
        factoryHealthy = true; // OrderBookFactoryMinimal doesn't have isPaused - assume healthy
        tradingRouterHealthy = !tradingRouter.isPaused();
        
        systemHealthy = vaultRouterHealthy && factoryHealthy && tradingRouterHealthy && upgradesEnabled;
    }
    
    // === INTERNAL FUNCTIONS ===
    
    /**
     * @dev Record an upgrade in history
     */
    function _recordUpgrade(
        address oldContract,
        address newContract,
        string memory contractType,
        string memory reason
    ) internal {
        upgradeHistory.push(UpgradeRecord({
            oldContract: oldContract,
            newContract: newContract,
            contractType: contractType,
            timestamp: block.timestamp,
            upgrader: msg.sender,
            reason: reason
        }));
        
        // Update authorized contracts
        authorizedContracts[oldContract] = false;
        authorizedContracts[newContract] = true;
    }
    
    modifier whenUpgradesEnabled() {
        require(upgradesEnabled, "UpgradeManager: upgrades disabled");
        _;
    }
}

