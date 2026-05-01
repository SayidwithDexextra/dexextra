#!/usr/bin/env npx tsx
/**
 * Market Health Check Script
 * 
 * Validates deployed markets against a comprehensive checklist to ensure
 * all facets are registered, roles granted, and configuration is correct.
 * 
 * WHAT IT CHECKS:
 *   - Facets: All required Diamond facet selectors (trading, view, pricing, liquidation, settlement, lifecycle, session/gasless)
 *   - Session Registry: Market has registry attached and is allowlisted for gasless trading
 *   - CoreVault Roles: ORDERBOOK_ROLE and SETTLEMENT_ROLE granted for margin/settlement operations
 *   - Lifecycle: Initialized state, settlement timestamp, challenge bond config
 *   - Fees: Fee structure and trading parameters configured
 * 
 * USAGE:
 *   npm run check:market-health -- --market 0x1234...     # Check specific market
 *   npm run check:market-health:all                       # Check all active markets
 *   npx tsx scripts/check-market-health.ts --all --json   # JSON output for automation
 *   npx tsx scripts/check-market-health.ts --verbose      # Show all checks (including passed)
 * 
 * EXIT CODES:
 *   0 = All markets healthy (no critical failures)
 *   1 = One or more markets unhealthy (has critical failures)
 */

import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';

// Load environment
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

// ============ Types ============

interface CheckResult {
  name: string;
  category: string;
  pass: boolean;
  details?: Record<string, any> | string;
  severity: 'critical' | 'warning' | 'info';
}

interface MarketHealthReport {
  marketAddress: string;
  marketId?: string;
  symbol?: string;
  timestamp: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    critical: number;
    warnings: number;
  };
  checks: CheckResult[];
  healthy: boolean;
}

// ============ Configuration ============

const RPC_URL = process.env.RPC_URL || process.env.RPC_URL_HYPEREVM;
const CORE_VAULT_ADDRESS = process.env.CORE_VAULT_ADDRESS || process.env.NEXT_PUBLIC_CORE_VAULT_ADDRESS;
const SESSION_REGISTRY_ADDRESS = process.env.SESSION_REGISTRY_ADDRESS || process.env.NEXT_PUBLIC_SESSION_REGISTRY_ADDRESS;
const FACTORY_ADDRESS = process.env.FUTURES_MARKET_FACTORY_ADDRESS || process.env.NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS;

// Expected facet addresses from env
const EXPECTED_FACETS: Record<string, string | undefined> = {
  OBAdminFacet: process.env.OB_ADMIN_FACET || process.env.NEXT_PUBLIC_OB_ADMIN_FACET,
  OBPricingFacet: process.env.OB_PRICING_FACET || process.env.NEXT_PUBLIC_OB_PRICING_FACET,
  OBOrderPlacementFacet: process.env.OB_ORDER_PLACEMENT_FACET || process.env.NEXT_PUBLIC_OB_ORDER_PLACEMENT_FACET,
  OBTradeExecutionFacet: process.env.OB_TRADE_EXECUTION_FACET || process.env.NEXT_PUBLIC_OB_TRADE_EXECUTION_FACET,
  OBLiquidationFacet: process.env.OB_LIQUIDATION_FACET || process.env.NEXT_PUBLIC_OB_LIQUIDATION_FACET,
  OBViewFacet: process.env.OB_VIEW_FACET || process.env.NEXT_PUBLIC_OB_VIEW_FACET,
  OBSettlementFacet: process.env.OB_SETTLEMENT_FACET || process.env.NEXT_PUBLIC_OB_SETTLEMENT_FACET,
  OrderBookVaultAdminFacet: process.env.ORDERBOOK_VAULT_FACET || process.env.ORDERBOOK_VALUT_FACET || process.env.NEXT_PUBLIC_ORDERBOOK_VAULT_FACET,
  MarketLifecycleFacet: process.env.MARKET_LIFECYCLE_FACET || process.env.NEXT_PUBLIC_MARKET_LIFECYCLE_FACET,
  MetaTradeFacet: process.env.META_TRADE_FACET || process.env.NEXT_PUBLIC_META_TRADE_FACET,
};

