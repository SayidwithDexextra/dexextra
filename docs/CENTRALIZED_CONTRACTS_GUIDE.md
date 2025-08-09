# 📋 Centralized Smart Contract Configuration Guide

**🎯 Problem Solved:** No more scattered contract addresses and ABIs causing deployment mismatches and failed transactions!

## 🏗️ Overview

The **Centralized Contract Configuration System** provides a single source of truth for all smart contract addresses, ABIs, and configurations across your entire DApp. This eliminates the recurring issues with contract address mismatches that cause transaction reverts.

## 📁 File Structure

```
src/lib/contracts.ts          # 🎯 SINGLE SOURCE OF TRUTH
src/lib/abis.ts              # ⚠️  DEPRECATED (backward compatibility only)
src/lib/networks.ts          # ✅ Updated to use centralized config  
src/lib/contractDeployment.ts # ✅ Updated to use centralized config
```

## 🚀 Quick Start

### Import Everything You Need

```typescript
import { 
  // Contract addresses by network
  getContractAddresses,
  getContractAddress,
  CONTRACT_ADDRESSES,
  
  // ABIs
  VAMM_ABI,
  VAULT_ABI,
  ORACLE_ABI,
  USDC_ABI,
  FACTORY_ABI,
  
  // Event signatures
  EVENT_SIGNATURES,
  
  // Utilities
  getContractInterface,
  isValidAddress,
  getDefaultNetwork
} from '@/lib/contracts';
```

### Get Contract Addresses

```typescript
// Get all addresses for a network
const polygonAddresses = getContractAddresses('polygon');
 console.log(polygonAddresses.SIMPLE_VAMM); // "0xfEAA2a60449E11935C636b9E42866Fd0cBbdF2ed"

// Get a specific contract address
const vammAddress = getContractAddress('polygon', 'SIMPLE_VAMM');
const vaultAddress = getContractAddress('mumbai', 'SIMPLE_VAULT');

// Supported networks: 'polygon', 'mumbai', 'localhost'
```

### Create Contract Instances

```typescript
import { ethers } from 'ethers';

// Create VAMM contract instance
const vammAddress = getContractAddress('polygon', 'SIMPLE_VAMM');
const vammContract = new ethers.Contract(vammAddress, VAMM_ABI, provider);

// Create Vault contract instance  
const vaultAddress = getContractAddress('polygon', 'SIMPLE_VAULT');
const vaultContract = new ethers.Contract(vaultAddress, VAULT_ABI, signer);
```

## 🔄 Migration Guide

### Before: Scattered Addresses

```typescript
// ❌ OLD: Multiple files with different addresses
// src/lib/networks.ts
const CONTRACT_ADDRESSES = {
  polygon: {
    SIMPLE_VAMM: "0x487f1baE58CE513B39889152E96Eb18a346c75b1", // OLD ADDRESS
  }
}

// src/services/scalableEventMonitor.ts  
const factoryAddress = "0x487f1baE58CE513B39889152E96Eb18a346c75b1"; // DIFFERENT ADDRESS

// src/hooks/useVAMMTrading.tsx
import { SIMPLE_VAMM_ABI } from '@/lib/abis';
```

### After: Centralized Configuration

```typescript
// ✅ NEW: Single source of truth
import { 
  getContractAddress, 
  VAMM_ABI 
} from '@/lib/contracts';

const vammAddress = getContractAddress('polygon', 'SIMPLE_VAMM');
const vammContract = new ethers.Contract(vammAddress, VAMM_ABI, provider);
```

### Migration Checklist

- [ ] ✅ Replace scattered contract addresses with `getContractAddress()`
- [ ] ✅ Replace ABI imports with centralized ABIs from `/lib/contracts`
- [ ] ✅ Update event monitoring to use `EVENT_SIGNATURES`
- [ ] ✅ Test all contract interactions work correctly
- [ ] ✅ Remove deprecated address constants

## 📋 Contract Addresses by Network

### Polygon Mainnet (Production)
```typescript
{
  SIMPLE_VAMM: "0xfEAA2a60449E11935C636b9E42866Fd0cBbdF2ed",
  SIMPLE_VAULT: "0x3e2928b4123AF4e42F9373b57fb1DD68Fd056bc9", 
  SIMPLE_ORACLE: "0x7c63Ac8d8489a21cB12c7088b377732CC1208beC",
  SIMPLE_USDC: "0x59d8f917b25f26633d173262A59136Eb326a76c1",
  VAMM_FACTORY: "0x70Cbc2F399A9E8d1fD4905dBA82b9C7653dfFc74"
}
```

### Mumbai Testnet
```typescript
{
  SIMPLE_VAMM: "0x851356ae760d987E095750cCeb3bC6014560891C",
  SIMPLE_VAULT: "0x1613beB3B2C4f22Ee086B2b38C1476A3cE7f78E8",
  SIMPLE_ORACLE: "0xa82fF9aFd8f496c3d6ac40E2a0F282E47488CFc9", 
  SIMPLE_USDC: "0x9E545E3C0baAB3E08CdfD552C960A1050f373042"
}
```

## 🎛️ Available ABIs

```typescript
// Trading contracts
VAMM_ABI          // SimpleVAMM contract
VAULT_ABI         // SimpleVault contract  
ORACLE_ABI        // SimplePriceOracle contract
USDC_ABI          // SimpleUSDC token contract
FACTORY_ABI       // vAMMFactory contract

// Alternative names (same ABIs)
SIMPLE_VAMM_ABI   // === VAMM_ABI
SIMPLE_VAULT_ABI  // === VAULT_ABI  
SIMPLE_ORACLE_ABI // === ORACLE_ABI
SIMPLE_USDC_ABI   // === USDC_ABI
ERC20_ABI         // === USDC_ABI
```

