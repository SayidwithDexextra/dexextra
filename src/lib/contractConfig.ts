/**
 * Contract configuration for Dexetrav5
 * Contains addresses and market information
 * Uses the new markets table for dynamic loading of market data
 */

import { env } from './env'
// Prefer sourcing addresses from HyperLiquid Testnet deployment JSON
// Fallback to existing hardcoded values if import or fields are missing
// JSON path is relative to this file: src/lib -> ../../Dexetrav5/deployments
// Next.js supports JSON imports by default
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import hyperliquidDeployment from '../../Dexetrav5/deployments/hyperliquid_testnet-deployment.json'
import marketService from './marketService'

// Contract addresses - these are the global contract addresses
// Market-specific contracts will be loaded from the markets table
const deployed = (hyperliquidDeployment as any) || {};
const deployedContracts = (deployed.contracts as any) || {};

// Core contract addresses - these are shared across markets
export const CONTRACT_ADDRESSES = {
  MOCK_USDC: deployedContracts.MOCK_USDC || env.MOCK_USDC_ADDRESS || "0x69bfB7DAB0135fB6cD3387CF411624d874B3c799",
  CORE_VAULT: deployedContracts.CORE_VAULT || env.CORE_VAULT_ADDRESS || "0x3F76468754fC1FA4a79C796C580824799281aCa0",
  LIQUIDATION_MANAGER: deployedContracts.LIQUIDATION_MANAGER || env.LIQUIDATION_MANAGER_ADDRESS || "0x93bF290F0a2039E502b87c8767c71e77A50C79C2",
  FUTURES_MARKET_FACTORY: deployedContracts.FUTURES_MARKET_FACTORY || env.FUTURES_MARKET_FACTORY_ADDRESS || "0x95c85427fdC7d6F04C948895fFe3dc6F84798EeC",

  // CamelCase aliases used by hooks like useContract
  mockUSDC: deployedContracts.MOCK_USDC || env.MOCK_USDC_ADDRESS || "0x69bfB7DAB0135fB6cD3387CF411624d874B3c799",
  coreVault: deployedContracts.CORE_VAULT || env.CORE_VAULT_ADDRESS || "0x3F76468754fC1FA4a79C796C580824799281aCa0",
  liquidationManager: deployedContracts.LIQUIDATION_MANAGER || env.LIQUIDATION_MANAGER_ADDRESS || "0x93bF290F0a2039E502b87c8767c71e77A50C79C2",
  futuresMarketFactory: deployedContracts.FUTURES_MARKET_FACTORY || env.FUTURES_MARKET_FACTORY_ADDRESS || "0x95c85427fdC7d6F04C948895fFe3dc6F84798EeC",

  // Default market orderbook (for backward compatibility)
  orderBook: deployedContracts.ALUMINUM_ORDERBOOK || env.DEFAULT_ORDERBOOK_ADDRESS || "0xFC27fc4786BE01510c3564117becD13fdB077bb3",
  aluminumOrderBook: deployedContracts.ALUMINUM_ORDERBOOK || env.DEFAULT_ORDERBOOK_ADDRESS || "0xFC27fc4786BE01510c3564117becD13fdB077bb3",

  // Market information will be populated at runtime from the database
  MARKET_INFO: {}
};

// Network/chain configuration sourced from validated env, with deployment fallback for chainId
export const CHAIN_CONFIG = {
  rpcUrl: env.RPC_URL,
  wsRpcUrl: env.WS_RPC_URL,
  chainId: Number.isFinite(env.CHAIN_ID as any) && (env.CHAIN_ID as any) > 0 ? env.CHAIN_ID : ((hyperliquidDeployment as any)?.chainId ?? 137),
} as const

// Function to populate market information from database
export async function populateMarketInfo() {
  try {
    const markets = await marketService.getAllMarkets();
    
    for (const market of markets) {
      // Skip markets that aren't fully deployed
      if (!market.market_address || !market.market_id_bytes32) continue;
      
      // Use the symbol prefix (e.g. "BTC" from "BTC-USD") as the key
      const key = (market.symbol.split('-')[0] || market.symbol).toUpperCase();
      
      (CONTRACT_ADDRESSES as any).MARKET_INFO[key] = {
        id: market.id,
        name: market.name,
        symbol: market.symbol,
        marketId: market.market_id_bytes32,
        marketIdentifier: market.market_identifier,
        orderBook: market.market_address,
        centralVault: market.central_vault_address,
        factoryAddress: market.factory_address,
        active: market.is_active && market.market_status === 'ACTIVE',
        status: market.market_status
      };
      
      // Set default orderBook for the first active market
      if (market.is_active && market.market_status === 'ACTIVE' && 
          (!CONTRACT_ADDRESSES.orderBook || CONTRACT_ADDRESSES.orderBook === "0xFC27fc4786BE01510c3564117becD13fdB077bb3")) {
        CONTRACT_ADDRESSES.orderBook = market.market_address;
      }
    }
    
    console.log('Market info populated from database:', Object.keys(CONTRACT_ADDRESSES.MARKET_INFO).length, 'markets');
  } catch (error) {
    console.error('Error populating market info:', error);
    
    // Fallback to deployment JSON for backward compatibility
    const deployedMarketsArr = (deployed.markets as any[]) || [];
    const deployedMarket = (deployed.aluminumMarket as any) || {};
    
    if (!Object.keys(CONTRACT_ADDRESSES.MARKET_INFO).length) {
      // Only add fallbacks if no markets were loaded from DB
      CONTRACT_ADDRESSES.MARKET_INFO.ALUMINUM = {
        name: "Aluminum",
        symbol: deployedMarket.symbol || "ALU-USD",
        marketId: deployedMarket.marketId || deployedContracts.ALUMINUM_MARKET_ID || "0x84df5da1dc24d655e8d74a938f8fa61ebe4288d27c27238f318464ef5e6d0bb4",
        orderBook: deployedMarket.orderBook || deployedContracts.ALUMINUM_ORDERBOOK || "0xFC27fc4786BE01510c3564117becD13fdB077bb3",
        active: true
      };
      
      CONTRACT_ADDRESSES.MARKET_INFO.BTC = {
        name: "Bitcoin",
        symbol: "BTC-USD",
        marketId: deployedMarket.marketId || "0x84df5da1dc24d655e8d74a938f8fa61ebe4288d27c27238f318464ef5e6d0bb4", // placeholder
        orderBook: deployedContracts.BTC_ORDERBOOK || deployedContracts.ALUMINUM_ORDERBOOK || "0xFC27fc4786BE01510c3564117becD13fdB077bb3",
        active: true
      };
      
      try {
        for (const m of deployedMarketsArr) {
          if (!m || !m.symbol || !m.marketId || !m.orderBook) continue;
          const key = (m.symbol.split('-')[0] || m.symbol).toUpperCase();
          (CONTRACT_ADDRESSES as any).MARKET_INFO[key] = {
            name: key,
            symbol: m.symbol,
            marketId: m.marketId,
            orderBook: m.orderBook,
            active: true
          };
        }
      } catch {}
    }
  }
}

// Helper function to get contract addresses for a specific market
export async function getMarketAddresses(marketIdentifier: string) {
  return marketService.getContractAddresses(marketIdentifier);
}

// Initialize contract addresses - this will be called during app startup
populateMarketInfo().catch(console.error);

export default CONTRACT_ADDRESSES;