// Critical selectors that must be present for core functionality
// severity: critical = trading broken, warning = degraded, info = nice-to-have
const CRITICAL_SELECTORS: Record<string, { sig: string; category: string; severity?: 'critical' | 'warning' | 'info' }[]> = {
  // Order placement - margin orders only (spot trading removed)
  OrderPlacement: [
    { sig: 'placeMarginLimitOrder(uint256,uint256,bool)', category: 'trading', severity: 'critical' },
    { sig: 'placeMarginMarketOrder(uint256,bool)', category: 'trading', severity: 'critical' },
    { sig: 'placeMarginMarketOrderWithSlippage(uint256,bool,uint256)', category: 'trading', severity: 'warning' },
    { sig: 'cancelOrder(uint256)', category: 'trading', severity: 'critical' },
    { sig: 'modifyOrder(uint256,uint256,uint256)', category: 'trading', severity: 'warning' },
  ],
  // Trade execution
  TradeExecution: [
    { sig: 'obExecuteTrade(address,address,uint256,uint256,bool,bool,bool)', category: 'trading' },
    { sig: 'obExecuteTradeBatch(address,bool,bool,(address,uint256,uint256,bool,uint256)[])', category: 'trading' },
    { sig: 'getAllTrades(uint256,uint256)', category: 'view' },
    { sig: 'getUserTrades(address,uint256,uint256)', category: 'view' },
  ],
  // View functions - based on deployed OBViewFacet
  View: [
    { sig: 'getUserOrders(address)', category: 'view', severity: 'critical' },
    { sig: 'getOrder(uint256)', category: 'view', severity: 'critical' },
    { sig: 'bestBid()', category: 'view', severity: 'critical' },
    { sig: 'bestAsk()', category: 'view', severity: 'critical' },
    { sig: 'getTradingParameters()', category: 'view', severity: 'warning' },
    { sig: 'getFeeStructure()', category: 'view', severity: 'warning' },
    { sig: 'getUserPosition(address)', category: 'view', severity: 'critical' },
    { sig: 'marketStatic()', category: 'view', severity: 'warning' },
  ],
  // Pricing
  Pricing: [
    { sig: 'getBestPrices()', category: 'view' },
    { sig: 'getOrderBookDepth(uint256)', category: 'view' },
    { sig: 'calculateMarkPrice()', category: 'view' },
  ],
  // Liquidation
  Liquidation: [
    { sig: 'liquidateDirect(address)', category: 'liquidation' },
    { sig: 'pokeLiquidations()', category: 'liquidation' },
  ],
  // Settlement
  Settlement: [
    { sig: 'settleMarket(uint256)', category: 'settlement' },
    { sig: 'isSettled()', category: 'settlement' },
    { sig: 'adminCancelAllRestingOrders()', category: 'settlement' },
  ],
  // Lifecycle
  Lifecycle: [
    { sig: 'getLifecycleState()', category: 'lifecycle' },
    { sig: 'getSettlementTimestamp()', category: 'lifecycle' },
    { sig: 'syncLifecycle()', category: 'lifecycle' },
    { sig: 'proposeSettlementPrice(uint256)', category: 'lifecycle' },
    { sig: 'commitEvidence(string)', category: 'lifecycle' },
    { sig: 'challengeSettlement(uint256)', category: 'lifecycle' },
  ],
  // Gasless/Session trading - margin only
  Session: [
    { sig: 'sessionPlaceMarginLimit(bytes32,address,uint256,uint256,bool,bytes32[])', category: 'gasless', severity: 'critical' },
    { sig: 'sessionPlaceMarginMarket(bytes32,address,uint256,bool,bytes32[])', category: 'gasless', severity: 'critical' },
    { sig: 'sessionModifyOrder(bytes32,address,uint256,uint256,uint256,bytes32[])', category: 'gasless', severity: 'warning' },
    { sig: 'sessionCancelOrder(bytes32,address,uint256,bytes32[])', category: 'gasless', severity: 'critical' },
    { sig: 'setSessionRegistry(address)', category: 'admin', severity: 'critical' },
    { sig: 'sessionRegistry()', category: 'view', severity: 'critical' },
  ],
  // Admin
  Admin: [
    { sig: 'updateTradingParameters(uint256,uint256,address)', category: 'admin', severity: 'warning' },
    { sig: 'updateFeeStructure(uint256,uint256,address,uint256)', category: 'admin', severity: 'warning' },
  ],
};

