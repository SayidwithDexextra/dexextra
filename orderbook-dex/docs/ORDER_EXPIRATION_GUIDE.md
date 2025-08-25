# Order Expiration System Guide

## Overview

The OrderBook DEX now includes a comprehensive order expiration system that automatically handles time-based order lifecycle management. This guide covers how to use the expiration features effectively.

## Features Added

### ✅ **Automatic Expiration Detection**
- Orders with `timeInForce: GTD` (Good Till Date) can have expiration times
- System validates expiry times when orders are placed
- Orders are rejected if already expired at placement time

### ✅ **Expiration Management Functions**
- `checkOrderExpiry(orderId)` - Check and expire individual orders
- `batchExpireOrders(orderIds[])` - Efficiently expire multiple orders
- `cleanupUserExpiredOrders(trader)` - Cleanup all expired orders for a user
- `getOrdersEligibleForExpiration(trader, limit)` - Find orders ready for expiration

### ✅ **Query Functions**
- `getUserExpiredOrders(trader)` - Get all expired orders for a user
- `isOrderExpired(orderId)` - Check if an order is expired (view only)
- `getOrdersEligibleForExpiration(trader, limit)` - Find orders needing expiration

### ✅ **Events for Monitoring**
- `OrderExpired(orderId, trader, metricId)` - Single order expired
- `BatchOrdersExpired(orderIds[], caller)` - Multiple orders expired in batch

### ✅ **Automation Scripts**
- `cleanup-expired-orders.ts` - Automated cleanup script
- Monitoring and batch processing capabilities

## Usage Examples

### 1. Placing Orders with Expiration

```typescript
import { ethers } from "ethers";

// Place an order that expires in 24 hours
const currentTime = Math.floor(Date.now() / 1000);
const expiryTime = currentTime + 86400; // 24 hours from now

const expiringOrder = {
    orderId: 0,
    trader: userAddress,
    metricId: "WORLD_POPULATION_2024",
    orderType: 1, // LIMIT
    side: 0, // BUY
    quantity: ethers.parseEther("10"),
    price: ethers.parseEther("8100000000"),
    filledQuantity: 0,
    timestamp: 0,
    expiryTime: expiryTime,
    status: 0, // PENDING
    timeInForce: 3, // GTD (Good Till Date)
    stopPrice: 0,
    icebergQty: 0,
    postOnly: false,
    metadataHash: ethers.ZeroHash
};

// Place the order
const router = await ethers.getContractAt("OrderRouter", routerAddress);
const tx = await router.connect(user).placeOrder(expiringOrder);
await tx.wait();

console.log("Order placed with 24-hour expiration");
```

### 2. Checking for Expired Orders

```typescript
// Check if specific order is expired
const orderId = 123;
const isExpired = await router.isOrderExpired(orderId);

if (isExpired) {
    console.log(`Order ${orderId} has expired`);
    
    // Expire the order
    await router.checkOrderExpiry(orderId);
}

// Get all orders eligible for expiration
const eligibleOrders = await router.getOrdersEligibleForExpiration(
    userAddress, // specific user (or ethers.ZeroAddress for all users)
    50 // limit
);

console.log(`Found ${eligibleOrders.length} orders ready for expiration`);
```

### 3. Batch Expiration

```typescript
// Get orders that need expiration
const eligibleOrders = await router.getOrdersEligibleForExpiration(
    ethers.ZeroAddress, // all users
    100 // limit
);

if (eligibleOrders.length > 0) {
    // Extract order IDs
    const orderIds = eligibleOrders.map(order => order.orderId);
    
    // Batch expire (max 100 at a time)
    const batchSize = 50;
    for (let i = 0; i < orderIds.length; i += batchSize) {
        const batch = orderIds.slice(i, i + batchSize);
        
        const tx = await router.batchExpireOrders(batch);
        const receipt = await tx.wait();
        
        console.log(`Expired batch of ${batch.length} orders in tx: ${receipt.transactionHash}`);
    }
}
```

### 4. User-Specific Cleanup

```typescript
// Cleanup all expired orders for a specific user
const cleanupTx = await router.cleanupUserExpiredOrders(userAddress);
const receipt = await cleanupTx.wait();

// Parse events to see how many were cleaned up
const batchExpiredEvents = receipt.logs.filter(
    log => log.topics[0] === router.interface.getEvent("BatchOrdersExpired").topicHash
);

if (batchExpiredEvents.length > 0) {
    const decodedEvent = router.interface.parseLog(batchExpiredEvents[0]);
    const expiredCount = decodedEvent.args.orderIds.length;
    console.log(`Cleaned up ${expiredCount} expired orders for ${userAddress}`);
}
```

