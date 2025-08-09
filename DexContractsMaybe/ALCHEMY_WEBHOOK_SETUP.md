# Alchemy Webhook Setup for SimpleVAMM System

## Contract Addresses

### Polygon Mainnet (Chain ID: 137)
- **SimpleVAMM**: `0x487f1baE58CE513B39889152E96Eb18a346c75b1`
- **SimpleVault**: `0x2C8d16222d4A1065285f28FA7fB7C6cF5cf7094e`
- **SimplePriceOracle**: `0x9f7Aa3d247a338cb612B2F8B5042068d3aeAe711`
- **SimpleUSDC**: `0xbD9E0b8e723434dCd41700e82cC4C8C539F66377`

## SimpleVAMM Events

### 🔧 Key Trading Events (Priority 1 - Most Important)

**PositionOpened** - Fired when a user opens a new position
- **Event Hash**: `0x5cf8fa4a8e333990018876ad3a82065e68b3859d46c3198b692b77fc3043808b`
- **Signature**: `PositionOpened(address,uint256,bool,uint256,uint256,uint256)`
- **Parameters**: user (indexed), positionId (indexed), isLong, size, price, leverage

**PositionClosed** - Fired when a user closes a position
- **Event Hash**: `0x398340331999d3ec20eba0ca6ed7fff4090f1906a8f6dfa8d96b3c4708155005`
- **Signature**: `PositionClosed(address,uint256,uint256,uint256,int256)`
- **Parameters**: user (indexed), positionId (indexed), size, price, pnl

**PriceUpdated** - Fired when market price changes
- **Event Hash**: `0x31423be1df71d4ecba11d1051d8033416ed316d601c79812e7cd8103e35b88a0`
- **Signature**: `PriceUpdated(uint256,int256)`
- **Parameters**: newPrice, netPosition

### 🔒 Admin Events (Priority 2 - Lower Priority)

**AuthorizedAdded** - Fired when new authorized address is added
- **Event Hash**: `0xdd10d14f6ac19e913d4edbb11fd30661531e2ccd0d23f571e9b224f001f0dd06`
- **Signature**: `AuthorizedAdded(address)`
- **Parameters**: account (indexed)

**AuthorizedRemoved** - Fired when authorized address is removed
- **Event Hash**: `0x0fafd0343e6c6f6985727574866da48938c918559eb9521cf9cc0d317ea0f7b4`
- **Signature**: `AuthorizedRemoved(address)`
- **Parameters**: account (indexed)

## SimpleVault Events

### 💰 Key Vault Events (Priority 1 - Financial Monitoring)

**CollateralDeposited** - Fired when user deposits collateral
- **Event Hash**: `0xd7243f6f8212d5188fd054141cf6ea89cfc0d91facb8c3afe2f88a1358480142`
- **Signature**: `CollateralDeposited(address,uint256)`
- **Parameters**: user (indexed), amount

**CollateralWithdrawn** - Fired when user withdraws collateral
- **Event Hash**: `0xc30fcfbcaac9e0deffa719714eaa82396ff506a0d0d0eebe170830177288715d`
- **Signature**: `CollateralWithdrawn(address,uint256)`
- **Parameters**: user (indexed), amount

**MarginReserved** - Fired when margin is reserved for a position
- **Event Hash**: `0x7a9b1b90f35f094ffc6d04d86069c79e82c6a16eb600f79672428a409635deca`
- **Signature**: `MarginReserved(address,uint256)`
- **Parameters**: user (indexed), amount

**MarginReleased** - Fired when margin is released from a position
- **Event Hash**: `0x5e63d54af10545f0b2bd229512f244caefe863ad94dbbb7ad827432c84d762f5`
- **Signature**: `MarginReleased(address,uint256)`
- **Parameters**: user (indexed), amount

**PnLUpdated** - Fired when user's profit/loss is updated
- **Event Hash**: `0x22d38deb33ee15dd233167fc440609397a226eb4e1b61e1773bdd09ef99424aa`
- **Signature**: `PnLUpdated(address,int256)`
- **Parameters**: user (indexed), pnlDelta

## Webhook Configuration Examples

### 1. Monitor All Trading Activity (Recommended)

```json
{
  "name": "SimpleVAMM Trading Monitor",
  "description": "Monitor all position opening/closing and price updates",
  "webhook_url": "https://your-webhook-endpoint.com/alchemy",
  "webhook_type": "ADDRESS_ACTIVITY",
  "addresses": ["0x487f1baE58CE513B39889152E96Eb18a346c75b1"],
  "network": "MATIC_MAINNET",
  "app_id": "your-app-id"
}
```

### 2. Monitor Specific Events Only

```json
{
  "name": "Position Events Only",
  "description": "Monitor position opening and closing only",
  "webhook_url": "https://your-webhook-endpoint.com/alchemy/positions",
  "webhook_type": "ADDRESS_ACTIVITY", 
  "addresses": ["0x487f1baE58CE513B39889152E96Eb18a346c75b1"],
  "network": "MATIC_MAINNET",
  "filters": {
    "topics": [
      [
        "0x5cf8fa4a8e333990018876ad3a82065e68b3859d46c3198b692b77fc3043808b",
        "0x398340331999d3ec20eba0ca6ed7fff4090f1906a8f6dfa8d96b3c4708155005"
      ]
    ]
  },
  "app_id": "your-app-id"
}
```

### 3. Monitor Price Updates Only

