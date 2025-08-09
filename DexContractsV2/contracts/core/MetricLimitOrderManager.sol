// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IMetricVAMM.sol";
import "../interfaces/ICentralizedVault.sol";
import "../interfaces/IMetricVAMMFactory.sol";
import "./MetricVAMMRouter.sol";

// SafeERC20 library for secure token transfers
library SafeERC20 {
    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(0xa9059cbb, to, value) // transfer(address,uint256)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "SafeERC20: transfer failed");
    }

    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(0x23b872dd, from, to, value) // transferFrom(address,address,uint256)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "SafeERC20: transferFrom failed");
    }
}

/**
 * @title MetricLimitOrderManager
 * @dev Industry-standard limit order implementation for VAMM system with hybrid Chainlink funding
 */
contract MetricLimitOrderManager {
    using SafeERC20 for IERC20;
    
    // === STRUCTS ===
    
    struct LimitOrder {
        bytes32 orderHash;              // Unique order identifier
        address user;                   // Order creator
        bytes32 metricId;              // Target metric
        bool isLong;                   // Position direction
        uint256 collateralAmount;      // Collateral to use
        uint256 leverage;              // Leverage multiplier
        uint256 triggerPrice;          // Execution trigger price
        uint256 targetValue;           // For prediction positions
        IMetricVAMM.PositionType positionType; // Position type
        OrderType orderType;           // Limit order type
        uint256 expiry;                // Order expiration timestamp
        uint256 maxSlippage;           // Maximum acceptable slippage (basis points)
        uint256 keeperFee;             // Fee for keeper execution
        bool isActive;                 // Order status
        uint256 createdAt;             // Creation timestamp
        uint256 nonce;                 // User nonce for EIP-712
    }

    enum OrderType {
        MARKET_IF_TOUCHED,             // Execute market order when price hit
        LIMIT,                         // Execute at exact trigger price or better
        STOP_LOSS,                     // Close position when price hits level
        TAKE_PROFIT                    // Close position at profit target
    }

    // === STATE VARIABLES ===
    
    MetricVAMMRouter public immutable router;
    ICentralizedVault public immutable vault;
    IMetricVAMMFactory public immutable factory;
    address public immutable automationFunding;
    address public owner;
    bool public paused;
    
    // Order storage
    mapping(bytes32 => LimitOrder) public limitOrders;
    mapping(address => bytes32[]) public userOrders;
    mapping(bytes32 => bytes32[]) public metricOrders; // Orders per metric
    
    // Keeper management
    mapping(address => bool) public authorizedKeepers;
    uint256 public maxOrdersPerTx = 10;
    
    // Fee structure (in USDC, 6 decimals)
    uint256 public constant AUTOMATION_FEE_USDC = 2e6;  // $2 USDC per order
    uint256 public constant EXECUTION_FEE_USDC = 3e6;   // $3 USDC per execution
    uint256 public constant MIN_KEEPER_FEE = 1e6;       // $1 USDC minimum
    uint256 public constant BASIS_POINTS = 10000;
    
    // EIP-712 for gasless orders
    bytes32 public constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "LimitOrder(address user,bytes32 metricId,bool isLong,uint256 collateralAmount,uint256 leverage,uint256 triggerPrice,uint256 targetValue,uint8 positionType,uint8 orderType,uint256 expiry,uint256 maxSlippage,uint256 keeperFee,uint256 nonce)"
    );
    
    mapping(address => uint256) public nonces;
    bytes32 public DOMAIN_SEPARATOR;

    // Statistics
    uint256 public totalOrdersCreated;
    uint256 public totalOrdersExecuted;
    uint256 public totalOrdersCancelled;
    uint256 public totalFeesCollected;

    // === EVENTS ===
    
    event LimitOrderCreated(
        bytes32 indexed orderHash,
        address indexed user,
        bytes32 indexed metricId,
        OrderType orderType,
        uint256 triggerPrice,
        uint256 expiry
    );
    
    event LimitOrderExecuted(
        bytes32 indexed orderHash,
        address indexed keeper,
        uint256 positionId,
        uint256 executionPrice,
        uint256 keeperReward
    );
    
    event LimitOrderCancelled(
        bytes32 indexed orderHash, 
        address indexed user,
        string reason
    );
    
    event BatchOrdersExecuted(
        uint256 successCount,
        uint256 attemptCount,
        address indexed keeper,
        uint256 totalRewards
    );

    event KeeperAuthorized(address indexed keeper, bool authorized);
    event AutomationFeeUpdated(uint256 newFee);

    // === MODIFIERS ===

    modifier onlyOwner() {
        require(msg.sender == owner, "LimitOrderManager: only owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "LimitOrderManager: paused");
        _;
    }

    modifier onlyAuthorizedKeeper() {
        require(authorizedKeepers[msg.sender], "LimitOrderManager: unauthorized keeper");
        _;
    }

    modifier collectsAutomationFee() {
        // Collect automation fee from user in USDC
        IERC20(vault.getCollateralToken()).safeTransferFrom(
            msg.sender, 
            automationFunding, 
            AUTOMATION_FEE_USDC
        );
        _;
    }

    // === CONSTRUCTOR ===
    
    constructor(
        address _router, 
        address _vault, 
        address _factory,
        address _automationFunding
    ) {
        router = MetricVAMMRouter(_router);
        vault = ICentralizedVault(_vault);
        factory = IMetricVAMMFactory(_factory);
        automationFunding = _automationFunding;
        owner = msg.sender;
        
        DOMAIN_SEPARATOR = keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256("MetricLimitOrderManager"),
            keccak256("1"),
            block.chainid,
            address(this)
        ));
    }

    // === ORDER PLACEMENT ===
    
    /**
     * @dev Create limit order with gasless signature
     * @param order Limit order parameters
     * @param signature EIP-712 signature from user
     */
    function createLimitOrderWithSignature(
        LimitOrder memory order,
        bytes calldata signature
    ) external whenNotPaused returns (bytes32 orderHash) {
        // Verify signature
        orderHash = _hashOrder(order);
        address signer = _recoverSigner(orderHash, signature);
        
        // VALIDATION: Signature must be from the specified user
        // FAILS: When recovered signer doesn't match order.user (invalid signature)
        // SUCCEEDS: When signature is valid and from correct user
        // REASONING: Prevents signature replay attacks and ensures only the user
        // can create orders for their account. Invalid signatures could allow
        // malicious actors to create unauthorized orders.
        require(
            signer == order.user, 
            "LimitOrderManager: Invalid signature - recovered signer does not match order user (check signature and order parameters)"
        );
        
        // VALIDATION: Nonce must match expected value to prevent replay attacks
        // FAILS: When order.nonce != current user nonce (replay attack or out of order)
        // SUCCEEDS: When nonce matches and increments correctly
        // REASONING: Nonces prevent signature replay attacks where the same signed
        // order could be submitted multiple times. Each signature can only be used once.
        require(
            nonces[order.user]++ == order.nonce, 
            "LimitOrderManager: Invalid nonce - prevents signature replay attacks (check current user nonce)"
        );
        
        return _createLimitOrder(order, orderHash);
    }
    
    /**
     * @dev Create limit order directly (pays gas)
     */
    function createLimitOrder(
        bytes32 metricId,
        bool isLong,
        uint256 collateralAmount,
        uint256 leverage,
        uint256 triggerPrice,
        uint256 targetValue,
        IMetricVAMM.PositionType positionType,
        OrderType orderType,
        uint256 expiry,
        uint256 maxSlippage
    ) external whenNotPaused collectsAutomationFee returns (bytes32 orderHash) {
        LimitOrder memory order = LimitOrder({
            orderHash: bytes32(0), // Will be set
            user: msg.sender,
            metricId: metricId,
            isLong: isLong,
            collateralAmount: collateralAmount,
            leverage: leverage,
            triggerPrice: triggerPrice,
            targetValue: targetValue,
            positionType: positionType,
            orderType: orderType,
            expiry: expiry,
            maxSlippage: maxSlippage,
            keeperFee: EXECUTION_FEE_USDC,
            isActive: true,
            createdAt: block.timestamp,
            nonce: 0 // Not used for direct orders
        });
        
        orderHash = _hashOrder(order);
        return _createLimitOrder(order, orderHash);
    }

    function _createLimitOrder(LimitOrder memory order, bytes32 orderHash) internal returns (bytes32) {
        // VALIDATION: Order must not be expired upon creation
        // FAILS: When order.expiry <= block.timestamp (order already expired)
        // SUCCEEDS: When order.expiry > block.timestamp (valid future expiry)
        // REASONING: Cannot create orders that are immediately expired. This ensures
        // orders have sufficient time for potential execution and prevents creation
        // of orders that would never be executable.
        require(
            order.expiry > block.timestamp, 
            "LimitOrderManager: Order expired on creation - expiry must be in the future to allow execution window"
        );
        
        // VALIDATION: Keeper fee must meet minimum threshold for execution incentive
        // FAILS: When order.keeperFee < MIN_KEEPER_FEE (insufficient keeper incentive)
        // SUCCEEDS: When keeper fee is adequate to incentivize execution
        // REASONING: Keepers need sufficient compensation to cover gas costs and
        // provide execution service. Insufficient fees could result in orders
        // never being executed due to lack of keeper incentive.
        require(
            order.keeperFee >= MIN_KEEPER_FEE, 
            "LimitOrderManager: Insufficient keeper fee - must meet minimum threshold to incentivize execution"
        );
        
        // VALIDATION: Collateral amount must be positive for position backing
        // FAILS: When order.collateralAmount = 0 (no collateral for position)
        // SUCCEEDS: When collateral amount > 0 (adequate position backing)
        // REASONING: Zero collateral orders cannot create meaningful positions and
        // waste system resources. All orders must have collateral to back positions.
        require(
            order.collateralAmount > 0, 
            "LimitOrderManager: Invalid collateral amount - must be greater than zero to back position"
        );
        
        // VALIDATION: Leverage must be within reasonable bounds
        // FAILS: When leverage < 1 (sub-unity leverage makes no sense)
        // SUCCEEDS: When leverage >= 1 (meaningful leverage multiplier)
        // REASONING: Leverage below 1x provides no trading advantage and could
        // confuse users or break position size calculations.
        require(
            order.leverage >= 1, 
            "LimitOrderManager: Invalid leverage - must be at least 1x for meaningful position sizing"
        );
        
        // VALIDATION: Trigger price must be positive for valid price comparison
        // FAILS: When triggerPrice = 0 (invalid price level)
        // SUCCEEDS: When triggerPrice > 0 (valid price for execution)
        // REASONING: Zero trigger prices cannot be compared against market prices
        // and would break order execution logic. All prices must be positive.
        require(
            order.triggerPrice > 0, 
            "LimitOrderManager: Invalid trigger price - must be greater than zero for price comparison"
        );
        
        // VALIDATION: Slippage must be reasonable percentage (max 50%)
        // FAILS: When maxSlippage > 5000 basis points (>50% slippage)
        // SUCCEEDS: When slippage is within reasonable bounds
        // REASONING: Excessive slippage tolerance could result in execution at
        // very unfavorable prices. 50% maximum protects users from extreme fills.
        require(
            order.maxSlippage <= 5000, 
            "LimitOrderManager: Excessive slippage tolerance - maximum 5000 basis points (50%) to protect against unfavorable execution"
        );
        
        // Check user has sufficient balance (include all fees)
        uint256 totalCost = order.collateralAmount + order.keeperFee + AUTOMATION_FEE_USDC;
        
        // VALIDATION: User must have sufficient margin for total order cost
        // FAILS: When available margin < totalCost (insufficient funds)
        // SUCCEEDS: When user has enough margin for collateral plus all fees
        // REASONING: Orders require collateral plus automation and execution fees.
        // Insufficient margin prevents order creation to avoid failed executions.
        require(
            vault.getAvailableMargin(order.user) >= totalCost,
            "LimitOrderManager: Insufficient margin - need collateral plus automation fee plus execution fee"
        );
        
        // Check metric is supported
        address vammAddress = factory.getVAMMByMetric(order.metricId);
        
        // VALIDATION: Metric must be supported by an active VAMM
        // FAILS: When no VAMM supports the specified metric (address = 0)
        // SUCCEEDS: When metric has associated VAMM for trading
        // REASONING: Cannot create orders for unsupported metrics as there would
        // be no VAMM to execute the trade. Orders need valid trading venue.
        require(
            vammAddress != address(0), 
            "LimitOrderManager: Unsupported metric - no VAMM deployed for this metric (check factory mappings)"
        );
        
        // Store order
        order.orderHash = orderHash;
        limitOrders[orderHash] = order;
        userOrders[order.user].push(orderHash);
        metricOrders[order.metricId].push(orderHash);
        
        // Update statistics
        totalOrdersCreated++;
        totalFeesCollected += AUTOMATION_FEE_USDC + order.keeperFee;
        
        emit LimitOrderCreated(
            orderHash, 
            order.user, 
            order.metricId, 
            order.orderType, 
            order.triggerPrice,
            order.expiry
        );
        
        return orderHash;
    }

    // === ORDER EXECUTION ===
    
    /**
     * @dev Execute single limit order (called by keepers)
     */
    function executeLimitOrder(bytes32 orderHash) external onlyAuthorizedKeeper whenNotPaused returns (uint256 positionId) {
        LimitOrder storage order = limitOrders[orderHash];
        
        // VALIDATION: Order must be currently active for execution
        // FAILS: When order.isActive = false (already executed, cancelled, or inactive)
        // SUCCEEDS: When order is active and available for execution
        // REASONING: Only active orders should be executable. Inactive orders may have
        // been cancelled, already executed, or failed validation. Prevents duplicate execution.
        require(
            order.isActive, 
            "LimitOrderManager: Order not active - may be cancelled, executed, or invalid (check order status)"
        );
        
        // VALIDATION: Order must not be expired for execution
        // FAILS: When current time >= order.expiry (order expired)
        // SUCCEEDS: When order is still within valid execution window
        // REASONING: Expired orders should not be executed as they may no longer
        // represent user's current trading intentions. Protects users from stale orders.
        require(
            order.expiry > block.timestamp, 
            "LimitOrderManager: Order expired - cannot execute expired orders (user must create new order with updated expiry)"
        );
        
        // Check if trigger condition is met
        uint256 currentPrice = _getCurrentPrice(order.metricId);
        
        // VALIDATION: Market conditions must meet order trigger requirements
        // FAILS: When current price doesn't satisfy trigger condition for order type
        // SUCCEEDS: When price conditions are met for order execution
        // REASONING: Orders should only execute when specified price conditions are met.
        // Premature execution could result in unfavorable fills for the user.
        require(
            _shouldExecuteOrder(order, currentPrice), 
            "LimitOrderManager: Trigger condition not met - current price does not satisfy order execution criteria"
        );
        
        // Mark order as executed (prevent reentrancy)
        order.isActive = false;
        
        // Calculate execution parameters with slippage protection
        (uint256 minPrice, uint256 maxPrice) = _calculateSlippageBounds(
            currentPrice, 
            order.maxSlippage, 
            order.isLong
        );
        
        // Execute the trade through router
        positionId = router.openPosition(
            order.metricId,
            order.collateralAmount,
            order.isLong,
            order.leverage,
            order.targetValue,
            order.positionType,
            minPrice,
            maxPrice
        );
        
        // Pay keeper fee
        IERC20(vault.getCollateralToken()).safeTransfer(msg.sender, order.keeperFee);
        
        // Update statistics
        totalOrdersExecuted++;
        
        emit LimitOrderExecuted(
            orderHash, 
            msg.sender, 
            positionId, 
            currentPrice, 
            order.keeperFee
        );
        
        return positionId;
    }
    
    /**
     * @dev Execute multiple orders in batch (gas optimization)
     */
    function executeBatchOrders(bytes32[] calldata orderHashes) external onlyAuthorizedKeeper whenNotPaused {
        // VALIDATION: Batch size must not exceed maximum to prevent gas limit issues
        // FAILS: When orderHashes.length > maxOrdersPerTx (too many orders)
        // SUCCEEDS: When batch size is within limits
        // REASONING: Large batches could exceed block gas limit causing transaction failure.
        // Limiting batch size ensures reliable execution and prevents gas limit errors.
        require(
            orderHashes.length <= maxOrdersPerTx, 
            "LimitOrderManager: Batch too large - exceeds maximum orders per transaction to prevent gas limit issues"
        );
        
        uint256 successCount = 0;
        uint256 totalRewards = 0;
        
        for (uint256 i = 0; i < orderHashes.length; i++) {
            try this.executeLimitOrder(orderHashes[i]) returns (uint256) {
                successCount++;
                totalRewards += limitOrders[orderHashes[i]].keeperFee;
            } catch {
                // Continue with next order if one fails
                // This prevents one failed order from breaking entire batch
                continue;
            }
        }
        
        emit BatchOrdersExecuted(successCount, orderHashes.length, msg.sender, totalRewards);
    }

    // === ORDER MANAGEMENT ===
    
    /**
     * @dev Cancel limit order
     */
    function cancelLimitOrder(bytes32 orderHash, string calldata reason) external whenNotPaused {
        LimitOrder storage order = limitOrders[orderHash];
        
        // VALIDATION: Only order owner can cancel their orders
        // FAILS: When msg.sender != order.user (not the order creator)
        // SUCCEEDS: When order owner is cancelling their own order
        // REASONING: Only the user who created the order should be able to cancel it.
        // Prevents malicious cancellation of other users' orders.
        require(
            order.user == msg.sender, 
            "LimitOrderManager: Not order owner - only order creator can cancel their orders"
        );
        
        // VALIDATION: Order must be active to be cancellable
        // FAILS: When order.isActive = false (already executed, cancelled, or inactive)
        // SUCCEEDS: When order is currently active and cancellable
        // REASONING: Cannot cancel orders that are already executed or previously cancelled.
        // Prevents double cancellation and maintains consistent order state.
        require(
            order.isActive, 
            "LimitOrderManager: Order not active - cannot cancel already executed, cancelled, or inactive orders"
        );
        
        order.isActive = false;
        totalOrdersCancelled++;
        
        emit LimitOrderCancelled(orderHash, msg.sender, reason);
    }
    
    /**
     * @dev Get executable orders for a metric (called by keepers and frontend)
     */
    function getExecutableOrders(bytes32 metricId, uint256 maxOrders) 
        external view returns (bytes32[] memory executableOrders) 
    {
        bytes32[] memory orders = metricOrders[metricId];
        bytes32[] memory temp = new bytes32[](maxOrders);
        uint256 count = 0;
        
        // Only get current price if we have orders to check
        uint256 currentPrice = 0;
        if (orders.length > 0) {
            currentPrice = _getCurrentPrice(metricId);
        }
        
        for (uint256 i = 0; i < orders.length && count < maxOrders; i++) {
            LimitOrder storage order = limitOrders[orders[i]];
            
            if (order.isActive && 
                order.expiry > block.timestamp && 
                _shouldExecuteOrder(order, currentPrice)) {
                temp[count] = orders[i];
                count++;
            }
        }
        
        // Resize array to actual count
        executableOrders = new bytes32[](count);
        for (uint256 i = 0; i < count; i++) {
            executableOrders[i] = temp[i];
        }
    }

    // === INTERNAL FUNCTIONS ===
    
    function _shouldExecuteOrder(LimitOrder storage order, uint256 currentPrice) internal view returns (bool) {
        if (order.orderType == OrderType.LIMIT) {
            // Long: execute when current price <= trigger (buying at or below target)
            // Short: execute when current price >= trigger (selling at or above target)
            return order.isLong ? currentPrice <= order.triggerPrice : currentPrice >= order.triggerPrice;
        } else if (order.orderType == OrderType.MARKET_IF_TOUCHED) {
            // Execute when price touches trigger level (either direction)
            return order.isLong ? currentPrice >= order.triggerPrice : currentPrice <= order.triggerPrice;
        } else if (order.orderType == OrderType.STOP_LOSS) {
            // Stop loss triggers when price moves against position
            return order.isLong ? currentPrice <= order.triggerPrice : currentPrice >= order.triggerPrice;
        } else if (order.orderType == OrderType.TAKE_PROFIT) {
            // Take profit triggers when price moves in favor of position
            return order.isLong ? currentPrice >= order.triggerPrice : currentPrice <= order.triggerPrice;
        }
        return false;
    }
    
    function _getCurrentPrice(bytes32 metricId) internal view returns (uint256) {
        address vammAddress = factory.getVAMMByMetric(metricId);
        require(vammAddress != address(0), "LimitOrderManager: No VAMM for metric");
        return IMetricVAMM(vammAddress).getMetricMarkPrice(metricId);
    }
    
    function _calculateSlippageBounds(uint256 price, uint256 maxSlippage, bool isLong) 
        internal pure returns (uint256 minPrice, uint256 maxPrice) 
    {
        uint256 slippageAmount = (price * maxSlippage) / BASIS_POINTS;
        
        if (isLong) {
            // For long positions, set wider bounds to ensure execution
            minPrice = price > slippageAmount ? price - slippageAmount : 0;
            maxPrice = price + slippageAmount;
        } else {
            // For short positions, set wider bounds to ensure execution
            minPrice = price > slippageAmount ? price - slippageAmount : 0;
            maxPrice = price + slippageAmount;
        }
    }
    
    function _hashOrder(LimitOrder memory order) internal view returns (bytes32) {
        return keccak256(abi.encode(
            ORDER_TYPEHASH,
            order.user,
            order.metricId,
            order.isLong,
            order.collateralAmount,
            order.leverage,
            order.triggerPrice,
            order.targetValue,
            uint8(order.positionType),
            uint8(order.orderType),
            order.expiry,
            order.maxSlippage,
            order.keeperFee,
            order.nonce
        ));
    }
    
    function _recoverSigner(bytes32 orderHash, bytes calldata signature) internal view returns (address) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, orderHash));
        return _recover(digest, signature);
    }
    
    function _recover(bytes32 hash, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) {
            return address(0);
        }
        
        bytes32 r;
        bytes32 s;
        uint8 v;
        
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 0x20))
            v := byte(0, calldataload(add(signature.offset, 0x40)))
        }
        
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            return address(0);
        }
        
        return ecrecover(hash, v, r, s);
    }

    // === KEEPER MANAGEMENT ===
    
    function addKeeper(address keeper) external onlyOwner {
        authorizedKeepers[keeper] = true;
        emit KeeperAuthorized(keeper, true);
    }
    
    function removeKeeper(address keeper) external onlyOwner {
        authorizedKeepers[keeper] = false;
        emit KeeperAuthorized(keeper, false);
    }
    
    function setMaxOrdersPerTx(uint256 _maxOrders) external onlyOwner {
        require(_maxOrders > 0 && _maxOrders <= 50, "LimitOrderManager: Invalid max orders");
        maxOrdersPerTx = _maxOrders;
    }

    // === VIEW FUNCTIONS ===
    
    function getUserOrders(address user) external view returns (bytes32[] memory) {
        return userOrders[user];
    }
    
    function getUserActiveOrders(address user) external view returns (LimitOrder[] memory activeOrders) {
        bytes32[] memory userOrderHashes = userOrders[user];
        uint256 activeCount = 0;
        
        // First pass: count active orders
        for (uint256 i = 0; i < userOrderHashes.length; i++) {
            if (limitOrders[userOrderHashes[i]].isActive) {
                activeCount++;
            }
        }
        
        // Second pass: collect active orders
        activeOrders = new LimitOrder[](activeCount);
        uint256 index = 0;
        for (uint256 i = 0; i < userOrderHashes.length; i++) {
            LimitOrder storage order = limitOrders[userOrderHashes[i]];
            if (order.isActive) {
                activeOrders[index] = order;
                index++;
            }
        }
    }
    
    function getOrderDetails(bytes32 orderHash) external view returns (LimitOrder memory) {
        return limitOrders[orderHash];
    }
    
    function getMetricOrders(bytes32 metricId) external view returns (bytes32[] memory) {
        return metricOrders[metricId];
    }
    
    function getOrderStats() external view returns (
        uint256 created,
        uint256 executed,
        uint256 cancelled,
        uint256 feesCollected
    ) {
        return (totalOrdersCreated, totalOrdersExecuted, totalOrdersCancelled, totalFeesCollected);
    }
    
    function getUserNonce(address user) external view returns (uint256) {
        return nonces[user];
    }

    // === ADMIN FUNCTIONS ===
    
    function pause() external onlyOwner {
        paused = true;
    }
    
    function unpause() external onlyOwner {
        paused = false;
    }
    
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "LimitOrderManager: invalid owner");
        owner = newOwner;
    }
    
    // === EMERGENCY FUNCTIONS ===
    
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        require(paused, "LimitOrderManager: not paused");
        IERC20(token).safeTransfer(owner, amount);
    }
    
    function emergencyCancelOrder(bytes32 orderHash, string calldata reason) external onlyOwner {
        require(paused, "LimitOrderManager: not paused");
        limitOrders[orderHash].isActive = false;
        emit LimitOrderCancelled(orderHash, owner, reason);
    }
}

// Helper interface for ERC20
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
} 