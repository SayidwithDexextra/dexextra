#!/usr/bin/env tsx

/**
 * Create Webhook Configs Table Script
 * 
 * This script creates the missing webhook_configs table in the database.
 */

require("dotenv").config({ path: ".env.local" });
require("dotenv").config();

import { createClient } from '@supabase/supabase-js';

async function createWebhookTable() {
  try {
    console.log("🔧 Creating webhook_configs table...\n");

    // Initialize Supabase client
    const supabaseUrl = process.env.SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // Create the webhook_configs table
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS webhook_configs (
        id VARCHAR(20) PRIMARY KEY DEFAULT 'default',
        address_activity_webhook_id VARCHAR(50),
        mined_transaction_webhook_id VARCHAR(50),
        contracts JSONB NOT NULL DEFAULT '[]'::jsonb,
        network VARCHAR(20) NOT NULL,
        chain_id INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    const { error: createError } = await supabase.rpc('exec_sql', { sql: createTableSQL });
    
    if (createError) {
      // If the function doesn't exist, try direct SQL
      console.log("Trying direct SQL execution...");
      const { error: directError } = await supabase
        .from('webhook_configs')
        .select('*')
        .limit(1);
        
      if (directError && directError.code === '42P01') {
        console.error("❌ Table doesn't exist and couldn't be created. Please run this SQL in your Supabase SQL Editor:");
        console.log("\n" + createTableSQL);
        console.log("\n-- Create indexes");
        console.log("CREATE INDEX IF NOT EXISTS idx_webhook_configs_network ON webhook_configs(network);");
        console.log("CREATE INDEX IF NOT EXISTS idx_webhook_configs_chain_id ON webhook_configs(chain_id);");
        process.exit(1);
      }
    }

    console.log("✅ webhook_configs table created successfully");

    // Now try to fix the webhook configuration
    const { EventDatabase } = await import("../src/lib/eventDatabase");
    const database = new EventDatabase();

    const contracts = await database.getDeployedVAMMContracts();
    console.log(`📋 Found ${contracts.length} contracts to configure`);

    const webhookConfig = {
      addressActivityWebhookId: "wh_knzudxkfpvzbbj55",
      minedTransactionWebhookId: "",
      contracts: contracts.map((c) => ({
        address: c.address,
        name: c.name,
        type: c.type,
      })),
      createdAt: new Date(),
      network: process.env.DEFAULT_NETWORK || "polygon",
      chainId: process.env.CHAIN_ID || "137",
    };

    await database.storeWebhookConfig(webhookConfig);
    console.log("✅ Webhook configuration stored successfully");

    // Verify
    const storedConfig = await database.getWebhookConfig();
    if (storedConfig) {
      console.log("\n📋 Verification - Stored configuration:");
      console.log(`  - Address Activity Webhook: ${storedConfig.addressActivityWebhookId}`);
      console.log(`  - Contracts monitored: ${storedConfig.contracts.length}`);
    }

  } catch (error) {
    console.error("❌ Failed to create webhook table:", error);
    console.log("\nℹ️  Please manually run this SQL in your Supabase SQL Editor:");
    console.log(`
CREATE TABLE IF NOT EXISTS webhook_configs (
  id VARCHAR(20) PRIMARY KEY DEFAULT 'default',
  address_activity_webhook_id VARCHAR(50),
  mined_transaction_webhook_id VARCHAR(50),
  contracts JSONB NOT NULL DEFAULT '[]'::jsonb,
  network VARCHAR(20) NOT NULL,
  chain_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_configs_network ON webhook_configs(network);
CREATE INDEX IF NOT EXISTS idx_webhook_configs_chain_id ON webhook_configs(chain_id);
    `);
    process.exit(1);
  }
}

createWebhookTable().catch((error) => {
  console.error("❌ Unexpected error:", error);
  process.exit(1);
}); 