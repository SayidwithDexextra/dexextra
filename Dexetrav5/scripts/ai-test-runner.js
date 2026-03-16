#!/usr/bin/env node

// ai-test-runner.js — Non-interactive CLI for AI-driven order book testing
//
// Wraps the InteractiveTrader's hack-mode engine so that an AI model (or any
// automated process) can:
//   1. Send hack-mode commands (orders, deposits, liquidations, assertions…)
//   2. Receive a structured JSON market-state snapshot on stdout
//   3. Get a deterministic exit code (0 = all passed, 1 = failure)
//
// USAGE:
//   # Run commands inline
//   npx hardhat run scripts/ai-test-runner.js --network localhost -- \
//       --commands "U1 DEP 5000; U2 DEP 5000; U1 LB 2.5 1 100; U2 MS 1 100"
//
//   # Run from a scenario file
//   npx hardhat run scripts/ai-test-runner.js --network localhost -- \
//       --file ./scenarios/ai-tests/001-basic-limit-match.txt
//
//   # Snapshot only (no commands, just current state)
//   npx hardhat run scripts/ai-test-runner.js --network localhost -- --snapshot
//
// OUTPUT (JSON to stdout):
//   {
//     "success": true/false,
//     "commands": [...],
//     "results": [...],
//     "errors": [...],
//     "state": { users, orderBook, bestBid, bestAsk, ... }
//   }

try {
  const path = require("path");
  const fs = require("fs");
  const dotenv = require("dotenv");
  const candidates = [
    path.resolve(__dirname, "..", "..", ".env.local"),
    path.resolve(process.cwd(), ".env.local"),
    path.join(__dirname, "..", ".env.local"),
    path.resolve(__dirname, "..", "..", ".env"),
    path.resolve(process.cwd(), ".env"),
    path.join(__dirname, "..", ".env"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      dotenv.config({ path: p });
      break;
    }
  }
} catch (_) {}

if (!process.env.HARDHAT_NETWORK) {
  process.env.HARDHAT_NETWORK = "localhost";
}

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const {
  getContract,
  getAddress,
  displayConfig,
  MARKET_INFO,
} = require("../config/contracts");

// Suppress all interactive-trader console output during headless runs.
// We capture structured data instead.
const origLog = console.log;
const origError = console.error;
const origWarn = console.warn;
const logBuffer = [];

function suppressConsole() {
  console.log = (...args) => logBuffer.push(args.map(String).join(" "));
  console.error = (...args) => logBuffer.push("[ERR] " + args.map(String).join(" "));
  console.warn = (...args) => logBuffer.push("[WARN] " + args.map(String).join(" "));
}

function restoreConsole() {
  console.log = origLog;
  console.error = origError;
  console.warn = origWarn;
}

// Strip ANSI escape codes for clean log capture
function stripAnsi(str) {
  return String(str).replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ""
  );
}

function formatPrice(val) {
  if (val === undefined || val === null) return "0";
  const n = BigInt(val.toString());
  return (Number(n) / 1e6).toFixed(6);
}

function formatUnits18(val) {
  if (val === undefined || val === null) return "0";
  const n = BigInt(val.toString());
  return (Number(n) / 1e18).toFixed(8);
}

function formatUnits6(val) {
  if (val === undefined || val === null) return "0";
  const n = BigInt(val.toString());
  return (Number(n) / 1e6).toFixed(6);
}

// ─── Headless Trader ────────────────────────────────────────────────────────

class HeadlessTrader {
  constructor() {
    this.contracts = {};
    this.users = [];
    this.currentUser = null;
    this.currentUserIndex = 0;
    this.hackHistory = [];
    this.strictBatch = false;
    this.activeTasks = 0;
    this.maxConcurrency = parseInt(process.env.RPC_CONCURRENCY || "6", 10);
    this.pendingQueue = [];
    this._hackBatchActive = false;
    this._hackBatchListeners = [];
  }

  async initialize() {
    await getContract.refreshAddresses();
    await this.loadContracts();
    await this.loadUsers();
  }

