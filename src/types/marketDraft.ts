import type { MetricDiscoveryResponse } from '@/types/metricDiscovery';
import type { MetricResolutionResponse } from '@/components/MetricResolutionModal/types';
import type { DataSourceTooltipContent } from '@/components/ui/Tooltip';

export const DRAFT_SCHEMA_VERSION = 1;

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

export interface MarketDraftSummary {
  id: string;
  title: string | null;
  currentStep: CreationStep;
  updatedAt: string;
  createdAt: string;
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
