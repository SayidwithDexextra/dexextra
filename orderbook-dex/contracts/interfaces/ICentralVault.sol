// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title ICentralVault
 * @dev Interface for the Central Vault contract
 * @notice Manages secure custody of all trading assets
 */
interface ICentralVault {
    /**
     * @dev Emitted when assets are deposited
     */
    event Deposit(
        address indexed user,
        address indexed asset,
        uint256 amount,
        uint256 timestamp
    );

    /**
     * @dev Emitted when assets are withdrawn
     */
    event Withdrawal(
        address indexed user,
        address indexed asset,
        uint256 amount,
        uint256 timestamp
    );

    /**
     * @dev Emitted when assets are allocated for trading
     */
    event AssetAllocation(
        address indexed user,
        address indexed market,
        address indexed asset,
        uint256 amount,
        bool isAllocation
    );

    /**
     * @dev Emitted when emergency pause is triggered
     */
    event EmergencyPause(address indexed admin, bool isPaused);

    /**
     * @dev User balance information
     */
    struct UserBalance {
        uint256 available;  // Available for trading
        uint256 allocated;  // Allocated to open positions
        uint256 locked;     // Locked for pending operations
    }

    /**
     * @dev Deposits assets into the vault
     * @param asset Address of the asset to deposit
     * @param amount Amount to deposit
     */
    function deposit(address asset, uint256 amount) external payable;

    /**
     * @dev Withdraws assets from the vault
     * @param asset Address of the asset to withdraw
     * @param amount Amount to withdraw
     */
    function withdraw(address asset, uint256 amount) external;

    /**
     * @dev Allocates assets for trading (called by authorized markets)
     * @param user User address
     * @param asset Asset address
     * @param amount Amount to allocate
     */
    function allocateAssets(
        address user,
        address asset,
        uint256 amount
    ) external;

    /**
     * @dev Deallocates assets from trading (called by authorized markets)
     * @param user User address
     * @param asset Asset address
     * @param amount Amount to deallocate
     */
    function deallocateAssets(
        address user,
        address asset,
        uint256 amount
    ) external;

    /**
     * @dev Transfers assets between users (for trade settlement)
     * @param from Source user
     * @param to Destination user
     * @param asset Asset address
     * @param amount Amount to transfer
     */
    function transferAssets(
        address from,
        address to,
        address asset,
        uint256 amount
    ) external;

    /**
     * @dev Returns user balance for a specific asset
     * @param user User address
     * @param asset Asset address
     * @return balance User balance struct
     */
    function getUserBalance(address user, address asset)
        external
        view
        returns (UserBalance memory balance);

    /**
     * @dev Returns total assets under management
     * @param asset Asset address
     * @return total Total amount of asset in vault
     */
    function getTotalAssets(address asset)
        external
        view
        returns (uint256 total);

    /**
     * @dev Checks if user has sufficient available balance
     * @param user User address
     * @param asset Asset address
     * @param amount Required amount
     * @return sufficient True if sufficient balance
     */
    function hasSufficientBalance(
        address user,
        address asset,
        uint256 amount
    ) external view returns (bool sufficient);

    /**
     * @dev Emergency pause function
     * @param isPaused New pause status
     */
    function setEmergencyPause(bool isPaused) external;

    /**
     * @dev Returns current pause status
     * @return isPaused Current pause status
     */
    function isEmergencyPaused() external view returns (bool isPaused);

    /**
     * @dev Adds/removes authorized market contracts
     * @param market Market contract address
     * @param isAuthorized Authorization status
     */
    function setMarketAuthorization(address market, bool isAuthorized) external;

    /**
     * @dev Checks if a market is authorized
     * @param market Market contract address
     * @return isAuthorized Authorization status
     */
    function isAuthorizedMarket(address market)
        external
        view
        returns (bool isAuthorized);

    /**
     * @dev Gets primary collateral token information
     * @return token Primary collateral token address
     * @return isERC20 Whether the primary collateral is an ERC20 token
     * @return name Token name
     * @return symbol Token symbol
     */
    function getPrimaryCollateralToken() 
        external 
        view 
        returns (address token, bool isERC20, string memory name, string memory symbol);
}
