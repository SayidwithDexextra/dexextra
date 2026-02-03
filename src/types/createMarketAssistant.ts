export type CreateMarketAssistantStep =
  | 'idle'
  | 'discovering'
  | 'clarify_metric'
  | 'name'
  | 'description'
  | 'select_source'
  | 'icon'
  | 'complete';

export type CreateMarketAssistantRole = 'system' | 'user' | 'assistant';

export type CreateMarketAssistantHistoryMessage = {
  role: CreateMarketAssistantRole;
  content: string;
};

export type CreateMarketAssistantContext = {
  metricPrompt?: string;
  discovery?: {
    measurable?: boolean;
    rejection_reason?: string | null;
    metric_definition?: {
      metric_name?: string;
      unit?: string;
      scope?: string;
      time_basis?: string;
      measurement_method?: string;
    } | null;
    assumptions?: string[];
    sources?: {
      primary_source?: {
        url: string;
        authority: string;
        confidence: number;
      } | null;
      secondary_sources?: Array<{
        url: string;
        authority: string;
        confidence: number;
      }>;
    } | null;
  } | null;

  marketName?: string;
  marketDescription?: string;

  selectedSource?: {
    url: string;
    label?: string;
    authority?: string;
    confidence?: number;
  } | null;
};

export type CreateMarketAssistantRequest = {
  step: CreateMarketAssistantStep;
  context: CreateMarketAssistantContext;
  history?: CreateMarketAssistantHistoryMessage[];
};

export type CreateMarketAssistantResponse = {
  message: string;
  suggestions?: {
    marketName?: string;
    marketDescription?: string;
  };
  meta?: {
    model?: string;
    metricUrl?: string;
    interestRating?: number;
  };
};
