#!/usr/bin/env tsx
/**
 * Guardian Monitoring Script for SecureSpokeVaultV2
 * 
 * This script monitors the vault for suspicious activity and can automatically
 * pause the contract if anomalies are detected.
 * 
 * Features:
 * - Real-time event monitoring
 * - Anomaly detection (unusual withdrawal patterns)
 * - Auto-pause capability
 * - Alerting via console (can be extended to Slack, Discord, etc.)
 * 
 * Usage:
 *   npx tsx scripts/guardian-monitor.ts
 *   npx tsx scripts/guardian-monitor.ts --auto-pause
 *   npx tsx scripts/guardian-monitor.ts --alert-only
 * 
 * Required env:
 *   - GUARDIAN_PRIVATE_KEY (guardian role holder)
 *   - ARBITRUM_RPC_URL
 *   - SPOKE_ARBITRUM_VAULT_ADDRESS
 */

import path from "path";
import dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const AUTO_PAUSE = process.argv.includes("--auto-pause");
const ALERT_ONLY = process.argv.includes("--alert-only");

// Anomaly thresholds
const THRESHOLDS = {
  // Max withdrawals in a 10-minute window before alert
  maxWithdrawalsPerWindow: 20,
  windowSizeSeconds: 600,
  
  // Max total value in a window before alert (in USDC units)
  maxValuePerWindow: 25000n * 1000000n, // 25k USDC
  
  // Max single withdrawal (should match contract, but alert early)
  alertOnLargeWithdrawal: 5000n * 1000000n, // 5k USDC
  
  // Max timelocked withdrawals pending at once
  maxPendingTimelocks: 10,
  
  // Consecutive failed withdrawals threshold
  maxConsecutiveFailures: 5,
};

// Contract ABI
const VAULT_ABI = [
  "function emergencyPause(string reason) external",
  "function paused() view returns (bool)",
  "function getDailyWithdrawn(address token) view returns (uint256)",
  "function getRemainingDailyLimit(address token) view returns (uint256)",
  "function getPendingTimelockCount() view returns (uint256)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  
  // Events
  "event Released(address indexed user, uint256 amount, bytes32 indexed withdrawId)",
  "event WithdrawalQueued(bytes32 indexed withdrawId, address indexed user, address token, uint256 amount, uint256 executeAfter)",
  "event WithdrawalExecuted(bytes32 indexed withdrawId, address indexed user, uint256 amount)",
  "event WithdrawalCancelled(bytes32 indexed withdrawId, address indexed cancelledBy)",
  "event DailyLimitReached(address indexed token, uint256 currentDay, uint256 attempted)",
  "event UserRateLimitReached(address indexed user, uint256 currentWindow)",
  "event EmergencyPause(address indexed guardian, string reason)",
];

// ═══════════════════════════════════════════════════════════════════════════
// MONITORING STATE
// ═══════════════════════════════════════════════════════════════════════════

interface WithdrawalEvent {
  timestamp: number;
  user: string;
  amount: bigint;
  withdrawId: string;
  txHash: string;
}

class MonitoringState {
  recentWithdrawals: WithdrawalEvent[] = [];
  pendingTimelocks: Set<string> = new Set();
  consecutiveFailures = 0;
  totalValueThisWindow = 0n;
  windowStart = Date.now();
  
  addWithdrawal(event: WithdrawalEvent) {
    this.recentWithdrawals.push(event);
    this.totalValueThisWindow += event.amount;
    this.consecutiveFailures = 0;
    
    // Clean old events
    const cutoff = Date.now() - THRESHOLDS.windowSizeSeconds * 1000;
    this.recentWithdrawals = this.recentWithdrawals.filter(e => e.timestamp > cutoff);
  }
  
  addFailure() {
    this.consecutiveFailures++;
  }
  
  resetWindow() {
    const cutoff = Date.now() - THRESHOLDS.windowSizeSeconds * 1000;
    this.recentWithdrawals = this.recentWithdrawals.filter(e => e.timestamp > cutoff);
    this.totalValueThisWindow = this.recentWithdrawals.reduce((sum, e) => sum + e.amount, 0n);
    this.windowStart = Date.now();
  }
  
  getWindowWithdrawalCount(): number {
    const cutoff = Date.now() - THRESHOLDS.windowSizeSeconds * 1000;
    return this.recentWithdrawals.filter(e => e.timestamp > cutoff).length;
  }
}

const state = new MonitoringState();

// ═══════════════════════════════════════════════════════════════════════════
// ALERTING
// ═══════════════════════════════════════════════════════════════════════════

type AlertSeverity = "INFO" | "WARNING" | "CRITICAL";

