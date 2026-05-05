# Quick Start: Secure Spoke V3 Deployment

## Prerequisites

1. **Install Foundry** (if not installed):
   ```bash
   curl -L https://foundry.paradigm.xyz | bash
   foundryup
   ```

2. **Install OpenZeppelin** (if not installed):
   ```bash
   npm install @openzeppelin/contracts@^5.0.0
   ```

---

## Step 1: Compile Contracts

```bash
cd contracts/secure-spoke
forge build
```

Expected output in `out/` directory:
- `SecureSpokeVaultV3.sol/SecureSpokeVaultV3.json`
- `SpokeInboxAdapter.sol/SpokeInboxAdapter.json`
- `AnomalyDetector.sol/AnomalyDetector.json`
- `WithdrawalVerifier.sol/WithdrawalVerifier.json`

---

## Step 2: Set Environment Variables

Create or update `.env.local`:

```bash
# Admin (must NOT be compromised)
NEW_ADMIN_PRIVATE_KEY=0x...
NEW_ADMIN_ADDRESS=0x0B8e7f065Df28F0679FA6eD2E3444726F66DE599

# RPC URLs
ARBITRUM_RPC_URL=https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY
RPC_URL=https://rpc.hyperliquid.xyz/evm

# Existing Hub contracts (unchanged)
HUB_OUTBOX_ADDRESS=0x4c32ff22b927a134a3286d5E33212debF951AcF5
HUB_INBOX_ADDRESS=0xB373b0538079f3cB61971F26abB11a89817BF072
```

---

## Step 3: Deploy (Dry Run First)

```bash
# From project root
npx tsx scripts/deploy-secure-spoke-v3.ts --dry-run
```

Review the output, then deploy for real:

```bash
npx tsx scripts/deploy-secure-spoke-v3.ts
```

---

## Step 4: Update Environment

Copy the output addresses to `.env.local`:

```bash
SPOKE_ARBITRUM_VAULT_ADDRESS=0x...   # SecureSpokeVaultV3
SPOKE_INBOX_ADDRESS_ARBITRUM=0x...   # SpokeInboxAdapter  
SPOKE_OUTBOX_ADDRESS_ARBITRUM=0x...  # SpokeBridgeOutboxWormhole
```

---

## Step 5: Push to Vercel

```bash
# Pull current env
vercel env pull .env.vercel.temp

# Edit with new addresses
# Then push
vercel env push

# Redeploy
vercel --prod
```

---

## Step 6: Fund the Vault

Send USDC to the new vault address:
- Native USDC: `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`
- To: `SPOKE_ARBITRUM_VAULT_ADDRESS`

Recommended initial funding: 10,000 - 50,000 USDC

---

## Step 7: Start Monitoring

```bash
# Run guardian monitor
npx tsx scripts/guardian-monitor.ts --auto-pause
```

Keep this running in a terminal or deploy as a service.

---

## Verification Checklist

- [ ] Contracts compiled successfully
- [ ] Deployed all 4-5 contracts
- [ ] Bridge inbox locked on vault
- [ ] Domain 999 locked on adapter
- [ ] Relayer has BRIDGE_ENDPOINT_ROLE on adapter
- [ ] Relayer has DEPOSIT_SENDER_ROLE on outbox
- [ ] Hub contracts updated to trust new spoke contracts
- [ ] Vault funded with USDC
- [ ] Guardian monitor running
- [ ] Test withdrawal works

---

## Troubleshooting

### "Missing compiled artifacts"
```bash
cd contracts/secure-spoke
forge build
```

### "Insufficient gas"
Fund the deployer address with more ETH on Arbitrum.

### "Not authorized" errors
Check that the correct admin key is being used.

### Withdrawals failing
1. Check relayer has correct roles
2. Check Hub trusts the new spoke contracts
3. Check vault has sufficient USDC balance

---

## Emergency Commands

### Pause the vault
```bash
npx tsx -e "
const { ethers } = require('ethers');
const pk = process.env.NEW_ADMIN_PRIVATE_KEY;
const rpc = process.env.ARBITRUM_RPC_URL;
const vault = process.env.SPOKE_ARBITRUM_VAULT_ADDRESS;
const provider = new ethers.JsonRpcProvider(rpc);
const signer = new ethers.Wallet(pk, provider);
const contract = new ethers.Contract(vault, ['function emergencyPause(string) external'], signer);
await contract.emergencyPause('Manual pause');
console.log('Paused');
"
```

### Check vault status
```bash
npx tsx -e "
const { ethers } = require('ethers');
const rpc = process.env.ARBITRUM_RPC_URL;
const vault = process.env.SPOKE_ARBITRUM_VAULT_ADDRESS;
const provider = new ethers.JsonRpcProvider(rpc);
const contract = new ethers.Contract(vault, ['function paused() view returns (bool)'], provider);
console.log('Paused:', await contract.paused());
"
```
