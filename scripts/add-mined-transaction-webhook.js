#!/usr/bin/env node

/**
 * Add MINED_TRANSACTION webhook for capturing smart contract event logs
 */

require("dotenv").config({ path: ".env.local" });
require("dotenv").config();

const https = require("https");

function makeAlchemyApiRequest(endpoint, method, payload) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(payload);

    const options = {
      hostname: "dashboard.alchemy.com",
      port: 443,
      path: `/api/create-webhook`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Alchemy-Token": process.env.ALCHEMY_WEBHOOK_AUTH_TOKEN,
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        try {
          const result = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(result);
          } else {
            reject(new Error(`API Error: ${res.statusCode} - ${data}`));
          }
        } catch (error) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });

    req.on("error", (error) => {
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

async function addMinedTransactionWebhook() {
  try {
    console.log(
      "🔗 Adding MINED_TRANSACTION webhook for smart contract events..."
    );

    // Check required environment variables
    if (!process.env.ALCHEMY_WEBHOOK_AUTH_TOKEN) {
      throw new Error("ALCHEMY_WEBHOOK_AUTH_TOKEN is required");
    }

    if (!process.env.APP_URL) {
      throw new Error("APP_URL is required");
    }

    // Your VAMM contracts
    const contractAddresses = [
      "0xc6220f6bdce01e85088b7e7b64e9425b86e3ab04", // GOLDV4 vAMM (your main contract)
      "0xdab242cd90b95a4ed68644347b80e0b3cead48c0", // GoldV1 vAMM
      "0x4eae52fe16bfd10bda0f6d7d354ec4a23188fce8", // GOLDV2 vAMM
      "0x49325a53dfbf0ce08e6e2d12653533c6fc3f9673", // GOLDV3 vAMM
      "0x3f0cf8a2b6a30dacd0cdcbb3cf0080753139b50e", // vAMM-GOLDV3
    ];

    console.log("📋 Contracts to monitor:", contractAddresses);

    // Create MINED_TRANSACTION webhook payload
    const payload = {
      network: "MATIC_MAINNET",
      webhook_type: "MINED_TRANSACTION",
      webhook_url: `${process.env.APP_URL}/api/webhooks/alchemy`,
      addresses: contractAddresses,
    };

    console.log(
      "📡 Creating webhook with payload:",
      JSON.stringify(payload, null, 2)
    );

    const response = await makeAlchemyApiRequest(
      "/create-webhook",
      "POST",
      payload
    );

    console.log("✅ MINED_TRANSACTION webhook created successfully!");
    console.log(`📡 Webhook ID: ${response.data.id}`);
    console.log("");
    console.log("🎯 This webhook will now capture:");
    console.log("  - PositionOpened events with full log data");
    console.log("  - PositionClosed events with full log data");
    console.log("  - All other smart contract events");
    console.log("  - Complete transaction logs with topics and data");
    console.log("");
    console.log(
      "🧪 Test by calling your emit function again and check the webhook payload!"
    );
    console.log('   You should now see a "log" field with topics and data.');
  } catch (error) {
    console.error("❌ Failed to add MINED_TRANSACTION webhook:", error.message);
    console.log("");
    console.log("🔧 Troubleshooting:");
    console.log(
      "1. Make sure ALCHEMY_WEBHOOK_AUTH_TOKEN is set in your .env.local"
    );
    console.log("2. Make sure APP_URL is set to your deployed app URL");
    console.log("3. Check that your Alchemy account has webhook permissions");
    process.exit(1);
  }
}

// Run the script
addMinedTransactionWebhook()
  .then(() => {
    console.log("✅ Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Script failed:", error);
    process.exit(1);
  });
