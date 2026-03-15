import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type VaultTxType = 'deposit' | 'withdraw'
export type VaultTxStatus = 'pending' | 'confirmed' | 'failed'
export type VaultTxMethod = 'hub_direct' | 'cross_chain' | 'bridge_deposit'

export interface VaultTransactionRecord {
  wallet_address: string
  tx_type: VaultTxType
  amount: number
  token?: string
  chain_id?: number
  tx_hash?: string
  status?: VaultTxStatus
  method?: VaultTxMethod
  metadata?: Record<string, unknown>
}

function getServerClient(): SupabaseClient | null {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
  const key = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''
  ).trim()
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function getAnonClient(): SupabaseClient | null {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim()
  const key = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim()
  if (!url || !key) return null
  return createClient(url, key)
}

function resolveClient(): SupabaseClient | null {
  return getServerClient() ?? getAnonClient()
}

/**
 * Records a vault deposit or withdrawal to Supabase.
 * Fire-and-forget safe — errors are logged but never thrown.
 */
export async function recordVaultTransaction(record: VaultTransactionRecord): Promise<void> {
  try {
    const sb = resolveClient()
    if (!sb) {
      console.warn('[vault-tx] Supabase client unavailable — skipping transaction record')
      return
    }

    const row = {
      wallet_address: record.wallet_address.toLowerCase(),
      tx_type: record.tx_type,
      amount: record.amount,
      token: record.token ?? 'USDC',
      chain_id: record.chain_id ?? null,
      tx_hash: record.tx_hash ?? null,
      status: record.status ?? 'confirmed',
      method: record.method ?? null,
      metadata: record.metadata ?? {},
    }

    // Use upsert on tx_hash + tx_type to prevent duplicate rows from webhook retries.
    // If tx_hash is null (rare), fall back to plain insert.
    if (row.tx_hash) {
      const { error } = await sb.from('vault_transactions').upsert(row, {
        onConflict: 'tx_hash,tx_type',
        ignoreDuplicates: true,
      })
      if (error) {
        // If upsert fails (e.g. constraint doesn't exist yet), fall back to insert
        const { error: insertErr } = await sb.from('vault_transactions').insert(row)
        if (insertErr) {
          console.error('[vault-tx] Failed to record transaction:', insertErr.message, row)
        } else {
          console.log(`[vault-tx] Recorded ${row.tx_type} of ${row.amount} USDC for ${row.wallet_address.slice(0, 8)}...`)
        }
      } else {
        console.log(`[vault-tx] Recorded ${row.tx_type} of ${row.amount} USDC for ${row.wallet_address.slice(0, 8)}...`)
      }
    } else {
      const { error } = await sb.from('vault_transactions').insert(row)
      if (error) {
        console.error('[vault-tx] Failed to record transaction:', error.message, row)
      } else {
        console.log(`[vault-tx] Recorded ${row.tx_type} of ${row.amount} USDC for ${row.wallet_address.slice(0, 8)}...`)
      }
    }
  } catch (err) {
    console.error('[vault-tx] Unexpected error recording transaction:', err)
  }
}
