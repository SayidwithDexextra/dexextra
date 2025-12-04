#!/usr/bin/env node

const { ethers, artifacts } = require("hardhat");

function sep() { console.log('────────────────────────────────────────────────────────────'); }
function ok(msg, extra) { console.log(`✅ ${msg}`, extra ?? ''); }
function info(msg, extra) { console.log(`ℹ️  ${msg}`, extra ?? ''); }
function err(msg, extra) { console.error(`❌ ${msg}`, extra ?? ''); }

function renderType(t) {
  const type = t.type || '';
  const arraySuffixMatch = type.match(/(\[.*\])$/);
  const arraySuffix = arraySuffixMatch ? arraySuffixMatch[1] : '';
  const base = type.replace(/(\[.*\])$/, '');
  if (base === 'tuple') {
    const comps = (t.components || []).map(renderType).join(',');
    return `(${comps})${arraySuffix}`;
  }
  return `${base}${arraySuffix}`;
}

async function selectorsFor(contractName, nameFilterFn) {
  const artifact = await artifacts.readArtifact(contractName);
  const fns = (artifact.abi || []).filter((e) => e && e.type === "function");
  const selected = fns.filter((f) => nameFilterFn(f.name));
  return selected.map((f) => {
    const inputsSig = (f.inputs || []).map(renderType).join(',');
    const sig = `${f.name}(${inputsSig})`;
    const selector = ethers.id(sig).slice(0, 10);
    return { name: f.name, signature: sig, selector };
  });
}

function isAddress(v) { return typeof v === 'string' && /^0x[a-fA-F0-9]{40}$/.test(v); }

async function main() {
  const net = await ethers.provider.getNetwork();
  const networkName = process.env.HARDHAT_NETWORK || String(net.chainId);
  sep(); console.log('🔎 Verify Diamond Selectors'); sep();
  info('Network', { name: networkName, chainId: String(net.chainId) });
  const orderBook = process.env.ORDERBOOK;
  if (!isAddress(orderBook)) throw new Error('Set ORDERBOOK to a valid diamond address.');
  info('Target Diamond', orderBook);

  const loupe = await ethers.getContractAt(
    ["function facetAddress(bytes4) view returns (address)"],
    orderBook
  );

  // MetaTradeFacet: check meta* and session* functions plus session admin
  const metaTargets = await selectorsFor("MetaTradeFacet", (n) => n.startsWith('meta') || n.startsWith('session') || n === 'createSession' || n === 'revokeSession' || n === 'sessions');
  // OBOrderPlacementFacet: check "...By" methods
  const obTargets = await selectorsFor("OBOrderPlacementFacet", (n) =>
    ['placeLimitOrderBy','placeMarginLimitOrderBy','placeMarketOrderBy','placeMarginMarketOrderBy','modifyOrderBy','cancelOrderBy'].includes(n)
  );

  sep(); console.log('MetaTradeFacet selectors'); sep();
  let metaMissing = 0;
  for (const t of metaTargets) {
    let addr = ethers.ZeroAddress;
    try { addr = await loupe.facetAddress(t.selector); } catch {}
    const present = addr && addr !== ethers.ZeroAddress;
    console.log(`${present ? '✅' : '❌'} ${t.name.padEnd(32)} ${t.selector} => ${addr}`);
    if (!present) metaMissing++;
  }

  sep(); console.log('OBOrderPlacementFacet "...By" selectors'); sep();
  let obMissing = 0;
  for (const t of obTargets) {
    let addr = ethers.ZeroAddress;
    try { addr = await loupe.facetAddress(t.selector); } catch {}
    const present = addr && addr !== ethers.ZeroAddress;
    console.log(`${present ? '✅' : '❌'} ${t.name.padEnd(32)} ${t.selector} => ${addr}`);
    if (!present) obMissing++;
  }

  sep();
  if (metaMissing === 0 && obMissing === 0) {
    ok('All target selectors are present');
  } else {
    err('Missing selectors', { metaMissing, obMissing });
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});









