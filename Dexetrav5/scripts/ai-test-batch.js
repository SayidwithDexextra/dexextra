#!/usr/bin/env node

// ai-test-batch.js — Run AI test scenarios in isolation with EVM snapshots
//
// USAGE:
//   node scripts/ai-test-batch.js                     # run ALL tests
//   node scripts/ai-test-batch.js 1-15                # run tests 001–015
//   node scripts/ai-test-batch.js 5-10                # run tests 005–010
//   node scripts/ai-test-batch.js 1,3,7,12            # run specific tests
//   node scripts/ai-test-batch.js 42                  # run single test 042
//   node scripts/ai-test-batch.js 1-5 --verbose       # show full JSON per test
//   node scripts/ai-test-batch.js 1-5 --stop-on-fail  # abort suite on first failure
//   node scripts/ai-test-batch.js 1-5 --redeploy      # kill node, restart, redeploy before run
//
// REQUIRES: Hardhat node running on 127.0.0.1:8545 with contracts deployed.

const { execSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const SCENARIOS_DIR = path.join(__dirname, "..", "scenarios", "ai-tests");
const SNAPSHOT_FILE = path.join(__dirname, "..", "deployments", "localhost-snapshot.json");
const RPC_URL = "http://127.0.0.1:8545";

function rpcCall(method, params = []) {
  const body = JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 });
  const result = spawnSync("curl", [
    "-s", "-X", "POST", RPC_URL,
    "-H", "Content-Type: application/json",
    "-d", body,
  ], { encoding: "utf8", timeout: 10000 });
  if (result.status !== 0) throw new Error(`RPC ${method} failed: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout);
  if (parsed.error) throw new Error(`RPC ${method} error: ${parsed.error.message}`);
  return parsed.result;
}

function discoverTests() {
  const files = fs.readdirSync(SCENARIOS_DIR)
    .filter((f) => f.endsWith(".txt") && /^\d{3}-/.test(f))
    .sort();
  return files.map((f) => {
    const num = parseInt(f.slice(0, 3), 10);
    const name = f.replace(/\.txt$/, "");
    const firstLine = fs.readFileSync(path.join(SCENARIOS_DIR, f), "utf8")
      .split("\n")
      .find((l) => l.startsWith("# Test")) || "";
    const description = firstLine.replace(/^#\s*Test\s*\d+:\s*/, "").trim();
    return { num, name, file: f, description };
  });
}

function parseRange(rangeStr, allTests) {
  const maxNum = Math.max(...allTests.map((t) => t.num));
  const selected = new Set();

  for (const part of rangeStr.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const dashMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (dashMatch) {
      const lo = parseInt(dashMatch[1], 10);
      const hi = parseInt(dashMatch[2], 10);
      for (let i = lo; i <= hi; i++) selected.add(i);
    } else {
      const n = parseInt(trimmed, 10);
      if (!isNaN(n)) selected.add(n);
    }
  }

  return allTests.filter((t) => selected.has(t.num));
}

function runSingleTest(testInfo) {
  const filePath = path.join(SCENARIOS_DIR, testInfo.file);
  const env = { ...process.env, HARDHAT_NETWORK: "localhost" };
  const result = spawnSync("node", [
    path.join(__dirname, "ai-test-runner.js"),
    "--file", filePath,
  ], { encoding: "utf8", timeout: 120000, env, cwd: path.join(__dirname, "..") });

  const stdout = result.stdout || "";
  const jsonStart = stdout.indexOf("{");
  if (jsonStart === -1) {
    return { success: false, error: `No JSON output. stderr: ${result.stderr}`, raw: stdout };
  }
  try {
    return JSON.parse(stdout.slice(jsonStart));
  } catch (e) {
    return { success: false, error: `JSON parse error: ${e.message}`, raw: stdout };
  }
}

function color(code, text) {
  if (!process.stdout.isTTY) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

function loadSavedSnapshot() {
  try {
    const data = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
    return data.snapshotId || null;
  } catch (_) {
    return null;
  }
}

function saveSnapshot(id) {
  const dir = path.dirname(SNAPSHOT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify({ snapshotId: id, savedAt: new Date().toISOString() }));
}

function redeploy() {
  console.log(color("33", "\n  Redeploying: killing node, restarting, deploying...\n"));

  try { execSync("lsof -ti:8545 | xargs kill -9 2>/dev/null", { stdio: "ignore" }); } catch (_) {}
  execSync("sleep 2");

  const nodeProc = require("child_process").spawn("npx", ["hardhat", "node"], {
    cwd: path.join(__dirname, ".."),
    stdio: "ignore",
    detached: true,
  });
  nodeProc.unref();

  // Wait for node to be ready
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      execSync("sleep 1");
      rpcCall("eth_blockNumber");
      ready = true;
      break;
    } catch (_) {}
  }
  if (!ready) throw new Error("Hardhat node failed to start");

  const deployResult = spawnSync("npx", ["hardhat", "run", "scripts/deploy.js", "--network", "localhost"], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
    timeout: 180000,
  });
  if (deployResult.status !== 0) throw new Error(`Deploy failed: ${deployResult.stderr}`);

  const snap = rpcCall("evm_snapshot");
  saveSnapshot(snap);
  console.log(color("32", "  Deploy complete. Clean snapshot saved.\n"));
}

function main() {
  const args = process.argv.slice(2);
  const flags = args.filter((a) => a.startsWith("-"));
  const positional = args.filter((a) => !a.startsWith("-"));

  const verbose = flags.includes("--verbose");
  const stopOnFail = flags.includes("--stop-on-fail");
  const shouldRedeploy = flags.includes("--redeploy");

  const allTests = discoverTests();
  if (allTests.length === 0) {
    console.error("No test files found in", SCENARIOS_DIR);
    process.exit(1);
  }

  let tests;
  if (positional.length > 0) {
    tests = parseRange(positional.join(","), allTests);
  } else {
    tests = allTests;
  }

  if (tests.length === 0) {
    console.error("No tests matched the given range.");
    process.exit(1);
  }

  if (shouldRedeploy) {
    redeploy();
  }

  // Verify node is reachable
  try {
    rpcCall("eth_blockNumber");
  } catch (e) {
    console.error(color("31", "  Hardhat node not reachable at " + RPC_URL));
    console.error("  Start it with: cd Dexetrav5 && npx hardhat node");
    console.error("  Then deploy:   npx hardhat run scripts/deploy.js --network localhost");
    process.exit(1);
  }

  // Revert to a clean post-deployment state if a saved snapshot exists.
  // evm_revert consumes the snapshot, so we immediately re-snapshot afterward.
  const savedSnap = loadSavedSnapshot();
  if (savedSnap) {
    try {
      rpcCall("evm_revert", [savedSnap]);
    } catch (_) {
      console.log(color("33", "  ⚠  Saved snapshot expired (node restarted?). Using current state."));
      console.log(color("33", "     Hint: run with --redeploy or redeploy manually for clean state.\n"));
    }
  }

  let snap = rpcCall("evm_snapshot");
  saveSnapshot(snap);

  const padNum = (n) => String(n).padStart(3, "0");
  const maxNameLen = Math.max(...tests.map((t) => t.name.length));

  console.log("");
  console.log(color("1", "  ══════════════════════════════════════════════════════"));
  console.log(color("1", `  AI TEST SUITE — ${tests.length} test(s), isolated via EVM snapshots`));
  console.log(color("1", "  ══════════════════════════════════════════════════════"));
  console.log("");

  let passed = 0;
  let failed = 0;
  const failures = [];
  const startTime = Date.now();

  for (const test of tests) {
    rpcCall("evm_revert", [snap]);
    snap = rpcCall("evm_snapshot");
    saveSnapshot(snap);

    const t0 = Date.now();
    const result = runSingleTest(test);
    const elapsed = Date.now() - t0;

    const label = test.name.padEnd(maxNameLen);
    const time = `${(elapsed / 1000).toFixed(1)}s`;

    if (result.success) {
      passed++;
      const cmds = result.passedCount || "?";
      console.log(color("32", `  ✓ ${label}`) + `  ${cmds} cmds  ${time}`);
    } else {
      failed++;
      const errMsg = (result.errors || []).map((e) => e.error).join("; ") || result.error || "unknown";
      const short = errMsg.length > 90 ? errMsg.slice(0, 90) + "…" : errMsg;
      console.log(color("31", `  ✗ ${label}`) + `  ${time}`);
      console.log(color("31", `    → ${short}`));
      failures.push({ test: test.name, error: errMsg });
    }

    if (verbose && result.results) {
      for (const r of result.results) {
        const icon = r.status === "ok" ? "·" : "✗";
        const c = r.status === "ok" ? "90" : "31";
        console.log(color(c, `      ${icon} ${r.cmd} → ${r.summary || r.status}`));
      }
    }

    if (stopOnFail && failed > 0) {
      console.log(color("33", "\n  Stopping on first failure (--stop-on-fail)"));
      break;
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("");
  console.log(color("1", "  ══════════════════════════════════════════════════════"));
  if (failed === 0) {
    console.log(color("32", `  ALL ${passed} TESTS PASSED`) + `  (${totalTime}s)`);
  } else {
    console.log(color("31", `  ${failed} FAILED`) + `, ${passed} passed  (${totalTime}s)`);
    console.log("");
    for (const f of failures) {
      console.log(color("31", `  ✗ ${f.test}`));
      console.log(`    ${f.error}`);
    }
  }
  console.log(color("1", "  ══════════════════════════════════════════════════════"));
  console.log("");

  process.exit(failed > 0 ? 1 : 0);
}

main();
