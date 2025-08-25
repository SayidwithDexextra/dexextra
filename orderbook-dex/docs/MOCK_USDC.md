# MockUSDC Documentation

## Overview

MockUSDC is an unlimited minting ERC20 token designed for testing and development purposes. It mimics the behavior of USDC (USD Coin) with 6 decimal places but allows **anyone to mint unlimited amounts** without any restrictions.

⚠️ **WARNING: FOR TESTING ONLY** - This contract has no access controls and should never be used in production environments.

## Features

### Core Functionality
- **ERC20 Compatible**: Standard ERC20 token with transfer, approve, allowance functions
- **6 Decimals**: Matches real USDC decimal precision
- **Unlimited Minting**: Anyone can mint any amount to any address
- **No Access Control**: Zero restrictions on who can mint or how much
- **Batch Operations**: Efficient batch minting for multiple addresses
- **Helper Functions**: Convenience functions for common testing scenarios

### Token Properties
- **Name**: Mock USD Coin
- **Symbol**: USDC
- **Decimals**: 6
- **Initial Supply**: 0 (minted as needed)
- **Max Supply**: Unlimited (type(uint256).max)

## Contract Interface

### Basic Minting Functions

```solidity
// Mint tokens to any address
function mint(address to, uint256 amount) external

// Mint tokens to yourself
function mintToSelf(uint256 amount) external

// Mint 1000 USDC to address
function mintStandard(address to) external

// Mint 1000 USDC to yourself (faucet)
function faucet() external

// Mint 1,000,000 USDC to address
function mintLarge(address to) external

// Mint maximum possible amount (use with caution!)
function mintMax(address to) external
```

### Batch Operations

```solidity
// Mint different amounts to different addresses
function batchMint(address[] recipients, uint256[] amounts) external

// Mint same amount to multiple addresses
function batchMintEqual(address[] recipients, uint256 amount) external

// Airdrop equal amounts to multiple addresses
function airdrop(address[] recipients, uint256 amountPerRecipient) external
```

### Burning Functions

```solidity
// Burn your own tokens
function burn(uint256 amount) external

// Burn tokens from another address (requires allowance)
function burnFrom(address from, uint256 amount) external
```

### Utility Functions

```solidity
// Get formatted balance (e.g., "1000.500000")
function getFormattedBalance(address account) external view returns (string)

// Check if address has sufficient balance
function hasSufficientBalance(address account, uint256 amount) external view returns (bool)

// Convert human amount to raw amount with decimals
function toRawAmount(uint256 humanAmount) external view returns (uint256)

// Convert raw amount to human readable amount
function toHumanAmount(uint256 rawAmount) external view returns (uint256)
```

## Usage Examples

### Basic Minting

```typescript
// Connect to deployed MockUSDC
const MockUSDC = await ethers.getContractFactory("MockUSDC");
const mockUSDC = MockUSDC.attach("0x...");

// Mint 1000 USDC to yourself
await mockUSDC.faucet();

// Mint custom amount to specific address
await mockUSDC.mint("0x742d35Cc...", ethers.parseUnits("5000", 6));

// Mint large amount for testing
await mockUSDC.mintLarge("0x742d35Cc..."); // 1M USDC
```

### Batch Operations

```typescript
// Airdrop to multiple addresses
const recipients = [
  "0x742d35Cc6634C0532925a3b8D",
  "0x8ba1f109551bD432803012645Hac136c",
  "0x1aE0EA34a72D944a8C7603FfB3eC30a6"
];

// Give each address 1000 USDC
await mockUSDC.airdrop(recipients, ethers.parseUnits("1000", 6));

// Different amounts for different addresses
const amounts = [
  ethers.parseUnits("500", 6),   // 500 USDC
  ethers.parseUnits("1000", 6),  // 1000 USDC
  ethers.parseUnits("2000", 6)   // 2000 USDC
];
await mockUSDC.batchMint(recipients, amounts);
```

### Balance Checking

