#!/usr/bin/env tsx
/**
 * Generate a fresh, dedicated ROLE_GRANTER wallet (offline only).
 *
 * This wallet's sole purpose is to sign CoreVault role grants
 * (ORDERBOOK_ROLE / SETTLEMENT_ROLE) during the configure phase of
 * market creation, so Lane B has its own signer and the parallel
 * lanes don't contend on a shared nonce manager.
 *
 * IMPORTANT — DO NOT REUSE OTHER WALLETS:
 *   - Do NOT reuse the deposit/withdrawal relayer (RELAYER_PRIVATE_KEY) —
 *     it is intentionally walled off from trade/admin signing per
 *     `_relayers_note` in relayers.generated.v2.json.
 *   - Do NOT reuse ADMIN_PRIVATE_KEY — that defeats the entire point
 *     (parallel lanes only work when the wallets differ).
 *   - Do NOT reuse any trade-pool relayer.
 *
 * What this script does:
 *   1. Generates a fresh random wallet (256 bits of entropy, in-memory only).
 *   2. Prints address + private key to stdout.
 *   3. Tells you exactly what to do next (fund + grant + env + redeploy).
 *
 * What this script does NOT do:
 *   - It does NOT write the private key to any file.
 *   - It does NOT send any RPC calls.
 *   - It does NOT update Vercel env vars.
 *   - It does NOT modify .env.local.
 *
 * Usage:
 *   npx tsx accessControlScripts/generate-role-granter-wallet.ts
 */
import { ethers } from 'ethers';

function divider(ch = '─', n = 78) {
  console.log(ch.repeat(n));
}

function main() {
  const w = ethers.Wallet.createRandom();

  divider('═');
  console.log('  ROLE_GRANTER wallet — freshly generated (offline)');
  divider('═');
  console.log();
  console.log(`  Address     : ${w.address}`);
  console.log(`  Private key : ${w.privateKey}`);
  console.log();
  divider();
  console.log('  Next steps  (do NOT skip any):');
  divider();
  console.log();
  console.log('  1. Save the private key in TWO places (and nowhere else):');
  console.log();
  console.log('       a) .env.local (local dev / scripts):');
  console.log('            ROLE_GRANTER_PRIVATE_KEY=<the_private_key_above>');
  console.log();
  console.log('       b) Vercel production env (and preview, if you use it):');
  console.log('            vercel env add ROLE_GRANTER_PRIVATE_KEY production');
  console.log('            # paste the private key when prompted');
  console.log();
  console.log('     The private key MUST NOT be committed to git.');
  console.log('     The key is only printed here once — copy it now.');
  console.log();
  console.log('  2. Fund the address with HYPE for gas. ~0.5 HYPE is plenty');
  console.log('     for hundreds of role grants (each grantRole ~0.001 HYPE).');
  console.log('     Send to:');
  console.log(`            ${w.address}`);
  console.log();
  console.log('  3. Grant DEFAULT_ADMIN_ROLE on CoreVault to the new address,');
  console.log('     signed by the current admin (ADMIN_PRIVATE_KEY):');
  console.log();
  console.log('       npx tsx accessControlScripts/grant-corevault-roles.ts \\');
  console.log(`         --to ${w.address} \\`);
  console.log('         --roles DEFAULT_ADMIN_ROLE');
  console.log();
  console.log('  4. Verify on-chain:');
  console.log('       The grant script prints "[final] DEFAULT_ADMIN_ROLE ✅".');
  console.log('       Re-run once if needed — grantRole is idempotent.');
  console.log();
  console.log('  5. Redeploy so Vercel picks up the new env var:');
  console.log('       vercel --prod');
  console.log();
  console.log('  6. Retry market creation. In the configure logs you should');
  console.log('     now see `parallel_signers` with diamondOwner != vaultAdmin');
  console.log('     and the lanes will run truly in parallel.');
  console.log();
  divider('═');
}

main();
