import type { MetricDiscoveryResponse } from '@/types/metricDiscovery';
import type { MetricResolutionResponse } from '@/components/MetricResolutionModal/types';
import type { DataSourceTooltipContent } from '@/components/ui/Tooltip';

export const DRAFT_SCHEMA_VERSION = 2;

export const STEP_ORDER = [
  'clarify_metric',
  'name',
  'similar_markets',
  'description',
  'select_source',
  'icon',
  'complete',
] as const;

export type CreationStep = (typeof STEP_ORDER)[number];

export interface SerializedSourceOption {
  id: string;
  label: string;
  sublabel?: string;
  url: string;
  confidence: number;
  authority: string;
  badge?: string;
  iconBg: string;
  tooltip: DataSourceTooltipContent;
}

export interface MarketDraftState {
  id: string;
  schemaVersion: number;

  prompt: string;
  metricClarification: string;
  marketName: string;
  marketDescription: string;

  isNameConfirmed: boolean;
  nameTouched: boolean;
  isDescriptionConfirmed: boolean;
  descriptionTouched: boolean;
  isIconConfirmed: boolean;
  similarMarketsAcknowledged: boolean;

  discoveryResult: MetricDiscoveryResponse | null;
  discoveryState: 'idle' | 'success' | 'clarify' | 'rejected' | 'error';

  selectedSource: SerializedSourceOption | null;
  validationResult: MetricResolutionResponse | null;
  deniedSourceUrls: string[];

  iconUrl: string | null;

  assistantHistory: Array<{ role: string; content: string }>;

  title: string;
  currentStep: CreationStep;
  createdAt: string;
  updatedAt: string;
}

export const PIPELINE_STAGES = [
  'draft',
  'deploying', 'deployed',
  'configuring', 'configured',
  'finalizing', 'finalized',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export interface PipelineDeployState {
  completed_at?: string;
  tx_hash?: string;
  block_number?: number;
  gas_used?: string;
}

export interface PipelineConfigureState {
  selectors_verified?: boolean;
  session_registry_attached?: boolean;
  roles_granted?: {
    ORDERBOOK_ROLE?: { tx: string; block?: number };
    SETTLEMENT_ROLE?: { tx: string; block?: number };
  };
  fees_configured?: { tx: string };
  fee_recipient_set?: { tx: string };
  speed_run_set?: boolean;
  completed_at?: string;
}

export interface PipelineFinalizeState {
  market_uuid?: string;
  qstash_ids?: Record<string, string | undefined>;
  wayback_url?: string;
  completed_at?: string;
}

export interface PipelineState {
  deploy?: PipelineDeployState;
  configure?: PipelineConfigureState;
  finalize?: PipelineFinalizeState;
}

export interface MarketDraftSummary {
  id: string;
  title: string | null;
  currentStep: CreationStep;
  pipelineStage: PipelineStage;
  orderbookAddress: string | null;
  marketIdBytes32: string | null;
  updatedAt: string;
  createdAt: string;
}

export function pipelineStageIndex(stage: PipelineStage): number {
  return PIPELINE_STAGES.indexOf(stage);
}

export function nextPipelineStage(stage: PipelineStage): PipelineStage | null {
  const idx = PIPELINE_STAGES.indexOf(stage);
  return idx >= 0 && idx < PIPELINE_STAGES.length - 1 ? PIPELINE_STAGES[idx + 1] : null;
}

export function stepIndex(step: CreationStep): number {
  return STEP_ORDER.indexOf(step);
}

export function stepProgress(step: CreationStep): number {
  const idx = stepIndex(step);
  return idx / (STEP_ORDER.length - 1);
}

export function stepLabel(step: CreationStep): string {
  return `Step ${stepIndex(step) + 1} of ${STEP_ORDER.length}`;
}