// Lifecycle state enum
const LIFECYCLE_STATES: Record<number, string> = {
  0: 'Uninitialized',
  1: 'Active',
  2: 'RolloverWindow',
  3: 'SettlementProposed',
  4: 'ChallengeWindow',
  5: 'Settled',
  6: 'Expired',
};

// ============ Helpers ============

function selector(signature: string): string {
  return ethers.id(signature).slice(0, 10);
}

function shortAddr(a: string): string {
  return a.startsWith('0x') && a.length === 42 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

// ============ Health Check Functions ============

async function checkFacetSelectors(
  provider: ethers.Provider,
  marketAddress: string,
  verbose: boolean
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const loupe = new ethers.Contract(marketAddress, [
    'function facetAddress(bytes4) view returns (address)',
    'function facets() view returns (tuple(address facetAddress, bytes4[] functionSelectors)[])',
  ], provider);

  // Check all critical selectors
  for (const [facetGroup, signatures] of Object.entries(CRITICAL_SELECTORS)) {
    for (const { sig, category, severity: configSeverity } of signatures) {
      try {
        const sel = selector(sig);
        const facetAddr = await loupe.facetAddress(sel);
        const present = facetAddr && facetAddr !== ethers.ZeroAddress;
        
        // Use configured severity, or infer from category
        const severity = configSeverity || 
          (category === 'trading' || category === 'gasless' ? 'critical' : 'warning');
        
        results.push({
          name: `selector.${sig.split('(')[0]}`,
          category: `facets.${facetGroup}`,
          pass: present,
          details: { selector: sel, facet: facetAddr, signature: sig },
          severity,
        });
      } catch (e: any) {
        results.push({
          name: `selector.${sig.split('(')[0]}`,
          category: `facets.${facetGroup}`,
          pass: false,
          details: e?.message || String(e),
          severity: configSeverity || 'critical',
        });
      }
    }
  }

  return results;
}

async function checkSessionRegistry(
  provider: ethers.Provider,
  marketAddress: string
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  
  if (!SESSION_REGISTRY_ADDRESS || !ethers.isAddress(SESSION_REGISTRY_ADDRESS)) {
    results.push({
      name: 'sessionRegistry.envConfigured',
      category: 'gasless',
      pass: false,
      details: 'SESSION_REGISTRY_ADDRESS not configured in env',
      severity: 'critical',
    });
    return results;
  }

  // Check if market has sessionRegistry selector
  const market = new ethers.Contract(marketAddress, [
    'function sessionRegistry() view returns (address)',
    'function facetAddress(bytes4) view returns (address)',
  ], provider);

  try {
    const sel = selector('sessionRegistry()');
    const facetAddr = await market.facetAddress(sel);
    const hasSelector = facetAddr && facetAddr !== ethers.ZeroAddress;
    
    results.push({
      name: 'sessionRegistry.selectorPresent',
      category: 'gasless',
      pass: hasSelector,
      details: { selector: sel, facet: facetAddr },
      severity: 'critical',
    });

    if (hasSelector) {
      const registryOnMarket = await market.sessionRegistry();
      
      results.push({
        name: 'sessionRegistry.nonzero',
        category: 'gasless',
        pass: registryOnMarket && registryOnMarket !== ethers.ZeroAddress,
        details: { value: registryOnMarket },
        severity: 'critical',
      });

      results.push({
        name: 'sessionRegistry.matchesEnv',
        category: 'gasless',
        pass: registryOnMarket?.toLowerCase() === SESSION_REGISTRY_ADDRESS.toLowerCase(),
        details: { onMarket: registryOnMarket, expected: SESSION_REGISTRY_ADDRESS },
        severity: 'critical',
      });
    }
  } catch (e: any) {
    results.push({
      name: 'sessionRegistry.readable',
      category: 'gasless',
      pass: false,
      details: e?.message || String(e),
      severity: 'critical',
    });
  }

  // Check if market is allowlisted on registry
  try {
    const registry = new ethers.Contract(SESSION_REGISTRY_ADDRESS, [
      'function allowedOrderbook(address) view returns (bool)',
    ], provider);
    const allowed = await registry.allowedOrderbook(marketAddress);
    
    results.push({
      name: 'sessionRegistry.marketAllowlisted',
      category: 'gasless',
      pass: allowed === true,
      details: { allowed },
      severity: 'critical',
    });
  } catch (e: any) {
    results.push({
      name: 'sessionRegistry.allowlistReadable',
      category: 'gasless',
      pass: false,
      details: e?.message || String(e),
      severity: 'critical',
    });
  }

  return results;
}

async function checkCoreVaultRoles(
  provider: ethers.Provider,
  marketAddress: string
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  if (!CORE_VAULT_ADDRESS || !ethers.isAddress(CORE_VAULT_ADDRESS)) {
    results.push({
      name: 'coreVault.envConfigured',
      category: 'vault',
      pass: false,
      details: 'CORE_VAULT_ADDRESS not configured in env',
      severity: 'critical',
    });
    return results;
  }

  const vault = new ethers.Contract(CORE_VAULT_ADDRESS, [
    'function hasRole(bytes32,address) view returns (bool)',
    'function marketToOrderBook(bytes32) view returns (address)',
  ], provider);

  // Check ORDERBOOK_ROLE
  try {
    const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ORDERBOOK_ROLE'));
    const hasOBRole = await vault.hasRole(ORDERBOOK_ROLE, marketAddress);
    
    results.push({
      name: 'coreVault.hasOrderbookRole',
      category: 'vault',
      pass: hasOBRole === true,
      details: { role: 'ORDERBOOK_ROLE', granted: hasOBRole },
      severity: 'critical',
    });
  } catch (e: any) {
    results.push({
      name: 'coreVault.orderbookRoleReadable',
      category: 'vault',
      pass: false,
      details: e?.message || String(e),
      severity: 'critical',
    });
  }

  // Check SETTLEMENT_ROLE
  try {
    const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes('SETTLEMENT_ROLE'));
    const hasSettleRole = await vault.hasRole(SETTLEMENT_ROLE, marketAddress);
    
    results.push({
      name: 'coreVault.hasSettlementRole',
      category: 'vault',
      pass: hasSettleRole === true,
      details: { role: 'SETTLEMENT_ROLE', granted: hasSettleRole },
      severity: 'critical',
    });
  } catch (e: any) {
    results.push({
      name: 'coreVault.settlementRoleReadable',
      category: 'vault',
      pass: false,
      details: e?.message || String(e),
      severity: 'critical',
    });
  }

  // Check marketToOrderBook mapping using marketStatic() which returns the marketId
  try {
    const market = new ethers.Contract(marketAddress, [
      'function marketStatic() view returns (bytes32 marketId, string memory symbol, uint256 startPrice, uint256 settlementDate, string memory metricUrl, string memory dataSource)',
    ], provider);
    const staticData = await market.marketStatic();
    const marketId = staticData.marketId || staticData[0];
    
    if (marketId && marketId !== ethers.ZeroHash) {
      const mappedAddress = await vault.marketToOrderBook(marketId);
      
      results.push({
        name: 'coreVault.marketIdMappingCorrect',
        category: 'vault',
        pass: mappedAddress?.toLowerCase() === marketAddress.toLowerCase(),
        details: { marketId, mappedAddress, expected: marketAddress },
        severity: 'warning',
      });
    } else {
      results.push({
        name: 'coreVault.marketIdMappingCorrect',
        category: 'vault',
        pass: false,
        details: { error: 'marketStatic returned zero/null marketId' },
        severity: 'warning',
      });
    }
  } catch (e: any) {
    // If marketStatic fails, try to skip this check gracefully
    results.push({
      name: 'coreVault.marketIdMappingReadable',
      category: 'vault',
      pass: false,
      details: `Could not read marketId: ${e?.shortMessage || e?.message || String(e)}`,
      severity: 'info', // Downgrade to info since this is a secondary check
    });
  }

  return results;
}

