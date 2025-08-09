// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// SafeERC20 library for secure token transfers
library SafeERC20 {
    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(token.transfer.selector, to, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "SafeERC20: transfer failed");
    }

    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(token.transferFrom.selector, from, to, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "SafeERC20: transferFrom failed");
    }

    function safeApprove(IERC20 token, address spender, uint256 value) internal {
        require((value == 0) || (token.allowance(address(this), spender) == 0), "SafeERC20: approve from non-zero");
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(token.approve.selector, spender, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "SafeERC20: approve failed");
    }
}

// Local interfaces to avoid external dependencies
interface LinkTokenInterface {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface AutomationRegistryInterface2_0 {
    function getUpkeep(uint256 id) external view returns (
        address target,
        uint32 executeGas,
        bytes memory checkData,
        uint96 balance,
        address admin,
        uint64 maxValidBlocknumber,
        uint32 lastPerformedBlockNumber,
        uint96 amountSpent,
        bool paused,
        bytes memory offchainConfig
    );
    
    function addFunds(uint256 id, uint96 amount) external;
    
    function registerUpkeep(
        address target,
        uint32 gasLimit,
        address admin,
        bytes calldata checkData,
        uint96 amount
    ) external returns (uint256 id);
    
    function cancelUpkeep(uint256 id) external;
    function setUpkeepGasLimit(uint256 id, uint32 gasLimit) external;
}

interface ISwapRouter {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }
    
    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}

/**
 * @title AutomationFundingManager
 * @dev Manages hybrid Chainlink funding model - users pay USDC, protocol handles LINK
 */
