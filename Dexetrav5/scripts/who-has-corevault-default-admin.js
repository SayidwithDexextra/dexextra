/* eslint-disable no-console */
// Prints the CURRENT set of CoreVault DEFAULT_ADMIN_ROLE holders.
//
// Why this script exists:
// - CoreVault inherits OpenZeppelin AccessControl (NOT AccessControlEnumerable),
//   so you cannot enumerate role members on-chain directly.
// - The reliable way is to reconstruct membership by scanning RoleGranted/RoleRevoked events.
//
// Usage:
//   CORE_VAULT_ADDRESS=0x... \
//   npx hardhat run scripts/who-has-corevault-default-admin.js --network <network> --from-block 0
//
// Optional:
//   --to-block <N>          (default: latest)
//   --chunk-size <N>        (default: 50_000)
//   --check 0xA,0xB,0xC     (also call hasRole for these)
//
// Notes:
// - If you don’t know the deployment block, start with a recent `--from-block` and widen.
// - On local/test chains, `--from-block 0` is usually fine.

const path = require("path");
try {
  require("dotenv").config({
    path: path.resolve(__dirname, "../../.env.local"),
  });
} catch (_) {}
try {
  require("dotenv").config();
} catch (_) {}

const { ethers } = require("hardhat");

function required(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`Missing env ${name}`);
  return String(v).trim();
}

function parseArgs() {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[k] = true;
    } else {
      out[k] = next;
      i++;
    }
  }
  return out;
}

function toNum(x, fallback) {
  if (x == null) return fallback;
  const n = Number(String(x));
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid number: ${x}`);
  return Math.floor(n);
}

function parseAddrList(csv) {
  if (!csv) return [];
  return String(csv)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((a) => {
      if (!ethers.isAddress(a)) throw new Error(`Invalid address in --check: ${a}`);
      return a;
    });
}

async function main() {
  const args = parseArgs();
  const coreVaultAddress = required("CORE_VAULT_ADDRESS");
  if (!ethers.isAddress(coreVaultAddress)) throw new Error("Invalid CORE_VAULT_ADDRESS");

  const fromBlock = toNum(args["from-block"], 0);
  const toBlockArg = args["to-block"];
  const toBlock = toBlockArg == null ? "latest" : toNum(toBlockArg, 0);
  const chunkSize = toNum(args["chunk-size"], 50_000);
  const checkAddrs = parseAddrList(args["check"]);

  const [signer] = await ethers.getSigners();
  const provider = signer?.provider || ethers.provider;

  console.log("--- CoreVault DEFAULT_ADMIN_ROLE holders ---");
  console.log("CoreVault:", coreVaultAddress);
  console.log("Network:", process.env.HARDHAT_NETWORK || "unknown");
  console.log("fromBlock:", fromBlock);
  console.log("toBlock:", toBlock);
  console.log("chunkSize:", chunkSize);

  const vault = await ethers.getContractAt("CoreVault", coreVaultAddress, signer);
  const role = await vault.DEFAULT_ADMIN_ROLE(); // bytes32(0)
  console.log("DEFAULT_ADMIN_ROLE:", role);

  // Optional direct checks first (fast)
  if (checkAddrs.length) {
    console.log("\nDirect hasRole checks:");
    for (const a of checkAddrs) {
      const ok = await vault.hasRole(role, a);
      console.log("-", a, ok ? "✅ HAS ROLE" : "❌ no role");
    }
  }

  const latest =
    toBlock === "latest" ? await provider.getBlockNumber() : Number(toBlock);

  // Reconstruct from RoleGranted/RoleRevoked logs in chunks
  const members = new Map(); // address -> boolean
  const grantedFilter = vault.filters.RoleGranted(role, null, null);
  const revokedFilter = vault.filters.RoleRevoked(role, null, null);

  console.log("\nScanning events...");
  for (let start = fromBlock; start <= latest; start += chunkSize) {
    const end = Math.min(start + chunkSize - 1, latest);
    const [grants, revokes] = await Promise.all([
      vault.queryFilter(grantedFilter, start, end),
      vault.queryFilter(revokedFilter, start, end),
    ]);

    for (const e of grants) {
      const account = e?.args?.account;
      if (account) members.set(String(account).toLowerCase(), true);
    }
    for (const e of revokes) {
      const account = e?.args?.account;
      if (account) members.set(String(account).toLowerCase(), false);
    }

    if ((end - fromBlock) % (chunkSize * 10) === 0 || end === latest) {
      console.log(`- scanned blocks ${start}..${end} (${end - fromBlock + 1} total since fromBlock)`);
    }
  }

  // Cross-check final truth via hasRole (important in case logs are incomplete)
  console.log("\nFinal role members (verified via hasRole):");
  const candidates = Array.from(members.entries())
    .filter(([, active]) => active)
    .map(([addr]) => addr);

  const final = [];
  for (const addr of candidates) {
    const ok = await vault.hasRole(role, addr);
    if (ok) final.push(addr);
  }

  final.sort();
  for (const a of final) console.log("-", a);
  console.log(`\nCount: ${final.length}`);

  if (!final.length) {
    console.log(
      "\n⚠️  No admins found via event reconstruction in this range. Try a lower --from-block."
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