async function checkLifecycle(
  provider: ethers.Provider,
  marketAddress: string
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const market = new ethers.Contract(marketAddress, [
    'function getLifecycleState() view returns (uint8)',
    'function getSettlementTimestamp() view returns (uint256)',
    'function isSettled() view returns (bool)',
    'function getChallengeBondConfig() view returns (uint256 bondAmount, address slashRecipient)',
    'function isLifecycleOperator(address) view returns (bool)',
    'function isProposalBondExempt(address) view returns (bool)',
  ], provider);

  // Check lifecycle state
  try {
    const state = await market.getLifecycleState();
    const stateName = LIFECYCLE_STATES[Number(state)] || `Unknown(${state})`;
    
    results.push({
      name: 'lifecycle.stateReadable',
      category: 'lifecycle',
      pass: true,
      details: { state: Number(state), stateName },
      severity: 'info',
    });

    results.push({
      name: 'lifecycle.initialized',
      category: 'lifecycle',
      pass: Number(state) > 0,
      details: { state: Number(state), stateName },
      severity: 'critical',
    });
  } catch (e: any) {
    results.push({
      name: 'lifecycle.stateReadable',
      category: 'lifecycle',
      pass: false,
      details: e?.message || String(e),
      severity: 'critical',
    });
  }

  // Check settlement timestamp
  try {
    const settlementTs = await market.getSettlementTimestamp();
    const now = Math.floor(Date.now() / 1000);
    const settlementDate = new Date(Number(settlementTs) * 1000).toISOString();
    
    results.push({
      name: 'lifecycle.settlementTimestampSet',
      category: 'lifecycle',
      pass: Number(settlementTs) > 0,
      details: { timestamp: Number(settlementTs), date: settlementDate },
      severity: 'critical',
    });

    results.push({
      name: 'lifecycle.notExpired',
      category: 'lifecycle',
      pass: Number(settlementTs) > now,
      details: { settlementTs: Number(settlementTs), now, expired: Number(settlementTs) <= now },
      severity: 'info',
    });
  } catch (e: any) {
    results.push({
      name: 'lifecycle.settlementTimestampReadable',
      category: 'lifecycle',
      pass: false,
      details: e?.message || String(e),
      severity: 'warning',
    });
  }

  // Check challenge bond config
  try {
    const [bondAmount, slashRecipient] = await market.getChallengeBondConfig();
    
    results.push({
      name: 'lifecycle.challengeBondConfigured',
      category: 'lifecycle',
      pass: BigInt(bondAmount) > 0n && slashRecipient !== ethers.ZeroAddress,
      details: { bondAmount: Number(bondAmount) / 1e6, slashRecipient },
      severity: 'warning',
    });
  } catch (e: any) {
    results.push({
      name: 'lifecycle.challengeBondReadable',
      category: 'lifecycle',
      pass: false,
      details: e?.message || String(e),
      severity: 'warning',
    });
  }

  return results;
}

