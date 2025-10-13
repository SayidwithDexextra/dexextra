# OrderBook Authorization Scripts

These scripts fix the `AccessControlUnauthorizedAccount` error by granting the necessary permissions for the OrderBook contract to interact with VaultRouter.

## 🚨 Problem Being Solved

The OrderBook contract needs two permissions to function:
1. **ORDERBOOK_ROLE** - to call margin functions on VaultRouter
2. **Market Authorization** - to authorize the specific market ID

Without these, all trading operations fail with `AccessControlUnauthorizedAccount` errors.

## 📋 Requirements

- Admin access to VaultRouter contract
- MATIC tokens for gas fees
- Private key of the VaultRouter admin

## 🔧 Option 1: Hardhat/TypeScript Script

### Prerequisites
```bash
npm install hardhat ethers
```

### Setup
1. Ensure your Hardhat network config includes Polygon
2. Make sure you have the admin private key configured

### Execute
```bash
npx hardhat run scripts/authorize-orderbook.ts --network polygon
```

## 🔧 Option 2: Standalone JavaScript Script

### Prerequisites
```bash
npm install ethers dotenv
```

### Setup
1. Create/update `.env` file:
```env
ADMIN_PRIVATE_KEY=your_admin_private_key_here
POLYGON_RPC_URL=https://polygon-rpc.com/
```

### Execute
```bash
node scripts/authorize-orderbook.js
```

## 🔧 Option 3: Manual via Polygonscan

Visit: https://polygonscan.com/address/0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7#writeContract

### Transaction 1: Grant Role
- **Function**: `grantRole`
- **role**: `0xe7d7e4bf430fa940e5a18beda68ad1833bb0bb84161df1150cd5a705786bf6e7`
- **account**: `0xaA5662ab1bF7BA1055B8C63281b764aF65553fec`

### Transaction 2: Authorize Market
- **Function**: `setMarketAuthorization`
- **marketId**: `0x88f2de2739bd614453f56cfec79f0456ef2829a0a56b36a410723613bcf2415b`
- **authorized**: `true`

## ✅ Verification

After running the script, you should see:
- ✅ OrderBook has ORDERBOOK_ROLE: YES
- ✅ Market is authorized: YES
- 🎉 SUCCESS! OrderBook authorization complete!

## 🚀 Result

Once authorized, users will be able to:
- Place limit orders successfully
- Place market orders successfully
- Orders will properly reserve margin in VaultRouter
- No more `AccessControlUnauthorizedAccount` errors

## 🔍 Contract Details

- **VaultRouter**: `0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7`
- **OrderBook (Aluminum V2)**: `0xaA5662ab1bF7BA1055B8C63281b764aF65553fec`
- **ORDERBOOK_ROLE**: `0xe7d7e4bf430fa940e5a18beda68ad1833bb0bb84161df1150cd5a705786bf6e7`
- **Market ID**: `0x88f2de2739bd614453f56cfec79f0456ef2829a0a56b36a410723613bcf2415b`

## 🛡️ Security Notes

- Only the VaultRouter admin can execute these functions
- These are one-time setup operations
- The private key must have admin privileges on VaultRouter
- Ensure sufficient MATIC balance for gas fees