```typescript
// Check balance
const balance = await mockUSDC.balanceOf(userAddress);
console.log("Balance:", ethers.formatUnits(balance, 6), "USDC");

// Check formatted balance
const formatted = await mockUSDC.getFormattedBalance(userAddress);
console.log("Formatted:", formatted); // "1000.500000"

// Check if user has enough for transaction
const hasEnough = await mockUSDC.hasSufficientBalance(
  userAddress, 
  ethers.parseUnits("100", 6)
);
```

## Faucet Script Usage

The project includes a convenient faucet script for easy token distribution:

### Basic Usage

```bash
# Mint 1000 USDC to yourself
npm run faucet

# Mint custom amount
npm run faucet -- --amount 5000

# Mint to specific address
npm run faucet -- --to 0x742d35Cc6634C0532925a3b8D --amount 2000

# Mint to multiple addresses
npm run faucet -- --recipients 0xaddr1,0xaddr2,0xaddr3 --amount 1000
```

### Faucet Script Examples

```bash
# Development testing
npm run faucet                                    # 1000 USDC to deployer
npm run faucet -- --amount 10000                 # 10,000 USDC to deployer

# Multi-user testing
npm run faucet -- --recipients 0x123,0x456,0x789 --amount 5000

# Testnet usage
npm run faucet:testnet -- --amount 1000
```

## Integration with DEX

### As Bond Currency

MockUSDC can be used as bond currency for UMA Oracle operations:

```typescript
// Deploy with MockUSDC as bond currency
const factory = await MetricsMarketFactory.deploy(
  umaOracleManagerAddress,
  orderBookImplementation,
  centralVault,
  orderRouter,
  admin,
  creationFee,
  feeRecipient
);

// Users need USDC for UMA bonds
await mockUSDC.mint(userAddress, ethers.parseUnits("10000", 6)); // 10k USDC for bonds
```

### As Trading Currency

```typescript
// Mint USDC for trading
await mockUSDC.mint(traderAddress, ethers.parseUnits("50000", 6));

// Approve DEX to spend USDC
await mockUSDC.connect(trader).approve(
  centralVaultAddress, 
  ethers.parseUnits("50000", 6)
);

// Deposit into trading vault
await centralVault.connect(trader).deposit(
  mockUSDC.address, 
  ethers.parseUnits("10000", 6)
);
```

## Testing Scenarios

### Unit Testing

```typescript
describe("MockUSDC", () => {
  let mockUSDC: MockUSDC;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  beforeEach(async () => {
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUSDC = await MockUSDC.deploy();
    [user1, user2] = await ethers.getSigners();
  });

  it("should allow unlimited minting", async () => {
    const amount = ethers.parseUnits("1000000", 6); // 1M USDC
    await mockUSDC.mint(user1.address, amount);
    
    const balance = await mockUSDC.balanceOf(user1.address);
    expect(balance).to.equal(amount);
  });

  it("should support batch operations", async () => {
    const recipients = [user1.address, user2.address];
    const amount = ethers.parseUnits("1000", 6);
    
    await mockUSDC.batchMintEqual(recipients, amount);
    
    expect(await mockUSDC.balanceOf(user1.address)).to.equal(amount);
    expect(await mockUSDC.balanceOf(user2.address)).to.equal(amount);
  });
});
```

### Integration Testing

```typescript
describe("DEX Integration", () => {
  it("should work as bond currency", async () => {
    // Mint USDC for bonds
    await mockUSDC.mint(user.address, bondAmount);
    
    // Approve UMA Oracle Manager
    await mockUSDC.connect(user).approve(umaOracleManager.address, bondAmount);
    
    // Request metric data (requires bond)
    await umaOracleManager.connect(user).requestMetricData(
      identifier,
      timestamp,
      ancillaryData,
      reward,
      liveness
    );
  });
});
```

## Security Considerations

### Testing Only

⚠️ **CRITICAL**: MockUSDC is designed for testing and has **NO SECURITY MEASURES**:

- **No Access Control**: Anyone can mint unlimited tokens
- **No Rate Limiting**: No restrictions on mint frequency or amounts
- **No Pause Mechanism**: Cannot be paused or stopped
- **No Upgrade Path**: Contract is not upgradeable
- **No Blacklisting**: Cannot block malicious addresses

### Best Practices