async function checkFeeConfiguration(
  provider: ethers.Provider,
  marketAddress: string
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const market = new ethers.Contract(marketAddress, [
    'function getFeeStructure() view returns (uint256 takerFeeBps, uint256 makerFeeBps, address protocolFeeRecipient, uint256 protocolFeeShareBps, uint256 legacyTradingFee, address marketOwnerFeeRecipient)',
    'function getTradingParameters() view returns (uint256 marginRequirement, uint256 fee, address recipient)',
  ], provider);

  // Check fee structure
  try {
    const feeStruct = await market.getFeeStructure();
    const [takerFeeBps, makerFeeBps, protocolFeeRecipient, protocolFeeShareBps] = feeStruct;
    
    results.push({
      name: 'fees.structureConfigured',
      category: 'fees',
      pass: protocolFeeRecipient !== ethers.ZeroAddress,
      details: {
        takerFeeBps: Number(takerFeeBps),
        makerFeeBps: Number(makerFeeBps),
        protocolFeeRecipient,
        protocolFeeShareBps: Number(protocolFeeShareBps),
      },
      severity: 'warning',
    });
  } catch (e: any) {
    results.push({
      name: 'fees.structureReadable',
      category: 'fees',
      pass: false,
      details: e?.message || String(e),
      severity: 'warning',
    });
  }

  // Check trading parameters
  try {
    const [marginReq, fee, recipient] = await market.getTradingParameters();
    
    results.push({
      name: 'fees.tradingParamsConfigured',
      category: 'fees',
      pass: recipient !== ethers.ZeroAddress,
      details: {
        marginRequirementBps: Number(marginReq),
        tradingFee: Number(fee),
        feeRecipient: recipient,
      },
      severity: 'warning',
    });
  } catch (e: any) {
    results.push({
      name: 'fees.tradingParamsReadable',
      category: 'fees',
      pass: false,
      details: e?.message || String(e),
      severity: 'warning',
    });
  }

  return results;
}