  async loadContracts() {
    this.contracts.mockUSDC = await getContract("MOCK_USDC");
    this.contracts.vault = await getContract("CORE_VAULT");

    const genericOb = getAddress("ORDERBOOK");
    let obAddress =
      genericOb && genericOb !== ethers.ZeroAddress ? genericOb : null;
    if (!obAddress) {
      const aluOb = getAddress("ALUMINUM_ORDERBOOK");
      if (!aluOb || aluOb === ethers.ZeroAddress) {
        throw new Error("ORDERBOOK address is not configured.");
      }
      obAddress = aluOb;
    }
    this.contracts.orderBookAddress = obAddress;

    this.contracts.obView = await ethers.getContractAt("OBViewFacet", obAddress);
    this.contracts.obPricing = await ethers.getContractAt("OBPricingFacet", obAddress);
    this.contracts.obPlace = await ethers.getContractAt("OBOrderPlacementFacet", obAddress);
    this.contracts.obExec = await ethers.getContractAt("OBTradeExecutionFacet", obAddress);
    this.contracts.obLiq = await ethers.getContractAt("OBLiquidationFacet", obAddress);
    this.contracts.obSettle = await ethers.getContractAt("OBSettlementFacet", obAddress);

    const obExecAbi = require("../artifacts/src/diamond/facets/OBTradeExecutionFacet.sol/OBTradeExecutionFacet.json").abi;
    const obPlaceAbi = require("../artifacts/src/diamond/facets/OBOrderPlacementFacet.sol/OBOrderPlacementFacet.json").abi;
    const obPricingAbi = require("../artifacts/src/diamond/facets/OBPricingFacet.sol/OBPricingFacet.json").abi;
    const obViewAbi = require("../artifacts/src/diamond/facets/OBViewFacet.sol/OBViewFacet.json").abi;
    const obLiqAbi = require("../artifacts/src/diamond/facets/OBLiquidationFacet.sol/OBLiquidationFacet.json").abi;

    const combinedAbi = [...obExecAbi, ...obPlaceAbi, ...obPricingAbi, ...obViewAbi, ...obLiqAbi];
    const provider =
      (this.contracts.vault?.runner?.provider) || ethers.provider;
    this.contracts.orderBook = new ethers.Contract(obAddress, combinedAbi, provider);

    this.contracts.factory = await getContract("FUTURES_MARKET_FACTORY");
    try {
      this.contracts.liquidationManager = await getContract("LIQUIDATION_MANAGER");
    } catch (_) {
      this.contracts.liquidationManager = null;
    }
  }

  async loadUsers() {
    const signers = await ethers.getSigners();
    this.users = signers.slice(0, 5);
    this.currentUser = this.users[0];
    this.currentUserIndex = 0;
  }

  // ─── Concurrency / retry helpers (mirrored from InteractiveTrader) ──────

  async withConcurrency(fn) {
    if (this.activeTasks < this.maxConcurrency) {
      this.activeTasks++;
      try { return await fn(); }
      finally {
        this.activeTasks--;
        const next = this.pendingQueue.shift();
        if (next) next();
      }
    }
    await new Promise((resolve) => this.pendingQueue.push(resolve));
    return this.withConcurrency(fn);
  }

  async withRpcRetry(fn, attempts = 8, baseDelayMs = 250) {
    let delay = baseDelayMs;
    for (let i = 1; i <= attempts; i++) {
      try { return await fn(); }
      catch (e) {
        const message = String(e?.code || e?.message || e);
        const isTransient =
          /ECONNRESET|ETIMEDOUT|EPIPE|ECONNREFUSED|socket hang up|network error|NETWORK_ERROR/i.test(message);
        if (!isTransient || i === attempts) throw e;
        await this.pause(delay);
        delay = Math.min(delay * 2, 5000);
      }
    }
  }

