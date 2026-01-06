#!/usr/bin/env node
/**
 * Generate relayer keys (address + privateKey) for ops. Writes JSON or CSV.
 *
 * Usage:
 *   node Dexetrav5/scripts/relayers/generate-relayer-keys.js --count 5 --out relayers.json
 *   node Dexetrav5/scripts/relayers/generate-relayer-keys.js --count 5 --out relayers.csv --format csv
 *
 * Notes:
 * - Treat output as a secret. Do not commit.
 */

const fs = require("node:fs");
const path = require("node:path");

function parseArgs(argv) {
  const args = { count: 1, out: "relayers.json", format: "json" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--count" && argv[i + 1]) args.count = Number(argv[++i]);
    else if (a === "--out" && argv[i + 1]) args.out = argv[++i];
    else if (a === "--format" && argv[i + 1]) args.format = String(argv[++i]).toLowerCase();
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Generate relayer keys (address + privateKey).",
          "",
          "Usage:",
          "  node Dexetrav5/scripts/relayers/generate-relayer-keys.js --count 5 --out relayers.json",
          "",
          "Options:",
          "  --count <n>        Number of keys (default 1)",
          "  --out <path>       Output file (default relayers.json)",
          "  --format json|csv  Output format (default json)",
        ].join("\n")
      );
      process.exit(0);
    }
  }
  if (!Number.isInteger(args.count) || args.count <= 0) {
    throw new Error(`--count must be a positive integer. Got: ${args.count}`);
  }
  if (args.format !== "json" && args.format !== "csv") {
    throw new Error(`--format must be json|csv. Got: ${args.format}`);
  }
  return args;
}

function csvEscape(v) {
  const s = String(v);
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { Wallet } = await import("ethers");

  const outAbs = path.resolve(process.cwd(), args.out);
  const rows = [];
  for (let i = 0; i < args.count; i++) {
    const w = Wallet.createRandom();
    rows.push({ address: w.address, privateKey: w.privateKey });
  }

  let content = "";
  if (args.format === "json") {
    content = JSON.stringify(rows, null, 2) + "\n";
  } else {
    content = "address,privateKey\n" + rows.map((r) => [r.address, r.privateKey].map(csvEscape).join(",")).join("\n") + "\n";
  }

  fs.writeFileSync(outAbs, content, { encoding: "utf8", mode: 0o600 });
  console.log(`Wrote ${rows.length} relayer keys -> ${outAbs} (permissions 600)`);
}

main().catch((e) => {
  console.error(e?.stack || e?.message || String(e));
  process.exit(1);
});




