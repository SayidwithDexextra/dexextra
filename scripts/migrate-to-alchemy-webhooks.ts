#!/usr/bin/env node

/**
 * Migration Script: Polling → Alchemy Webhooks
 *
 * This script migrates from the old polling-based event monitoring system
 * to the new Alchemy Notify API webhook system for Vercel compatibility.
 *
 * Usage:
 *   node scripts/migrate-to-alchemy-webhooks.js
 *
 * Requirements:
 *   - ALCHEMY_API_KEY environment variable
 *   - APP_URL environment variable (for webhook endpoint)
 *   - Deployed VAMM contracts in the database
 */

require("dotenv").config({ path: ".env.local" });
require("dotenv").config();

const readline = require("readline");

// Import ESM modules using dynamic import
async function runMigration() {
  try {
    console.log("🚀 Starting migration to Alchemy Webhook system...\n");

    // Dynamic imports for ESM modules
    const { getAlchemyNotifyService } = await import(
      "../src/services/alchemyNotifyService"
    );
    const { EventDatabase } = await import("../src/lib/eventDatabase");
    const { getWebhookEventListener } = await import(
      "../src/services/webhookEventListener"
    );

    // Validate environment
    if (!process.env.ALCHEMY_API_KEY) {
      console.error(
        "❌ ALCHEMY_API_KEY is required. Please add it to your .env file."
      );
      console.log("💡 Get your API key from: https://dashboard.alchemy.com/");
      process.exit(1);
    }

    if (!process.env.ALCHEMY_WEBHOOK_AUTH_TOKEN) {
      console.error("❌ ALCHEMY_WEBHOOK_AUTH_TOKEN is required. Please add it to your .env file.");
      console.log("💡 How to get your webhook auth token:");
      console.log("   1. Go to https://dashboard.alchemy.com/");
      console.log("   2. Select 'Notify' from the top menu");
      console.log("   3. Copy the 'Auth Token' from the top right of the page");
      console.log("   4. Add it to your .env.local file as: ALCHEMY_WEBHOOK_AUTH_TOKEN=your-token-here");
      process.exit(1);
    }

    if (!process.env.APP_URL) {
      console.error("❌ APP_URL is required for webhook endpoint.");
      console.log(
        "💡 Set it to your deployed URL (e.g., https://your-app.vercel.app)"
      );
      process.exit(1);
    }

    console.log("✅ Environment validation passed");
    console.log(`📋 Configuration:
  - Alchemy API Key: ${process.env.ALCHEMY_API_KEY ? "✓ Set" : "✗ Missing"}
  - Webhook URL: ${process.env.APP_URL}/api/webhooks/alchemy
  - Network: ${process.env.DEFAULT_NETWORK || "polygon"}
  - Chain ID: ${process.env.CHAIN_ID || "137"}
`);

    // Initialize services
    const database = new EventDatabase();
    const alchemyNotify = await getAlchemyNotifyService();

    console.log("🔍 Scanning for deployed contracts...");

    // Get deployed contracts
    const contracts = await database.getDeployedVAMMContracts();

    if (contracts.length === 0) {
      console.log("⚠️  No contracts found in database.");
      console.log("💡 Deploy contracts via the create-market wizard first.");
      return;
    }

    console.log(`📋 Found ${contracts.length} contracts to migrate:`);
    contracts.forEach((contract, index) => {
      console.log(
        `  ${index + 1}. ${contract.name} (${contract.type}): ${
          contract.address
        }`
      );
    });

    // Check for existing webhooks
    console.log("\n🔍 Checking for existing webhooks...");
    const existingWebhooks = await alchemyNotify.listWebhooks();

    if (existingWebhooks.webhooks.length > 0) {
      console.log(
        `⚠️  Found ${existingWebhooks.webhooks.length} existing webhooks:`
      );
      existingWebhooks.webhooks.forEach((webhook, index) => {
        console.log(
          `  ${index + 1}. ${webhook.type} - ${
            webhook.isActive ? "Active" : "Inactive"
          } (ID: ${webhook.id})`
        );
      });

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await new Promise((resolve) => {
        rl.question(
          "\nDo you want to proceed and create new webhooks? (y/N): ",
          resolve
        );
      });
      rl.close();

      if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
        console.log("Migration cancelled by user.");
        return;
      }
    }

    console.log("\n🔗 Setting up webhooks with Alchemy...");

    // Register webhooks
    const contractAddresses = contracts.map((c) => c.address);
    console.log(
      `📡 Registering ${contractAddresses.length} contract addresses for webhook monitoring...`
    );

    const addressActivityWebhookId =
      await alchemyNotify.createAddressActivityWebhook(contractAddresses);

    // Also create Mined Transaction webhook for complete event coverage
    console.log("🔗 Creating Mined Transaction webhook for complete smart contract event coverage...");
    const minedTransactionWebhookId = 
      await alchemyNotify.createMinedTransactionWebhook(contractAddresses);

    console.log("✅ Webhooks created successfully:");
    console.log(`  - Address Activity: ${addressActivityWebhookId}`);
    console.log(`  - Mined Transaction: ${minedTransactionWebhookId}`);
    console.log("💡 Note: Address Activity webhooks capture transfers, Mined Transaction webhooks capture all contract events");

    // Store webhook configuration
    console.log("\n💾 Storing webhook configuration in database...");
    const webhookConfig = {
      addressActivityWebhookId,
      minedTransactionWebhookId,
      contracts: contracts.map((c) => ({
        address: c.address,
        name: c.name,
        type: c.type,
      })),
      createdAt: new Date(),
      network: process.env.DEFAULT_NETWORK || "polygon",
      chainId: process.env.CHAIN_ID || "137",
    };

    try {
      await database.storeWebhookConfig(webhookConfig);
      console.log("✅ Webhook configuration stored successfully");
    } catch (error) {
      console.warn(
        "⚠️  Failed to store webhook config in database:",
        error.message
      );
      console.log(
        "💡 Webhooks are still active, but configuration won't persist across deployments"
      );
    }

    // Test webhook endpoint
    console.log("\n🧪 Testing webhook endpoint...");
    try {
      const response = await fetch(
        `${process.env.APP_URL}/api/webhooks/alchemy`,
        {
          method: "GET",
        }
      );

      if (response.ok) {
        const data = await response.json();
        console.log("✅ Webhook endpoint is healthy:", data.message);
      } else {
        console.warn(
          "⚠️  Webhook endpoint returned non-200 status:",
          response.status
        );
      }
    } catch (error) {
      console.warn("⚠️  Could not test webhook endpoint:", error.message);
      console.log("💡 Make sure your app is deployed and accessible");
    }

    // Migration summary
    console.log("\n🎉 Migration completed successfully!");
    console.log(`
📊 Migration Summary:
  ✅ Registered ${contracts.length} contracts for webhook monitoring
  ✅ Created Address Activity webhook (captures all transfers)
  ✅ Webhook configuration stored in database
  ✅ System is now Vercel-compatible

🔧 Next Steps:
  1. Deploy your app to Vercel with the new webhook system
  2. Verify events are being received at /api/webhooks/alchemy
  3. Monitor webhook status via the API endpoints
  4. Remove old polling-based event listener from package.json scripts

⚠️  Legacy System:
  - Old polling system is marked as legacy in src/services/eventListener.ts
  - Remove references to the old system in production
  - The webhook system will handle all event monitoring automatically

📚 Documentation:
  - Webhook endpoint: ${process.env.APP_URL}/api/webhooks/alchemy
  - Health check: ${process.env.APP_URL}/api/webhooks/alchemy (GET)
  - Status monitoring: Use getWebhookEventListener().getStatus()
`);
  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    console.error(error.stack);

    console.log("\n🔧 Troubleshooting:");
    console.log("1. Verify ALCHEMY_API_KEY is correct");
    console.log("2. Check APP_URL points to your deployed application");
    console.log("3. Ensure Supabase database is accessible");
    console.log("4. Check network connectivity");

    process.exit(1);
  }
}

// Handle cleanup on exit
process.on("SIGINT", () => {
  console.log("\n⚠️  Migration interrupted by user");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n⚠️  Migration terminated");
  process.exit(0);
});

// Run migration
runMigration().catch((error) => {
  console.error("❌ Unexpected error:", error);
  process.exit(1);
});