  pause(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ─── Hack-mode command execution (ported from InteractiveTrader) ────────

  async executeHackCommand(cmd) {
    const parts = cmd.split(/\s+/).filter(Boolean);
    if (parts.length === 0) throw new Error("Empty command");

    let user = this.currentUser;
    let userIndex = this.currentUserIndex;
    let cursor = 0;

    if (/^(deployer|@dep|@)$/i.test(parts[0])) {
      userIndex = 0;
      user = this.users[userIndex];
      cursor++;
    } else if (/^u\d+$/i.test(parts[0])) {
      const n = parseInt(parts[0].slice(1), 10);
      if (Number.isNaN(n) || n < 1 || n >= this.users.length) {
        throw new Error(`Invalid user: ${parts[0]}`);
      }
      userIndex = n;
      user = this.users[userIndex];
      cursor++;
    }

    if (cursor >= parts.length) throw new Error("Missing operation");
    const op = parts[cursor].toUpperCase();
    cursor++;

    const requiresUserOps = new Set([
      "LB", "LS", "MB", "MS", "DEP", "WDR", "CA", "CO", "CNO",
      "POS", "ORDS", "TUP", "RED", "PF", "DPA", "DMA",
      "POKE_LIQ", "POKE_VAULT",
    ]);

    if (requiresUserOps.has(op) && !user) {
      if (this.users.length > 0) {
        user = this.users[0];
        this.currentUser = user;
        this.currentUserIndex = 0;
      } else {
        throw new Error("No user selected");
      }
    }

    const compare = (left, opSym, right) => {
      switch (opSym) {
        case ">=": return left >= right;
        case ">": return left > right;
        case "<=": return left <= right;
        case "<": return left < right;
        case "==": return left === right;
        case "!=": return left !== right;
        default: throw new Error(`Unsupported operator: ${opSym}`);
      }
    };

    switch (op) {
      case "SLEEP": {
        const msStr = parts[cursor++];
        if (!msStr) throw new Error("SLEEP usage: SLEEP milliseconds");
        const ms = Number(msStr);
        if (!isFinite(ms) || ms < 0) throw new Error("Invalid milliseconds");
        await this.pause(ms);
        return `SLEEP ${ms}ms`;
      }

      case "STRICT": {
        const mode = (parts[cursor++] || "").toUpperCase();
        if (mode !== "ON" && mode !== "OFF") throw new Error("STRICT usage: STRICT ON|OFF");
        this.strictBatch = mode === "ON";
        return `STRICT ${mode}`;
      }

      case "ASSERT": {
        const what = (parts[cursor++] || "").toUpperCase();
        if (!what) throw new Error("ASSERT usage: ASSERT <BID|ASK|POSITION|AVAIL> ...");

        if (what === "BID" || what === "ASK") {
          const opSym = parts[cursor++];
          const rhsStr = parts[cursor++];
          if (!opSym || !rhsStr) throw new Error("ASSERT BID/ASK usage: ASSERT BID|ASK <op> <price>");
          const [bestBid, bestAsk] = await this.withConcurrency(() =>
            this.withRpcRetry(() => this.contracts.obPricing.getBestPrices())
          );
          const actual6 = what === "BID" ? BigInt(bestBid || 0n) : BigInt(bestAsk || 0n);
          if (rhsStr.toUpperCase() === "NONE") {
            if (actual6 !== 0n) throw new Error(`ASSERT failed: ${what} expected NONE but got ${formatPrice(actual6)}`);
            return `ASSERT ${what} NONE`;
          }
          const expect6 = ethers.parseUnits(String(Number(rhsStr)), 6);
          if (!compare(actual6, opSym, expect6)) {
            throw new Error(`ASSERT failed: ${what} ${opSym} ${rhsStr} (actual ${formatPrice(actual6)})`);
          }
          return `ASSERT ${what} ${opSym} ${rhsStr}`;
        }

        if (what === "POSITION") {
          let targetUser = null;
          if (parts[cursor] && /^u\d+$/i.test(parts[cursor])) {
            const idx = parseInt(parts[cursor++].slice(1), 10);
            if (Number.isNaN(idx) || idx < 0 || idx >= this.users.length) throw new Error("Invalid user");
            targetUser = this.users[idx];
          } else {
            targetUser = this.currentUser || this.users[0];
          }
          const side = (parts[cursor++] || "").toUpperCase();
          if (side !== "LONG" && side !== "SHORT") throw new Error("ASSERT POSITION: need LONG|SHORT");
          const opSym = parts[cursor++];
          const rhsUnitsStr = parts[cursor++];
          if (!opSym || !rhsUnitsStr) throw new Error("ASSERT POSITION usage: ... <op> <units>");
          const marketId = MARKET_INFO["ALU-USD"]?.marketId || ethers.ZeroHash;
          const positions = await this.contracts.vault.getUserPositions(targetUser.address);
          const pos = positions.find((p) => p.marketId === marketId) || positions[0];
          const size18 = pos ? BigInt(pos.size.toString()) : 0n;
          const expected18 = ethers.parseUnits(String(Number(rhsUnitsStr)), 18);
          const actualAbs18 = size18 >= 0n ? size18 : -size18;
          let ok = false;
          if (side === "LONG") ok = size18 > 0n && compare(actualAbs18, opSym, expected18);
          else ok = size18 < 0n && compare(actualAbs18, opSym, expected18);
          if (!ok) throw new Error(`ASSERT failed: POSITION ${side} ${opSym} ${rhsUnitsStr} (actual ${ethers.formatUnits(size18, 18)})`);
          return `ASSERT POSITION ${side}`;
        }

        if (what === "AVAIL") {
          let targetUser = null;
          if (parts[cursor] && /^u\d+$/i.test(parts[cursor])) {
            const idx = parseInt(parts[cursor++].slice(1), 10);
            if (Number.isNaN(idx) || idx < 0 || idx >= this.users.length) throw new Error("Invalid user");
            targetUser = this.users[idx];
          } else {
            targetUser = this.currentUser || this.users[0];
          }
          const opSym = parts[cursor++];
          const rhsStr = parts[cursor++];
          if (!opSym || !rhsStr) throw new Error("ASSERT AVAIL usage: ... <op> <usdc>");
          const [_, __, ___, available] = await this.withConcurrency(() =>
            this.withRpcRetry(() => this.contracts.vault.getUnifiedMarginSummary(targetUser.address))
          );
          const actual6 = BigInt((available || 0).toString());
          const expect6 = ethers.parseUnits(String(Number(rhsStr)), 6);
          if (!compare(actual6, opSym, expect6)) {
            throw new Error(`ASSERT failed: AVAIL ${opSym} ${rhsStr} (actual ${formatUnits6(actual6)})`);
          }
          return `ASSERT AVAIL`;
        }

        if (what === "COLLAT") {
          let targetUser = null;
          if (parts[cursor] && /^u\d+$/i.test(parts[cursor])) {
            const idx = parseInt(parts[cursor++].slice(1), 10);
            if (Number.isNaN(idx) || idx < 0 || idx >= this.users.length) throw new Error("Invalid user");
            targetUser = this.users[idx];
          } else {
            targetUser = this.currentUser || this.users[0];
          }
          const opSym = parts[cursor++];
          const rhsStr = parts[cursor++];
          if (!opSym || !rhsStr) throw new Error("ASSERT COLLAT usage: ... <op> <usdc>");
          const [totalCollateral] = await this.withConcurrency(() =>
            this.withRpcRetry(() => this.contracts.vault.getUnifiedMarginSummary(targetUser.address))
          );
          const actual6 = BigInt((totalCollateral || 0).toString());
          const expect6 = ethers.parseUnits(String(Number(rhsStr)), 6);
          if (!compare(actual6, opSym, expect6)) {
            throw new Error(`ASSERT failed: COLLAT ${opSym} ${rhsStr} (actual ${formatUnits6(actual6)})`);
          }
          return `ASSERT COLLAT`;
        }

        if (what === "BOOK_EMPTY") {
          const [bestBid, bestAsk] = await this.withConcurrency(() =>
            this.withRpcRetry(() => this.contracts.obPricing.getBestPrices())
          );
          if (BigInt(bestBid || 0n) !== 0n || BigInt(bestAsk || 0n) !== 0n) {
            throw new Error(`ASSERT failed: BOOK_EMPTY (bid=${formatPrice(bestBid)}, ask=${formatPrice(bestAsk)})`);
          }
          return "ASSERT BOOK_EMPTY";
        }

        throw new Error(`Unknown ASSERT target: ${what}`);
      }

      case "LB":
      case "LS": {
        const isBuy = op === "LB";
        const priceStr = parts[cursor++];
        const modeStr = parts[cursor++];
        const valStr = parts[cursor++];
        if ([priceStr, modeStr, valStr].some((v) => v === undefined)) throw new Error("LB/LS usage: [U#] LB price mode value");
        const price = Number(priceStr);
        const mode = Number(modeStr);
        const value = Number(valStr);
        if (!isFinite(price) || price <= 0) throw new Error("Invalid price");
        if (!(mode === 1 || mode === 2)) throw new Error("Mode must be 1 or 2");
        if (!isFinite(value) || value <= 0) throw new Error("Invalid value");

        let amountAlu = mode === 1 ? value : value / price;
        const priceWei = ethers.parseUnits(String(price), 6);
        const amountWei = ethers.parseUnits(String(amountAlu), 18);

        const { tx, rcpt } = await this.withConcurrency(() =>
          this.withRpcRetry(async () => {
            const tx = await this.contracts.obPlace.connect(user).placeMarginLimitOrder(priceWei, amountWei, isBuy);
            const rcpt = await tx.wait();
            return { tx, rcpt };
          })
        );
        return `${isBuy ? "LB" : "LS"} ${amountAlu} @ $${price} gas=${rcpt.gasUsed}`;
      }

      case "MB":
      case "MS": {
        const isBuy = op === "MB";
        const modeStr = parts[cursor++];
        const valStr = parts[cursor++];
        const slipStr = parts[cursor];
        if ([modeStr, valStr].some((v) => v === undefined)) throw new Error("MB/MS usage: [U#] MB mode value [slipBps]");
        const mode = Number(modeStr);
        const value = Number(valStr);
        const slippageBps = slipStr !== undefined ? Number(slipStr) : 100;
        if (!(mode === 1 || mode === 2)) throw new Error("Mode must be 1 or 2");
        if (!isFinite(value) || value <= 0) throw new Error("Invalid value");

        let amountAlu;
        if (mode === 1) {
          amountAlu = value;
        } else {
          const [bestBid, bestAsk] = await this.withConcurrency(() =>
            this.withRpcRetry(() => this.contracts.obPricing.getBestPrices())
          );
          const ref = isBuy ? bestAsk : bestBid;
          if (!ref || ref === 0n) throw new Error("No liquidity for market");
          const refPrice = Number(formatPrice(ref));
          amountAlu = value / refPrice;
        }
        const amountWei = ethers.parseUnits(String(amountAlu), 18);

        const { tx, rcpt } = await this.withConcurrency(() =>
          this.withRpcRetry(async () => {
            const tx = await this.contracts.obPlace.connect(user).placeMarginMarketOrderWithSlippage(amountWei, isBuy, slippageBps);
            const rcpt = await tx.wait();
            return { tx, rcpt };
          })
        );
        return `${isBuy ? "MB" : "MS"} ${amountAlu} slip=${slippageBps}bps gas=${rcpt.gasUsed}`;
      }

      case "DEP": {
        const amtStr = parts[cursor++];
        if (!amtStr) throw new Error("DEP usage: [U#] DEP amountUSDC");
        const amount = Number(amtStr);
        if (!isFinite(amount) || amount <= 0) throw new Error("Invalid amount");
        const amount6 = ethers.parseUnits(String(amount), 6);

        // Auto-mint mock USDC so each test is self-sufficient on localhost
        const deployer = this.users[0];
        const mockAddr = await this.contracts.mockUSDC.getAddress();
        const mockFull = await ethers.getContractAt("MockUSDC", mockAddr, deployer);
        await this.withConcurrency(() =>
          this.withRpcRetry(async () => {
            const mintTx = await mockFull.mint(user.address, amount6);
            await mintTx.wait();
          })
        );

        await this.withConcurrency(() =>
          this.withRpcRetry(async () => {
            const approveTx = await this.contracts.mockUSDC.connect(user).approve(await this.contracts.vault.getAddress(), amount6);
            await approveTx.wait();
          })
        );
        const { tx } = await this.withConcurrency(() =>
          this.withRpcRetry(async () => {
            const tx = await this.contracts.vault.connect(user).depositCollateral(amount6);
            await tx.wait();
            return { tx };
          })
        );
        return `DEP $${amount}`;
      }

      case "WDR": {
        const amtStr = parts[cursor++];
        if (!amtStr) throw new Error("WDR usage: [U#] WDR amountUSDC");
        const amount = Number(amtStr);
        if (!isFinite(amount) || amount <= 0) throw new Error("Invalid amount");
        const amount6 = ethers.parseUnits(String(amount), 6);
        await this.withConcurrency(() =>
          this.withRpcRetry(async () => {
            const tx = await this.contracts.vault.connect(user).withdrawCollateral(amount6);
            await tx.wait();
          })
        );
        return `WDR $${amount}`;
      }

      case "CA": {
        const orders = await this.safeGetUserOrders(user.address);
        let success = 0;
        for (const orderId of orders) {
          try {
            const order = await this.contracts.orderBook.getOrder(orderId);
            if (order.trader !== ethers.ZeroAddress && order.amount > 0) {
              await this.withConcurrency(() =>
                this.withRpcRetry(async () => {
                  const tx = await this.contracts.orderBook.connect(user).cancelOrder(orderId);
                  await tx.wait();
                })
              );
              success++;
            }
          } catch (_) {}
        }
        return `CA ${success}`;
      }

      case "CO": {
        const idStr = parts[cursor++];
        if (!idStr) throw new Error("CO usage: [U#] CO orderId");
        const orderId = BigInt(idStr);
        await this.withConcurrency(() =>
          this.withRpcRetry(async () => {
            const tx = await this.contracts.orderBook.connect(user).cancelOrder(orderId);
            await tx.wait();
          })
        );
        return `CO ${orderId}`;
      }

      case "CNO": {
        const idxStr = parts[cursor++];
        if (!idxStr) throw new Error("CNO usage: [U#] CNO index");
        const idx = Number(idxStr) - 1;
        const orders = await this.safeGetUserOrders(user.address);
        if (isNaN(idx) || idx < 0 || idx >= orders.length) throw new Error("Invalid order index");
        const orderId = orders[idx];
        await this.withConcurrency(() =>
          this.withRpcRetry(async () => {
            const tx = await this.contracts.orderBook.connect(user).cancelOrder(orderId);
            await tx.wait();
          })
        );
        return `CNO #${idx + 1}`;
      }

      case "SU": {
        const idxStr = parts[cursor++];
        if (!idxStr) throw new Error("SU usage: SU DEPLOYER|@|userIndex");
        let idx;
        if (/^(deployer|@)$/i.test(idxStr)) {
          idx = 0;
        } else {
          const n = Number(idxStr);
          if (isNaN(n) || n < 1 || n >= this.users.length) throw new Error("Invalid user index");
          idx = n;
        }
        this.currentUser = this.users[idx];
        this.currentUserIndex = idx;
        return `SU ${idx}`;
      }

      case "TUP": {
        const idxStr = parts[cursor++];
        const amtStr = parts[cursor++];
        if (!idxStr || !amtStr) throw new Error("TUP usage: [U#] TUP index amountUSDC");
        const idx = Number(idxStr) - 1;
        const amount6 = ethers.parseUnits(String(Number(amtStr)), 6);
        const positions = await this.contracts.vault.getUserPositions(user.address);
        if (isNaN(idx) || idx < 0 || idx >= positions.length) throw new Error("Invalid position index");
        const pos = positions[idx];
        const tx = await this.contracts.vault.connect(user).topUpPositionMargin(pos.marketId, amount6);
        await tx.wait();
        return `TUP #${idx + 1} $${Number(amtStr)}`;
      }

      case "RED": {
        const idxStr = parts[cursor++];
        const amtStr = parts[cursor++];
        if (!idxStr || !amtStr) throw new Error("RED usage: [U#] RED index amountUSDC");
        const idx = Number(idxStr) - 1;
        const amount6 = ethers.parseUnits(String(Number(amtStr)), 6);
        const positions = await this.contracts.vault.getUserPositions(user.address);
        if (isNaN(idx) || idx < 0 || idx >= positions.length) throw new Error("Invalid position index");
        const pos = positions[idx];
        const tx = await this.contracts.vault.connect(user).releaseMargin(user.address, pos.marketId, amount6);
        await tx.wait();
        return `RED #${idx + 1} $${Number(amtStr)}`;
      }

      case "POKE_VAULT": {
        if (this.contracts.vault.sweepLiquidations) {
          await this.contracts.vault.sweepLiquidations();
        }
        return "POKE_VAULT";
      }

      case "MARK": {
        const priceStr = parts[cursor++];
        if (!priceStr) throw new Error("MARK usage: MARK <price>");
        const price6 = ethers.parseUnits(priceStr, 6);
        const marketId = MARKET_INFO["ALU-USD"]?.marketId || ethers.ZeroHash;
        const tx = await this.withRpcRetry(() =>
          this.contracts.vault.connect(this.users[0]).updateMarkPrice(marketId, price6)
        );
        await tx.wait();
        return `MARK $${priceStr}`;
      }

      case "LD": {
        const targetStr = parts[cursor++];
        if (!targetStr) throw new Error("LD usage: LD <targetUserIndex>");
        const idx = Number(targetStr);
        if (!Number.isFinite(idx) || idx < 0 || idx >= this.users.length) throw new Error("Invalid target");
        const target = this.users[idx];
        const marketId = MARKET_INFO["ALU-USD"]?.marketId || ethers.ZeroHash;
        const tx = await this.withRpcRetry(() =>
          this.contracts.vault.connect(user || this.currentUser).liquidateDirect(marketId, target.address)
        );
        const rcpt = await tx.wait();
        return `LD target=${idx} gas=${rcpt?.gasUsed}`;
      }

      case "LMLD": {
        const targetStr = parts[cursor++];
        if (!targetStr) throw new Error("LMLD usage: LMLD <targetUserIndex>");
        const idx = Number(targetStr);
        if (!Number.isFinite(idx) || idx < 0 || idx >= this.users.length) throw new Error("Invalid target");
        const target = this.users[idx];
        const marketId = MARKET_INFO["ALU-USD"]?.marketId || ethers.ZeroHash;
        if (!this.contracts.liquidationManager) throw new Error("LiquidationManager not available");
        const tx = await this.withRpcRetry(() =>
          this.contracts.liquidationManager.connect(user || this.currentUser).liquidateDirect(marketId, target.address)
        );
        const rcpt = await tx.wait();
        return `LMLD target=${idx} gas=${rcpt?.gasUsed}`;
      }

      // View commands return empty string (state captured at the end)
      case "POS":
      case "ORDS":
      case "OB":
      case "PF":
      case "OVR":
      case "DPA":
      case "DMA":
      case "TH":
      case "LH":
        return `${op} (view — see state snapshot)`;

      default:
        throw new Error(`Unknown command: ${op}`);
    }
  }

  async safeGetUserOrders(userAddress) {
    try {
      const contract = this.contracts.obView?.getUserOrders
        ? this.contracts.obView
        : this.contracts.orderBook;
      if (!contract || !contract.getUserOrders) return [];
      const orders = await this.withRpcRetry(() => contract.getUserOrders(userAddress));
      return Array.isArray(orders) ? orders : [];
    } catch (_) {
      return [];
    }
  }

  // ─── Market state snapshot ──────────────────────────────────────────────

  async getMarketState() {
    const state = {
      users: [],
      orderBook: { bestBid: null, bestAsk: null, bids: [], asks: [] },
      timestamp: new Date().toISOString(),
    };

    // Best prices
    try {
      const [bestBid, bestAsk] = await this.withConcurrency(() =>
        this.withRpcRetry(() => this.contracts.obPricing.getBestPrices())
      );
      state.orderBook.bestBid = formatPrice(bestBid);
      state.orderBook.bestAsk = formatPrice(bestAsk);
    } catch (_) {}

    // Order book depth
    try {
      const [bidPrices, bidAmounts, askPrices, askAmounts] =
        await this.contracts.obPricing.getOrderBookDepth(10);
      for (let i = 0; i < bidPrices.length && bidPrices[i] > 0; i++) {
        state.orderBook.bids.push({
          price: formatPrice(bidPrices[i]),
          amount: formatUnits18(bidAmounts[i]),
        });
      }
      for (let i = 0; i < askPrices.length && askPrices[i] > 0; i++) {
        state.orderBook.asks.push({
          price: formatPrice(askPrices[i]),
          amount: formatUnits18(askAmounts[i]),
        });
      }
    } catch (_) {}

    // Per-user state
    for (let i = 0; i < this.users.length; i++) {
      const address = this.users[i].address;
      const label = i === 0 ? "Deployer" : `User${i}`;
      const userState = {
        index: i,
        label,
        address,
        walletUSDC: "0",
        collateral: "0",
        available: "0",
        marginUsed: "0",
        marginReserved: "0",
        isHealthy: true,
        positions: [],
        orders: [],
        socializedLoss: "0",
      };

      try {
        const bal = await this.contracts.mockUSDC.balanceOf(address);
        userState.walletUSDC = formatUnits6(bal);
      } catch (_) {}

      try {
        const [
          totalCollateral,
          marginUsed,
          marginReserved,
          available,
          realizedPnL,
          unrealizedPnL,
          totalCommitted,
          isHealthy,
        ] = await this.contracts.vault.getUnifiedMarginSummary(address);
        userState.collateral = formatUnits6(totalCollateral);
        userState.available = formatUnits6(available);
        userState.marginUsed = formatUnits6(marginUsed);
        userState.marginReserved = formatUnits6(marginReserved);
        userState.isHealthy = Boolean(isHealthy);
      } catch (_) {}

      try {
        const haircut = await this.contracts.vault.userSocializedLoss(address);
        userState.socializedLoss = formatUnits6(haircut);
      } catch (_) {}

      try {
        const positions = await this.contracts.vault.getUserPositions(address);
        for (const pos of positions) {
          const size18 = BigInt(pos.size.toString());
          if (size18 === 0n) continue;
          userState.positions.push({
            marketId: pos.marketId,
            side: size18 > 0n ? "LONG" : "SHORT",
            size: formatUnits18(size18 > 0n ? size18 : -size18),
            entryPrice: formatPrice(pos.entryPrice),
          });
        }
      } catch (_) {}

      try {
        const orderIds = await this.safeGetUserOrders(address);
        for (const orderId of orderIds) {
          try {
            const order = await this.contracts.orderBook.getOrder(orderId);
            if (order.trader !== ethers.ZeroAddress && order.amount > 0) {
              userState.orders.push({
                orderId: orderId.toString(),
                side: order.isBuy ? "BUY" : "SELL",
                price: formatPrice(order.price),
                amount: formatUnits18(order.amount),
              });
            }
          } catch (_) {}
        }
      } catch (_) {}

      state.users.push(userState);
    }

    return state;
  }

  // ─── Batch runner ───────────────────────────────────────────────────────

  async runCommands(commandStrings) {
    const results = [];
    const errors = [];

    for (const raw of commandStrings) {
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      // Handle chained commands (semicolon/comma within a single line)
      const subCommands = trimmed.split(/[;,]/).map((c) => c.trim()).filter(Boolean);
      for (const cmd of subCommands) {
        try {
          const summary = await this.executeHackCommand(cmd);
          results.push({ cmd, status: "ok", summary });
        } catch (err) {
          const errMsg = err.message || String(err);
          if (this.strictBatch) {
            results.push({ cmd, status: "error", summary: errMsg });
            errors.push({ cmd, error: errMsg });
            return { results, errors, aborted: true };
          }
          results.push({ cmd, status: "skipped", summary: `(non-strict) ${errMsg}` });
        }
      }
    }
    return { results, errors, aborted: false };
  }
}

// ─── CLI entry point ────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);

