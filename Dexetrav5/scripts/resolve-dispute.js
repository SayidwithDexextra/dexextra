#!/usr/bin/env node

/**
 * resolve-dispute.js
 *
 * Instantly resolve a dispute via the SandboxOOv3 (test environments only).
 * This replaces the 48-96h DVM vote with an admin decision.
 *
 * Reads disputed markets from Supabase and displays them ordered from
 * most recently created to oldest.
 *
 * Interactive mode (default):
 *   npx hardhat run scripts/resolve-dispute.js --network sepolia
 *
 * Non-interactive mode (env vars):
 *   ASSERTION_ID=0x... CHALLENGER_WINS=true npx hardhat run scripts/resolve-dispute.js --network sepolia
 *
 * Env vars:
 *   SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY)
 *   SANDBOX_OOV3_ADDRESS (optional, falls back to deployment file)
 *   DISPUTE_RELAY_ADDRESS (optional, falls back to deployment file)
 */

const path = require("path");
const fs = require("fs");
const readline = require("readline");
const { ethers } = require("hardhat");

const SANDBOX_OOV3_ABI = [
  "function resolveAssertion(bytes32 assertionId, bool assertedTruthfully) external",
  "function getAssertion(bytes32 assertionId) external view returns (tuple(tuple(bool arbitrateViaEscalationManager, bool discardOracle, bool validateDisputers, address escalationManager) escalationManagerSettings, address asserter, uint64 assertionTime, bool settled, address currency, uint64 expirationTime, bool settlementResolution, bytes32 domainId, bytes32 identifier, uint256 bond, address callbackRecipient, address disputer))",
  "function owner() external view returns (address)",
];

const DISPUTE_RELAY_ABI = [
  "function getDispute(bytes32 assertionId) external view returns (tuple(address hlMarket, uint256 proposedPrice, uint256 challengedPrice, bool resolved, bool challengerWon, uint256 bondAmount, uint256 timestamp))",
  "function getDisputeCount() external view returns (uint256)",
  "function getAssertionIdAt(uint256 index) external view returns (bytes32)",
];

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function fetchDisputedMarketsFromSupabase() {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    return null;
  }
  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from("markets")
    .select("id, symbol, market_identifier, market_address, proposed_settlement_value, alternative_settlement_value, settlement_disputed, market_config, created_at")
    .eq("settlement_disputed", true)
    .not("market_address", "is", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("  Supabase error:", error.message);
    return null;
  }
  return data || [];
}

function getContractAddresses(networkName) {
  let SANDBOX_OOV3 = process.env.SANDBOX_OOV3_ADDRESS;
  let DISPUTE_RELAY = process.env.DISPUTE_RELAY_ADDRESS;
  let decimals = 18;
  let symbol = "WETH";

  if (!SANDBOX_OOV3 || !DISPUTE_RELAY) {
    const deploymentPath = path.join(
      __dirname,
      `../deployments/${networkName}-sandbox-deployment.json`
    );
    if (fs.existsSync(deploymentPath)) {
      const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
      SANDBOX_OOV3 = SANDBOX_OOV3 || deployment.contracts?.SANDBOX_OOV3;
      DISPUTE_RELAY = DISPUTE_RELAY || deployment.contracts?.DISPUTE_RELAY;
      decimals = deployment.bondTokenInfo?.decimals || 18;
      symbol = deployment.bondTokenInfo?.symbol || "TOKEN";
    }
  }

  return { SANDBOX_OOV3, DISPUTE_RELAY, decimals, symbol };
}

