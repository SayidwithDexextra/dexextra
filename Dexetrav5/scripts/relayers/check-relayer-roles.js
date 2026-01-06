#!/usr/bin/env node

/**
 * Check relayer EOAs (from RELAYER_PRIVATE_KEYS_JSON) for required on-chain roles.
 *
 * Prints: relayer address + "X/Y roles" plus per-role pass/fail.
 *
 * By default, checks the roles needed to relay deposits end-to-end:
 * - Spoke outbox: DEPOSIT_SENDER_ROLE
 * - Hub inbox:    BRIDGE_ENDPOINT_ROLE
 *
 * Extra checks (mode=all):
 * - Spoke inbox:  BRIDGE_ENDPOINT_ROLE (withdraw delivery)
 * - CollateralHub: WITHDRAW_REQUESTER_ROLE (optional withdraw initiation)
 * - System wiring (not per-relayer, but required for deposits/withdraws to work):
 *   - CollateralHub.BRIDGE_INBOX_ROLE -> HUB_INBOX_ADDRESS
 *   - CoreVault.EXTERNAL_CREDITOR_ROLE -> COLLATERAL_HUB_ADDRESS
 *   - SpokeVault.BRIDGE_INBOX_ROLE -> SPOKE_INBOX_ADDRESS
 *
 * Trading prerequisites (always checked as "system readiness"):
 * - OrderBook diamond contains required selectors for:
 *   - meta trades (metaPlace*, metaCancel*, metaModify*)
 *   - session trades (sessionPlace*, sessionCancel*, sessionModify*)
 * - OrderBook has correct sessionRegistry (if readable) and registry allows the orderbook
 * - Relayer keys include at least 2 entries (throughput prerequisite)
 *
 * NOTE:
 * - Gasless trading is signature-authorized; relayer EOAs usually do not need roles.
 * - Session trading requires tx sender == session.relayer; that is per-session, not a role.
 *
 * Configure which orderbooks to inspect via env:
 * - RELAYER_CHECK_ORDERBOOKS="0x...,0x..." (comma-separated)
 * - falls back to DEFAULT_ORDERBOOK_ADDRESS / NEXT_PUBLIC_DEFAULT_ORDERBOOK_ADDRESS
 *
 * Usage:
 *   node Dexetrav5/scripts/relayers/check-relayer-roles.js
 *   node Dexetrav5/scripts/relayers/check-relayer-roles.js --mode deposits
 *   node Dexetrav5/scripts/relayers/check-relayer-roles.js --mode all --spoke arbitrum
 *
 * Env requirements:
 * - RELAYER_PRIVATE_KEYS_JSON='["0x...","0x..."]'
 *
 * Hub (required for deposits):
 * - RPC_URL (or RPC_URL_HYPEREVM)
 * - HUB_INBOX_ADDRESS
 *
 * Spoke selection:
 * - --spoke arbitrum (default) expects:
 *    - ALCHEMY_ARBITRUM_HTTP or ARBITRUM_RPC_URL or RPC_URL_ARBITRUM
 *    - SPOKE_OUTBOX_ADDRESS_ARBITRUM (preferred) or SPOKE_OUTBOX_ADDRESS
 *    - SPOKE_INBOX_ADDRESS_ARBITRUM (optional, only for mode=all) or SPOKE_INBOX_ADDRESS
 *
 * - --spoke polygon expects:
 *    - ALCHEMY_POLYGON_HTTP or POLYGON_RPC_URL or RPC_URL_POLYGON
 *    - SPOKE_OUTBOX_ADDRESS_POLYGON (preferred) or SPOKE_OUTBOX_ADDRESS
 *    - SPOKE_INBOX_ADDRESS_POLYGON (optional) or SPOKE_INBOX_ADDRESS
 *
 * Optional withdraw initiator check (mode=all):
 * - COLLATERAL_HUB_ADDRESS
 */

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../../.env.local") });
require("dotenv").config();

