# Secure Spoke Infrastructure V3

A hardened cross-chain bridge system for the Arbitrum side of Dexextra, built after a security incident where an attacker exploited a compromised private key to drain the original vault.

---

## The Problem We Solved

The original SpokeVault had a single point of failure: whoever held the `BRIDGE_INBOX_ROLE` could withdraw funds. When the admin's private key was compromised, the attacker deployed a malicious contract at the same address on Arbitrum and drained 613 USDC.

This new system ensures that even if a key is compromised, an attacker cannot drain funds quickly or silently.

---

## How It Works

### The Big Picture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        HYPERLIQUID (HUB)                                │
│                                                                         │
│    User wants to withdraw  →  CollateralHub  →  HubBridgeOutbox        │
│                                                                         │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    │  Cross-chain message
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        ARBITRUM (SPOKE)                                 │
│                                                                         │
│    SpokeInboxAdapter  →  SecureSpokeVaultV3  →  USDC sent to user      │
│         │                       │                                       │
│         │                       │                                       │
│         ▼                       ▼                                       │
│    AnomalyDetector         8 Security Checks                           │
│    (watches patterns)      (must pass ALL)                             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### The Flow

1. **User requests withdrawal** on HyperLiquid through the existing CollateralHub
2. **HubBridgeOutbox sends a message** to Arbitrum (unchanged from before)
3. **SpokeInboxAdapter receives the message** and checks for anomalies
4. **SecureSpokeVaultV3 validates everything** through 8 security layers
5. **If small amount**: User gets USDC immediately
6. **If large amount**: Withdrawal is queued for 1 hour, then user can claim it

---

## The 8 Security Layers

Every withdrawal must pass through ALL of these checks. If any fails, the withdrawal is rejected.

### Layer 1: Access Control
Only the SpokeInboxAdapter can tell the vault to release funds. This address is set once and then **permanently locked** — it can never be changed, even by the admin.

### Layer 2: Depositor Whitelist
Only addresses that have previously deposited can withdraw. This stops attackers from creating fresh addresses to drain funds.

### Layer 3: Merkle Proof Verification (Optional)
Withdrawals can be verified against a merkle root published by the Hub. This ensures the withdrawal request actually originated from legitimate Hub activity.

### Layer 4: Co-Signer Verification (Optional)
Large withdrawals can require an off-chain signature from a trusted co-signer service. This enables fraud detection before funds leave the vault.

### Layer 5: Balance Check
Simple but critical — the vault must have enough funds to cover the withdrawal.

### Layer 6: Rate Limiting
Three levels of protection:
- **Daily limit**: Maximum 50,000 USDC per day total
- **Hourly limit**: Maximum 100,000 USDC per hour total  
- **Per-user limit**: Maximum 5 withdrawals per hour per address

### Layer 7: Hot Wallet Limit
Only 200,000 USDC is accessible through normal withdrawals. Anything beyond that requires a separate "cold withdrawal" process with multi-sig approval.

### Layer 8: Timelock for Large Withdrawals
Withdrawals over 1,000 USDC are not instant. They're queued with a 1-hour delay. During this time:
- The guardian can cancel suspicious withdrawals
- Monitoring systems can detect anomalies
- Admins have time to pause if something looks wrong

---

## The Contracts

### SecureSpokeVaultV3
The main vault that holds USDC. It implements all 8 security layers and can be paused in emergencies. Large withdrawals are timelocked, and admin configuration changes require a 24-hour delay.

