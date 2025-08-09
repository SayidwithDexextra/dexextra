export interface VAMMFormData {
  // Step 1: Market Information
  symbol: string;
  description: string;
  category: string; // Single category string for DexV2
  
  // Step 2: Metrics Configuration
  metricName: string; // Main metric name for display
  metricDataSource: string; // Data source (e.g., "Chainlink", "UMA", "Custom")
  settlementPeriod: string; // Settlement period in seconds (auto-generated metricIds, fixed updateFrequency)
  
  // Step 2: Metric Resolution Data
  metricResolution?: MetricResolutionData;
  
  // Step 2: AI Assistant Data for auto-triggering analysis
  aiAssistantData?: {
    urls: string[];
    hasAnalyzed: boolean;
    canAnalyze: boolean;
    triggerAnalysis?: () => void;
  };
  
  // Step 3: VAMM Template Configuration
  templateType: 'preset' | 'custom';
  presetTemplate: string; // "conservative", "standard", "aggressive"
  customTemplate: {
    maxLeverage: string;
    tradingFeeRate: string; // basis points
    liquidationFeeRate: string; // basis points
    maintenanceMarginRatio: string; // basis points
    initialReserves: string; // token amount
    volumeScaleFactor: string;
    startPrice: string; // Custom starting price for the asset (e.g., "88" for $88)
  };
  
  // Step 4: Market Images
  bannerImage: File | null;
  iconImage: File | null;
  supportingPhotos: File[];
  bannerImageUrl: string;
  iconImageUrl: string;
  supportingPhotoUrls: string[];
  
  // Step 5: Advanced Settings & Review
  deploymentFee: string;
  customTemplateFee: string;
  isActive: boolean;
  oracleAddress: string; // For metric price feeds
  initialPrice: string; // For metric initialization
  priceDecimals: number;
  
  // System Integration Fields (populated during deployment)
  metricRegistryAddress?: string;
  centralizedVaultAddress?: string;
  chainId?: number;
  factoryAddress?: string;
  routerAddress?: string;
  collateralTokenAddress?: string;
}

// Metric Resolution Types
export interface MetricSource {
  url: string;
  screenshot_url: string;
  quote: string;
  match_score: number;
}

export interface MetricResolutionData {
  metric: string;
  value: string;
  unit: string;
  as_of: string;
  confidence: number;
  asset_price_suggestion: string;
  reasoning: string;
  sources: MetricSource[];
  status: 'processing' | 'completed' | 'failed';
  processingTime?: string;
  cached?: boolean;
}

export interface MetricResolutionState {
  isProcessing: boolean;
  data?: MetricResolutionData;
  error?: string;
  jobId?: string;
  urls: string[];
  currentUrl: string;
}

export interface StepProps {
  formData: VAMMFormData;
  updateFormData: (data: Partial<VAMMFormData>) => void;
  onNext: () => void;
  onPrevious: () => void;
  errors: FormErrors;
  isLoading?: boolean;
  onSkipToFinal?: () => void;
}

export interface FormErrors {
  [key: string]: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: FormErrors;
}

export const STEPS = [
  {
    id: 1,
    title: 'Market Info',
    description: 'Basic market details'
  },
  {
    id: 2,
    title: 'Metrics Setup',
    description: 'Configure metrics and data sources'
  },
  {
    id: 3,
    title: 'VAMM Template',
    description: 'Trading parameters and risk settings'
  },
  {
    id: 4,
    title: 'Market Images',
    description: 'Upload market visuals'
  },
  {
    id: 5,
    title: 'Review & Deploy',
    description: 'Final confirmation and deployment'
  }
] as const;

export type StepId = typeof STEPS[number]['id'];

export interface DeploymentResult {
  success: boolean;
  marketId?: string;
  symbol?: string;
  vammAddress?: string;
  vaultAddress?: string;
  oracleAddress?: string;
  collateralToken?: string;
  transactionHash?: string;
  blockNumber?: number;
  gasUsed?: string;
  error?: string;
} 