### 5. Monitoring and Automation

```typescript
// Monitoring function that can be called periodically
async function monitorAndCleanup() {
    const router = await ethers.getContractAt("OrderRouter", routerAddress);
    
    // Check for expired orders
    const eligibleOrders = await router.getOrdersEligibleForExpiration(
        ethers.ZeroAddress, // all users
        100
    );
    
    if (eligibleOrders.length === 0) {
        console.log("✅ No expired orders found");
        return;
    }
    
    console.log(`⚠️  Found ${eligibleOrders.length} expired orders`);
    
    // Group by user for better gas efficiency
    const ordersByUser = new Map();
    for (const order of eligibleOrders) {
        if (!ordersByUser.has(order.trader)) {
            ordersByUser.set(order.trader, []);
        }
        ordersByUser.get(order.trader).push(order.orderId);
    }
    
    // Clean up each user's expired orders
    for (const [userAddress, orderIds] of ordersByUser.entries()) {
        try {
            const tx = await router.cleanupUserExpiredOrders(userAddress);
            await tx.wait();
            console.log(`✅ Cleaned up ${orderIds.length} orders for ${userAddress}`);
        } catch (error) {
            console.error(`❌ Failed to cleanup orders for ${userAddress}:`, error);
        }
    }
}

// Run every 30 minutes
setInterval(monitorAndCleanup, 30 * 60 * 1000);
```

## Time in Force Options

The system supports different time-in-force options:

```typescript
enum TimeInForce {
    GTC = 0,  // Good Till Cancelled - no expiration
    IOC = 1,  // Immediate or Cancel - expires if not filled immediately  
    FOK = 2,  // Fill or Kill - expires if not completely filled
    GTD = 3   // Good Till Date - expires at specified time
}
```

### Examples for Each Type:

```typescript
// Good Till Cancelled (default - no expiration)
const gtcOrder = {
    // ... other fields
    timeInForce: 0, // GTC
    expiryTime: 0   // No expiry needed
};

// Good Till Date (expires at specific time)
const gtdOrder = {
    // ... other fields
    timeInForce: 3, // GTD
    expiryTime: Math.floor(Date.now() / 1000) + 86400 // 24 hours
};

// Immediate or Cancel and Fill or Kill are handled by the OrderBook
// during order matching and don't require cleanup
```

## Automation Script Usage

### Run the Cleanup Script

```bash
# Run the automated cleanup script
npx hardhat run scripts/cleanup-expired-orders.ts --network localhost

# Example output:
# 🧹 Starting Order Expiration Cleanup...
# 📋 OrderRouter address: 0x1234...
# 🔍 Scanning for orders eligible for expiration...
# Found 15 orders eligible for expiration
# 
# 📊 Expired Orders Summary:
# ────────────────────────────────────────
# Order ID: 123
#   Trader: 0xabc...
#   Metric: WORLD_POPULATION_2024
#   Side: BUY
#   Quantity: 10.0
#   Price: 8100000000.0
#   Expiry: 2024-01-15T10:30:00.000Z
#
# 🔄 Starting batch expiration process...
# 📦 Processing batch 1 with 15 orders...
# ✅ Transaction confirmed in block 12345
# 🎯 Expired 15 orders in this batch
# 
# 🎉 Cleanup completed! Total orders expired: 15
```

### Integration with Keeper Networks

The expiration system is designed to work with keeper networks like Chainlink Keepers:

```typescript
// Keeper-compatible check function
contract OrderExpirationKeeper {
    IOrderRouter public immutable orderRouter;
    uint256 public constant MAX_BATCH_SIZE = 50;
    
    constructor(address _orderRouter) {
        orderRouter = IOrderRouter(_orderRouter);
    }
    
    function checkUpkeep(bytes calldata) 
        external 
        view 
        returns (bool upkeepNeeded, bytes memory performData) 
    {
        // Check if there are orders eligible for expiration
        IOrderRouter.Order[] memory eligibleOrders = orderRouter.getOrdersEligibleForExpiration(
            address(0), // all users
            MAX_BATCH_SIZE
        );
        
        upkeepNeeded = eligibleOrders.length > 0;
        
        if (upkeepNeeded) {
            uint256[] memory orderIds = new uint256[](eligibleOrders.length);
            for (uint256 i = 0; i < eligibleOrders.length; i++) {
                orderIds[i] = eligibleOrders[i].orderId;
            }
            performData = abi.encode(orderIds);
        }
    }
    
    function performUpkeep(bytes calldata performData) external {
        uint256[] memory orderIds = abi.decode(performData, (uint256[]));
        orderRouter.batchExpireOrders(orderIds);
    }
}
```