async function checkContractDeployed(
  provider: ethers.Provider,
  marketAddress: string
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    const code = await provider.getCode(marketAddress);
    const hasCode = code && code !== '0x' && code.length > 2;
    
    results.push({
      name: 'contract.deployed',
      category: 'basic',
      pass: hasCode,
      details: { codeLength: code?.length || 0 },
      severity: 'critical',
    });
  } catch (e: any) {
    results.push({
      name: 'contract.deployed',
      category: 'basic',
      pass: false,
      details: e?.message || String(e),
      severity: 'critical',
    });
  }

  return results;
}

async function checkMarketOwnership(
  provider: ethers.Provider,
  marketAddress: string
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const market = new ethers.Contract(marketAddress, [
    'function owner() view returns (address)',
  ], provider);

  try {
    const owner = await market.owner();
    
    results.push({
      name: 'ownership.hasOwner',
      category: 'admin',
      pass: owner && owner !== ethers.ZeroAddress,
      details: { owner },
      severity: 'info',
    });
  } catch (e: any) {
    results.push({
      name: 'ownership.readable',
      category: 'admin',
      pass: false,
      details: e?.message || String(e),
      severity: 'info',
    });
  }

  return results;
}

// ============ Main Check Runner ============

async function runHealthCheck(
  provider: ethers.Provider,
  marketAddress: string,
  verbose: boolean = false,
  marketInfo?: { symbol?: string; marketId?: string }
): Promise<MarketHealthReport> {
  const checks: CheckResult[] = [];

  // Run all checks
  checks.push(...await checkContractDeployed(provider, marketAddress));
  
  // Only continue if contract is deployed
  const deployed = checks.find(c => c.name === 'contract.deployed');
  if (deployed?.pass) {
    checks.push(...await checkFacetSelectors(provider, marketAddress, verbose));
    checks.push(...await checkSessionRegistry(provider, marketAddress));
    checks.push(...await checkCoreVaultRoles(provider, marketAddress));
    checks.push(...await checkLifecycle(provider, marketAddress));
    checks.push(...await checkFeeConfiguration(provider, marketAddress));
    checks.push(...await checkMarketOwnership(provider, marketAddress));
  }

  // Calculate summary
  const passed = checks.filter(c => c.pass).length;
  const failed = checks.filter(c => !c.pass).length;
  const critical = checks.filter(c => !c.pass && c.severity === 'critical').length;
  const warnings = checks.filter(c => !c.pass && c.severity === 'warning').length;

  return {
    marketAddress,
    marketId: marketInfo?.marketId,
    symbol: marketInfo?.symbol,
    timestamp: new Date().toISOString(),
    summary: {
      total: checks.length,
      passed,
      failed,
      critical,
      warnings,
    },
    checks,
    healthy: critical === 0,
  };
}

// ============ Output Formatters ============

function printReport(report: MarketHealthReport, verbose: boolean = false) {
  const { marketAddress, symbol, summary, checks, healthy } = report;

  console.log('\n' + '═'.repeat(70));
  console.log(`  MARKET HEALTH CHECK: ${symbol || shortAddr(marketAddress)}`);
  console.log(`  Address: ${marketAddress}`);
  console.log('═'.repeat(70));

  // Summary
  const healthIcon = healthy ? '✅' : '❌';
  const healthText = healthy ? 'HEALTHY' : 'UNHEALTHY';
  console.log(`\n  Status: ${healthIcon} ${healthText}`);
  console.log(`  Passed: ${summary.passed}/${summary.total} checks`);
  if (summary.critical > 0) console.log(`  Critical failures: ${summary.critical}`);
  if (summary.warnings > 0) console.log(`  Warnings: ${summary.warnings}`);

  // Group checks by category
  const byCategory = checks.reduce((acc, check) => {
    const cat = check.category;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(check);
    return acc;
  }, {} as Record<string, CheckResult[]>);

  console.log('\n' + '─'.repeat(70));

  for (const [category, categoryChecks] of Object.entries(byCategory)) {
    const catPassed = categoryChecks.filter(c => c.pass).length;
    const catTotal = categoryChecks.length;
    const catIcon = catPassed === catTotal ? '✅' : '⚠️';
    
    console.log(`\n  ${catIcon} ${category.toUpperCase()} (${catPassed}/${catTotal})`);

    for (const check of categoryChecks) {
      const icon = check.pass ? '  ✓' : check.severity === 'critical' ? '  ✗' : '  ⚠';
      const color = check.pass ? '' : check.severity === 'critical' ? '' : '';
      
      if (!verbose && check.pass) continue;
      
      console.log(`     ${icon} ${check.name}`);
      if (!check.pass && check.details) {
        const detailStr = typeof check.details === 'string' 
          ? check.details 
          : JSON.stringify(check.details, null, 2).split('\n').map(l => '        ' + l).join('\n');
        console.log(`        ${detailStr}`);
      }
    }
  }

  console.log('\n' + '═'.repeat(70) + '\n');
}

