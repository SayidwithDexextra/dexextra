#!/usr/bin/env node
require("dotenv").config({ path: ".env.local" });
require("dotenv").config({ path: ".env" });

const { createClient } = require("@supabase/supabase-js");

async function main() {
  const newRouter = process.argv[2] || process.env.NEW_ORDER_ROUTER_ADDRESS;
  if (!newRouter) {
    console.error(
      "Usage: node scripts/update-router-address.js 0xNewRouterAddress"
    );
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing Supabase env (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)"
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Fetch current markets to report changes (unified markets table)
  const { data: markets, error: fetchErr } = await supabase
    .from("markets")
    .select("id, market_identifier, market_config");
  if (fetchErr) throw fetchErr;

  console.log("Found markets:", markets?.length || 0);
  for (const m of markets || []) {
    const current =
      (m.market_config && m.market_config.order_router_address) || null;
    if (
      current?.toLowerCase &&
      current.toLowerCase() === newRouter.toLowerCase()
    ) {
      console.log(`- ${m.market_identifier}: already up-to-date (${current})`);
      continue;
    }
    const { error: updErr } = await supabase
      .from("markets")
      .update({
        market_config: {
          ...(m.market_config || {}),
          order_router_address: newRouter,
        },
      })
      .eq("id", m.id);
    if (updErr) {
      console.error(
        `❌ Failed updating ${m.market_identifier}:`,
        updErr.message
      );
    } else {
      console.log(
        `✅ Updated ${m.market_identifier}: ${
          current || "[none]"
        } -> ${newRouter}`
      );
    }
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
