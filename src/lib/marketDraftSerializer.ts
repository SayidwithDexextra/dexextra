import type { MetricSourceOption } from '@/components/create-market-v2/MetricSourceBubble';
import type { MarketDraftState, SerializedSourceOption, CreationStep } from '@/types/marketDraft';
import { DRAFT_SCHEMA_VERSION, STEP_ORDER } from '@/types/marketDraft';
import { makeIconNode, makeFaviconUrl, getHostname } from '@/components/create-market-v2/MetricSourceBubble';
import type { MetricDiscoveryResponse } from '@/types/metricDiscovery';
import type { MetricResolutionResponse } from '@/components/MetricResolutionModal/types';

export function serializeSource(src: MetricSourceOption): SerializedSourceOption {
  return {
    id: src.id,
    label: src.label,
    sublabel: src.sublabel,
    url: src.url,
    confidence: src.confidence,
    authority: src.authority,
    badge: src.badge,
    iconBg: src.iconBg,
    tooltip: src.tooltip,
  };
}

export function deserializeSource(src: SerializedSourceOption): MetricSourceOption {
  const domain = getHostname(src.url);
  const faviconUrl = makeFaviconUrl({ domain });
  return {
    ...src,
    icon: makeIconNode({ faviconUrl, label: src.label }),
  };
}

export interface CreationStateSnapshot {
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
  discoveryState: 'idle' | 'discovering' | 'success' | 'clarify' | 'rejected' | 'error';
  selectedSource: MetricSourceOption | null;
  validationResult: MetricResolutionResponse | null;
  deniedSourceUrls: string[];
  iconStoredUrl: string | null;
  iconPreviewUrl: string | null;
  assistantHistory: Array<{ role: string; content: string }>;
  visibleStep: CreationStep;
}

export function snapshotToDraft(
  draftId: string,
  snap: CreationStateSnapshot,
  existing?: MarketDraftState | null,
): MarketDraftState {
  const discoveryState = snap.discoveryState === 'discovering' ? 'idle' : snap.discoveryState;

  const iconUrl =
    snap.iconStoredUrl ||
    (snap.iconPreviewUrl && !snap.iconPreviewUrl.startsWith('blob:') ? snap.iconPreviewUrl : null);

  const title =
    snap.marketName?.trim() ||
    snap.discoveryResult?.metric_definition?.metric_name ||
    snap.prompt?.trim().slice(0, 100) ||
    '';

  const now = new Date().toISOString();

  return {
    id: draftId,
    schemaVersion: DRAFT_SCHEMA_VERSION,
    prompt: snap.prompt,
    metricClarification: snap.metricClarification,
    marketName: snap.marketName,
    marketDescription: snap.marketDescription,
    isNameConfirmed: snap.isNameConfirmed,
    nameTouched: snap.nameTouched,
    isDescriptionConfirmed: snap.isDescriptionConfirmed,
    descriptionTouched: snap.descriptionTouched,
    isIconConfirmed: snap.isIconConfirmed,
    similarMarketsAcknowledged: snap.similarMarketsAcknowledged,
    discoveryResult: snap.discoveryResult,
    discoveryState,
    selectedSource: snap.selectedSource ? serializeSource(snap.selectedSource) : null,
    validationResult: snap.validationResult,
    deniedSourceUrls: snap.deniedSourceUrls,
    iconUrl,
    assistantHistory: snap.assistantHistory,
    title,
    currentStep: snap.visibleStep as CreationStep,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export function draftToInitialState(draft: MarketDraftState): CreationStateSnapshot {
  return {
    prompt: draft.prompt ?? '',
    metricClarification: draft.metricClarification ?? '',
    marketName: draft.marketName ?? '',
    marketDescription: draft.marketDescription ?? '',
    isNameConfirmed: draft.isNameConfirmed ?? false,
    nameTouched: draft.nameTouched ?? false,
    isDescriptionConfirmed: draft.isDescriptionConfirmed ?? false,
    descriptionTouched: draft.descriptionTouched ?? false,
    isIconConfirmed: draft.isIconConfirmed ?? false,
    similarMarketsAcknowledged: draft.similarMarketsAcknowledged ?? false,
    discoveryResult: draft.discoveryResult ?? null,
    discoveryState: draft.discoveryState ?? 'idle',
    selectedSource: draft.selectedSource ? deserializeSource(draft.selectedSource) : null,
    validationResult: draft.validationResult ?? null,
    deniedSourceUrls: draft.deniedSourceUrls ?? [],
    iconStoredUrl: draft.iconUrl ?? null,
    iconPreviewUrl: draft.iconUrl ?? null,
    assistantHistory: draft.assistantHistory ?? [],
    visibleStep: (STEP_ORDER.includes(draft.currentStep as any) ? draft.currentStep : 'clarify_metric') as CreationStep,
  };
}