function parseArgs(argv) {
  const out = { mode: "deposits", spoke: "arbitrum" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mode" && argv[i + 1]) out.mode = String(argv[++i]).toLowerCase();
    else if (a === "--spoke" && argv[i + 1]) out.spoke = String(argv[++i]).toLowerCase();
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Check relayer roles for each private key in RELAYER_PRIVATE_KEYS_JSON.",
          "",
          "Usage:",
          "  node Dexetrav5/scripts/relayers/check-relayer-roles.js --mode deposits --spoke arbitrum",
          "",
          "Options:",
          "  --mode deposits|all   What to check (default deposits)",
          "  --spoke arbitrum|polygon  Which spoke chain envs to use (default arbitrum)",
        ].join("\n")
      );
      process.exit(0);
    }
  }
  if (!["deposits", "all"].includes(out.mode)) {
    throw new Error(`Invalid --mode: ${out.mode} (use deposits|all)`);
  }
  if (!["arbitrum", "polygon"].includes(out.spoke)) {
    throw new Error(`Invalid --spoke: ${out.spoke} (use arbitrum|polygon)`);
  }
  return out;
}

function parseJsonKeys(json) {
  try {
    const v = JSON.parse(json);
    if (!Array.isArray(v)) return [];
    return v.map((x) => String(x || "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function normalizePk(pk) {
  const raw = String(pk || "").trim();
  if (!raw) return "";
  const v = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(v)) return "";
  return v;
}

function pickFirst(...vals) {
  for (const v of vals) {
    const s = String(v || "").trim();
    if (s) return s;
  }
  return "";
}

function okAddr(a) {
  return typeof a === "string" && /^0x[a-fA-F0-9]{40}$/.test(a);
}

function parseOrderbooksFromEnv() {
  const raw = String(process.env.RELAYER_CHECK_ORDERBOOKS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const fallbacks = [
    String(process.env.DEFAULT_ORDERBOOK_ADDRESS || "").trim(),
    String(process.env.NEXT_PUBLIC_DEFAULT_ORDERBOOK_ADDRESS || "").trim(),
  ].filter(Boolean);
  const all = raw.length ? raw : fallbacks;
  return Array.from(new Set(all.map((x) => x.toLowerCase())))
    .filter((x) => okAddr(x))
    .map((x) => x);
}

function selector(signature) {
  // ethers.id(signature) == keccak256(utf8(signature))
  const { ethers } = require("ethers");
  return ethers.id(signature).slice(0, 10);
}

async function main() {
  const { mode, spoke } = parseArgs(process.argv.slice(2));
  const { ethers, Wallet } = await import("ethers");

  const keysJson = String(process.env.RELAYER_PRIVATE_KEYS_JSON || "").trim();
  const raw = parseJsonKeys(keysJson);
  const keys = raw.map(normalizePk).filter(Boolean);
  const invalidCount = raw.length - keys.length;
  if (keys.length === 0) {
    throw new Error("RELAYER_PRIVATE_KEYS_JSON missing/empty (expected JSON array of 0x-prefixed private keys)");
  }

  // Providers + contract addresses
  const hubRpc = pickFirst(process.env.RPC_URL, process.env.RPC_URL_HYPEREVM);
  const hubInbox = String(process.env.HUB_INBOX_ADDRESS || "").trim();
  if (!hubRpc) throw new Error("Missing hub RPC (RPC_URL or RPC_URL_HYPEREVM)");
  if (!okAddr(hubInbox)) throw new Error("Missing/invalid HUB_INBOX_ADDRESS");

  const spokeRpc =
    spoke === "arbitrum"
      ? pickFirst(process.env.ALCHEMY_ARBITRUM_HTTP, process.env.RPC_URL_ARBITRUM, process.env.ARBITRUM_RPC_URL)
      : pickFirst(process.env.ALCHEMY_POLYGON_HTTP, process.env.RPC_URL_POLYGON, process.env.POLYGON_RPC_URL);

  if (!spokeRpc) {
    throw new Error(
      spoke === "arbitrum"
        ? "Missing spoke RPC for arbitrum (ALCHEMY_ARBITRUM_HTTP / RPC_URL_ARBITRUM / ARBITRUM_RPC_URL)"
        : "Missing spoke RPC for polygon (ALCHEMY_POLYGON_HTTP / RPC_URL_POLYGON / POLYGON_RPC_URL)"
    );
  }

  const spokeOutbox =
    spoke === "arbitrum"
      ? pickFirst(process.env.SPOKE_OUTBOX_ADDRESS_ARBITRUM, process.env.SPOKE_OUTBOX_ADDRESS)
      : pickFirst(process.env.SPOKE_OUTBOX_ADDRESS_POLYGON, process.env.SPOKE_OUTBOX_ADDRESS);
  if (!okAddr(spokeOutbox)) {
    throw new Error(
      spoke === "arbitrum"
        ? "Missing/invalid SPOKE_OUTBOX_ADDRESS_ARBITRUM (or SPOKE_OUTBOX_ADDRESS fallback)"
        : "Missing/invalid SPOKE_OUTBOX_ADDRESS_POLYGON (or SPOKE_OUTBOX_ADDRESS fallback)"
    );
  }

  const spokeInbox =
    spoke === "arbitrum"
      ? pickFirst(process.env.SPOKE_INBOX_ADDRESS_ARBITRUM, process.env.SPOKE_INBOX_ADDRESS)
      : pickFirst(process.env.SPOKE_INBOX_ADDRESS_POLYGON, process.env.SPOKE_INBOX_ADDRESS);

  const collateralHub = String(process.env.COLLATERAL_HUB_ADDRESS || "").trim();
  const coreVault = String(process.env.CORE_VAULT_ADDRESS || process.env.NEXT_PUBLIC_CORE_VAULT_ADDRESS || "").trim();
  const spokeVault =
    spoke === "arbitrum"
      ? pickFirst(process.env.SPOKE_ARBITRUM_VAULT_ADDRESS, process.env.SPOKE_VAULT_ADDRESS)
      : pickFirst(process.env.SPOKE_POLYGON_VAULT_ADDRESS, process.env.SPOKE_VAULT_ADDRESS);

  const hubProvider = new ethers.JsonRpcProvider(hubRpc);
  const spokeProvider = new ethers.JsonRpcProvider(spokeRpc);
  const orderbooks = parseOrderbooksFromEnv();
  const sessionRegistry = String(process.env.SESSION_REGISTRY_ADDRESS || process.env.NEXT_PUBLIC_SESSION_REGISTRY_ADDRESS || "").trim();

  const OutboxAbi = [
    "function hasRole(bytes32 role, address account) view returns (bool)",
    "function DEPOSIT_SENDER_ROLE() view returns (bytes32)",
  ];
  const InboxAbi = [
    "function hasRole(bytes32 role, address account) view returns (bool)",
    "function BRIDGE_ENDPOINT_ROLE() view returns (bytes32)",
  ];
  const HubAbi = [
    "function hasRole(bytes32 role, address account) view returns (bool)",
    "function WITHDRAW_REQUESTER_ROLE() view returns (bytes32)",
    "function BRIDGE_INBOX_ROLE() view returns (bytes32)",
  ];
  const CoreVaultAbi = [
    "function hasRole(bytes32 role, address account) view returns (bool)",
    "function EXTERNAL_CREDITOR_ROLE() view returns (bytes32)",
  ];
  const SpokeVaultAbi = [
    "function hasRole(bytes32 role, address account) view returns (bool)",
    "function BRIDGE_INBOX_ROLE() view returns (bytes32)",
  ];

  const outbox = new ethers.Contract(spokeOutbox, OutboxAbi, spokeProvider);
  const hubInboxC = new ethers.Contract(hubInbox, InboxAbi, hubProvider);
  const spokeInboxC = okAddr(spokeInbox) ? new ethers.Contract(spokeInbox, InboxAbi, spokeProvider) : null;
  const collateralHubC = okAddr(collateralHub) ? new ethers.Contract(collateralHub, HubAbi, hubProvider) : null;
  const coreVaultC = okAddr(coreVault) ? new ethers.Contract(coreVault, CoreVaultAbi, hubProvider) : null;
  const spokeVaultC = okAddr(spokeVault) ? new ethers.Contract(spokeVault, SpokeVaultAbi, spokeProvider) : null;

  // Read role ids once
  const DEPOSIT_SENDER_ROLE = await outbox.DEPOSIT_SENDER_ROLE();
  const HUB_BRIDGE_ENDPOINT_ROLE = await hubInboxC.BRIDGE_ENDPOINT_ROLE();
  const SPOKE_BRIDGE_ENDPOINT_ROLE = spokeInboxC ? await spokeInboxC.BRIDGE_ENDPOINT_ROLE() : null;
  const WITHDRAW_REQUESTER_ROLE = collateralHubC ? await collateralHubC.WITHDRAW_REQUESTER_ROLE() : null;
  const HUB_BRIDGE_INBOX_ROLE = collateralHubC ? await collateralHubC.BRIDGE_INBOX_ROLE() : null;
  const CORE_VAULT_EXTERNAL_CREDITOR_ROLE = coreVaultC ? await coreVaultC.EXTERNAL_CREDITOR_ROLE() : null;
  const SPOKE_VAULT_BRIDGE_INBOX_ROLE = spokeVaultC ? await spokeVaultC.BRIDGE_INBOX_ROLE() : null;

  const requiredChecks = [];
  requiredChecks.push({
    name: `spoke(${spoke}).outbox.DEPOSIT_SENDER_ROLE`,
    check: async (addr) => await outbox.hasRole(DEPOSIT_SENDER_ROLE, addr),
    required: true,
  });
  requiredChecks.push({
    name: "hub.inbox.BRIDGE_ENDPOINT_ROLE",
    check: async (addr) => await hubInboxC.hasRole(HUB_BRIDGE_ENDPOINT_ROLE, addr),
    required: true,
  });

  if (mode === "all") {
    requiredChecks.push({
      name: `spoke(${spoke}).inbox.BRIDGE_ENDPOINT_ROLE`,
      check: async (addr) => {
        if (!spokeInboxC || !SPOKE_BRIDGE_ENDPOINT_ROLE) return null;
        return await spokeInboxC.hasRole(SPOKE_BRIDGE_ENDPOINT_ROLE, addr);
      },
      // If SPOKE_INBOX is configured, this is required for withdraw deliveries.
      required: !!spokeInboxC,
    });
    requiredChecks.push({
      name: "hub.collateralHub.WITHDRAW_REQUESTER_ROLE",
      check: async (addr) => {
        if (!collateralHubC || !WITHDRAW_REQUESTER_ROLE) return null;
        return await collateralHubC.hasRole(WITHDRAW_REQUESTER_ROLE, addr);
      },
      required: false,
    });
  }

  // Per-relayer gas funding checks (required to actually submit txs)
  // Thresholds can be configured with MIN_RELAYER_BALANCE_WEI_HUB / MIN_RELAYER_BALANCE_WEI_SPOKE
  const minHubWei = (() => {
    const v = String(process.env.MIN_RELAYER_BALANCE_WEI_HUB || "").trim();
    try { return v ? BigInt(v) : 0n; } catch { return 0n; }
  })();
  const minSpokeWei = (() => {
    const v = String(process.env.MIN_RELAYER_BALANCE_WEI_SPOKE || "").trim();
    try { return v ? BigInt(v) : 0n; } catch { return 0n; }
  })();
  const perRelayerChecks = [...requiredChecks];
  perRelayerChecks.push({
    name: `hub.native_balance >= ${minHubWei} wei`,
    check: async (addr) => {
      const b = await hubProvider.getBalance(addr);
      return b >= minHubWei;
    },
    required: true,
  });
  perRelayerChecks.push({
    name: `spoke(${spoke}).native_balance >= ${minSpokeWei} wei`,
    check: async (addr) => {
      const b = await spokeProvider.getBalance(addr);
      return b >= minSpokeWei;
    },
    required: true,
  });

  const requiredCount = perRelayerChecks.filter((c) => c.required).length;

  console.log("");
  console.log("Relayer role check");
  console.log("─".repeat(80));
  console.log(`mode=${mode} spoke=${spoke}`);
  console.log(`relayers=${keys.length}${invalidCount ? ` (invalid_skipped=${invalidCount})` : ""}`);
  console.log(`hubInbox=${hubInbox}`);
  console.log(`spokeOutbox=${spokeOutbox}`);
  if (mode === "all") {
    console.log(`spokeInbox=${okAddr(spokeInbox) ? spokeInbox : "(unset)"} (optional)`);
    console.log(`collateralHub=${okAddr(collateralHub) ? collateralHub : "(unset)"} (optional)`);
    console.log(`coreVault=${okAddr(coreVault) ? coreVault : "(unset)"} (wiring check)`);
    console.log(`spokeVault=${okAddr(spokeVault) ? spokeVault : "(unset)"} (wiring check)`);
  }
  console.log(`orderbooks=${orderbooks.length ? orderbooks.join(",") : "(unset)"}`);
  console.log(`sessionRegistry=${okAddr(sessionRegistry) ? sessionRegistry : "(unset)"}`);
  console.log("─".repeat(80));

  for (let i = 0; i < keys.length; i++) {
    const w = new Wallet(keys[i]);
    const addr = ethers.getAddress(w.address);

    let haveRequired = 0;
    const parts = [];
    for (const c of perRelayerChecks) {
      let res = null;
      try {
        res = await c.check(addr);
      } catch (e) {
        res = null;
      }
      if (res === true && c.required) haveRequired++;
      const status = res === true ? "✅" : res === false ? "❌" : "⚠️";
      parts.push(`${status} ${c.name}${c.required ? "" : " (optional)"}`);
    }

    console.log(`${addr} — ${haveRequired}/${requiredCount} required roles`);
    for (const p of parts) console.log(`  - ${p}`);
  }

  // System-wide trading prerequisites
  console.log("");
  console.log("Trading prerequisites (system readiness)");
  console.log("─".repeat(80));

  // 1) Throughput prerequisite: multiple keys
  console.log(`- relayer_key_count >= 2 ${keys.length >= 2 ? "✅" : "❌"} (found ${keys.length})`);

  // 2) RPC reachability
  try {
    const n = await hubProvider.getNetwork();
    console.log(`- hub.rpc.reachable ✅ (chainId=${String(n.chainId)})`);
  } catch (e) {
    console.log(`- hub.rpc.reachable ❌`);
  }
  try {
    const n = await spokeProvider.getNetwork();
    console.log(`- spoke(${spoke}).rpc.reachable ✅ (chainId=${String(n.chainId)})`);
  } catch (e) {
    console.log(`- spoke(${spoke}).rpc.reachable ❌`);
  }

  // 3) OrderBook diamond selectors
  if (!orderbooks.length) {
    console.log("- orderbooks.configured ❌ (set RELAYER_CHECK_ORDERBOOKS or DEFAULT_ORDERBOOK_ADDRESS)");
  } else {
    const LoupeAbi = ["function facetAddress(bytes4) view returns (address)"];
    const MetaViewAbi = ["function sessionRegistry() view returns (address)"];
    const RegistryAbi = [
      "function allowedOrderbook(address) view returns (bool)",
    ];
    const requiredMeta = [
      "metaPlaceLimit((address,uint256,uint256,bool,uint256,uint256),bytes)",
      "metaPlaceMarginLimit((address,uint256,uint256,bool,uint256,uint256),bytes)",
      "metaPlaceMarket((address,uint256,bool,uint256,uint256),bytes)",
      "metaPlaceMarginMarket((address,uint256,bool,uint256,uint256),bytes)",
      "metaModifyOrder((address,uint256,uint256,uint256,uint256,uint256),bytes)",
      "metaCancelOrder((address,uint256,uint256,uint256),bytes)",
    ];
    const requiredSession = [
      "sessionPlaceLimit(bytes32,address,uint256,uint256,bool,bytes32[])",
      "sessionPlaceMarginLimit(bytes32,address,uint256,uint256,bool,bytes32[])",
      "sessionPlaceMarket(bytes32,address,uint256,bool,bytes32[])",
      "sessionPlaceMarginMarket(bytes32,address,uint256,bool,bytes32[])",
      "sessionModifyOrder(bytes32,address,uint256,uint256,uint256,bytes32[])",
      "sessionCancelOrder(bytes32,address,uint256,bytes32[])",
      "setSessionRegistry(address)",
    ];

    for (const ob of orderbooks) {
      const orderBook = ethers.getAddress(ob);
      console.log(`- orderbook ${orderBook}`);
      const loupe = new ethers.Contract(orderBook, LoupeAbi, hubProvider);

      // selector presence checks
      let metaOk = 0;
      for (const sig of requiredMeta) {
        try {
          const sel = ethers.id(sig).slice(0, 10);
          const facet = await loupe.facetAddress(sel);
          const ok = facet && facet !== ethers.ZeroAddress;
          if (ok) metaOk++;
        } catch {}
      }
      console.log(`  - meta_selectors ${metaOk}/${requiredMeta.length} ${metaOk === requiredMeta.length ? "✅" : "❌"}`);

      let sessionOk = 0;
      for (const sig of requiredSession) {
        try {
          const sel = ethers.id(sig).slice(0, 10);
          const facet = await loupe.facetAddress(sel);
          const ok = facet && facet !== ethers.ZeroAddress;
          if (ok) sessionOk++;
        } catch {}
      }
      console.log(`  - session_selectors ${sessionOk}/${requiredSession.length} ${sessionOk === requiredSession.length ? "✅" : "❌"}`);

      // registry wiring checks (best-effort)
      if (okAddr(sessionRegistry)) {
        try {
          const reg = new ethers.Contract(sessionRegistry, RegistryAbi, hubProvider);
          const allowed = await reg.allowedOrderbook(orderBook);
          console.log(`  - registry.allowedOrderbook ✅ (${allowed === true ? "true" : "false"})${allowed === true ? "" : " ❌"}`);
        } catch {
          console.log("  - registry.allowedOrderbook ⚠️ (read failed)");
        }
        try {
          const metaView = new ethers.Contract(orderBook, MetaViewAbi, hubProvider);
          const regOnOb = await metaView.sessionRegistry();
          const matches = String(regOnOb).toLowerCase() === String(sessionRegistry).toLowerCase();
          console.log(`  - orderbook.sessionRegistry.matches_env ${matches ? "✅" : "❌"}`);
        } catch {
          console.log("  - orderbook.sessionRegistry.matches_env ⚠️ (not readable)");
        }
      } else {
        console.log("  - sessionRegistry.configured ❌ (SESSION_REGISTRY_ADDRESS unset)");
      }
    }
  }

  if (mode === "all") {
    console.log("");
    console.log("System wiring checks (not per-relayer)");
    console.log("─".repeat(80));
    // CollateralHub.BRIDGE_INBOX_ROLE -> HUB_INBOX
    if (collateralHubC && HUB_BRIDGE_INBOX_ROLE) {
      try {
        const has = await collateralHubC.hasRole(HUB_BRIDGE_INBOX_ROLE, hubInbox);
        console.log(`- CollateralHub.BRIDGE_INBOX_ROLE -> hubInbox ${has ? "✅" : "❌"}`);
      } catch {
        console.log("- CollateralHub.BRIDGE_INBOX_ROLE -> hubInbox ⚠️ (read failed)");
      }
    } else {
      console.log("- CollateralHub.BRIDGE_INBOX_ROLE -> hubInbox ⚠️ (COLLATERAL_HUB_ADDRESS unset)");
    }
    // CoreVault.EXTERNAL_CREDITOR_ROLE -> CollateralHub
    if (coreVaultC && CORE_VAULT_EXTERNAL_CREDITOR_ROLE && okAddr(collateralHub)) {
      try {
        const has = await coreVaultC.hasRole(CORE_VAULT_EXTERNAL_CREDITOR_ROLE, collateralHub);
        console.log(`- CoreVault.EXTERNAL_CREDITOR_ROLE -> CollateralHub ${has ? "✅" : "❌"}`);
      } catch {
        console.log("- CoreVault.EXTERNAL_CREDITOR_ROLE -> CollateralHub ⚠️ (read failed)");
      }
    } else {
      console.log("- CoreVault.EXTERNAL_CREDITOR_ROLE -> CollateralHub ⚠️ (CORE_VAULT_ADDRESS or COLLATERAL_HUB_ADDRESS unset)");
    }
    // SpokeVault.BRIDGE_INBOX_ROLE -> SpokeInbox (withdraw wiring)
    if (spokeVaultC && SPOKE_VAULT_BRIDGE_INBOX_ROLE && spokeInboxC) {
      try {
        const has = await spokeVaultC.hasRole(SPOKE_VAULT_BRIDGE_INBOX_ROLE, spokeInbox);
        console.log(`- SpokeVault.BRIDGE_INBOX_ROLE -> spokeInbox ${has ? "✅" : "❌"}`);
      } catch {
        console.log("- SpokeVault.BRIDGE_INBOX_ROLE -> spokeInbox ⚠️ (read failed)");
      }
    } else {
      console.log("- SpokeVault.BRIDGE_INBOX_ROLE -> spokeInbox ⚠️ (SPOKE_*_VAULT_ADDRESS or SPOKE_INBOX_ADDRESS unset)");
    }
    console.log("");
    console.log("Note: Gasless trading (meta trades/topups) is signature-authorized and does not require AccessControl roles for the relayer EOA.");
    console.log("      Session trading requires tx sender == session.relayer (per-session), not a role.");
  }

  console.log("");
}

main().catch((e) => {
  console.error(e?.stack || e?.message || String(e));
  process.exit(1);
});