contract AutomationFundingManager {
    using SafeERC20 for IERC20;
    
    // === INTERFACES ===
    
    LinkTokenInterface public constant LINK_TOKEN = LinkTokenInterface(0x514910771AF9Ca656af840dff83E8264EcF986CA);
    AutomationRegistryInterface2_0 public constant AUTOMATION_REGISTRY = AutomationRegistryInterface2_0(0x02777053d6764996e594c3E88AF1D58D5363a2e6);
    ISwapRouter public constant SWAP_ROUTER = ISwapRouter(0xE592427A0AEce92De3Edee1F18E0157C05861564);
    
    address public constant USDC = 0xA0B86a33e6441fa0c907CB6c47D6BD063096c8B8;
    address public constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    
    // === STATE VARIABLES ===
    
    address public owner;
    address public treasury;
    address public limitOrderManager;
    
    // Upkeep management
    uint256 public upkeepId;
    uint256 public constant MIN_LINK_BALANCE = 5 ether;      // 5 LINK minimum
    uint256 public constant REFILL_AMOUNT = 20 ether;       // 20 LINK refill
    uint256 public constant LINK_BUFFER = 50 ether;         // 50 LINK treasury buffer
    
    // Fee management
    uint256 public totalUSDCCollected;
    uint256 public totalLinkPurchased;
    uint256 public totalLinkSpent;
    uint256 public lastLinkPurchase;
    
    // Revenue sharing (in basis points)
    uint256 public constant TREASURY_SHARE = 7000;  // 70% for LINK funding
    uint256 public constant PROTOCOL_SHARE = 3000;  // 30% for protocol revenue
    uint256 public constant BASIS_POINTS = 10000;
    
    // Automation parameters
    uint256 public automationCheckInterval = 1 hours;
    uint256 public lastAutomationCheck;
    bool public autoFundingEnabled = true;
    
    // === EVENTS ===
    
    event USDCCollected(address indexed from, uint256 amount, uint256 totalCollected);
    event LinkPurchased(uint256 usdcSpent, uint256 linkReceived, uint256 price);
    event UpkeepFunded(uint256 upkeepId, uint256 linkAmount);
    event RevenueDistributed(uint256 treasuryAmount, uint256 protocolAmount);
    event AutomationStatusChanged(bool enabled);
    event UpkeepRegistered(uint256 upkeepId, string name);
    
    // === MODIFIERS ===
    
    modifier onlyOwner() {
        require(msg.sender == owner, "AutomationFunding: only owner");
        _;
    }
    
    modifier onlyLimitOrderManager() {
        require(msg.sender == limitOrderManager, "AutomationFunding: only limit order manager");
        _;
    }
    
    modifier whenAutoFundingEnabled() {
        require(autoFundingEnabled, "AutomationFunding: auto funding disabled");
        _;
    }

    // === CONSTRUCTOR ===
    
    constructor(
        address _treasury,
        address _limitOrderManager
    ) {
        owner = msg.sender;
        treasury = _treasury;
        limitOrderManager = _limitOrderManager;
        lastAutomationCheck = block.timestamp;
    }

    // === FEE COLLECTION ===
    
    /**
     * @dev Collect automation fee from user (called by LimitOrderManager)
     */
    function collectAutomationFee(address user, uint256 usdcAmount) external onlyLimitOrderManager {
        // VALIDATION: USDC amount must be positive for meaningful fee collection
        // FAILS: When usdcAmount = 0 (no fee to collect)
        // SUCCEEDS: When usdcAmount > 0 (valid fee amount)
        // REASONING: Zero fees provide no funding for automation and waste gas.
        // All automation operations require fees to cover LINK costs and system maintenance.
        require(
            usdcAmount > 0, 
            "AutomationFunding: Fee amount must be greater than zero for automation funding"
        );
        
        // Transfer USDC from LimitOrderManager (which collected from user)
        IERC20(USDC).safeTransferFrom(limitOrderManager, address(this), usdcAmount);
        
        totalUSDCCollected += usdcAmount;
        
        emit USDCCollected(user, usdcAmount, totalUSDCCollected);
        
        // Trigger automated funding check if needed
        if (autoFundingEnabled && 
            block.timestamp >= lastAutomationCheck + automationCheckInterval) {
            _performAutomatedMaintenance();
        }
    }

    // === AUTOMATED MAINTENANCE ===
    
    /**
     * @dev Perform automated funding maintenance
     */
    function performMaintenance() external {
        _performAutomatedMaintenance();
    }
    
    function _performAutomatedMaintenance() internal whenAutoFundingEnabled {
        lastAutomationCheck = block.timestamp;
        
        // 1. Check if upkeep needs funding
        if (upkeepId != 0) {
            _checkAndFundUpkeep();
        }
        
        // 2. Buy LINK if treasury is low
        _checkAndBuyLink();
        
        // 3. Distribute revenue if accumulated enough
        if (totalUSDCCollected >= 1000e6) { // $1000 threshold
            _distributeRevenue();
        }
    }
    
    function _checkAndFundUpkeep() internal {
        if (upkeepId == 0) return;
        
        try AUTOMATION_REGISTRY.getUpkeep(upkeepId) returns (
            address target,
            uint32 executeGas,
            bytes memory checkData,
            uint96 balance,
            address admin,
            uint64 maxValidBlocknumber,
            uint32 lastPerformedBlockNumber,
            uint96 amountSpent,
            bool paused,
            bytes memory offchainConfig
        ) {
            // Check if upkeep needs funding
            if (balance < MIN_LINK_BALANCE && !paused) {
                _fundUpkeep(REFILL_AMOUNT);
            }
        } catch {
            // Upkeep might not exist or registry call failed
            // This is non-critical, just log and continue
        }
    }
    
    function _checkAndBuyLink() internal {
        uint256 linkBalance = LINK_TOKEN.balanceOf(address(this));
        
        // Buy LINK if we're running low
        if (linkBalance < LINK_BUFFER) {
            uint256 usdcToBuy = 500e6; // $500 worth of LINK
            
            if (IERC20(USDC).balanceOf(address(this)) >= usdcToBuy) {
                _buyLinkWithUSDC(usdcToBuy);
            }
        }
    }

    // === LINK MANAGEMENT ===
    
    /**
     * @dev Buy LINK tokens with collected USDC fees
     */
    function buyLinkWithUSDC(uint256 usdcAmount) external onlyOwner {
        _buyLinkWithUSDC(usdcAmount);
    }
    
    function _buyLinkWithUSDC(uint256 usdcAmount) internal {
        // VALIDATION: USDC amount must be positive for meaningful purchase
        // FAILS: When usdcAmount = 0 (no USDC to convert)
        // SUCCEEDS: When usdcAmount > 0 (valid purchase amount)
        // REASONING: Zero USDC purchases waste gas and don't provide LINK funding.
        // All purchases must be meaningful amounts to cover transaction costs.
        require(
            usdcAmount > 0, 
            "AutomationFunding: USDC amount must be greater than zero for LINK purchase"
        );
        
        // VALIDATION: Contract must have sufficient USDC balance for purchase
        // FAILS: When contract USDC balance < usdcAmount (insufficient funds)
        // SUCCEEDS: When contract has enough USDC for the purchase
        // REASONING: Cannot purchase LINK without sufficient USDC in the contract.
        // This ensures purchases only occur when funds are available.
        require(
            IERC20(USDC).balanceOf(address(this)) >= usdcAmount,
            "AutomationFunding: Insufficient USDC balance for LINK purchase"
        );
        
        // Approve USDC for Uniswap router
        IERC20(USDC).safeApprove(address(SWAP_ROUTER), usdcAmount);
        
        // Swap USDC → WETH → LINK (more liquid path)
        ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
            path: abi.encodePacked(
                USDC,
                uint24(500),  // 0.05% fee tier USDC/WETH
                WETH,
                uint24(3000), // 0.3% fee tier WETH/LINK
                address(LINK_TOKEN)
            ),
            recipient: address(this),
            deadline: block.timestamp + 300, // 5 minutes
            amountIn: usdcAmount,
            amountOutMinimum: 0 // Accept any amount of LINK (could add slippage protection)
        });
        
        uint256 linkReceived = SWAP_ROUTER.exactInput(params);
        
        totalLinkPurchased += linkReceived;
        lastLinkPurchase = block.timestamp;
        
        // Calculate approximate price (USDC has 6 decimals, LINK has 18)
        uint256 linkPriceInUSDC = (usdcAmount * 1e18) / linkReceived; // Price in USDC with 18 decimals
        
        emit LinkPurchased(usdcAmount, linkReceived, linkPriceInUSDC);
    }
    
    /**
     * @dev Fund upkeep with LINK tokens
     */
    function fundUpkeep(uint256 linkAmount) external onlyOwner {
        _fundUpkeep(linkAmount);
    }
    
    function _fundUpkeep(uint256 linkAmount) internal {
        require(upkeepId != 0, "AutomationFunding: No upkeep registered");
        
        // VALIDATION: LINK amount must be positive for meaningful funding
        // FAILS: When linkAmount = 0 (no LINK to fund)
        // SUCCEEDS: When linkAmount > 0 (valid funding amount)
        // REASONING: Zero LINK funding provides no upkeep funding and wastes gas.
        // Upkeeps require meaningful LINK amounts to cover execution costs.
        require(
            linkAmount > 0, 
            "AutomationFunding: LINK amount must be greater than zero for upkeep funding"
        );
        
        // VALIDATION: Contract must have sufficient LINK balance for funding
        // FAILS: When contract LINK balance < linkAmount (insufficient LINK)
        // SUCCEEDS: When contract has enough LINK for upkeep funding
        // REASONING: Cannot fund upkeep without sufficient LINK tokens in the contract.
        // This ensures funding only occurs when LINK is available.
        require(
            LINK_TOKEN.balanceOf(address(this)) >= linkAmount,
            "AutomationFunding: Insufficient LINK balance for upkeep funding"
        );
        
        // Approve and fund upkeep
        IERC20(address(LINK_TOKEN)).safeApprove(address(AUTOMATION_REGISTRY), linkAmount);
        AUTOMATION_REGISTRY.addFunds(upkeepId, uint96(linkAmount));
        
        totalLinkSpent += linkAmount;
        
        emit UpkeepFunded(upkeepId, linkAmount);
    }

    // === REVENUE MANAGEMENT ===
    
    /**
     * @dev Distribute collected revenue between treasury and protocol
     */
    function distributeRevenue() external onlyOwner {
        _distributeRevenue();
    }
    
    function _distributeRevenue() internal {
        uint256 revenue = totalUSDCCollected;
        
        // VALIDATION: Must have revenue to distribute
        // FAILS: When totalUSDCCollected = 0 (no fees collected)
        // SUCCEEDS: When revenue > 0 (fees available for distribution)
        // REASONING: Cannot distribute zero revenue as it provides no value to
        // treasury or protocol. Distribution requires accumulated fees.
        require(
            revenue > 0, 
            "AutomationFunding: No revenue to distribute - must collect fees before distribution"
        );
        
        // Calculate shares
        uint256 treasuryAmount = (revenue * TREASURY_SHARE) / BASIS_POINTS;
        uint256 protocolAmount = revenue - treasuryAmount;
        
        // Transfer to treasury (for LINK funding)
        if (treasuryAmount > 0) {
            IERC20(USDC).safeTransfer(treasury, treasuryAmount);
        }
        
        // Transfer to protocol (owner)
        if (protocolAmount > 0) {
            IERC20(USDC).safeTransfer(owner, protocolAmount);
        }
        
        // Reset collection counter
        totalUSDCCollected = 0;
        
        emit RevenueDistributed(treasuryAmount, protocolAmount);
    }

    // === UPKEEP MANAGEMENT ===
    
    /**
     * @dev Register new upkeep for automation
     */
    function registerUpkeep(
        string calldata name,
        bytes calldata encryptedEmail,
        address upkeepContract,
        uint32 gasLimit,
        bytes calldata checkData,
        uint96 amount
    ) external onlyOwner returns (uint256) {
        // VALIDATION: Upkeep contract must be valid deployed contract
        // FAILS: When upkeepContract = address(0) (invalid contract address)
        // SUCCEEDS: When upkeepContract is valid deployed contract address
        // REASONING: Upkeep contracts must be valid addresses to receive automation calls.
        // Zero address cannot execute automation functions and would break the system.
        require(
            upkeepContract != address(0), 
            "AutomationFunding: Upkeep contract cannot be zero address - must be valid deployed contract"
        );
        
        // VALIDATION: Gas limit must be reasonable for execution
        // FAILS: When gasLimit < 100000 (too low) or > 2500000 (too high)
        // SUCCEEDS: When gas limit is within reasonable execution bounds
        // REASONING: Gas limits must be sufficient for upkeep execution but not excessive.
        // Too low limits cause execution failures, too high limits waste resources.
        require(
            gasLimit >= 100000 && gasLimit <= 2500000, 
            "AutomationFunding: Gas limit must be between 100,000 and 2,500,000 for reliable execution"
        );
        
        // VALIDATION: Must provide initial funding for upkeep registration
        // FAILS: When amount = 0 (no initial funding)
        // SUCCEEDS: When amount > 0 (adequate initial funding)
        // REASONING: Upkeeps require initial LINK funding to begin operations.
        // Zero funding would result in immediate failure of automation service.
        require(
            amount > 0, 
            "AutomationFunding: Initial funding amount must be greater than zero for upkeep registration"
        );
        
        // Approve LINK for registration
        IERC20(address(LINK_TOKEN)).safeApprove(address(AUTOMATION_REGISTRY), amount);
        
        // Register upkeep
        upkeepId = AUTOMATION_REGISTRY.registerUpkeep(
            upkeepContract,
            gasLimit,
            address(this), // This contract is the admin
            checkData,
            amount
        );
        
        totalLinkSpent += amount;
        
        emit UpkeepRegistered(upkeepId, name);
        return upkeepId;
    }
    
    /**
     * @dev Update upkeep parameters
     */
    function updateUpkeep(uint32 gasLimit) external onlyOwner {
        require(upkeepId != 0, "AutomationFunding: No upkeep registered");
        AUTOMATION_REGISTRY.setUpkeepGasLimit(upkeepId, gasLimit);
    }
    
    /**
     * @dev Cancel upkeep and withdraw remaining funds
     */
    function cancelUpkeep() external onlyOwner {
        require(upkeepId != 0, "AutomationFunding: No upkeep registered");
        AUTOMATION_REGISTRY.cancelUpkeep(upkeepId);
        upkeepId = 0;
    }

    // === CONFIGURATION ===
    
    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "AutomationFunding: Invalid treasury");
        treasury = _treasury;
    }
    
    function setLimitOrderManager(address _limitOrderManager) external onlyOwner {
        require(_limitOrderManager != address(0), "AutomationFunding: Invalid limit order manager");
        limitOrderManager = _limitOrderManager;
    }
    
    function setAutomationCheckInterval(uint256 _interval) external onlyOwner {
        require(_interval >= 1 minutes && _interval <= 24 hours, "AutomationFunding: Invalid interval");
        automationCheckInterval = _interval;
    }
    
    function setAutoFundingEnabled(bool _enabled) external onlyOwner {
        autoFundingEnabled = _enabled;
        emit AutomationStatusChanged(_enabled);
    }

    // === VIEW FUNCTIONS ===
    
    function getUpkeepInfo() external view returns (
        uint256 id,
        uint256 balance,
        bool needsFunding,
        uint256 linkBalance,
        uint256 usdcBalance
    ) {
        id = upkeepId;
        linkBalance = LINK_TOKEN.balanceOf(address(this));
        usdcBalance = IERC20(USDC).balanceOf(address(this));
        
        if (upkeepId != 0) {
            try AUTOMATION_REGISTRY.getUpkeep(upkeepId) returns (
                address,
                uint32,
                bytes memory,
                uint96 upkeepBalance,
                address,
                uint64,
                uint32,
                uint96,
                bool,
                bytes memory
            ) {
                balance = upkeepBalance;
                needsFunding = upkeepBalance < MIN_LINK_BALANCE;
            } catch {
                balance = 0;
                needsFunding = true;
            }
        }
    }
    
    function getFinancialSummary() external view returns (
        uint256 totalUSDCCollectedAmount,
        uint256 totalLinkPurchasedAmount,
        uint256 totalLinkSpentAmount,
        uint256 currentUSDCBalance,
        uint256 currentLinkBalance,
        uint256 lastPurchaseTime
    ) {
        return (
            totalUSDCCollected,
            totalLinkPurchased,
            totalLinkSpent,
            IERC20(USDC).balanceOf(address(this)),
            LINK_TOKEN.balanceOf(address(this)),
            lastLinkPurchase
        );
    }
    
    function shouldPerformMaintenance() external view returns (bool needsMaintenance, string memory reason) {
        if (!autoFundingEnabled) {
            return (false, "Auto funding disabled");
        }
        
        if (block.timestamp < lastAutomationCheck + automationCheckInterval) {
            return (false, "Too soon for maintenance check");
        }
        
        // Check if upkeep needs funding
        if (upkeepId != 0) {
            try AUTOMATION_REGISTRY.getUpkeep(upkeepId) returns (
                address,
                uint32,
                bytes memory,
                uint96 balance,
                address,
                uint64,
                uint32,
                uint96,
                bool paused,
                bytes memory
            ) {
                if (balance < MIN_LINK_BALANCE && !paused) {
                    return (true, "Upkeep needs funding");
                }
            } catch {
                return (true, "Upkeep check failed");
            }
        }
        
        // Check if treasury needs LINK
        if (LINK_TOKEN.balanceOf(address(this)) < LINK_BUFFER) {
            return (true, "LINK balance low");
        }
        
        // Check if revenue should be distributed
        if (totalUSDCCollected >= 1000e6) {
            return (true, "Revenue ready for distribution");
        }
        
        return (false, "No maintenance needed");
    }

    // === EMERGENCY FUNCTIONS ===
    
    function emergencyWithdraw(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransfer(owner, balance);
    }
    
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "AutomationFunding: Invalid owner");
        owner = newOwner;
    }
}

// Helper interface for ERC20
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
} 