### SpokeInboxAdapter  
The bridge between the existing Hub infrastructure and the new secure vault. It receives messages in the same format as before (so Hub contracts don't need changes) and forwards them to the vault with additional security checks.

### AnomalyDetector
Watches withdrawal patterns in real-time. It tracks:
- How many withdrawals are happening per hour
- Total value being withdrawn
- Whether single addresses are getting too much
- Statistical outliers

When patterns look suspicious, it can recommend pausing or trigger alerts.

### WithdrawalVerifier
Manages co-signers for large withdrawal approvals. Supports multi-sig (e.g., 2-of-3 signers required) and maintains a blacklist of suspicious addresses.

---

## Roles & Permissions

| Role | What They Can Do | Who Should Have It |
|------|------------------|-------------------|
| **Admin** | Configure the system, grant roles, unpause | Multi-sig wallet (2-of-3 or higher) |
| **Guardian** | Pause withdrawals, cancel pending timelocks | Monitoring bot + admin backup |
| **Bridge Inbox** | Initiate withdrawals | SpokeInboxAdapter only (locked) |
| **Co-Signer** | Approve large withdrawals off-chain | Trusted backend service |
| **Cold Withdrawer** | Access funds beyond hot wallet limit | Multi-sig wallet |

---

## What Happens During an Attack?

### Scenario: Compromised Admin Key

**Old system**: Attacker drains everything immediately.

**New system**: 
1. Attacker can only withdraw up to daily limit (50k USDC)
2. Large withdrawals are timelocked — guardian has 1 hour to cancel
3. Circuit breaker auto-pauses if too many withdrawals happen
4. Guardian monitoring alerts immediately on unusual patterns
5. Hot wallet limit means most funds are inaccessible anyway

### Scenario: Compromised Relayer Key

**Old system**: Relayer could potentially be used to drain funds.

**New system**:
1. Relayer can only deliver messages, not create fake ones
2. Vault verifies message came from trusted Hub (domain locked)
3. All the rate limits and timelocks still apply
4. Anomaly detector flags unusual activity

### Scenario: Coordinated Attack (Multiple Keys)

**New system**:
1. Even with admin + relayer, daily limits cap damage
2. Config changes require 24-hour timelock
3. Bridge inbox address is permanently locked
4. Cold funds require separate multi-sig

---

## Emergency Procedures

### Pausing Everything
The guardian can immediately pause all withdrawals. This stops everything until an admin reviews and unpause.

### Canceling a Suspicious Withdrawal  
If a large withdrawal is queued and looks suspicious, the guardian can cancel it before the timelock expires. The funds stay in the vault.

### Circuit Breaker
If withdrawal volume or frequency exceeds thresholds, the system automatically pauses for 1 hour. No human intervention needed.

### Cold Withdrawal
If you need to move funds beyond the hot wallet limit (e.g., for rebalancing), use the cold withdrawal function. This requires a separate role that should be held by a multi-sig wallet.

---

## Configuration Defaults

| Setting | Value | Purpose |
|---------|-------|---------|
| Instant withdrawal threshold | 1,000 USDC | Below this = immediate |
| Large withdrawal timelock | 1 hour | Time to review/cancel |
| Daily limit per token | 50,000 USDC | Caps daily damage |
| Global hourly limit | 100,000 USDC | Prevents rapid drain |
| Hot wallet limit | 200,000 USDC | Accessible without cold sig |
| User withdrawals per hour | 5 max | Prevents single-user abuse |
| Admin config timelock | 24 hours | Prevents instant config hijack |

---

## Integration with Existing System

**Good news**: The Hub contracts (CollateralHub, HubBridgeOutbox, HubBridgeInbox) don't need any changes.

The SpokeInboxAdapter speaks the same language as the old SpokeBridgeInbox. From the Hub's perspective, nothing changed — it just sends messages to a new address on Arbitrum.

The only updates needed:
1. Deploy the new contracts on Arbitrum
2. Tell the Hub to trust the new Arbitrum addresses
3. Fund the new vault with USDC

---

## Monitoring

The guardian monitor script watches the vault in real-time and:
- Logs every withdrawal
- Alerts on large withdrawals (>5,000 USDC)
- Alerts when rate limits are approaching
- Can auto-pause if thresholds are exceeded

Run it continuously in production for best protection.

---

## File Overview

```
contracts/secure-spoke/
├── SecureSpokeVaultV3.sol      ← Main vault with all security
├── AnomalyDetector.sol         ← Pattern detection
├── WithdrawalVerifier.sol      ← Co-signer management  
├── adapters/
│   └── SpokeInboxAdapter.sol   ← Hub compatibility layer
├── README.md                   ← You are here
└── QUICKSTART.md               ← Step-by-step deployment

scripts/
├── deploy-secure-spoke-v3.ts   ← Deploys everything
└── guardian-monitor.ts         ← Real-time monitoring
```

---

## Summary

This system turns a single point of failure into defense in depth. An attacker would need to:

1. Compromise the bridge inbox (permanently locked)
2. Bypass the whitelist (only depositors can withdraw)
3. Beat the rate limits (50k/day, 100k/hour)
4. Avoid the timelock (1 hour for large amounts)
5. Evade the anomaly detector (pattern monitoring)
6. Disable the circuit breaker (auto-pauses)
7. Access cold funds (separate multi-sig required)

Even if they somehow did all that, they'd still only get limited funds before the guardian pauses everything.

The goal isn't to make the system unhackable — it's to make attacks slow, visible, and limited in damage. That gives you time to respond.
