#!/usr/bin/env node
/**
 * Generate test wallets CSV (nickname,address,privateKey)
 *
 * CommonJS .js wrapper that uses dynamic import() for ethers (v6 is ESM-first).
 *
 * Usage:
 *   node AdvancedMarketAutomation/generate-wallets-csv.js --count 100 --out AdvancedMarketAutomation/wallets.csv
 *
 * Options:
 *   --count <n>        Number of wallets (default 100)
 *   --out <path>       Output CSV path (default AdvancedMarketAutomation/wallets.csv)
 *   --prefix <string>  Nickname prefix (default User) -> User001, User002...
 *   --start <n>        Start index for deterministic derivation (default 0)
 *   --append           Append rows to existing CSV (keeps header if present)
 *   --deterministic    Derive from TEST_MNEMONIC (default)
 *   --random           Generate random wallets (non-reproducible)
 *
 * Env:
 *   TEST_MNEMONIC      Mnemonic used when --deterministic is set.
 */

const fs = require("node:fs");

function parseArgs(argv) {
  const args = {
    count: 100,
    out: "AdvancedMarketAutomation/wallets.csv",
    nicknamePrefix: "User",
    deterministic: true,
    start: 0,
    append: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--count" && argv[i + 1]) args.count = Number(argv[++i]);
    else if (a === "--out" && argv[i + 1]) args.out = argv[++i];
    else if (a === "--prefix" && argv[i + 1]) args.nicknamePrefix = argv[++i];
    else if (a === "--start" && argv[i + 1]) args.start = Number(argv[++i]);
    else if (a === "--append") args.append = true;
    else if (a === "--random") args.deterministic = false;
    else if (a === "--deterministic") args.deterministic = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Generate test wallets CSV (nickname,address,privateKey)",
          "",
          "Usage:",
          "  node AdvancedMarketAutomation/generate-wallets-csv.js --count 100 --out AdvancedMarketAutomation/wallets.csv",
          "",
          "Options:",
          "  --count <n>        Number of wallets (default 100)",
          "  --out <path>       Output CSV path (default AdvancedMarketAutomation/wallets.csv)",
          "  --prefix <string>  Nickname prefix (default User) -> User001, User002...",
          "  --start <n>        Start index for deterministic derivation (default 0)",
          "  --append           Append rows to existing CSV (keeps header if present)",
          "  --deterministic    Derive from TEST_MNEMONIC (default)",
          "  --random           Generate random wallets (non-reproducible)",
          "",
          "Env:",
          "  TEST_MNEMONIC      Mnemonic used when --deterministic is set.",
        ].join("\n")
      );
      process.exit(0);
    }
  }

  if (!Number.isInteger(args.count) || args.count <= 0) {
    throw new Error(`--count must be a positive integer. Got: ${args.count}`);
  }
  if (!Number.isInteger(args.start) || args.start < 0) {
    throw new Error(`--start must be a non-negative integer. Got: ${args.start}`);
  }

  return args;
}

function csvEscape(value) {
  const v = String(value);
  if (v.includes('"') || v.includes(",") || v.includes("\n") || v.includes("\r")) {
    return `"${v.replaceAll('"', '""')}"`;
  }
  return v;
}

function nicknameFor(i, total, prefix) {
  const width = Math.max(3, String(total).length);
  const n = String(i + 1).padStart(width, "0");
  return `${prefix}${n}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const { HDNodeWallet, Wallet } = await import("ethers");

  const header = "nickname,address,privateKey";
  const rows = [];

  if (args.deterministic) {
    const mnemonic =
      process.env.TEST_MNEMONIC ?? "test test test test test test test test test test test junk";
    const basePath = "m/44'/60'/0'/0/";

    for (let i = 0; i < args.count; i++) {
      const derivationIndex = args.start + i;
      const w = HDNodeWallet.fromPhrase(mnemonic, undefined, `${basePath}${derivationIndex}`);
      const nick = nicknameFor(i, args.count, args.nicknamePrefix);
      rows.push([nick, w.address, w.privateKey].map(csvEscape).join(","));
    }

    console.log(
      `Generated ${args.count} deterministic wallets from index ${args.start} using TEST_MNEMONIC (or default test mnemonic).`
    );
  } else {
    for (let i = 0; i < args.count; i++) {
      const w = Wallet.createRandom();
      const nick = nicknameFor(i, args.count, args.nicknamePrefix);
      rows.push([nick, w.address, w.privateKey].map(csvEscape).join(","));
    }
    console.log(`Generated ${args.count} random wallets (non-reproducible).`);
  }

  const outExists = fs.existsSync(args.out);
  let content = "";

  if (args.append && outExists) {
    const existing = fs.readFileSync(args.out, "utf8");
    const hasHeader = existing.trimStart().startsWith(header);
    content = existing.replace(/\s*$/, "");
    content += (content.length > 0 ? "\n" : "") + (hasHeader ? "" : header + "\n");
    content += rows.join("\n") + "\n";
    fs.writeFileSync(args.out, content, { encoding: "utf8", mode: 0o600 });
  } else {
    content = header + "\n" + rows.join("\n") + "\n";
    fs.writeFileSync(args.out, content, { encoding: "utf8", mode: 0o600 });
  }

  console.log(`Wrote CSV -> ${args.out} (permissions 600)`);
}

main().catch((e) => {
  console.error(e?.stack || e?.message || String(e));
  process.exit(1);
});





