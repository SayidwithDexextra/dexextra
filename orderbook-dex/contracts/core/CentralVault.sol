// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "../interfaces/ICentralVault.sol";

/**
 * @title CentralVault
 * @dev Secure asset custody and management for the OrderBook DEX
 * @notice Manages all trading assets with multi-signature security and risk controls
 */
contract CentralVault is ICentralVault, AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using Address for address payable;

    // Roles
    bytes32 public constant VAULT_ADMIN_ROLE = keccak256("VAULT_ADMIN_ROLE");
    bytes32 public constant MARKET_ROLE = keccak256("MARKET_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    // Constants
    address public constant ETH_ADDRESS = address(0);
    uint256 public constant MAX_WITHDRAWAL_DELAY = 7 days;
    uint256 public constant PRECISION = 1e18;

    // State variables
    uint256 public emergencyPauseDuration;
    uint256 public emergencyPauseStart;
    
    // Primary collateral token configuration
    address public primaryCollateralToken;
    bool public primaryCollateralIsERC20;
    
    // Asset tracking
    mapping(address => uint256) public totalAssetReserves;
    mapping(address => bool) public supportedAssets;
    address[] public assetList;

    // User balances: user => asset => UserBalance
    mapping(address => mapping(address => UserBalance)) public userBalances;
    
    // Market authorizations
    mapping(address => bool) public authorizedMarkets;
    address[] public marketList;

    // Withdrawal delays and locks
    struct WithdrawalRequest {
        uint256 amount;
        uint256 requestTime;
        bool processed;
    }
    
    mapping(address => mapping(address => WithdrawalRequest)) public withdrawalRequests;
    uint256 public withdrawalDelay;

    // Risk management
    struct RiskParameters {
        uint256 maxSingleWithdrawal;
        uint256 maxDailyWithdrawal;
        uint256 collateralizationRatio; // Basis points (10000 = 100%)
        bool enabled;
    }
    
    mapping(address => RiskParameters) public assetRiskParams;
    mapping(address => mapping(uint256 => uint256)) public dailyWithdrawals; // user => day => amount

    // Events
    event AssetAdded(address indexed asset, string name, string symbol);
    event AssetRemoved(address indexed asset);
    event WithdrawalDelayUpdated(uint256 oldDelay, uint256 newDelay);
    event RiskParametersUpdated(address indexed asset, uint256 maxSingle, uint256 maxDaily, uint256 collateralRatio);
    event WithdrawalRequested(address indexed user, address indexed asset, uint256 amount, uint256 executeTime);
    event WithdrawalExecuted(address indexed user, address indexed asset, uint256 amount);
    event WithdrawalCancelled(address indexed user, address indexed asset, uint256 amount);

    modifier onlyAuthorizedMarket() {
        require(authorizedMarkets[msg.sender], "CentralVault: Not authorized market");
        _;
    }

    modifier onlySupportedAsset(address asset) {
        require(supportedAssets[asset] || asset == ETH_ADDRESS, "CentralVault: Asset not supported");
        _;
    }

    modifier notEmergencyPaused() {
        if (emergencyPauseStart > 0) {
            require(
                block.timestamp > emergencyPauseStart + emergencyPauseDuration,
                "CentralVault: Emergency pause active"
            );
        }
        _;
    }

    /**
     * @dev Constructor
     * @param admin Admin address for role management
     * @param _emergencyPauseDuration Duration of emergency pause in seconds
     * @param _primaryCollateralToken Primary collateral token address (address(0) for ETH)
     */
    constructor(
        address admin, 
        uint256 _emergencyPauseDuration,
        address _primaryCollateralToken
    ) {
        require(admin != address(0), "CentralVault: Invalid admin");
        require(_emergencyPauseDuration <= MAX_WITHDRAWAL_DELAY, "CentralVault: Invalid pause duration");

        emergencyPauseDuration = _emergencyPauseDuration;
        withdrawalDelay = 1 hours; // Default 1 hour delay

        // Set primary collateral token
        primaryCollateralToken = _primaryCollateralToken;
        primaryCollateralIsERC20 = _primaryCollateralToken != address(0);

        // Setup roles
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(VAULT_ADMIN_ROLE, admin);
        _grantRole(EMERGENCY_ROLE, admin);

        // Add ETH as supported asset by default
        supportedAssets[ETH_ADDRESS] = true;
        assetList.push(ETH_ADDRESS);

        // Set default risk parameters for ETH
        assetRiskParams[ETH_ADDRESS] = RiskParameters({
            maxSingleWithdrawal: 100 ether,
            maxDailyWithdrawal: 1000 ether,
            collateralizationRatio: 15000, // 150%
            enabled: true
        });

        emit AssetAdded(ETH_ADDRESS, "Ethereum", "ETH");

        // If primary collateral is an ERC20 token, add it as supported asset
        if (primaryCollateralIsERC20) {
            _addPrimaryCollateralToken(_primaryCollateralToken);
        }
    }

    /**
     * @dev Deposits assets into the vault
     */
    function deposit(address asset, uint256 amount) 
        external 
        payable 
        override 
        nonReentrant 
        whenNotPaused 
        notEmergencyPaused
        onlySupportedAsset(asset)
    {
        require(amount > 0, "CentralVault: Invalid amount");

        if (asset == ETH_ADDRESS) {
            require(msg.value == amount, "CentralVault: ETH amount mismatch");
        } else {
            require(msg.value == 0, "CentralVault: ETH not expected");
            IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        }

        // Update user balance
        userBalances[msg.sender][asset].available += amount;
        totalAssetReserves[asset] += amount;

        emit Deposit(msg.sender, asset, amount, block.timestamp);
    }

    /**
     * @dev Withdraws assets from the vault
     */
    function withdraw(address asset, uint256 amount) 
        external 
        override 
        nonReentrant 
        whenNotPaused 
        notEmergencyPaused
        onlySupportedAsset(asset)
    {
        require(amount > 0, "CentralVault: Invalid amount");
        
        UserBalance storage balance = userBalances[msg.sender][asset];
        require(balance.available >= amount, "CentralVault: Insufficient available balance");

        // Check risk parameters
        _validateWithdrawal(msg.sender, asset, amount);

        if (withdrawalDelay > 0) {
            // Request delayed withdrawal
            _requestWithdrawal(msg.sender, asset, amount);
        } else {
            // Execute immediate withdrawal
            _executeWithdrawal(msg.sender, asset, amount);
        }
    }

    /**
     * @dev Executes a delayed withdrawal request
     */
    function executeWithdrawal(address asset) 
        external 
        nonReentrant 
        whenNotPaused 
        notEmergencyPaused
    {
        WithdrawalRequest storage request = withdrawalRequests[msg.sender][asset];
        require(!request.processed, "CentralVault: Request already processed");
        require(request.amount > 0, "CentralVault: No withdrawal request");
        require(
            block.timestamp >= request.requestTime + withdrawalDelay,
            "CentralVault: Withdrawal delay not met"
        );

        request.processed = true;
        _executeWithdrawal(msg.sender, asset, request.amount);
    }

    /**
     * @dev Cancels a withdrawal request
     */
    function cancelWithdrawal(address asset) external {
        WithdrawalRequest storage request = withdrawalRequests[msg.sender][asset];
        require(!request.processed, "CentralVault: Request already processed");
        require(request.amount > 0, "CentralVault: No withdrawal request");

        uint256 amount = request.amount;
        delete withdrawalRequests[msg.sender][asset];

        emit WithdrawalCancelled(msg.sender, asset, amount);
    }

    /**
     * @dev Allocates assets for trading (called by authorized markets)
     */
    function allocateAssets(
        address user,
        address asset,
        uint256 amount
    ) external override onlyAuthorizedMarket nonReentrant {
        require(amount > 0, "CentralVault: Invalid amount");
        
        UserBalance storage balance = userBalances[user][asset];
        require(balance.available >= amount, "CentralVault: Insufficient available balance");

        balance.available -= amount;
        balance.allocated += amount;

        emit AssetAllocation(user, msg.sender, asset, amount, true);
    }

    /**
     * @dev Deallocates assets from trading (called by authorized markets)
     */
    function deallocateAssets(
        address user,
        address asset,
        uint256 amount
    ) external override onlyAuthorizedMarket nonReentrant {
        require(amount > 0, "CentralVault: Invalid amount");
        
        UserBalance storage balance = userBalances[user][asset];
        require(balance.allocated >= amount, "CentralVault: Insufficient allocated balance");

        balance.allocated -= amount;
        balance.available += amount;

        emit AssetAllocation(user, msg.sender, asset, amount, false);
    }

    /**
     * @dev Transfers assets between users (for trade settlement)
     */
    function transferAssets(
        address from,
        address to,
        address asset,
        uint256 amount
    ) external override onlyAuthorizedMarket nonReentrant {
        require(from != to, "CentralVault: Cannot transfer to self");
        require(amount > 0, "CentralVault: Invalid amount");

        UserBalance storage fromBalance = userBalances[from][asset];
        require(fromBalance.allocated >= amount, "CentralVault: Insufficient allocated balance");

        fromBalance.allocated -= amount;
        userBalances[to][asset].available += amount;

        // Note: Total reserves stay the same as assets move between users
    }

    /**
     * @dev Returns user balance for a specific asset
     */
    function getUserBalance(address user, address asset)
        external
        view
        override
        returns (UserBalance memory balance)
    {
        return userBalances[user][asset];
    }

    /**
     * @dev Returns total assets under management
     */
    function getTotalAssets(address asset)
        external
        view
        override
        returns (uint256 total)
    {
        return totalAssetReserves[asset];
    }

    /**
     * @dev Checks if user has sufficient available balance
     */
    function hasSufficientBalance(
        address user,
        address asset,
        uint256 amount
    ) external view override returns (bool sufficient) {
        return userBalances[user][asset].available >= amount;
    }

    /**
     * @dev Emergency pause function
     */
    function setEmergencyPause(bool isPaused) external override onlyRole(EMERGENCY_ROLE) {
        if (isPaused) {
            emergencyPauseStart = block.timestamp;
            _pause();
        } else {
            emergencyPauseStart = 0;
            _unpause();
        }

        emit EmergencyPause(msg.sender, isPaused);
    }

    /**
     * @dev Returns current pause status
     */
    function isEmergencyPaused() external view override returns (bool isPaused) {
        if (emergencyPauseStart == 0) return false;
        return block.timestamp <= emergencyPauseStart + emergencyPauseDuration;
    }

    /**
     * @dev Adds/removes authorized market contracts
     */
    function setMarketAuthorization(address market, bool isAuthorized) 
        external 
        override 
        onlyRole(VAULT_ADMIN_ROLE) 
    {
        require(market != address(0), "CentralVault: Invalid market address");

        if (isAuthorized && !authorizedMarkets[market]) {
            authorizedMarkets[market] = true;
            marketList.push(market);
        } else if (!isAuthorized && authorizedMarkets[market]) {
            authorizedMarkets[market] = false;
            _removeFromMarketList(market);
        }
    }

    /**
     * @dev Checks if a market is authorized
     */
    function isAuthorizedMarket(address market)
        external
        view
        override
        returns (bool isAuthorized)
    {
        return authorizedMarkets[market];
    }

    /**
     * @dev Adds a new supported asset
     */
    function addSupportedAsset(
        address asset,
        uint256 maxSingleWithdrawal,
        uint256 maxDailyWithdrawal,
        uint256 collateralizationRatio
    ) external onlyRole(VAULT_ADMIN_ROLE) {
        require(asset != address(0), "CentralVault: Invalid asset address");
        require(!supportedAssets[asset], "CentralVault: Asset already supported");
        require(collateralizationRatio >= 10000, "CentralVault: Invalid collateralization ratio");

        supportedAssets[asset] = true;
        assetList.push(asset);

        assetRiskParams[asset] = RiskParameters({
            maxSingleWithdrawal: maxSingleWithdrawal,
            maxDailyWithdrawal: maxDailyWithdrawal,
            collateralizationRatio: collateralizationRatio,
            enabled: true
        });

        // Try to get token info for event
        try IERC20Metadata(asset).name() returns (string memory name) {
            try IERC20Metadata(asset).symbol() returns (string memory symbol) {
                emit AssetAdded(asset, name, symbol);
            } catch {
                emit AssetAdded(asset, "Unknown", "UNK");
            }
        } catch {
            emit AssetAdded(asset, "Unknown", "UNK");
        }
    }

    /**
     * @dev Removes a supported asset
     */
    function removeSupportedAsset(address asset) external onlyRole(VAULT_ADMIN_ROLE) {
        require(supportedAssets[asset], "CentralVault: Asset not supported");
        require(totalAssetReserves[asset] == 0, "CentralVault: Asset has reserves");

        supportedAssets[asset] = false;
        delete assetRiskParams[asset];
        _removeFromAssetList(asset);

        emit AssetRemoved(asset);
    }

    /**
     * @dev Updates withdrawal delay
     */
    function setWithdrawalDelay(uint256 newDelay) external onlyRole(VAULT_ADMIN_ROLE) {
        require(newDelay <= MAX_WITHDRAWAL_DELAY, "CentralVault: Delay too long");
        
        uint256 oldDelay = withdrawalDelay;
        withdrawalDelay = newDelay;

        emit WithdrawalDelayUpdated(oldDelay, newDelay);
    }

    /**
     * @dev Updates risk parameters for an asset
     */
    function updateAssetRiskParameters(
        address asset,
        uint256 maxSingleWithdrawal,
        uint256 maxDailyWithdrawal,
        uint256 collateralizationRatio,
        bool enabled
    ) external onlyRole(VAULT_ADMIN_ROLE) onlySupportedAsset(asset) {
        require(collateralizationRatio >= 10000, "CentralVault: Invalid collateralization ratio");

        assetRiskParams[asset] = RiskParameters({
            maxSingleWithdrawal: maxSingleWithdrawal,
            maxDailyWithdrawal: maxDailyWithdrawal,
            collateralizationRatio: collateralizationRatio,
            enabled: enabled
        });

        emit RiskParametersUpdated(asset, maxSingleWithdrawal, maxDailyWithdrawal, collateralizationRatio);
    }

    /**
     * @dev Gets all supported assets
     */
    function getSupportedAssets() external view returns (address[] memory) {
        return assetList;
    }

    /**
     * @dev Gets all authorized markets
     */
    function getAuthorizedMarkets() external view returns (address[] memory) {
        return marketList;
    }

    /**
     * @dev Gets withdrawal request details
     */
    function getWithdrawalRequest(address user, address asset) 
        external 
        view 
        returns (uint256 amount, uint256 requestTime, bool processed, uint256 executeTime) 
    {
        WithdrawalRequest memory request = withdrawalRequests[user][asset];
        return (
            request.amount,
            request.requestTime,
            request.processed,
            request.requestTime + withdrawalDelay
        );
    }

    /**
     * @dev Gets current day for daily withdrawal tracking
     */
    function getCurrentDay() public view returns (uint256) {
        return block.timestamp / 1 days;
    }

    /**
     * @dev Gets daily withdrawal amount for user
     */
    function getDailyWithdrawal(address user, uint256 day) external view returns (uint256) {
        return dailyWithdrawals[user][day];
    }

    /**
     * @dev Emergency withdrawal function (admin only)
     */
    function emergencyWithdraw(
        address asset,
        address to,
        uint256 amount
    ) external onlyRole(EMERGENCY_ROLE) {
        require(to != address(0), "CentralVault: Invalid recipient");
        require(amount > 0, "CentralVault: Invalid amount");

        if (asset == ETH_ADDRESS) {
            require(address(this).balance >= amount, "CentralVault: Insufficient ETH balance");
            payable(to).sendValue(amount);
        } else {
            IERC20(asset).safeTransfer(to, amount);
        }

        totalAssetReserves[asset] -= amount;
    }

    // Internal functions

    /**
     * @dev Validates withdrawal against risk parameters
     */
    function _validateWithdrawal(address user, address asset, uint256 amount) internal view {
        RiskParameters memory riskParams = assetRiskParams[asset];
        require(riskParams.enabled, "CentralVault: Asset disabled for withdrawal");

        // Check single withdrawal limit
        if (riskParams.maxSingleWithdrawal > 0) {
            require(amount <= riskParams.maxSingleWithdrawal, "CentralVault: Exceeds single withdrawal limit");
        }

        // Check daily withdrawal limit
        if (riskParams.maxDailyWithdrawal > 0) {
            uint256 currentDay = getCurrentDay();
            uint256 dailyTotal = dailyWithdrawals[user][currentDay] + amount;
            require(dailyTotal <= riskParams.maxDailyWithdrawal, "CentralVault: Exceeds daily withdrawal limit");
        }
    }

    /**
     * @dev Requests a delayed withdrawal
     */
    function _requestWithdrawal(address user, address asset, uint256 amount) internal {
        // Cancel any existing request
        if (withdrawalRequests[user][asset].amount > 0) {
            delete withdrawalRequests[user][asset];
        }

        withdrawalRequests[user][asset] = WithdrawalRequest({
            amount: amount,
            requestTime: block.timestamp,
            processed: false
        });

        // Lock the funds
        UserBalance storage balance = userBalances[user][asset];
        balance.available -= amount;
        balance.locked += amount;

        emit WithdrawalRequested(user, asset, amount, block.timestamp + withdrawalDelay);
    }

    /**
     * @dev Executes withdrawal transfer
     */
    function _executeWithdrawal(address user, address asset, uint256 amount) internal {
        require(user != address(0), "CentralVault: Invalid user address");
        require(amount > 0, "CentralVault: Invalid withdrawal amount");
        
        UserBalance storage balance = userBalances[user][asset];
        
        // Ensure sufficient total balance (available + locked)
        uint256 totalUserBalance = balance.available + balance.locked;
        require(totalUserBalance >= amount, "CentralVault: Insufficient total balance");
        
        // Handle locked funds if this is a delayed withdrawal
        if (balance.locked >= amount) {
            balance.locked -= amount;
        } else {
            uint256 remainingAmount = amount - balance.locked;
            require(balance.available >= remainingAmount, "CentralVault: Insufficient available balance");
            balance.locked = 0;
            balance.available -= remainingAmount;
        }

        // Ensure we have sufficient reserves
        require(totalAssetReserves[asset] >= amount, "CentralVault: Insufficient vault reserves");
        totalAssetReserves[asset] -= amount;

        // Update daily withdrawal tracking with overflow protection
        uint256 currentDay = getCurrentDay();
        uint256 currentDailyWithdrawal = dailyWithdrawals[user][currentDay];
        require(currentDailyWithdrawal <= type(uint256).max - amount, "CentralVault: Daily withdrawal overflow");
        dailyWithdrawals[user][currentDay] += amount;

        // Execute transfer with proper error handling
        if (asset == ETH_ADDRESS) {
            require(address(this).balance >= amount, "CentralVault: Insufficient ETH balance");
            payable(user).sendValue(amount);
        } else {
            // Check contract balance before transfer
            uint256 contractBalance = IERC20(asset).balanceOf(address(this));
            require(contractBalance >= amount, "CentralVault: Insufficient token balance");
            IERC20(asset).safeTransfer(user, amount);
        }

        emit Withdrawal(user, asset, amount, block.timestamp);
        emit WithdrawalExecuted(user, asset, amount);
    }

    /**
     * @dev Removes market from authorized list
     */
    function _removeFromMarketList(address market) internal {
        for (uint256 i = 0; i < marketList.length; i++) {
            if (marketList[i] == market) {
                marketList[i] = marketList[marketList.length - 1];
                marketList.pop();
                break;
            }
        }
    }

    /**
     * @dev Removes asset from supported list
     */
    function _removeFromAssetList(address asset) internal {
        for (uint256 i = 0; i < assetList.length; i++) {
            if (assetList[i] == asset) {
                assetList[i] = assetList[assetList.length - 1];
                assetList.pop();
                break;
            }
        }
    }

    /**
     * @dev Sets a new primary collateral token (admin only)
     */
    function setPrimaryCollateralToken(address newCollateralToken) 
        external 
        onlyRole(VAULT_ADMIN_ROLE) 
    {
        address oldToken = primaryCollateralToken;
        primaryCollateralToken = newCollateralToken;
        primaryCollateralIsERC20 = newCollateralToken != address(0);

        // Add new token as supported asset if it's an ERC20
        if (primaryCollateralIsERC20 && !supportedAssets[newCollateralToken]) {
            _addPrimaryCollateralToken(newCollateralToken);
        }

        emit PrimaryCollateralTokenUpdated(oldToken, newCollateralToken);
    }

    /**
     * @dev Gets primary collateral token information
     */
    function getPrimaryCollateralToken() 
        external 
        view 
        returns (address token, bool isERC20, string memory name, string memory symbol) 
    {
        token = primaryCollateralToken;
        isERC20 = primaryCollateralIsERC20;
        
        if (isERC20) {
            try IERC20Metadata(token).name() returns (string memory _name) {
                name = _name;
            } catch {
                name = "Unknown";
            }
            
            try IERC20Metadata(token).symbol() returns (string memory _symbol) {
                symbol = _symbol;
            } catch {
                symbol = "UNK";
            }
        } else {
            name = "Ethereum";
            symbol = "ETH";
        }
    }

    /**
     * @dev Gets primary collateral balance for a user
     */
    function getPrimaryCollateralBalance(address user) 
        external 
        view 
        returns (uint256 available, uint256 allocated, uint256 locked) 
    {
        UserBalance memory balance = userBalances[user][primaryCollateralToken];
        return (balance.available, balance.allocated, balance.locked);
    }

    /**
     * @dev Deposits primary collateral (convenience function)
     */
    function depositPrimaryCollateral(uint256 amount) 
        external 
        payable 
        nonReentrant 
        whenNotPaused 
        notEmergencyPaused 
    {
        require(amount > 0, "CentralVault: Invalid amount");

        if (primaryCollateralIsERC20) {
            require(msg.value == 0, "CentralVault: ETH not expected for ERC20 collateral");
            IERC20(primaryCollateralToken).safeTransferFrom(msg.sender, address(this), amount);
        } else {
            require(msg.value == amount, "CentralVault: ETH amount mismatch");
        }

        // Update user balance
        userBalances[msg.sender][primaryCollateralToken].available += amount;
        totalAssetReserves[primaryCollateralToken] += amount;

        emit Deposit(msg.sender, primaryCollateralToken, amount, block.timestamp);
    }

    /**
     * @dev Withdraws primary collateral (convenience function)
     */
    function withdrawPrimaryCollateral(uint256 amount) 
        external 
        whenNotPaused 
        notEmergencyPaused 
    {
        require(amount > 0, "CentralVault: Invalid amount");
        
        UserBalance storage balance = userBalances[msg.sender][primaryCollateralToken];
        require(balance.available >= amount, "CentralVault: Insufficient available balance");

        // Check risk parameters
        _validateWithdrawal(msg.sender, primaryCollateralToken, amount);

        if (withdrawalDelay > 0) {
            // Request delayed withdrawal
            _requestWithdrawal(msg.sender, primaryCollateralToken, amount);
        } else {
            // Execute immediate withdrawal
            _executeWithdrawal(msg.sender, primaryCollateralToken, amount);
        }
    }

    // Internal functions

    /**
     * @dev Adds primary collateral token as supported asset
     */
    function _addPrimaryCollateralToken(address token) internal {
        require(token != address(0), "CentralVault: Invalid token address");
        
        supportedAssets[token] = true;
        assetList.push(token);

        // Set generous default risk parameters for primary collateral
        assetRiskParams[token] = RiskParameters({
            maxSingleWithdrawal: type(uint256).max, // No limit
            maxDailyWithdrawal: type(uint256).max,  // No limit
            collateralizationRatio: 12000, // 120%
            enabled: true
        });

        // Try to get token info for event
        try IERC20Metadata(token).name() returns (string memory name) {
            try IERC20Metadata(token).symbol() returns (string memory symbol) {
                emit AssetAdded(token, name, symbol);
            } catch {
                emit AssetAdded(token, "Primary Collateral", "COL");
            }
        } catch {
            emit AssetAdded(token, "Primary Collateral", "COL");
        }
    }

    /**
     * @dev Receive function for ETH deposits
     */
    receive() external payable {
        // Only allow ETH deposits if ETH is the primary collateral or if it's supported
        require(
            !primaryCollateralIsERC20 || supportedAssets[ETH_ADDRESS], 
            "CentralVault: ETH deposits not allowed"
        );
        
        totalAssetReserves[ETH_ADDRESS] += msg.value;
        userBalances[msg.sender][ETH_ADDRESS].available += msg.value;
        emit Deposit(msg.sender, ETH_ADDRESS, msg.value, block.timestamp);
    }

    // Additional events
    event PrimaryCollateralTokenUpdated(address indexed oldToken, address indexed newToken);
}
