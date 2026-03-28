// Metric Resolution Types (for AI Assistant)
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
}

export interface MetricResolutionState {
  status: 'idle' | 'processing' | 'completed' | 'error';
  data?: MetricResolutionData;
  error?: string;
  processingTime?: string;
  cached?: boolean;
  performance?: {
    totalTime: number;
    breakdown: {
      cacheCheck: string;
      scraping: string;
      processing: string;
      aiAnalysis: string;
    };
  };
}

export interface MarketFormData {
  // Step 1: Market Information
  metricId: string;          // Unique identifier for the metric
  description: string;       // Market description
  category: string;          // Market category for organization
  
  // Step 1: AI Assistant Data for metric validation
  metricResolution?: MetricResolutionData;
  aiAssistantData?: {
    urls: string[];
    hasAnalyzed: boolean;
    canAnalyze: boolean;
    triggerAnalysis?: () => void;
  };
  
  // Step 2: Trading Configuration
  decimals: number;          // Decimal precision for the metric
  minimumOrderSize: string;  // Minimum order size in base units
  tickSize: string;          // Fixed at 0.01 - no longer user configurable
  requiresKYC: boolean;      // Whether market requires KYC
  
  // Step 3: Settlement Configuration
  settlementDate: string;    // Unix timestamp for market settlement
  tradingEndDate: string;    // When trading stops (before settlement)
  dataRequestWindow: string; // How long before settlement to request data (in seconds)
  autoSettle: boolean;       // Whether market auto-settles or needs manual trigger
  oracleProvider: string;    // Oracle provider address (UMA oracle manager)
  
  // Step 3: Initial Order Configuration (Optional)
  initialOrder: {
    enabled: boolean;        // Whether to place an initial order
    side: 'BUY' | 'SELL';   // Order side
    quantity: string;        // Order quantity
    price: string;           // Order price
    timeInForce: 'GTC' | 'IOC' | 'FOK' | 'GTD'; // Time in force
    expiryTime: string;      // Expiry time for GTD orders (Unix timestamp)
  };
  
  // Step 4: Market Images (unchanged)
  bannerImage: File | null;
  iconImage: File | null;
  supportingPhotos: File[];
  bannerImageUrl: string;
  iconImageUrl: string;
  supportingPhotoUrls: string[];
  
  // Step 5: Advanced Settings & Review
  creationFee: string;       // Market creation fee
  isActive: boolean;         // Whether market should be active immediately
  
  // System Integration Fields (populated during deployment)
  factoryAddress?: string;
  centralVaultAddress?: string;
  orderRouterAddress?: string;
  umaOracleManagerAddress?: string;
  chainId?: number;
}

// Settlement timing helper types
export interface SettlementTiming {
  settlementDate: Date;
  tradingEndDate: Date;
  dataRequestWindowHours: number;
}

// Order types from IOrderRouter interface
export interface OrderConfig {
  side: 'BUY' | 'SELL';
  quantity: string;
  price: string;
  timeInForce: 'GTC' | 'IOC' | 'FOK' | 'GTD';
  expiryTime?: string;
}

export interface StepProps {
  formData: MarketFormData;
  updateFormData: (data: Partial<MarketFormData>) => void;
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
    description: 'Basic market details and metric configuration'
  },
  {
    id: 2,
    title: 'Trading Config',
    description: 'Order book and trading parameters'
  },
  {
    id: 3,
    title: 'Settlement Config',
    description: 'Oracle integration and settlement timeline'
  },
  {
    id: 4,
    title: 'Market Images',
    description: 'Upload market visuals and branding'
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
  metricId?: string;
  marketAddress?: string;
  factoryAddress?: string;
  oracleProvider?: string;
  transactionHash?: string;
  blockNumber?: number;
  gasUsed?: string;
  error?: string;
}

