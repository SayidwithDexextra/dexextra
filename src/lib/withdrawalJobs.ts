/**
 * Persistent saga state for cross-chain withdrawals.
 *
 * The cross-chain withdraw flow has three on-chain steps that MUST be tracked
 * across process restarts and individual relayer failures:
 *
 *   1. CollateralHub.requestWithdraw     (debits CoreVault credit)
 *   2. HubBridgeOutbox.sendWithdraw      (emits WithdrawSent → Wormhole)
 *   3. SpokeBridgeInbox.receiveMessage   (releases USDC to user)
 *
 * If we crash between (1) and (2)/(3), credit is gone but the user has nothing.
 * The retry worker uses the rows in `withdrawal_jobs` to reconcile any job
 * that didn't reach `completed`.
 */
import { supabaseAdmin } from './supabase-admin'

export type WithdrawalJobStatus =
  | 'pending'
  | 'hub_debiting'
  | 'hub_debited'
  | 'hub_sending'
  | 'hub_sent'
  | 'spoke_pending'
  | 'spoke_delivering'
  | 'completed'
  | 'hub_debit_failed'
  | 'outbox_failed'
  | 'spoke_failed'
  | 'requires_manual'

export type WithdrawalJob = {
  id: string
  user_address: string
  target_chain_id: number
  amount_wei: string
  amount_human: string
  spoke_token: string | null
  status: WithdrawalJobStatus
  withdraw_id: string | null
  hub_request_tx: string | null
  hub_request_block: number | null
  hub_send_tx: string | null
  hub_send_block: number | null
  spoke_deliver_tx: string | null
  spoke_deliver_block: number | null
  attempts: number
  max_attempts: number
  earliest_run_at: string
  last_error: string | null
  metadata: Record<string, any>
  created_at: string
  updated_at: string
  completed_at: string | null
}

export type StepPatch = {
  withdraw_id?: string
  hub_request_tx?: string
  hub_request_block?: number
  hub_send_tx?: string
  hub_send_block?: number
  spoke_deliver_tx?: string
  spoke_deliver_block?: number
  last_error?: string
  metadata?: Record<string, any>
}

function toRpcPatch(patch: StepPatch): Record<string, any> {
  const out: Record<string, any> = {}
  if (patch.withdraw_id !== undefined) out.withdraw_id = patch.withdraw_id
  if (patch.hub_request_tx !== undefined) out.hub_request_tx = patch.hub_request_tx
  if (patch.hub_request_block !== undefined) out.hub_request_block = String(patch.hub_request_block)
  if (patch.hub_send_tx !== undefined) out.hub_send_tx = patch.hub_send_tx
  if (patch.hub_send_block !== undefined) out.hub_send_block = String(patch.hub_send_block)
  if (patch.spoke_deliver_tx !== undefined) out.spoke_deliver_tx = patch.spoke_deliver_tx
  if (patch.spoke_deliver_block !== undefined) out.spoke_deliver_block = String(patch.spoke_deliver_block)
  if (patch.last_error !== undefined) out.last_error = patch.last_error
  if (patch.metadata !== undefined) out.metadata = patch.metadata
  return out
}

export async function createWithdrawalJob(args: {
  user: string
  targetChainId: number
  amountWei: bigint
  amountHuman: string
  spokeToken: string | null
  metadata?: Record<string, any>
  maxAttempts?: number
}): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc('create_withdrawal_job', {
    p_user: args.user,
    p_target_chain_id: args.targetChainId,
    p_amount_wei: args.amountWei.toString(),
    p_amount_human: args.amountHuman,
    p_spoke_token: args.spokeToken,
    p_metadata: args.metadata ?? {},
    p_max_attempts: args.maxAttempts ?? 8,
  })
  if (error) throw new Error(`createWithdrawalJob: ${error.message}`)
  return String(data)
}

export async function markWithdrawalStep(
  id: string,
  toStatus: WithdrawalJobStatus,
  patch: StepPatch = {}
): Promise<WithdrawalJob | null> {
  const { data, error } = await supabaseAdmin.rpc('mark_withdrawal_step', {
    p_id: id,
    p_to_status: toStatus,
    p_patch: toRpcPatch(patch),
  })
  if (error) throw new Error(`markWithdrawalStep(${toStatus}): ${error.message}`)
  return (data as WithdrawalJob) ?? null
}

export async function failOrRequeueWithdrawalJob(
  id: string,
  err: string,
  requeueTo: WithdrawalJobStatus,
  backoffSeconds = 30
): Promise<'requeued' | 'requires_manual' | 'not_found'> {
  const { data, error } = await supabaseAdmin.rpc('fail_or_requeue_withdrawal_job', {
    p_id: id,
    p_error: err.slice(0, 1000),
    p_requeue_to: requeueTo,
    p_backoff_seconds: backoffSeconds,
  })
  if (error) throw new Error(`failOrRequeueWithdrawalJob: ${error.message}`)
  return (data as any) ?? 'requeued'
}

export async function completeWithdrawalJob(
  id: string,
  spokeDeliverTx?: string,
  spokeDeliverBlock?: number
): Promise<WithdrawalJob | null> {
  const { data, error } = await supabaseAdmin.rpc('complete_withdrawal_job', {
    p_id: id,
    p_spoke_deliver_tx: spokeDeliverTx ?? null,
    p_spoke_deliver_block: spokeDeliverBlock !== undefined ? String(spokeDeliverBlock) : null,
  })
  if (error) throw new Error(`completeWithdrawalJob: ${error.message}`)
  return (data as WithdrawalJob) ?? null
}

export async function getWithdrawalJobById(id: string): Promise<WithdrawalJob | null> {
  const { data, error } = await supabaseAdmin
    .from('withdrawal_jobs')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`getWithdrawalJobById: ${error.message}`)
  return (data as WithdrawalJob) ?? null
}

export async function getWithdrawalJobByWithdrawId(
  withdrawId: string
): Promise<WithdrawalJob | null> {
  const { data, error } = await supabaseAdmin
    .from('withdrawal_jobs')
    .select('*')
    .eq('withdraw_id', withdrawId)
    .maybeSingle()
  if (error) throw new Error(`getWithdrawalJobByWithdrawId: ${error.message}`)
  return (data as WithdrawalJob) ?? null
}
