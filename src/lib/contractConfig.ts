/**
 * Contract configuration for Dexetrav5
 * Contains addresses and market information
 */

import { env } from './env'
// Prefer sourcing addresses from HyperLiquid Testnet deployment JSON
// Fallback to existing hardcoded values if import or fields are missing
// JSON path is relative to this file: src/lib -> ../../Dexetrav5/deployments
// Next.js supports JSON imports by default
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import hyperliquidDeployment from '../../Dexetrav5/deployments/hyperliquid_testnet-deployment.json'

// Contract addresses
const deployed = (hyperliquidDeployment as any) || {};
const deployedContracts = (deployed.contracts as any) || {};
const deployedMarket = (deployed.aluminumMarket as any) || {};

console.log('deployed', deployed);

export const CONTRACT_ADDRESSES = {
  MOCK_USDC: deployedContracts.MOCK_USDC || "0x69bfB7DAB0135fB6cD3387CF411624d874B3c799",
  CORE_VAULT: deployedContracts.CORE_VAULT || "0x3F76468754fC1FA4a79C796C580824799281aCa0",
  LIQUIDATION_MANAGER: deployedContracts.LIQUIDATION_MANAGER || "0x93bF290F0a2039E502b87c8767c71e77A50C79C2",
  FUTURES_MARKET_FACTORY: deployedContracts.FUTURES_MARKET_FACTORY || "0x95c85427fdC7d6F04C948895fFe3dc6F84798EeC",
  ALUMINUM_ORDERBOOK: deployedContracts.ALUMINUM_ORDERBOOK || "0xFC27fc4786BE01510c3564117becD13fdB077bb3",
  BTC_ORDERBOOK: deployedContracts.BTC_ORDERBOOK || deployedContracts.ALUMINUM_ORDERBOOK || "0xFC27fc4786BE01510c3564117becD13fdB077bb3",

  // CamelCase aliases used by hooks like useContract
  mockUSDC: deployedContracts.MOCK_USDC || "0x69bfB7DAB0135fB6cD3387CF411624d874B3c799",
  coreVault: deployedContracts.CORE_VAULT || "0x3F76468754fC1FA4a79C796C580824799281aCa0",
  futuresMarketFactory: deployedContracts.FUTURES_MARKET_FACTORY || "0x95c85427fdC7d6F04C948895fFe3dc6F84798EeC",
  aluminumOrderBook: deployedContracts.ALUMINUM_ORDERBOOK || "0xFC27fc4786BE01510c3564117becD13fdB077bb3",
  orderBook: deployedContracts.ALUMINUM_ORDERBOOK || "0xFC27fc4786BE01510c3564117becD13fdB077bb3",

  // Market information
  MARKET_INFO: {
    ALUMINUM: {
      name: "Aluminum",
      symbol: deployedMarket.symbol || "ALU-USD",
      marketId: deployedMarket.marketId || deployedContracts.ALUMINUM_MARKET_ID || "0x84df5da1dc24d655e8d74a938f8fa61ebe4288d27c27238f318464ef5e6d0bb4",
      orderBook: deployedMarket.orderBook || deployedContracts.ALUMINUM_ORDERBOOK || "0xFC27fc4786BE01510c3564117becD13fdB077bb3",
      active: true
    },
    BTC: {
      name: "Bitcoin",
      symbol: "BTC-USD",
      marketId: deployedMarket.marketId || "0x84df5da1dc24d655e8d74a938f8fa61ebe4288d27c27238f318464ef5e6d0bb4", // placeholder
      orderBook: deployedContracts.BTC_ORDERBOOK || deployedContracts.ALUMINUM_ORDERBOOK || "0xFC27fc4786BE01510c3564117becD13fdB077bb3",
      active: true
    }
  }
};

// Network/chain configuration sourced from validated env
export const CHAIN_CONFIG = {
  rpcUrl: env.RPC_URL,
  wsRpcUrl: env.WS_RPC_URL,
  chainId: env.CHAIN_ID,
} as const