// Market categories for orderbook-dex (synced with VALID_CATEGORIES in suggestCategories.ts)
export const MARKET_CATEGORIES = [
  { value: 'Agriculture', label: 'Agriculture' },
  { value: 'Automotive', label: 'Automotive' },
  { value: 'Commodities', label: 'Commodities' },
  { value: 'Consumer Goods', label: 'Consumer Goods' },
  { value: 'Cryptocurrency', label: 'Cryptocurrency' },
  { value: 'Demographics', label: 'Demographics & Population' },
  { value: 'Development', label: 'Development' },
  { value: 'Digital Assets', label: 'Digital Assets' },
  { value: 'Economics', label: 'Economic Indicators' },
  { value: 'Education', label: 'Education' },
  { value: 'Energy', label: 'Energy' },
  { value: 'Entertainment', label: 'Entertainment' },
  { value: 'Environment', label: 'Environmental Metrics' },
  { value: 'Equities', label: 'Equities' },
  { value: 'Financial', label: 'Financial Markets' },
  { value: 'Food & Beverages', label: 'Food & Beverages' },
  { value: 'Forex', label: 'Forex & Currency' },
  { value: 'Futures', label: 'Futures' },
  { value: 'Gaming', label: 'Gaming' },
  { value: 'Governance', label: 'Governance' },
  { value: 'Health', label: 'Health & Medical Data' },
  { value: 'Indices', label: 'Indices' },
  { value: 'Industrial Metals', label: 'Industrial Metals' },
  { value: 'Infrastructure', label: 'Infrastructure' },
  { value: 'Labor & Employment', label: 'Labor & Employment' },
  { value: 'Natural Gas', label: 'Natural Gas' },
  { value: 'Politics', label: 'Politics' },
  { value: 'Precious Metals', label: 'Precious Metals' },
  { value: 'Real Estate', label: 'Real Estate' },
  { value: 'Science', label: 'Science' },
  { value: 'Social', label: 'Social Metrics' },
  { value: 'Soft Commodities', label: 'Soft Commodities' },
  { value: 'Sports', label: 'Sports & Events' },
  { value: 'Stocks', label: 'Stocks' },
  { value: 'Technology', label: 'Technology' },
  { value: 'Top Picks', label: 'Top Picks' },
  { value: 'Transportation', label: 'Transportation' },
  { value: 'Weather', label: 'Weather & Climate' },
  { value: 'Custom', label: 'Custom Metrics' },
] as const;

// Common oracle providers (will be populated from orderbook-dex deployment)
export const ORACLE_PROVIDERS = [
  { value: 'UMA', label: 'UMA Optimistic Oracle V3', description: 'Decentralized oracle for custom metrics' },
  { value: 'Custom', label: 'Custom Oracle', description: 'Use a custom oracle provider' }
] as const;

// Time in force options
export const TIME_IN_FORCE_OPTIONS = [
  { value: 'GTC', label: 'Good Till Cancelled', description: 'Order remains active until cancelled' },
  { value: 'IOC', label: 'Immediate or Cancel', description: 'Execute immediately or cancel' },
  { value: 'FOK', label: 'Fill or Kill', description: 'Execute completely or cancel' },
  { value: 'GTD', label: 'Good Till Date', description: 'Order expires at specified time' }
] as const;

// Settlement timing presets
export const SETTLEMENT_PRESETS = [
  { 
    label: '1 Week Settlement',
    description: 'Trading ends 1 day before settlement',
    tradingDurationDays: 6,
    settlementDelayDays: 7,
    dataRequestWindowHours: 24
  },
  { 
    label: '1 Month Settlement',
    description: 'Trading ends 3 days before settlement',
    tradingDurationDays: 27,
    settlementDelayDays: 30,
    dataRequestWindowHours: 72
  },
  { 
    label: '3 Month Settlement',
    description: 'Trading ends 1 week before settlement',
    tradingDurationDays: 83,
    settlementDelayDays: 90,
    dataRequestWindowHours: 168
  },
  { 
    label: 'Custom Timeline',
    description: 'Set your own settlement schedule',
    tradingDurationDays: 0,
    settlementDelayDays: 0,
    dataRequestWindowHours: 0
  }
] as const;
