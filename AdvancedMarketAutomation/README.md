# AdvancedMarketAutomation

Local scripts for generating test wallets and monitoring balances.

## Generate wallets

```bash
npm run wallets:gen
```

This writes `AdvancedMarketAutomation/wallets.csv` (ignored by git).

## Interactive balances (Arbitrum ETH + CoreVault)

Set env vars (in `.env.local` or your shell):

- `ARBITRUM_RPC_URL`
- `CORE_VAULT_ADDRESS` (fallback: `SPOKE_ARBITRUM_VAULT_ADDRESS`)

Run:

```bash
npm run ama:balances
```

Commands: `n` (next page), `p` (prev), `r` (refresh), `#` (wallet number details), `q` (quit).

Non-interactive one-shot view:

```bash
npm run ama:balances -- --once
```

⚠️ `wallets.csv` contains private keys — keep it local and never commit/share it.


