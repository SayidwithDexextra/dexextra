# USDC Faucet Component

A React component that provides a user-friendly interface for claiming test USDC tokens on the Polygon network. Built for the Dexetra platform to enable users to get test tokens for trading.

## Features

- 🔗 **Wallet Integration**: Seamless connection with MetaMask and other web3 wallets
- 🌐 **Polygon Network**: Optimized for fast, low-cost transactions
- ⏰ **Cooldown System**: 24-hour cooldown between claims to prevent abuse
- 💰 **Balance Display**: Real-time USDC balance checking
- 🔄 **Auto-refresh**: Automatic balance updates after successful claims
- 🎨 **Modern UI**: Consistent with Dexetra design system
- 📱 **Responsive**: Mobile-friendly interface

## Usage

```tsx
import { Faucet } from '@/components/Faucet'

function RewardsPage() {
  return (
    <div>
      <Faucet />
    </div>
  )
}
```

## Configuration

The faucet is configured with the following constants:

- **MOCK_USDC_ADDRESS**: `0xbD9E0b8e723434dCd41700e82cC4C8C539F66377` (Polygon mainnet)
- **CLAIM_AMOUNT**: 1,000 USDC per claim
- **COOLDOWN_PERIOD**: 24 hours (86,400,000 ms)
- **POLYGON_CHAIN_ID**: 137

## How It Works

1. **Wallet Connection**: Users connect their web3 wallet (MetaMask recommended)
2. **Network Check**: Automatically detects if user is on Polygon network
3. **Balance Display**: Shows current USDC balance from the mock contract
4. **Claim Process**: Users can claim 1,000 USDC tokens every 24 hours
5. **Cooldown Management**: Tracks last claim time using localStorage
6. **Transaction Handling**: Executes mint transaction on the MockUSDC contract

## Smart Contract Integration

The component interacts with a MockUSDC contract deployed on Polygon that includes:

- `balanceOf(address)`: Check user's USDC balance
- `mint(address, uint256)`: Mint new tokens to user's address  
- `decimals()`: Get token decimals (6 for USDC)

## Error Handling

The component handles various error scenarios:

- **No Wallet**: Prompts user to install MetaMask
- **Wrong Network**: Shows warning and provides switch button
- **Transaction Failures**: Displays user-friendly error messages
- **RPC Issues**: Graceful fallback with error messaging
- **Contract Errors**: Specific error messages for contract interactions

## States

The component manages several states:

- `isLoading`: Loading user data
- `isClaiming`: Currently processing a claim
- `lastClaimTime`: Timestamp of last successful claim
- `cooldownRemaining`: Time remaining until next claim
- `usdcBalance`: Current USDC balance
- `isPolygonNetwork`: Whether user is on correct network

## Styling

Uses CSS modules with the following design patterns:

- Dark gradient backgrounds
- Blue accent colors (`#00d4ff`, `#0066ff`)
- Smooth hover animations
- Loading spinners for better UX
- Responsive grid layouts

## Security Features

- **Rate Limiting**: 24-hour cooldown prevents spam
- **Network Validation**: Only works on Polygon mainnet
- **Local Storage**: Cooldown tracking per wallet address
- **Error Boundaries**: Safe error handling

## Troubleshooting

### Common Issues

1. **"Wrong Network" Warning**
   - Solution: Click "Switch Network" button or manually switch to Polygon in wallet

2. **"Failed to load balance"**
   - Check internet connection
   - Ensure wallet is connected
   - Try refreshing the page

3. **"Transaction Failed"**
   - Ensure you have enough MATIC for gas fees
   - Check if you're still within cooldown period
   - Verify contract address is correct

4. **Cooldown Not Working**
   - Clear browser localStorage for the site
   - Ensure consistent wallet address

### Network Configuration

If Polygon network is not in your wallet:

```javascript
Network Name: Polygon Mainnet
RPC URL: https://polygon-rpc.com/
Chain ID: 137
Currency Symbol: MATIC
Block Explorer: https://polygonscan.com/
```

## Development

### Testing Locally

1. Ensure MockUSDC contract is deployed on Polygon
2. Update `MOCK_USDC_ADDRESS` if needed
3. Test with different wallet states
4. Verify cooldown functionality

### Deployment Considerations

- Verify contract address is correct for target network
- Test faucet functionality with small amounts first
- Monitor for abuse patterns
- Consider implementing additional rate limiting

## Future Enhancements

- [ ] Multi-token support (add other test tokens)
- [ ] Transaction history display
- [ ] Enhanced anti-abuse mechanisms
- [ ] Integration with backend tracking
- [ ] Referral system for bonus claims
- [ ] Progressive claim amounts based on usage 