// ============ Database Integration ============

async function getAllMarketsFromDb(): Promise<Array<{ address: string; symbol: string; marketId: string }>> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.warn('Supabase not configured, cannot fetch markets from DB');
    return [];
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  
  const { data, error } = await supabase
    .from('markets')
    .select('market_address, symbol, market_id_bytes32')
    .eq('is_active', true)
    .not('market_address', 'is', null)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching markets:', error);
    return [];
  }

  return (data || []).map(m => ({
    address: m.market_address,
    symbol: m.symbol,
    marketId: m.market_id_bytes32,
  }));
}

// ============ Main Entry ============

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                    MARKET HEALTH CHECK TOOL                         ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  const marketAddress = getArg('--market');
  const checkAll = hasFlag('--all');
  const jsonOutput = hasFlag('--json');
  const verbose = hasFlag('--verbose');

  if (!marketAddress && !checkAll) {
    console.error('Usage:');
    console.error('  npx tsx scripts/check-market-health.ts --market <address>');
    console.error('  npx tsx scripts/check-market-health.ts --all');
    console.error('\nOptions:');
    console.error('  --market <address>  Check a specific market');
    console.error('  --all               Check all active markets from DB');
    console.error('  --json              Output results as JSON');
    console.error('  --verbose           Show all checks (including passed)');
    process.exit(1);
  }

  if (!RPC_URL) {
    console.error('❌ RPC_URL not configured');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  
  try {
    const network = await provider.getNetwork();
    console.log(`🌐 Network: Chain ID ${network.chainId}`);
  } catch (e: any) {
    console.error('❌ Could not connect to RPC:', e.message);
    process.exit(1);
  }

  const reports: MarketHealthReport[] = [];

  if (checkAll) {
    console.log('📋 Fetching all active markets from database...');
    const markets = await getAllMarketsFromDb();
    
    if (markets.length === 0) {
      console.log('No active markets found in database.');
      process.exit(0);
    }

    console.log(`Found ${markets.length} active market(s)\n`);

    for (const market of markets) {
      console.log(`Checking ${market.symbol || shortAddr(market.address)}...`);
      const report = await runHealthCheck(provider, market.address, verbose, {
        symbol: market.symbol,
        marketId: market.marketId,
      });
      reports.push(report);
    }
  } else if (marketAddress) {
    if (!ethers.isAddress(marketAddress)) {
      console.error('❌ Invalid market address');
      process.exit(1);
    }

    const report = await runHealthCheck(provider, marketAddress, verbose);
    reports.push(report);
  }

  // Output
  if (jsonOutput) {
    console.log(JSON.stringify(reports, null, 2));
  } else {
    for (const report of reports) {
      printReport(report, verbose);
    }

    // Summary for --all
    if (reports.length > 1) {
      console.log('\n' + '═'.repeat(70));
      console.log('  SUMMARY');
      console.log('═'.repeat(70));
      
      const healthy = reports.filter(r => r.healthy).length;
      const unhealthy = reports.filter(r => !r.healthy).length;
      
      console.log(`\n  Total markets: ${reports.length}`);
      console.log(`  ✅ Healthy: ${healthy}`);
      console.log(`  ❌ Unhealthy: ${unhealthy}`);

      if (unhealthy > 0) {
        console.log('\n  Unhealthy markets:');
        for (const r of reports.filter(r => !r.healthy)) {
          console.log(`    - ${r.symbol || shortAddr(r.marketAddress)}: ${r.summary.critical} critical, ${r.summary.warnings} warnings`);
        }
      }
      
      console.log('\n' + '═'.repeat(70) + '\n');
    }
  }

  // Exit code
  const anyUnhealthy = reports.some(r => !r.healthy);
  process.exit(anyUnhealthy ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
