#!/usr/bin/env tsx
/**
 * Update Alchemy webhook to monitor new SecureSpokeVaultV3
 * 
 * This script:
 * 1. Lists all existing webhooks
 * 2. Finds and deletes the old webhook monitoring old vault
 * 3. Creates a new ADDRESS_ACTIVITY webhook for the new vault
 * 
 * Usage:
 *   npx tsx scripts/update-alchemy-webhook.ts
 *   npx tsx scripts/update-alchemy-webhook.ts --dry-run
 */

import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const DRY_RUN = process.argv.includes("--dry-run");

const OLD_VAULT = "0x12684fE7d4b44c0Ef02AC2815742b46107E86091";
const NEW_VAULT = process.env.SPOKE_ARBITRUM_VAULT_ADDRESS || "0xE5A57E4A503eEF1DC320b7f7aAA1e768EEA093B9";

const ALCHEMY_AUTH_TOKEN = process.env.ALCHEMY_WEBHOOK_AUTH_TOKEN;
const ALCHEMY_API_BASE = "https://dashboard.alchemy.com/api";
const WEBHOOK_URL = "https://www.dexetera.xyz/api/webhooks/alchemy/deposits";

async function makeAlchemyRequest(endpoint: string, method: string, body?: any) {
  const url = `${ALCHEMY_API_BASE}${endpoint}`;
  const options: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Alchemy-Token": ALCHEMY_AUTH_TOKEN!,
    },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Alchemy API error: ${response.status} ${text}`);
  }
  return response.json();
}

async function main() {
  console.log("");
  console.log("╔══════════════════════════════════════════════════════════════════════════╗");
  console.log("║         UPDATE ALCHEMY WEBHOOK FOR V3 VAULT                               ║");
  console.log("╚══════════════════════════════════════════════════════════════════════════╝");
  console.log("");

  if (!ALCHEMY_AUTH_TOKEN) {
    console.log("❌ ALCHEMY_WEBHOOK_AUTH_TOKEN not set in environment");
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log("🔸 DRY RUN MODE - No changes will be made\n");
  }

  console.log("Configuration:");
  console.log("  Old Vault:", OLD_VAULT);
  console.log("  New Vault:", NEW_VAULT);
  console.log("  Webhook URL:", WEBHOOK_URL);
  console.log("");

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: List all webhooks
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("Step 1: Listing existing webhooks...");
  
  const listResponse = await makeAlchemyRequest("/team-webhooks", "GET");
  const webhooks = listResponse.data || [];
  
  console.log(`  Found ${webhooks.length} webhooks\n`);

  // Find webhooks related to our addresses
  const oldVaultLower = OLD_VAULT.toLowerCase();
  const arbWebhooks = webhooks.filter((w: any) => 
    w.network === "ARB_MAINNET" || 
    (w.addresses && w.addresses.some((a: string) => a.toLowerCase() === oldVaultLower))
  );

  console.log("  Arbitrum webhooks found:");
  for (const w of arbWebhooks) {
    console.log(`    - ${w.id}: ${w.webhook_type} (${w.addresses?.length || 0} addresses)`);
    if (w.addresses?.length <= 5) {
      console.log(`      Addresses: ${w.addresses?.join(", ")}`);
    }
  }
  console.log("");

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Find and delete old webhook
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("Step 2: Looking for webhook monitoring old vault...");
  
  const oldWebhook = webhooks.find((w: any) => 
    w.addresses?.some((a: string) => a.toLowerCase() === oldVaultLower)
  );

  if (oldWebhook) {
    console.log(`  Found old webhook: ${oldWebhook.id}`);
    console.log(`    Type: ${oldWebhook.webhook_type}`);
    console.log(`    Network: ${oldWebhook.network}`);
    console.log(`    Addresses: ${oldWebhook.addresses?.join(", ")}`);
    console.log("");

    if (!DRY_RUN) {
      console.log("  Deleting old webhook...");
      await makeAlchemyRequest("/delete-webhook", "DELETE", { webhook_id: oldWebhook.id });
      console.log("  ✅ Old webhook deleted");
    } else {
      console.log("  Would delete webhook:", oldWebhook.id);
    }
  } else {
    console.log("  No webhook found monitoring old vault address");
  }
  console.log("");

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Create new webhook for new vault
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("Step 3: Creating new webhook for new vault...");
  
  const payload = {
    network: "ARB_MAINNET",
    webhook_type: "ADDRESS_ACTIVITY",
    webhook_url: WEBHOOK_URL,
    addresses: [NEW_VAULT],
  };

  console.log("  Payload:", JSON.stringify(payload, null, 2));
  console.log("");

  if (!DRY_RUN) {
    const createResponse = await makeAlchemyRequest("/create-webhook", "POST", payload);
    console.log("  ✅ New webhook created!");
    console.log("    Webhook ID:", createResponse.data?.id);
    console.log("    Signing Key:", createResponse.data?.signing_key);
    console.log("");
    console.log("  ⚠️  IMPORTANT: Update ALCHEMY_WEBHOOK_SIGNING_KEY_DEPOSITS_ARBITRUM");
    console.log("     in .env.local and Vercel with the new signing key above!");
  } else {
    console.log("  Would create webhook with above payload");
  }
  console.log("");

  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("✅ ALCHEMY WEBHOOK UPDATE COMPLETE");
  console.log("═══════════════════════════════════════════════════════════════════════");
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