1. **Never Deploy to Mainnet**: Only use on testnets or local development
2. **Clear Documentation**: Always document that tokens are for testing
3. **Separate Environments**: Keep test tokens isolated from production
4. **Regular Cleanup**: Clean up test environments regularly
5. **Monitor Usage**: Track who is using the faucet in shared environments

## Deployment

### Local Development

```typescript
// Deploy MockUSDC
const MockUSDC = await ethers.getContractFactory("MockUSDC");
const mockUSDC = await MockUSDC.deploy();
await mockUSDC.waitForDeployment();

console.log("MockUSDC deployed to:", await mockUSDC.getAddress());

// Mint initial supply
await mockUSDC.mintLarge(deployer.address); // 1M USDC to deployer
```

### Testnet Deployment

The MockUSDC is automatically deployed when running the main deployment script on testnets:

```bash
# Deploy to testnet (includes MockUSDC)
npm run deploy:testnet

# Check deployment
npm run faucet:testnet -- --amount 1000
```

## Gas Usage

Approximate gas costs for common operations:

| Operation | Gas Cost | Notes |
|-----------|----------|-------|
| `mint()` | ~51,000 | Single mint operation |
| `faucet()` | ~51,000 | Mint 1000 USDC to caller |
| `batchMintEqual()` (10 addresses) | ~300,000 | Batch mint to 10 addresses |
| `airdrop()` (100 addresses) | ~2,500,000 | Large airdrop operation |
| `transfer()` | ~21,000 | Standard ERC20 transfer |
| `approve()` | ~46,000 | Standard ERC20 approval |

## Events

MockUSDC emits standard ERC20 events plus custom events for tracking:

```solidity
// Standard ERC20 events
event Transfer(address indexed from, address indexed to, uint256 value);
event Approval(address indexed owner, address indexed spender, uint256 value);

// Custom events for tracking
event FaucetUsed(address indexed user, uint256 amount);
event MassAirdrop(address indexed sender, uint256 recipientCount, uint256 totalAmount);
```

## Troubleshooting

### Common Issues

**Issue**: "MockUSDC address not found"
**Solution**: Deploy contracts first or set MOCK_USDC_ADDRESS environment variable

**Issue**: "Transaction reverted without reason"
**Solution**: Check gas limits and network connection

**Issue**: "Insufficient balance" when using faucet
**Solution**: Ensure deployer has ETH for gas fees

### Debug Commands

```typescript
// Check contract deployment
const code = await ethers.provider.getCode(mockUSDCAddress);
console.log("Contract deployed:", code !== "0x");

// Check total supply
const totalSupply = await mockUSDC.totalSupply();
console.log("Total supply:", ethers.formatUnits(totalSupply, 6));

// Check specific balance
const balance = await mockUSDC.balanceOf(address);
console.log("Balance:", ethers.formatUnits(balance, 6));
```

## API Reference

### View Functions

```solidity
function name() external view returns (string memory)
function symbol() external view returns (string memory)  
function decimals() external view returns (uint8)
function totalSupply() external view returns (uint256)
function balanceOf(address account) external view returns (uint256)
function allowance(address owner, address spender) external view returns (uint256)
function getFormattedBalance(address account) external view returns (string memory)
function hasSufficientBalance(address account, uint256 amount) external view returns (bool)
function toRawAmount(uint256 humanAmount) external view returns (uint256)
function toHumanAmount(uint256 rawAmount) external view returns (uint256)
```

### State Changing Functions

```solidity
function mint(address to, uint256 amount) external
function mintToSelf(uint256 amount) external
function mintStandard(address to) external
function faucet() external
function mintLarge(address to) external
function mintMax(address to) external
function batchMint(address[] recipients, uint256[] amounts) external
function batchMintEqual(address[] recipients, uint256 amount) external
function airdrop(address[] recipients, uint256 amountPerRecipient) external
function burn(uint256 amount) external
function burnFrom(address from, uint256 amount) external
function transfer(address to, uint256 amount) external returns (bool)
function transferFrom(address from, address to, uint256 amount) external returns (bool)
function approve(address spender, uint256 amount) external returns (bool)
```

---

*MockUSDC provides unlimited token minting capabilities for comprehensive testing of the OrderBook DEX system. Use responsibly and only in development/testing environments.*
