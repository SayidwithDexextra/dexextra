#!/usr/bin/env node
const { ethers } = require("hardhat");

async function main() {
  const orderBook = process.env.ORDERBOOK;
  if (!orderBook || !/^0x[a-fA-F0-9]{40}$/.test(orderBook)) {
    throw new Error('Set ORDERBOOK=0x... to inspect');
  }
  const provider = ethers.provider;
  const net = await provider.getNetwork();
  console.log('Network', { chainId: String(net.chainId) });
  const loupe = await ethers.getContractAt(
    ["function facetAddress(bytes4) view returns (address)"],
    orderBook
  );
  const sigs = {
    metaPlaceLimit: 'metaPlaceLimit((address,uint256,uint256,bool,uint256,uint256),bytes)',
    metaPlaceMarginLimit: 'metaPlaceMarginLimit((address,uint256,uint256,bool,uint256,uint256),bytes)',
    metaPlaceMarket: 'metaPlaceMarket((address,uint256,bool,uint256,uint256),bytes)',
    metaPlaceMarginMarket: 'metaPlaceMarginMarket((address,uint256,bool,uint256,uint256),bytes)',
    metaModifyOrder: 'metaModifyOrder((address,uint256,uint256,uint256,uint256,uint256),bytes)',
    metaCancelOrder: 'metaCancelOrder((address,uint256,uint256,uint256),bytes)',
  };
  for (const [name, sig] of Object.entries(sigs)) {
    const sel = ethers.id(sig).slice(0, 10);
    const addr = await loupe.facetAddress(sel);
    console.log(name, sel, addr);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