async function main() {
  const networkName = process.env.HARDHAT_NETWORK || "unknown";
  const [signer] = await ethers.getSigners();

  console.log("\n>>> Resolve Dispute via SandboxOOv3");
  console.log("=".repeat(60));
  console.log(`Network:  ${networkName}`);
  console.log(`Signer:   ${signer.address}`);

  const { SANDBOX_OOV3, DISPUTE_RELAY, decimals, symbol } = getContractAddresses(networkName);

  if (!SANDBOX_OOV3 || !DISPUTE_RELAY) {
    console.error("Missing SANDBOX_OOV3_ADDRESS or DISPUTE_RELAY_ADDRESS.");
    console.error("Set env vars or run deploy-sandbox-oov3.js first.");
    process.exit(1);
  }

  console.log(`Sandbox:  ${SANDBOX_OOV3}`);
  console.log(`Relay:    ${DISPUTE_RELAY}`);

  const sandbox = new ethers.Contract(SANDBOX_OOV3, SANDBOX_OOV3_ABI, signer);
  const relay = new ethers.Contract(DISPUTE_RELAY, DISPUTE_RELAY_ABI, signer);

  let assertionId = process.env.ASSERTION_ID || "";
  let challengerWins;

  const isInteractive = !assertionId;

  if (isInteractive) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    console.log("\n  Fetching disputed markets from Supabase...");
    const supabaseDisputes = await fetchDisputedMarketsFromSupabase();

    if (supabaseDisputes && supabaseDisputes.length > 0) {
      console.log(`\n  Disputed markets (newest first): ${supabaseDisputes.length}`);
      console.log("  " + "-".repeat(80));

      const disputeList = [];
      for (let i = 0; i < supabaseDisputes.length; i++) {
        const m = supabaseDisputes[i];
        const config = m.market_config || {};
        const umaAssertionId = config.uma_assertion_id;
        const umaResolved = config.uma_resolved || false;

        const proposed = m.proposed_settlement_value ? `$${Number(m.proposed_settlement_value).toFixed(2)}` : "N/A";
        const challenged = m.alternative_settlement_value ? `$${Number(m.alternative_settlement_value).toFixed(2)}` : "N/A";
        const createdAt = new Date(m.created_at).toLocaleDateString();

        let status = "PENDING";
        if (umaResolved) {
          status = config.uma_challenger_won ? "UMA: challenger won" : "UMA: proposer won";
        } else if (umaAssertionId) {
          status = "ESCALATED";
        }

        const shortId = umaAssertionId ? `${umaAssertionId.slice(0, 10)}...${umaAssertionId.slice(-6)}` : "(not escalated)";

        console.log(`  [${i}] ${m.symbol.padEnd(12)} ${proposed.padEnd(10)} vs ${challenged.padEnd(10)}  ${shortId}  ${status}  (${createdAt})`);

        if (umaAssertionId && !umaResolved) {
          disputeList.push({ index: i, assertionId: umaAssertionId, market: m });
        }
      }
      console.log("");

      if (disputeList.length === 0) {
        console.log("  No unresolved escalated disputes found.\n");
        rl.close();
        process.exit(0);
      }

      const input = (await ask(rl, "  Select dispute (index or full assertion ID): ")).trim();

      if (/^\d+$/.test(input)) {
        const idx = parseInt(input, 10);
        const found = disputeList.find((d) => d.index === idx);
        if (!found) {
          console.error(`  Index ${idx} not found or not an escalated dispute.`);
          rl.close();
          process.exit(1);
        }
        assertionId = found.assertionId;
        console.log(`  Selected: ${found.market.symbol} -> ${assertionId}`);
      } else if (input.startsWith("0x") && input.length === 66) {
        assertionId = input;
      } else {
        console.error("  Invalid input. Enter an index number or a full 0x assertion ID.");
        rl.close();
        process.exit(1);
      }
    } else {
      console.log("  No disputes in Supabase. Falling back to on-chain relay...\n");

      const count = await relay.getDisputeCount();
      const total = Number(count);

      if (total > 0) {
        console.log(`  Disputes on relay (on-chain): ${total}`);
        console.log("  " + "-".repeat(56));

        const start = Math.max(0, total - 10);
        for (let i = total - 1; i >= start; i--) {
          const id = await relay.getAssertionIdAt(i);
          const d = await relay.getDispute(id);
          const status = d.resolved
            ? d.challengerWon ? "RESOLVED (challenger won)" : "RESOLVED (proposer won)"
            : "PENDING";
          const proposed = `$${(Number(d.proposedPrice) / 1e6).toFixed(2)}`;
          const challenged = `$${(Number(d.challengedPrice) / 1e6).toFixed(2)}`;
          console.log(`  [${i}] ${id.slice(0, 10)}...${id.slice(-8)}  ${proposed} vs ${challenged}  ${status}`);
        }
        console.log("");

        assertionId = (await ask(rl, "  Assertion ID (paste full 0x... or index number): ")).trim();

        if (/^\d+$/.test(assertionId)) {
          const idx = parseInt(assertionId, 10);
          if (idx < 0 || idx >= total) {
            console.error(`  Index ${idx} out of range (0-${total - 1})`);
            rl.close();
            process.exit(1);
          }
          assertionId = await relay.getAssertionIdAt(idx);
          console.log(`  Resolved index ${idx} -> ${assertionId}`);
        }
      } else {
        console.log("  No disputes found.\n");
        rl.close();
        process.exit(0);
      }
    }

    if (!assertionId.startsWith("0x") || assertionId.length !== 66) {
      console.error("  Invalid assertion ID. Must be a 0x-prefixed 32-byte hex string.");
      rl.close();
      process.exit(1);
    }

    const winnerChoice = (await ask(rl, "  Who wins? [c]hallenger / [p]roposer (default: c): ")).trim().toLowerCase();
    challengerWins = winnerChoice !== "p" && winnerChoice !== "proposer";

    rl.close();
  } else {
    challengerWins = (process.env.CHALLENGER_WINS || "true").toLowerCase() === "true";
  }

  const assertedTruthfully = !challengerWins;

  console.log(`\n  Assertion ID:    ${assertionId}`);
  console.log(`  Challenger wins: ${challengerWins}`);

  // Pre-check
  console.log("\n  Checking assertion state...");
  const assertion = await sandbox.getAssertion(assertionId);
  if (assertion.asserter === ethers.ZeroAddress) {
    console.error("  Assertion not found. It may belong to a different OOv3 instance.");
    process.exit(1);
  }
  if (assertion.settled) {
    console.log("  Assertion is already settled.");
    const dispute = await relay.getDispute(assertionId);
    console.log(`    resolved:      ${dispute.resolved}`);
    console.log(`    challengerWon: ${dispute.challengerWon}`);
    process.exit(0);
  }

  console.log(`    asserter:  ${assertion.asserter}`);
  console.log(`    disputer:  ${assertion.disputer}`);
  console.log(`    bond:      ${ethers.formatUnits(assertion.bond, decimals)} ${symbol}`);

  // Resolve
  console.log(`\n  Resolving (assertedTruthfully=${assertedTruthfully})...`);
  const tx = await sandbox.resolveAssertion(assertionId, assertedTruthfully);
  const receipt = await tx.wait();
  console.log(`    tx: ${receipt.hash}`);

  // Verify
  const dispute = await relay.getDispute(assertionId);
  console.log("\n  DisputeRelay result:");
  console.log(`    hlMarket:        ${dispute.hlMarket}`);
  console.log(`    proposedPrice:   $${(Number(dispute.proposedPrice) / 1e6).toFixed(2)}`);
  console.log(`    challengedPrice: $${(Number(dispute.challengedPrice) / 1e6).toFixed(2)}`);
  console.log(`    resolved:        ${dispute.resolved}`);
  console.log(`    challengerWon:   ${dispute.challengerWon}`);
  console.log(`    bondAmount:      ${ethers.formatUnits(dispute.bondAmount, decimals)} ${symbol}`);

  const winner = dispute.challengerWon ? "CHALLENGER" : "PROPOSER";
  const winningPrice = dispute.challengerWon ? dispute.challengedPrice : dispute.proposedPrice;
  console.log(`\n  Result: ${winner} wins. Winning price: $${(Number(winningPrice) / 1e6).toFixed(2)}`);

  // Call the universal UMA resolution webhook
  await callUmaResolutionWebhook(assertionId, dispute.hlMarket, dispute.challengerWon, winningPrice);

  console.log("\n  Done.\n");
}

async function callUmaResolutionWebhook(assertionId, hlMarket, challengerWon, winningPrice) {
  const appUrl = process.env.APP_URL || process.env.VERCEL_URL;

  if (!appUrl) {
    console.log("\n  APP_URL not set — cannot call webhook.");
    console.log("  Set APP_URL to enable automatic settlement via webhook.");
    return;
  }

  const baseUrl = appUrl.startsWith("http") ? appUrl : `https://${appUrl}`;
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/api/webhooks/uma-resolution`;

  console.log("\n  Calling UMA resolution webhook...");

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assertionId,
        hlMarket,
        challengerWon,
        winningPrice: winningPrice.toString(),
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error(`  Webhook failed (${res.status}):`, data.error || data);
      return;
    }

    if (data.ok) {
      const result = data.results?.[0] || {};
      console.log(`  Webhook success: ${result.symbol || "market"}`);
      if (result.settled) {
        console.log(`  Settlement finalized!`);
      } else {
        console.log(`  Settlement pending (will finalize automatically)`);
      }
    } else {
      console.log(`  Webhook response: ${data.error || "unknown error"}`);
    }
  } catch (err) {
    console.error("  Webhook error:", err.message || err);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\nResolve failed:", e.message || e);
    process.exit(1);
  });
