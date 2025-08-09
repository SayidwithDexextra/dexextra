// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ICentralizedVault
 * @dev Interface for the centralized vault supporting multiple VAMM contracts
 */
interface ICentralizedVault {
    struct MarginAccount {
        uint256 totalCollateral;        // Total USDC deposited
        uint256 availableCollateral;    // Available for new positions
        uint256 reservedMargin;         // Locked in active positions
        int256 unrealizedPnL;          // Net PnL across ALL VAMMs
        uint256 lastUpdateTime;         // Last interaction timestamp
    }

    struct VAMMAllocation {
        uint256 reservedMargin;         // Margin allocated to this VAMM
        int256 unrealizedPnL;          // PnL from this specific VAMM
        uint256 activePositions;        // Number of active positions
        uint256 lastFundingUpdate;      // Last funding payment
    }

    struct GlobalRiskMetrics {
        uint256 totalCollateral;       // Total collateral in vault
        uint256 totalReservedMargin;   // Total margin across all VAMMs
        int256 totalUnrealizedPnL;    // Total PnL across all VAMMs
        uint256 utilizationRatio;      // Reserved / Total ratio
        uint256 activeUsers;           // Number of users with positions
    }

    // Events
    event CollateralDeposited(address indexed user, uint256 amount, uint256 newBalance);
    event CollateralWithdrawn(address indexed user, uint256 amount, uint256 newBalance);
    event MarginReserved(address indexed user, address indexed vamm, uint256 amount);
    event MarginReleased(address indexed user, address indexed vamm, uint256 amount);
    event VAMMAuthorized(address indexed vamm, string category);
    event VAMMDeauthorized(address indexed vamm, string reason);
    event PnLUpdated(address indexed user, address indexed vamm, int256 pnlDelta, int256 totalPnL);
    event FundingApplied(address indexed user, address indexed vamm, int256 fundingPayment);
    event GlobalLiquidation(address indexed user, uint256 totalLoss, address[] vammsLiquidated);

    // Collateral management
    function depositCollateral(uint256 amount) external;
    function withdrawCollateral(uint256 amount) external;
    function getAvailableMargin(address user) external view returns (uint256);
    function getTotalMargin(address user) external view returns (int256);

    // VAMM authorization (only factory)
    function authorizeVAMM(address vamm, string calldata category) external;
    function deauthorizeVAMM(address vamm, string calldata reason) external;
    function isAuthorizedVAMM(address vamm) external view returns (bool);

    // Position management (only authorized VAMMs)
    function reserveMargin(address user, uint256 amount) external;
    function releaseMargin(address user, uint256 amount) external;
    function updatePnL(address user, int256 pnlDelta) external;
    function applyFunding(address user, int256 fundingPayment) external;

    // Risk management
    function checkLiquidationRisk(address user) external view returns (
        bool atRisk,
        uint256 totalExposure,
        uint256 marginRatio,
        address[] memory riskiestVAMMs
    );
    function liquidateUser(address user) external returns (uint256 totalLoss);
    function canOpenPosition(address user, uint256 additionalMargin) external view returns (bool);

    // Portfolio queries
    function getMarginAccount(address user) external view returns (MarginAccount memory);
    function getVAMMAllocation(address user, address vamm) external view returns (VAMMAllocation memory);
    function getPortfolioSummary(address user) external view returns (
        uint256 totalCollateral,
        uint256 availableMargin,
        int256 unrealizedPnL,
        uint256 marginRatio,
        uint256 activeVAMMs
    );

    // Global metrics
    function getGlobalRiskMetrics() external view returns (GlobalRiskMetrics memory);
    function getTotalValueLocked() external view returns (uint256);
    function getVAMMCount() external view returns (uint256);
    function getAllAuthorizedVAMMs() external view returns (address[] memory);
    
    // Token information
    function getCollateralToken() external view returns (address);
} 