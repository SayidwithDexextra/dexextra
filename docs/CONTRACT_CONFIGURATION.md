# Dexetrav5 Contract Configuration System

This document explains how the contract configuration system works in the Dexetrav5 project. The system is designed to provide a single source of truth for all contract addresses, ABIs, and related configuration.

## Overview

The contract configuration system is built around these key components:

1. **Dexetrav5/config/contracts.js** - The single source of truth for all contract addresses and configurations
2. **src/lib/dexetrav5Config.ts** - Bridge between Node.js/Hardhat config and Next.js frontend
3. **src/lib/contractConfig.ts** - Frontend-specific contract configuration
4. **src/lib/contracts.ts** - Contract ABIs and legacy compatibility
5. **src/hooks/useContract.tsx** - React hooks for interacting with contracts

## How It Works

### 1. Contract Deployment

When you deploy new contracts using the `deploy.js` script in Dexetrav5, the script:

1. Deploys the contracts
2. Saves the deployment information to `Dexetrav5/deployments/{network}-deployment.json`
3. Updates `Dexetrav5/config/contracts.js` with the new contract addresses

### 2. Configuration Loading

The frontend loads contract addresses and configurations through this flow:

```
deploy.js → deployment JSON → contracts.js → dexetrav5Config.ts → contractConfig.ts → React hooks
```

This ensures that when you deploy new contracts, the frontend automatically uses the new addresses without manual updates.

### 3. Server vs. Client Loading

- **Server-side**: Direct access to `Dexetrav5/config/contracts.js` via Node.js `require()`
- **Client-side**: Uses pre-loaded configuration from server-side rendering or fallback values

## Key Files Explained

### Dexetrav5/config/contracts.js

This is the central configuration file that:

- Loads addresses from deployment files
- Provides helper functions for accessing contracts
- Defines market information and network configuration
- Exports a consistent API for other parts of the system

```js
// Example usage in Node.js scripts
const { getContract, ADDRESSES } = require('../config/contracts');
const tradingRouter = await getContract('TRADING_ROUTER');
```

### src/lib/dexetrav5Config.ts

This file bridges the gap between the Node.js-based config and the Next.js frontend:

- Loads the CommonJS module when running on the server
- Provides a compatible API for client-side code
- Handles errors and provides fallbacks

```typescript
// Example usage
import { getDexetrav5Config } from './dexetrav5Config';

const config = getDexetrav5Config();
const coreVaultAddress = config.getAddress('CORE_VAULT');
```

### src/lib/contractConfig.ts

Frontend-specific contract configuration:

- Exports contract addresses in a frontend-friendly format
- Provides chain configuration
- Offers helper functions for contract interaction

```typescript
import { CONTRACT_ADDRESSES, CHAIN_CONFIG } from '@/lib/contractConfig';

// Access contract addresses
const coreVaultAddress = CONTRACT_ADDRESSES.coreVault;
```

### src/hooks/useContract.tsx

React hooks for contract interaction:

- Provides typed hooks for each contract
- Handles loading, errors, and wallet connection
- Simplifies contract interactions in React components

```tsx
import { useCoreVault } from '@/hooks/useContract';

function MyComponent() {
  const { contract, isLoading, error } = useCoreVault();
  
  // Use contract methods
  const handleDeposit = async () => {
    await contract.write.depositCollateral([amount]);
  };
}
```

## Adding New Contracts

When adding new contracts:

1. Deploy the contracts using `deploy.js`
2. The script will automatically update `contracts.js`
3. Add any new ABIs to `src/lib/abis/` if needed
4. Update `src/lib/contracts.ts` if you need to expose new ABIs
5. Create specific hooks in `src/hooks/useContract.tsx` if needed

## Best Practices

1. **Always use the hooks**: Use the provided React hooks for contract interactions
2. **Don't hardcode addresses**: Never hardcode contract addresses in components
3. **Handle loading states**: Always check `isLoading` and `error` from hooks
4. **Use the test page**: Visit `/config-test` to verify contract loading

## Troubleshooting

If contracts aren't loading correctly:

1. Check if the deployment file exists in `Dexetrav5/deployments/`
2. Verify that `contracts.js` has the correct addresses
3. Check browser console for any errors in `dexetrav5Config.ts`
4. Ensure ABIs are correctly imported in `contracts.ts`
5. Verify that the contract hooks are properly exported in `hooks/index.ts`