  // Strip hardhat's `--` separator
  const dashIdx = argv.indexOf("--");
  const args = dashIdx !== -1 ? argv.slice(dashIdx + 1) : argv;

  const flagValue = (flag) => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
  };
  const hasFlag = (flag) => args.includes(flag);

  const commandsRaw = flagValue("--commands");
  const filePath = flagValue("--file");
  const snapshotOnly = hasFlag("--snapshot");
  const showLogs = hasFlag("--verbose");

  if (!commandsRaw && !filePath && !snapshotOnly) {
    restoreConsole();
    origLog("Usage:");
    origLog("  --commands \"CMD1; CMD2; ...\"   Run inline hack-mode commands");
    origLog("  --file <path>                  Run commands from a scenario file");
    origLog("  --snapshot                     Output current market state (no commands)");
    origLog("  --verbose                      Include raw logs in output");
    origLog("");
    origLog("Examples:");
    origLog('  npx hardhat run scripts/ai-test-runner.js --network localhost -- --commands "U1 DEP 5000; U2 DEP 5000; U1 LB 2.5 1 100"');
    origLog('  npx hardhat run scripts/ai-test-runner.js --network localhost -- --file ./scenarios/ai-tests/001-basic-limit-match.txt');
    origLog('  npx hardhat run scripts/ai-test-runner.js --network localhost -- --snapshot');
    process.exit(0);
  }

  suppressConsole();

  const trader = new HeadlessTrader();

  try {
    await trader.initialize();
  } catch (err) {
    restoreConsole();
    origLog(JSON.stringify({
      success: false,
      error: `Initialization failed: ${err.message}`,
      hint: "Ensure a Hardhat node is running (npx hardhat node) and contracts are deployed.",
    }, null, 2));
    process.exit(1);
  }

  let runResult = { results: [], errors: [], aborted: false };

  if (!snapshotOnly) {
    let commandLines = [];

    if (commandsRaw) {
      commandLines = commandsRaw.split(/[;\n]+/).map((s) => s.trim()).filter(Boolean);
    } else if (filePath) {
      const absolute = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
      if (!fs.existsSync(absolute)) {
        restoreConsole();
        origLog(JSON.stringify({ success: false, error: `File not found: ${absolute}` }, null, 2));
        process.exit(1);
      }
      const raw = fs.readFileSync(absolute, "utf8");
      commandLines = raw.split(/\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith("#"));
    }

    runResult = await trader.runCommands(commandLines);
  }

  // Collect post-execution state
  const state = await trader.getMarketState();

  const hasErrors = runResult.errors.length > 0;

  const output = {
    success: !hasErrors,
    commandCount: runResult.results.length,
    passedCount: runResult.results.filter((r) => r.status === "ok").length,
    failedCount: runResult.results.filter((r) => r.status === "error").length,
    aborted: runResult.aborted,
    results: runResult.results,
    errors: runResult.errors,
    state,
  };

  if (showLogs) {
    output.logs = logBuffer.map(stripAnsi);
  }

  restoreConsole();
  origLog(JSON.stringify(output, null, 2));

  process.exit(hasErrors ? 1 : 0);
}

main().catch((err) => {
  restoreConsole();
  origLog(JSON.stringify({
    success: false,
    error: `Fatal: ${err.message}`,
    stack: err.stack,
  }, null, 2));
  process.exit(1);
});