```json
{
  "name": "Price Updates Monitor",
  "description": "Monitor price changes in the VAMM",
  "webhook_url": "https://your-webhook-endpoint.com/alchemy/price",
  "webhook_type": "ADDRESS_ACTIVITY",
  "addresses": ["0x487f1baE58CE513B39889152E96Eb18a346c75b1"],
  "network": "MATIC_MAINNET",
  "filters": {
    "topics": [
      ["0x31423be1df71d4ecba11d1051d8033416ed316d601c79812e7cd8103e35b88a0"]
    ]
  },
  "app_id": "your-app-id"
}
```

### 4. Monitor Complete System (VAMM + Vault) [RECOMMENDED]

```json
{
  "name": "Complete SimpleVAMM System Monitor",
  "description": "Monitor all trading and vault activities",
  "webhook_url": "https://your-webhook-endpoint.com/alchemy/complete",
  "webhook_type": "ADDRESS_ACTIVITY",
  "addresses": [
    "0x487f1baE58CE513B39889152E96Eb18a346c75b1",
    "0x2C8d16222d4A1065285f28FA7fB7C6cF5cf7094e"
  ],
  "network": "MATIC_MAINNET",
  "filters": {
    "topics": [
      [
        "0x5cf8fa4a8e333990018876ad3a82065e68b3859d46c3198b692b77fc3043808b",
        "0x398340331999d3ec20eba0ca6ed7fff4090f1906a8f6dfa8d96b3c4708155005",
        "0x31423be1df71d4ecba11d1051d8033416ed316d601c79812e7cd8103e35b88a0",
        "0xd7243f6f8212d5188fd054141cf6ea89cfc0d91facb8c3afe2f88a1358480142",
        "0xc30fcfbcaac9e0deffa719714eaa82396ff506a0d0d0eebe170830177288715d"
      ]
    ]
  },
  "app_id": "your-app-id"
}
```

### 5. Monitor Vault Events Only

```json
{
  "name": "Vault Activities Monitor",
  "description": "Monitor collateral deposits/withdrawals and margin activity",
  "webhook_url": "https://your-webhook-endpoint.com/alchemy/vault",
  "webhook_type": "ADDRESS_ACTIVITY",
  "addresses": ["0x2C8d16222d4A1065285f28FA7fB7C6cF5cf7094e"],
  "network": "MATIC_MAINNET",
  "filters": {
    "topics": [
      [
        "0xd7243f6f8212d5188fd054141cf6ea89cfc0d91facb8c3afe2f88a1358480142",
        "0xc30fcfbcaac9e0deffa719714eaa82396ff506a0d0d0eebe170830177288715d",
        "0x7a9b1b90f35f094ffc6d04d86069c79e82c6a16eb600f79672428a409635deca",
        "0x5e63d54af10545f0b2bd229512f244caefe863ad94dbbb7ad827432c84d762f5"
      ]
    ]
  },
  "app_id": "your-app-id"
}
```

## Quick Setup Commands

### Using Alchemy API

```bash
# Create webhook for all VAMM events
curl -X POST https://dashboard.alchemy.com/api/create-webhook \
  -H "Content-Type: application/json" \
  -H "X-Alchemy-Token: YOUR_AUTH_TOKEN" \
  -d '{
    "webhook_type": "ADDRESS_ACTIVITY",
    "webhook_url": "https://your-endpoint.com/webhook",
    "addresses": ["0x487f1baE58CE513B39889152E96Eb18a346c75b1"],
    "network": "MATIC_MAINNET"
  }'
```

### Using Alchemy Notify SDK

```javascript
import { AlchemyNotifyService } from './alchemyNotifyService';

const alchemyNotify = new AlchemyNotifyService('YOUR_AUTH_TOKEN');

// Monitor all VAMM events
await alchemyNotify.createAddressActivityWebhook([
  '0x487f1baE58CE513B39889152E96Eb18a346c75b1'
], 'https://your-webhook-endpoint.com/alchemy');
```

## Event Data Structure Examples

### PositionOpened Event
```json
{
  "webhookId": "wh_abc123",
  "id": "whevt_xyz789",
  "createdAt": "2025-01-18T10:30:00.000Z",
  "type": "ADDRESS_ACTIVITY",
  "event": {
    "network": "MATIC_MAINNET",
    "activity": [
      {
        "fromAddress": "0x1234...",
        "toAddress": "0x487f1baE58CE513B39889152E96Eb18a346c75b1",
        "blockNum": "0x...",
        "hash": "0x...",
        "log": {
          "address": "0x487f1baE58CE513B39889152E96Eb18a346c75b1",
          "topics": [
            "0x5cf8fa4a8e333990018876ad3a82065e68b3859d46c3198b692b77fc3043808b",
            "0x000000000000000000000000user_address_here",
            "0x0000000000000000000000000000000000000000000000000000000000000001"
          ],
          "data": "0x..."
        }
      }
    ]
  }
}
```

## Priority Setup Recommendations

1. **Start with Position Events** - Monitor `PositionOpened` and `PositionClosed` first
2. **Add Price Monitoring** - Include `PriceUpdated` for market analysis
3. **Include Vault Events** - Monitor `CollateralDeposited`/`CollateralWithdrawn` for full picture
4. **Admin Events Last** - Add authorization events only if needed for security monitoring

## Testing

Test your webhook setup by:
1. Opening a position through the frontend
2. Checking if your webhook receives the `PositionOpened` event
3. Closing a position and verifying `PositionClosed` event
4. Monitoring price changes with `PriceUpdated` events

## Network Information

- **Network**: Polygon Mainnet
- **Chain ID**: 137
- **RPC URL**: https://polygon-rpc.com/
- **Explorer**: https://polygonscan.com/ 