## 🔗 Event Signatures

```typescript
import { EVENT_SIGNATURES } from '@/lib/contracts';

// VAMM Events
EVENT_SIGNATURES.PositionOpened   // '0x5cf8fa4a8e333990018876ad3a82065e68b3859d46c3198b692b77fc3043808b'
EVENT_SIGNATURES.PositionClosed   // '0x398340331999d3ec20eba0ca6ed7fff4090f1906a8f6dfa8d96b3c4708155005'
EVENT_SIGNATURES.PriceUpdated     // '0x31423be1df71d4ecba11d1051d8033416ed316d601c79812e7cd8103e35b88a0'

// Vault Events  
EVENT_SIGNATURES.CollateralDeposited  // '0xd7243f6f8212d5188fd054141cf6ea89cfc0d91facb8c3afe2f88a1358480142'
EVENT_SIGNATURES.CollateralWithdrawn  // '0xc30fcfbcaac9e0deffa719714eaa82396ff506a0d0d0eebe170830177288715d'
```

## 🛠️ Utility Functions

### Address Resolution
```typescript
// Validate Ethereum addresses
const isValid = isValidAddress("0xfEAA2a60449E11935C636b9E42866Fd0cBbdF2ed"); // true

// Get default network based on environment
const network = getDefaultNetwork(); // 'localhost' in dev, 'polygon' in prod
```

### Contract Interfaces
```typescript
// Get ethers Interface for parsing events/calls
const vammInterface = getContractInterface('SIMPLE_VAMM');
const parsedLog = vammInterface.parseLog(log);
```

## 🚀 Deployment Workflow

### 1. Deploy New Contracts
```bash
# Deploy your contracts to the network
npm run deploy:polygon
```

### 2. Update Central Configuration
```typescript
// src/lib/contracts.ts
export const CONTRACT_ADDRESSES = {
  polygon: {
    SIMPLE_VAMM: "0xNEW_VAMM_ADDRESS",     // ✅ Update here
    SIMPLE_VAULT: "0xNEW_VAULT_ADDRESS",   // ✅ Update here  
    SIMPLE_ORACLE: "0xNEW_ORACLE_ADDRESS", // ✅ Update here
    SIMPLE_USDC: "0xNEW_USDC_ADDRESS",     // ✅ Update here
  }
}

// Update deployment record
export const LATEST_DEPLOYMENT: DeploymentConfig = {
  network: 'polygon',
  addresses: CONTRACT_ADDRESSES.polygon,
  deployer: '0xYOUR_DEPLOYER_ADDRESS',
  deploymentDate: new Date().toISOString(),
  marketSymbol: 'YOUR_SYMBOL',
  startingPrice: '100'
};
```

### 3. Automatic Propagation
✅ All files automatically use new addresses  
✅ No manual updates needed across the codebase  
✅ Zero risk of address mismatches  

## 🔧 Common Patterns

### Hook Usage
```typescript
// In useVAMMTrading.tsx
import { VAMM_ABI, getContractAddress } from '@/lib/contracts';

export function useVAMMTrading(network: string = 'polygon') {
  const vammAddress = getContractAddress(network, 'SIMPLE_VAMM');
  const vammContract = useMemo(() => 
    new ethers.Contract(vammAddress, VAMM_ABI, provider), 
    [vammAddress, provider]
  );
}
```

### Service Usage
```typescript
// In services/eventMonitor.ts
import { EVENT_SIGNATURES, getContractAddress } from '@/lib/contracts';

export class EventMonitor {
  constructor(network: string = 'polygon') {
    this.factoryAddress = getContractAddress(network, 'VAMM_FACTORY');
    this.monitoredEvents = Object.values(EVENT_SIGNATURES);
  }
}
```

### API Route Usage
```typescript
// In api/webhooks/alchemy/route.ts
import { FACTORY_ABI, VAMM_ABI, getContractAddress } from '@/lib/contracts';

const factoryAddress = getContractAddress('polygon', 'VAMM_FACTORY');
const factoryContract = new ethers.Contract(factoryAddress, FACTORY_ABI, provider);
```

## ⚠️ Migration Notes

### Backward Compatibility
- The old `src/lib/abis.ts` file still works but shows deprecation warnings
- Gradually migrate imports to use the new centralized system
- Old network configuration automatically uses centralized addresses

### Network Detection
```typescript
// Environment-based network selection
const network = process.env.NODE_ENV === 'development' ? 'localhost' : 'polygon';
const addresses = getContractAddresses(network);
```

## 🎯 Benefits

### ✅ Problem Solved
- **No more address mismatches** causing transaction reverts
- **Single deployment update** propagates everywhere automatically  
- **Consistent ABIs** across all components
- **Type safety** with TypeScript interfaces
- **Easy testing** with network-specific configurations

### 🚀 Developer Experience
- **Autocomplete** for contract names and networks
- **Validation** of addresses and contract types  
- **Documentation** embedded in the configuration
- **Migration path** from legacy scattered approach

## 🔮 Future Enhancements

- [ ] **Multi-chain support** for Ethereum, Arbitrum, etc.
- [ ] **Automatic deployment detection** from transaction receipts
- [ ] **Contract verification status** tracking
- [ ] **ABI versioning** for contract upgrades
- [ ] **Environment-specific** configurations (dev/staging/prod)

---

**🎉 Your DApp now has bulletproof contract configuration!**  
No more debugging transaction reverts caused by address mismatches. 