## Gas Optimization Tips

### 1. Batch Operations
- Always use `batchExpireOrders()` for multiple orders
- Optimal batch size is 20-50 orders depending on network conditions

### 2. User-Specific Cleanup
- Use `cleanupUserExpiredOrders()` for single-user cleanup
- More gas-efficient than manual batching for one user

### 3. Monitoring Frequency
- Check for expired orders every 15-30 minutes
- Avoid checking too frequently to save gas

### 4. Smart Batching
```typescript
// Group orders by user for better efficiency
const ordersByUser = new Map();
for (const order of expiredOrders) {
    if (!ordersByUser.has(order.trader)) {
        ordersByUser.set(order.trader, []);
    }
    ordersByUser.get(order.trader).push(order.orderId);
}

// Use user-specific cleanup for better gas efficiency
for (const [user, orderIds] of ordersByUser.entries()) {
    if (orderIds.length <= 10) {
        await router.cleanupUserExpiredOrders(user);
    } else {
        // For many orders, use batch operations
        await router.batchExpireOrders(orderIds);
    }
}
```

## Error Handling

### Common Errors and Solutions

```typescript
try {
    await router.batchExpireOrders(orderIds);
} catch (error) {
    if (error.message.includes("Order not found")) {
        console.log("Some orders were already processed");
        // Filter out processed orders and retry
    } else if (error.message.includes("Too many orders in batch")) {
        console.log("Batch too large, splitting...");
        // Split into smaller batches
    } else if (error.message.includes("No orders provided")) {
        console.log("Empty batch provided");
        // Skip empty batches
    } else {
        console.error("Unexpected error:", error);
        throw error;
    }
}
```

## Best Practices

### 1. **Frontend Integration**
- Show expiry time in order displays
- Warn users about orders nearing expiration
- Provide "extend expiry" functionality where appropriate

### 2. **Backend Monitoring**
- Set up automated monitoring for expired orders
- Use events to track expiration activity
- Implement alerting for high expiration volumes

### 3. **User Experience**
- Default to reasonable expiry times (24-48 hours)
- Allow users to set custom expiry times
- Provide clear feedback about order expiration

### 4. **Gas Management**
- Monitor gas prices and adjust cleanup frequency
- Use keeper networks for automated cleanup
- Batch operations efficiently

## Events and Monitoring

### Listen for Expiration Events

```typescript
// Listen for individual order expirations
router.on("OrderExpired", (orderId, trader, metricId, event) => {
    console.log(`Order ${orderId} expired for trader ${trader} in market ${metricId}`);
});

// Listen for batch expirations
router.on("BatchOrdersExpired", (orderIds, caller, event) => {
    console.log(`Batch of ${orderIds.length} orders expired by ${caller}`);
});
```

### Dashboard Metrics

Track these metrics for monitoring:
- Total expired orders per day
- Average time between placement and expiration
- Gas costs for cleanup operations
- User adoption of different time-in-force options

## Testing

Run the comprehensive test suite:

```bash
npx hardhat test tests/OrderExpiration.test.ts

# Expected output:
# ✓ Should reject orders that are already expired
# ✓ Should accept orders with future expiry times  
# ✓ Should detect orders eligible for expiration
# ✓ Should expire individual orders
# ✓ Should batch expire multiple orders
# ✓ Should cleanup user expired orders
# ✓ Should handle non-existent order IDs gracefully
# ✓ Should not expire orders that are not GTD type
# ✓ Should handle empty batch operations
# ✓ Should limit batch size
```

## Summary

The order expiration system provides:

- ✅ **Automatic expiration detection and processing**
- ✅ **Gas-efficient batch operations**
- ✅ **Comprehensive monitoring and query functions**
- ✅ **Integration-ready automation scripts**
- ✅ **Keeper network compatibility**
- ✅ **Robust error handling and edge case management**

This system ensures clean order books, prevents expired orders from consuming unnecessary resources, and provides a professional trading experience similar to traditional financial markets.
