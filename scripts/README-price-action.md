# Silver Market Price Action Generator

This script generates realistic price action for the SILVER_Relayed_Meridian_2025_85969 market by placing a combination of limit and market orders.

## Features

- Places alternating buy and sell orders
- Generates random but realistic trade sizes (20-100 units)
- Creates price movements between 20-95 USDC
- Respects market tick size (0.01)
- Places limit orders and corresponding market orders to create trades
- Runs continuously with 30-second intervals between trades

## Prerequisites

1. Node.js installed
2. Access to a Polygon RPC node
3. A funded wallet with sufficient USDC collateral
4. API access to the orderbook system

## Configuration

Create a .env file with the following variables:

```env
TRADER_PRIVATE_KEY=your_private_key_here
RPC_URL=your_polygon_rpc_url
API_URL=orderbook_api_url
```

## Installation

```bash
npm install ethers @ethersproject/providers
```

## Usage

Run the script:

```bash
node generate-silver-price-action.js
```

The script will:
1. Generate a random price point between 20-95 USDC
2. Place a limit order (BUY or SELL)
3. Place a corresponding market order to create trades
4. Wait 30 seconds before repeating

## Safety Features

- Random but bounded price movements
- Reasonable trade sizes
- Built-in delays between trades
- Error handling and logging

## Monitoring

The script logs all orders being placed:
- Order type (limit/market)
- Side (buy/sell)
- Quantity
- Price (for limit orders)

## Important Notes

1. Ensure your wallet has sufficient collateral before running
2. Monitor the script's operation to ensure proper functioning
3. The script runs indefinitely - use Ctrl+C to stop it
4. Consider running on a reliable server to maintain consistent price action

