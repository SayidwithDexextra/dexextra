export interface VAMMFormData {
  // Step 1: Market Information
  symbol: string;
  description: string;
  category: string[];
  
  // Step 2: Oracle Configuration
  oracleAddress: string;
  initialPrice: string;
  priceDecimals: number;
  
  // Step 3: Market Images
  bannerImage: File | null;
  iconImage: File | null;
  supportingPhotos: File[];
  bannerImageUrl: string;
  iconImageUrl: string;
  supportingPhotoUrls: string[];
  
  // Step 4: Advanced Settings
  deploymentFee: string;
  isActive: boolean;
}

export interface StepProps {
  formData: VAMMFormData;
  updateFormData: (data: Partial<VAMMFormData>) => void;
  onNext: () => void;
  onPrevious: () => void;
  errors: FormErrors;
  isLoading?: boolean;
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
    title: 'Oracle Setup',
    description: 'Price oracle configuration'
  },
  {
    id: 3,
    title: 'Market Images',
    description: 'Upload market visuals'
  },
  {
    id: 4,
    title: 'Review & Deploy',
    description: 'Final confirmation'
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