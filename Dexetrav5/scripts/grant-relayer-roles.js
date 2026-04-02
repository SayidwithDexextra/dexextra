#!/usr/bin/env node
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

try { require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") }); } catch (_) {}
try { require("dotenv").config(); } catch (_) {}

async function main() {
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const [admin] = await ethers.getSigners();
  console.log(`\nAdmin: ${admin.address}  (chainId ${chainId})`);

  const deployFile = path.join(__dirname, `../deployments/upgraded-vault-${chainId}.json`);
  if (!fs.existsSync(deployFile)) throw new Error(`No deployment file: ${deployFile}`);
  const deployment = JSON.parse(fs.readFileSync(deployFile, "utf8"));
  const vaultAddr = deployment.contracts.CoreVaultProxy;
  console.log(`Vault:  ${vaultAddr}\n`);

  const vault = await ethers.getContractAt("CoreVault", vaultAddr);
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;

  const hasAdmin = await vault.hasRole(DEFAULT_ADMIN_ROLE, admin.address);
  if (!hasAdmin) throw new Error(`${admin.address} does not have DEFAULT_ADMIN_ROLE`);

  const relayersFile = path.resolve(__dirname, "../../relayers.generated.json");
  const relayers = JSON.parse(fs.readFileSync(relayersFile, "utf8"));
  console.log(`Granting DEFAULT_ADMIN_ROLE to ${relayers.length} relayers...\n`);

  let granted = 0;
  for (const r of relayers) {
    const already = await vault.hasRole(DEFAULT_ADMIN_ROLE, r.address);
    if (already) {
      console.log(`  ${r.address} — already has role`);
      granted++;
      continue;
    }
    try {
      const tx = await vault.grantRole(DEFAULT_ADMIN_ROLE, r.address);
      await tx.wait();
      console.log(`  ${r.address} — granted ✓`);
      granted++;
    } catch (err) {
      console.log(`  ${r.address} — FAILED: ${err.message?.slice(0, 80)}`);
    }
  }
  console.log(`\n✅ ${granted}/${relayers.length} relayers have DEFAULT_ADMIN_ROLE`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
