import 'dotenv/config';
import fetch from 'node-fetch';
import { ethers } from 'ethers';
import {
  OBAdminFacetABI,
  OBPricingFacetABI,
  OBOrderPlacementFacetABI,
  OBTradeExecutionFacetABI,
  OBLiquidationFacetABI,
  OBViewFacetABI,
  OBSettlementFacetABI,
  MarketLifecycleFacetABI,
} from '../src/lib/contracts';
import MetaTradeFacetArtifact from '../src/lib/abis/facets/MetaTradeFacet.json';
import OrderBookVaultAdminFacetArtifact from '../src/lib/abis/facets/OrderBookVaultAdminFacet.json';
import FuturesMarketFactoryArtifact from '../src/lib/abis/FuturesMarketFactory.json';

type CliArgs = Record<string, string | boolean>;

function warn(label: string, value: unknown) {
  const present = Boolean(value);
  const status = present ? '✅' : '⚠️';
  const valStr = value === undefined ? 'undefined' : value === null ? 'null' : String(value);
  console.log(`${status} ${label}: ${valStr}`);
}

function parseArgs(): CliArgs {
  const out: CliArgs = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function selectorsFromAbi(abi: any[]): string[] {
  try {
    const iface = new ethers.Interface(abi as any);
    return (iface.fragments as any[])
      .filter((frag: any) => frag?.type === 'function')
      .map((frag: any) => ethers.id(frag.format('sighash')).slice(0, 10));
  } catch {
    return [];
  }
}

function getEnvAddress(name: string): string | null {
  const v = process.env[name] || (process.env as any)[`NEXT_PUBLIC_${name}`];
  return v && ethers.isAddress(String(v)) ? String(v) : null;
}

function logEnvCheck() {
  console.log('--- ENV CHECK (gasless-create-market) ---');
  warn('RPC_URL', process.env.RPC_URL || process.env.JSON_RPC_URL || process.env.ALCHEMY_RPC_URL);
  warn('CREATOR_PRIVATE_KEY', process.env.CREATOR_PRIVATE_KEY ? '***set***' : undefined);
  warn('FUTURES_MARKET_FACTORY_ADDRESS', process.env.FUTURES_MARKET_FACTORY_ADDRESS || (process.env as any).NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS);
  warn('ORDER_BOOK_INIT_FACET', process.env.ORDER_BOOK_INIT_FACET || (process.env as any).NEXT_PUBLIC_ORDER_BOOK_INIT_FACET);
  warn('OB_ADMIN_FACET', process.env.OB_ADMIN_FACET || (process.env as any).NEXT_PUBLIC_OB_ADMIN_FACET);
  warn('OB_PRICING_FACET', process.env.OB_PRICING_FACET || (process.env as any).NEXT_PUBLIC_OB_PRICING_FACET);
  warn('OB_ORDER_PLACEMENT_FACET', process.env.OB_ORDER_PLACEMENT_FACET || (process.env as any).NEXT_PUBLIC_OB_ORDER_PLACEMENT_FACET);
  warn('OB_TRADE_EXECUTION_FACET', process.env.OB_TRADE_EXECUTION_FACET || (process.env as any).NEXT_PUBLIC_OB_TRADE_EXECUTION_FACET);
  warn('OB_LIQUIDATION_FACET', process.env.OB_LIQUIDATION_FACET || (process.env as any).NEXT_PUBLIC_OB_LIQUIDATION_FACET);
  warn('OB_VIEW_FACET', process.env.OB_VIEW_FACET || (process.env as any).NEXT_PUBLIC_OB_VIEW_FACET);
  warn('OB_SETTLEMENT_FACET', process.env.OB_SETTLEMENT_FACET || (process.env as any).NEXT_PUBLIC_OB_SETTLEMENT_FACET);
  warn('ORDERBOOK_VAULT_FACET', process.env.ORDERBOOK_VAULT_FACET || (process.env as any).NEXT_PUBLIC_ORDERBOOK_VAULT_FACET || process.env.ORDERBOOK_VALUT_FACET || (process.env as any).NEXT_PUBLIC_ORDERBOOK_VALUT_FACET);
  warn('MARKET_LIFECYCLE_FACET', process.env.MARKET_LIFECYCLE_FACET || (process.env as any).NEXT_PUBLIC_MARKET_LIFECYCLE_FACET);
  warn('META_TRADE_FACET', process.env.META_TRADE_FACET || (process.env as any).NEXT_PUBLIC_META_TRADE_FACET);
  warn('DIAMOND_OWNER_ADDRESS', process.env.DIAMOND_OWNER_ADDRESS);
  warn('GASLESS_CREATE_ENABLED', process.env.GASLESS_CREATE_ENABLED || (process.env as any).NEXT_PUBLIC_GASLESS_CREATE_ENABLED);
  warn('GASLESS_RELAYER_URL', process.env.GASLESS_RELAYER_URL || process.env.APP_URL);
  console.log('----------------------------------------');
}

function usage() {
  console.log(`
Usage:
  tsx scripts/gasless-create-market.ts --symbol BTC-USD --metric "https://example.com" --price 42000 --tags "BTC,USD" [--submit]

Required env:
  RPC_URL / JSON_RPC_URL
  FUTURES_MARKET_FACTORY_ADDRESS
  ORDER_BOOK_INIT_FACET
  OB_ADMIN_FACET, OB_PRICING_FACET, OB_ORDER_PLACEMENT_FACET, OB_TRADE_EXECUTION_FACET,
  OB_LIQUIDATION_FACET, OB_VIEW_FACET, OB_SETTLEMENT_FACET, ORDERBOOK_VAULT_FACET,
  MARKET_LIFECYCLE_FACET, META_TRADE_FACET
  CREATOR_PRIVATE_KEY (user signing the gasless payload)
Optional env:
  GASLESS_RELAYER_URL (default: ${process.env.APP_URL || 'http://localhost:3000'}/api/markets/create)
  EIP712_FACTORY_DOMAIN_NAME (default: DexetraFactory; prefer on-chain eip712DomainInfo())
  EIP712_FACTORY_DOMAIN_VERSION (default: 1)
  DIAMOND_OWNER_ADDRESS (must match relayer/admin submitter; required when --submit unless your relayer uses creator as owner)
  GASLESS_CREATE_ENABLED (default: true)
Flags:
  --symbol SYMBOL           Market symbol (e.g. BTC-USD) [required]
  --metric URL             Metric URL [required]
  --price NUMBER           Start price (human, will be scaled to 6 decimals) [required]
  --tags "A,B,C"           Comma-separated tags (optional)
  --dataSource TEXT        Data source description (optional, default: User Provided)
  --settlement SECONDS     Settlement timestamp (unix seconds, default: now + 365d)
  --deadline SECONDS       Signature deadline (unix seconds, default: now + 15m)
  --pipeline ID            Optional pipeline id for server push logs
  --submit                 Also POST to relayer (otherwise sign-only)
`);
}

async function main() {
  const args = parseArgs();
  if (!args.symbol || !args.metric || !args.price) {
    usage();
    process.exit(1);
  }

  logEnvCheck();

  const rpcUrl =
    process.env.RPC_URL ||
    process.env.JSON_RPC_URL ||
    process.env.ALCHEMY_RPC_URL;
  if (!rpcUrl) throw new Error('Missing RPC_URL / JSON_RPC_URL');

  const creatorPk = process.env.CREATOR_PRIVATE_KEY;
  if (!creatorPk) throw new Error('Missing CREATOR_PRIVATE_KEY');

  const factoryAddressEnv = getEnvAddress('FUTURES_MARKET_FACTORY_ADDRESS');
  if (!factoryAddressEnv) throw new Error('Missing FUTURES_MARKET_FACTORY_ADDRESS');

  // Load cut/initFacet: prefer server /api/orderbook/cut to avoid selector drift
  let initFacet: string | null = null;
  let cutArg: Array<[string, number, string[]]> = [];
  try {
    const res = await fetch('http://localhost:3000/api/orderbook/cut', { method: 'GET' });
    if (!res.ok) throw new Error(`cut API ${res.status}`);
    const data = await res.json();
    const cut = Array.isArray(data?.cut) ? data.cut : [];
    initFacet = data?.initFacet || null;
    cutArg = cut.map((c: any) => [c.facetAddress, 0, c.functionSelectors]);
    console.log('[cut] using server-provided cutArg', { facets: cutArg.length, initFacet });
  } catch (e: any) {
    console.warn('[cut] server cut fetch failed, falling back to env ABIs:', e?.message || String(e));
    const factoryAddress = getEnvAddress('FUTURES_MARKET_FACTORY_ADDRESS');
    const initFacetEnv = getEnvAddress('ORDER_BOOK_INIT_FACET');
    const adminFacet = getEnvAddress('OB_ADMIN_FACET');
    const pricingFacet = getEnvAddress('OB_PRICING_FACET');
    const placementFacet = getEnvAddress('OB_ORDER_PLACEMENT_FACET');
    const execFacet = getEnvAddress('OB_TRADE_EXECUTION_FACET');
    const liqFacet = getEnvAddress('OB_LIQUIDATION_FACET');
    const viewFacet = getEnvAddress('OB_VIEW_FACET');
    const settleFacet = getEnvAddress('OB_SETTLEMENT_FACET');
    const vaultFacet =
      getEnvAddress('ORDERBOOK_VALUT_FACET') ||
      getEnvAddress('ORDERBOOK_VAULT_FACET');
    const lifecycleFacet = getEnvAddress('MARKET_LIFECYCLE_FACET');
    const metaTradeFacet = getEnvAddress('META_TRADE_FACET');

    const required = {
      factoryAddress,
      initFacetEnv,
      adminFacet,
      pricingFacet,
      placementFacet,
      execFacet,
      liqFacet,
      viewFacet,
      settleFacet,
      vaultFacet,
      lifecycleFacet,
      metaTradeFacet,
    };
    const missing = Object.entries(required)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length) {
      throw new Error(`Missing required facet addresses: ${missing.join(', ')}`);
    }

    initFacet = initFacetEnv;

    const adminSelectors = selectorsFromAbi(OBAdminFacetABI as any[]);
    const pricingSelectors = selectorsFromAbi(OBPricingFacetABI as any[]);
    const placementSelectors = selectorsFromAbi(OBOrderPlacementFacetABI as any[]);
    const execSelectors = selectorsFromAbi(OBTradeExecutionFacetABI as any[]);
    const liqSelectors = selectorsFromAbi(OBLiquidationFacetABI as any[]);
    const viewSelectors = selectorsFromAbi(OBViewFacetABI as any[]);
    const settleSelectors = selectorsFromAbi(OBSettlementFacetABI as any[]);
    const vaultSelectors = selectorsFromAbi(
      ((OrderBookVaultAdminFacetArtifact as any)?.abi || []) as any[]
    );
    const lifecycleSelectors = selectorsFromAbi(
      (MarketLifecycleFacetABI as any[]) || []
    );
    const metaSelectors = selectorsFromAbi(
      ((MetaTradeFacetArtifact as any)?.abi || []) as any[]
    );

    cutArg = [
      [adminFacet!, 0, adminSelectors],
      [pricingFacet!, 0, pricingSelectors],
      [placementFacet!, 0, placementSelectors],
      [execFacet!, 0, execSelectors],
      [liqFacet!, 0, liqSelectors],
      [viewFacet!, 0, viewSelectors],
      [settleFacet!, 0, settleSelectors],
      [vaultFacet!, 0, vaultSelectors],
      [lifecycleFacet!, 0, lifecycleSelectors],
      [metaTradeFacet!, 0, metaSelectors],
    ];
  }

  // Ensure initFacet exists before proceeding
  if (!initFacet || !ethers.isAddress(initFacet)) {
    throw new Error('initFacet not available. Ensure /api/orderbook/cut and env are configured.');
  }

  const factoryAddress = factoryAddressEnv;
  console.log('[env-log] using factoryAddress (env)', factoryAddress);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  // Domain sanity logs
  try {
    const net = await provider.getNetwork();
    const chainIdRpcHex = await provider.send('eth_chainId', []);
    console.log('[domain-check] provider.chainId', net?.chainId?.toString?.());
    console.log('[domain-check] eth_chainId raw', chainIdRpcHex);
    console.log('[domain-check] using verifyingContract', factoryAddress);
  } catch (e: any) {
    console.warn('[domain-check] failed to read chainId', e?.message || String(e));
  }

  const creatorWallet = new ethers.Wallet(creatorPk, provider);
  const creator = await creatorWallet.getAddress();
  console.log('[signer-check] creatorWallet address:', creator);

  const symbol = String(args.symbol).toUpperCase();
  const metricUrl = String(args.metric);
  const startPrice = String(args.price);
  const startPrice6 = ethers.parseUnits(startPrice, 6);
  const dataSource = args.dataSource ? String(args.dataSource) : 'User Provided';
  const tags = args.tags
    ? String(args.tags)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 10)
    : [];
  const settlementTs = args.settlement
    ? Number(args.settlement)
    : Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  const deadline = args.deadline
    ? BigInt(String(args.deadline))
    : BigInt(Math.floor(Date.now() / 1000) + 15 * 60);

  // Force-enable gasless path
  const gaslessEnabled = true;

  // Domain: prefer on-chain helper to avoid name/version drift (this is the #1 cause of bad recovery)
  const chainId = (await provider.getNetwork()).chainId;
  let domainName = String(process.env.EIP712_FACTORY_DOMAIN_NAME || 'DexetraFactory');
  let domainVersion = String(process.env.EIP712_FACTORY_DOMAIN_VERSION || '1');
  let domainChainId = Number(chainId);
  let domainVerifyingContract = factoryAddress;
  try {
    const helperDomain = new ethers.Contract(
      factoryAddress,
      ['function eip712DomainInfo() view returns (string,string,uint256,address,bytes32)'],
      provider
    );
    const [dName, dVer, dChainId, dAddr] = await helperDomain.eip712DomainInfo();
    if (dName) domainName = String(dName);
    if (dVer) domainVersion = String(dVer);
    if (dChainId) domainChainId = Number(dChainId);
    if (dAddr && ethers.isAddress(String(dAddr))) domainVerifyingContract = String(dAddr);
    console.log('[domain-check] on-chain eip712DomainInfo', { name: domainName, version: domainVersion, chainId: domainChainId, verifyingContract: domainVerifyingContract });
  } catch (e: any) {
    console.warn('[domain-check] eip712DomainInfo unavailable, falling back to env defaults', e?.message || String(e));
  }
  const domain = {
    name: domainName,
    version: domainVersion,
    chainId: domainChainId,
    verifyingContract: domainVerifyingContract,
  } as const;
  try {
    console.log('[domain-check] TypedData domain hash', ethers.TypedDataEncoder.hashDomain(domain));
  } catch (e: any) {
    console.warn('[domain-check] failed to hash domain', e?.message || String(e));
  }

  // Hashing: prefer contract helpers to match on-chain exactly
  const helperAbi = [
    'function computeTagsHash(string[] tags) view returns (bytes32)',
    'function computeCutHash((address facetAddress,uint8 action,bytes4[] functionSelectors)[] cut) view returns (bytes32)',
    'function computeStructHash(string,string,uint256,uint256,string,bytes32,address,bytes32,address,address,uint256,uint256) view returns (bytes32)',
    'function eip712DomainInfo() view returns (string,string,uint256,address,bytes32)',
  ];
  const helper = new ethers.Contract(factoryAddress, helperAbi, provider);
  let tagsHash: string;
  let cutHash: string;
  try {
    tagsHash = await helper.computeTagsHash(tags);
  } catch {
    tagsHash = ethers.keccak256(
      ethers.solidityPacked(new Array(tags.length).fill('string'), tags)
    );
  }
  try {
    cutHash = await helper.computeCutHash(cutArg as any);
  } catch {
    const perCutHashes: string[] = [];
    for (const entry of cutArg) {
      const selectorsHash = ethers.keccak256(
        ethers.solidityPacked(
          new Array((entry?.[2] || []).length).fill('bytes4'),
          entry?.[2] || []
        )
      );
      const enc = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'uint8', 'bytes32'],
        [entry?.[0], entry?.[1], selectorsHash]
      );
      perCutHashes.push(ethers.keccak256(enc));
    }
    cutHash = ethers.keccak256(
      ethers.solidityPacked(new Array(perCutHashes.length).fill('bytes32'), perCutHashes)
    );
  }

  // Optional: log on-chain structHash and computed digest using on-chain domain sep
  try {
    const [dName, dVer, dChainId, dAddr, dSep] = await helper.eip712DomainInfo();
    const structHash = await helper.computeStructHash(
      symbol,
      metricUrl,
      settlementTs,
      startPrice6,
      dataSource,
      tagsHash,
      creator,
      cutHash,
      initFacet!,
      creator,
      0,
      deadline
    );
    const digest = ethers.keccak256(
      ethers.solidityPacked(
        ['string', 'bytes32', 'bytes32'],
        ['\x19\x01', dSep, structHash]
      )
    );
    console.log('[hash-check] tagsHash', tagsHash);
    console.log('[hash-check] cutHash', cutHash);
    console.log('[hash-check] domainSep (on-chain)', dSep);
    console.log('[hash-check] structHash (on-chain helper)', structHash);
    console.log('[hash-check] digest (using on-chain sep + structHash)', digest);
  } catch (e: any) {
    console.warn('[hash-check] skipped/failed', e?.message || String(e));
  }

  const factoryAbi =
    (FuturesMarketFactoryArtifact as any)?.abi ||
    (FuturesMarketFactoryArtifact as any) ||
    [];
  const metaAbi = [
    'function metaCreateNonce(address) view returns (uint256)',
  ];
  const mergedAbi = Array.isArray(factoryAbi)
    ? [...factoryAbi, ...metaAbi]
    : metaAbi;
  const factory = new ethers.Contract(factoryAddress!, mergedAbi, creatorWallet);
  const nonce = await factory.metaCreateNonce(creator);

  const submit = Boolean(args.submit);
  const diamondOwnerEnv =
    process.env.DIAMOND_OWNER_ADDRESS && ethers.isAddress(String(process.env.DIAMOND_OWNER_ADDRESS))
      ? String(process.env.DIAMOND_OWNER_ADDRESS)
      : null;
  // IMPORTANT: the relayer verifies diamondOwner as its own owner/admin address (ownerAddress).
  // If you sign with a different diamondOwner, the recovered address will not match.
  const diamondOwner = diamondOwnerEnv || creator;
  if (submit && !diamondOwnerEnv) {
    throw new Error('DIAMOND_OWNER_ADDRESS is required when --submit (must match relayer/admin ownerAddress used in verification).');
  }

  const types = {
    MetaCreate: [
      { name: 'marketSymbol', type: 'string' },
      { name: 'metricUrl', type: 'string' },
      { name: 'settlementDate', type: 'uint256' },
      { name: 'startPrice', type: 'uint256' },
      { name: 'dataSource', type: 'string' },
      { name: 'tagsHash', type: 'bytes32' },
      { name: 'diamondOwner', type: 'address' },
      { name: 'cutHash', type: 'bytes32' },
      { name: 'initFacet', type: 'address' },
      { name: 'creator', type: 'address' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  } as const;

  const message = {
    marketSymbol: symbol,
    metricUrl,
    settlementDate: settlementTs,
    startPrice: startPrice6.toString(),
    dataSource,
    tagsHash,
    diamondOwner,
    cutHash,
    initFacet: initFacet!,
    creator,
    nonce: nonce.toString(),
    deadline: deadline.toString(),
  };

  console.log('--- EIP712 DEBUG ---');
  console.log('domain', domain);
  console.log('message', message);
  console.log('diamondOwner === creator ?', String(message.diamondOwner).toLowerCase() === String(creator).toLowerCase());

  const signature = await creatorWallet.signTypedData(
    domain as any,
    types as any,
    message as any
  );
  // Local recovery sanity check before submitting to relayer
  try {
    const recoveredLocal = ethers.verifyTypedData(domain as any, types as any, message as any, signature);
    console.log('[signcheck] recoveredLocal', recoveredLocal);
    if (recoveredLocal.toLowerCase() !== creator.toLowerCase()) {
      throw new Error(`Local recovered ${recoveredLocal} does not match creator ${creator} (domain/message mismatch)`);
    }
  } catch (e: any) {
    throw new Error(`Local signature self-check failed: ${e?.message || String(e)}`);
  }

  console.log('--- Gasless Create Payload (sign-only unless --submit) ---');
  console.log('creator:', creator);
  console.log('factory:', factoryAddress);
  console.log('diamondOwner:', diamondOwner);
  console.log('chainId:', Number(chainId));
  console.log('nonce:', nonce.toString());
  console.log('deadline:', deadline.toString());
  console.log('tagsHash:', tagsHash);
  console.log('cutHash:', cutHash);
  console.log('signature:', signature);
  console.log('relayerBase (resolved):', (process.env.GASLESS_RELAYER_URL as string | undefined) || (process.env.APP_URL ? `${process.env.APP_URL}` : 'http://localhost:3000'));

  if (!submit) {
    console.log('\nRun with --submit to POST to the relayer.');
    return;
  }

  const relayerBase =
    (process.env.GASLESS_RELAYER_URL as string | undefined) ||
    (process.env.APP_URL ? `${process.env.APP_URL}` : 'http://localhost:3000');
  const relayerUrl = `${relayerBase.replace(/\/$/, '')}/api/markets/create`;

  const payload = {
    symbol,
    metricUrl,
    startPrice,
    startPrice6: startPrice6.toString(),
    dataSource,
    tags,
    creatorWalletAddress: creator,
    settlementDate: settlementTs,
    signature,
    nonce: message.nonce,
    deadline: message.deadline,
    cutArg,
    pipelineId: args.pipeline ? String(args.pipeline) : null,
  };

  console.log('\nSubmitting to relayer:', relayerUrl);
  const res = await fetch(relayerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  try {
    console.log('Relayer response status:', res.status);
    console.log('Relayer response body:', JSON.parse(text));
  } catch {
    console.log('Relayer response status:', res.status);
    console.log('Relayer response body (raw):', text);
  }

  if (!res.ok) {
    throw new Error(`Relayer returned HTTP ${res.status}`);
  }
}

main().catch((e) => {
  console.error('Error:', e?.message || e);
  process.exit(1);
});