function alert(severity: AlertSeverity, message: string, details?: any) {
  const timestamp = new Date().toISOString();
  const prefix = {
    INFO: "ℹ️ ",
    WARNING: "⚠️ ",
    CRITICAL: "🚨",
  }[severity];
  
  console.log("");
  console.log(`${prefix} [${timestamp}] [${severity}] ${message}`);
  if (details) {
    console.log("   Details:", JSON.stringify(details, (_, v) => typeof v === "bigint" ? v.toString() : v, 2));
  }
  
  // TODO: Extend with Slack, Discord, PagerDuty, etc.
  // if (severity === "CRITICAL") {
  //   await sendSlackAlert(message, details);
  //   await sendPagerDutyAlert(message, details);
  // }
}

// ═══════════════════════════════════════════════════════════════════════════
// ANOMALY DETECTION
// ═══════════════════════════════════════════════════════════════════════════

interface AnomalyResult {
  detected: boolean;
  severity: AlertSeverity;
  reason: string;
  shouldPause: boolean;
}

function detectAnomalies(): AnomalyResult[] {
  const anomalies: AnomalyResult[] = [];
  
  // Check withdrawal count
  const withdrawalCount = state.getWindowWithdrawalCount();
  if (withdrawalCount >= THRESHOLDS.maxWithdrawalsPerWindow) {
    anomalies.push({
      detected: true,
      severity: "CRITICAL",
      reason: `High withdrawal frequency: ${withdrawalCount} in last ${THRESHOLDS.windowSizeSeconds / 60} minutes`,
      shouldPause: true,
    });
  } else if (withdrawalCount >= THRESHOLDS.maxWithdrawalsPerWindow * 0.7) {
    anomalies.push({
      detected: true,
      severity: "WARNING",
      reason: `Elevated withdrawal frequency: ${withdrawalCount} in last ${THRESHOLDS.windowSizeSeconds / 60} minutes`,
      shouldPause: false,
    });
  }
  
  // Check total value
  if (state.totalValueThisWindow >= THRESHOLDS.maxValuePerWindow) {
    anomalies.push({
      detected: true,
      severity: "CRITICAL",
      reason: `High withdrawal value: ${ethers.formatUnits(state.totalValueThisWindow, 6)} USDC in window`,
      shouldPause: true,
    });
  }
  
  // Check consecutive failures
  if (state.consecutiveFailures >= THRESHOLDS.maxConsecutiveFailures) {
    anomalies.push({
      detected: true,
      severity: "WARNING",
      reason: `${state.consecutiveFailures} consecutive withdrawal failures`,
      shouldPause: false,
    });
  }
  
  // Check pending timelocks
  if (state.pendingTimelocks.size >= THRESHOLDS.maxPendingTimelocks) {
    anomalies.push({
      detected: true,
      severity: "WARNING",
      reason: `${state.pendingTimelocks.size} pending timelocked withdrawals`,
      shouldPause: false,
    });
  }
  
  return anomalies;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("");
  console.log("╔══════════════════════════════════════════════════════════════════════════╗");
  console.log("║         GUARDIAN MONITORING - SecureSpokeVaultV2                         ║");
  console.log("╚══════════════════════════════════════════════════════════════════════════╝");
  console.log("");
  
  const guardianPk = process.env.GUARDIAN_PRIVATE_KEY || process.env.NEW_ADMIN_PRIVATE_KEY;
  if (!guardianPk) throw new Error("GUARDIAN_PRIVATE_KEY required");
  
  const arbRpc = process.env.ARBITRUM_RPC_URL;
  if (!arbRpc) throw new Error("ARBITRUM_RPC_URL required");
  
  const vaultAddr = process.env.SPOKE_ARBITRUM_VAULT_ADDRESS;
  if (!vaultAddr) throw new Error("SPOKE_ARBITRUM_VAULT_ADDRESS required");
  
  const provider = new ethers.JsonRpcProvider(arbRpc);
  const signer = new ethers.Wallet(guardianPk, provider);
  const vault = new ethers.Contract(vaultAddr, VAULT_ABI, signer);
  
  console.log("Configuration:");
  console.log("  Vault:", vaultAddr);
  console.log("  Guardian:", signer.address);
  console.log("  Mode:", AUTO_PAUSE ? "AUTO-PAUSE" : ALERT_ONLY ? "ALERT-ONLY" : "NORMAL");
  console.log("");
  
  // Verify guardian role
  const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
  const hasGuardian = await vault.hasRole(GUARDIAN_ROLE, signer.address);
  if (!hasGuardian) {
    console.error("❌ Signer does not have GUARDIAN_ROLE!");
    console.log("   Cannot pause contract if anomalies detected.");
    if (AUTO_PAUSE) {
      console.log("   Switching to ALERT-ONLY mode.");
    }
  } else {
    console.log("✅ Guardian role verified");
  }
  
  // Check if already paused
  const isPaused = await vault.paused();
  if (isPaused) {
    console.log("⚠️  Vault is currently PAUSED");
  }
  console.log("");
  
  console.log("Thresholds:");
  console.log("  Max withdrawals/window:", THRESHOLDS.maxWithdrawalsPerWindow);
  console.log("  Window size:", THRESHOLDS.windowSizeSeconds / 60, "minutes");
  console.log("  Max value/window:", ethers.formatUnits(THRESHOLDS.maxValuePerWindow, 6), "USDC");
  console.log("  Large withdrawal alert:", ethers.formatUnits(THRESHOLDS.alertOnLargeWithdrawal, 6), "USDC");
  console.log("");
  
  console.log("Starting event monitoring...");
  console.log("Press Ctrl+C to stop");
  console.log("");
  console.log("═══════════════════════════════════════════════════════════════════════════");
  
  // Subscribe to events
  vault.on("Released", async (user: string, amount: bigint, withdrawId: string, event: any) => {
    const txHash = event.log?.transactionHash || "unknown";
    
    state.addWithdrawal({
      timestamp: Date.now(),
      user,
      amount,
      withdrawId,
      txHash,
    });
    
    console.log(`[${new Date().toISOString()}] Released: ${ethers.formatUnits(amount, 6)} USDC to ${user.slice(0, 10)}...`);
    
    // Check for large withdrawal
    if (amount >= THRESHOLDS.alertOnLargeWithdrawal) {
      alert("WARNING", "Large withdrawal detected", {
        user,
        amount: ethers.formatUnits(amount, 6) + " USDC",
        withdrawId,
        txHash,
      });
    }
    
    // Run anomaly detection
    const anomalies = detectAnomalies();
    for (const anomaly of anomalies) {
      if (anomaly.detected) {
        alert(anomaly.severity, anomaly.reason);
        
        if (anomaly.shouldPause && AUTO_PAUSE && !ALERT_ONLY && hasGuardian) {
          alert("CRITICAL", "AUTO-PAUSING VAULT", { reason: anomaly.reason });
          try {
            const tx = await vault.emergencyPause(`Auto-pause: ${anomaly.reason}`);
            await tx.wait();
            console.log("✅ Vault PAUSED successfully");
          } catch (e: any) {
            console.error("❌ Failed to pause:", e.message);
          }
        }
      }
    }
  });
  
  vault.on("WithdrawalQueued", (withdrawId: string, user: string, token: string, amount: bigint, executeAfter: bigint) => {
    state.pendingTimelocks.add(withdrawId);
    alert("INFO", "Large withdrawal queued (timelocked)", {
      withdrawId,
      user,
      amount: ethers.formatUnits(amount, 6) + " USDC",
      executeAfter: new Date(Number(executeAfter) * 1000).toISOString(),
    });
  });
  
  vault.on("WithdrawalExecuted", (withdrawId: string, user: string, amount: bigint) => {
    state.pendingTimelocks.delete(withdrawId);
    console.log(`[${new Date().toISOString()}] Timelock executed: ${ethers.formatUnits(amount, 6)} USDC to ${user.slice(0, 10)}...`);
  });
  
  vault.on("WithdrawalCancelled", (withdrawId: string, cancelledBy: string) => {
    state.pendingTimelocks.delete(withdrawId);
    alert("INFO", "Timelocked withdrawal cancelled", { withdrawId, cancelledBy });
  });
  
  vault.on("DailyLimitReached", (token: string, currentDay: bigint, attempted: bigint) => {
    alert("WARNING", "Daily limit reached", {
      token,
      day: Number(currentDay),
      attemptedAmount: ethers.formatUnits(attempted, 6) + " USDC",
    });
    state.addFailure();
  });
  
  vault.on("UserRateLimitReached", (user: string, currentWindow: bigint) => {
    alert("WARNING", "User rate limit reached", { user });
    state.addFailure();
  });
  
  vault.on("EmergencyPause", (guardian: string, reason: string) => {
    alert("CRITICAL", "VAULT PAUSED", { guardian, reason });
  });
  
  // Periodic status check
  setInterval(async () => {
    state.resetWindow();
    
    try {
      const isPaused = await vault.paused();
      const pendingCount = await vault.getPendingTimelockCount().catch(() => 0);
      
      console.log(`[${new Date().toISOString()}] Status: ${isPaused ? "PAUSED" : "ACTIVE"} | ` +
        `Window: ${state.getWindowWithdrawalCount()} withdrawals | ` +
        `Pending timelocks: ${pendingCount}`);
    } catch (e: any) {
      console.error(`[${new Date().toISOString()}] Status check failed:`, e.message);
    }
  }, 60000); // Every minute
  
  // Keep alive
  process.on("SIGINT", () => {
    console.log("");
    console.log("Shutting down...");
    process.exit(0);
  });
}

main().catch((e) => {
  console.error("Error:", e?.message || e);
  process.exit(1);
});
