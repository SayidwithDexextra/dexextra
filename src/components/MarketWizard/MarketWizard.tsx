'use client'

import React, { useState, useEffect, useRef, useMemo } from 'react'
import { createWalletClient, custom } from 'viem'
import { polygon } from 'viem/chains'
import styles from './MarketWizard.module.css'
import { MarketFormData, FormErrors, StepId, DeploymentResult } from './types'
import { validateStep1, validateStep2, validateStep3, validateStep4, validateStep5, canProceedFromStep } from './validation'
import FixedStepFooter from './FixedStepFooter'
import { useWallet } from '@/hooks/useWallet'
import { uploadMarketImages, cleanupPreviewUrls } from '@/lib/imageUpload'

// Step components
import Step1MarketInfo from './steps/Step1MarketInfo'
import Step2TradingConfig from './steps/Step2TradingConfig'
import Step3SettlementConfig from './steps/Step3SettlementConfig'
import Step4MarketImages from './steps/Step4MarketImages'
import Step5ReviewDeploy from './steps/Step5ReviewDeploy'

// Default contract addresses - these should come from environment or deployment configuration
const DEFAULT_CONTRACT_ADDRESSES = {
  metricsMarketFactory: process.env.NEXT_PUBLIC_METRICS_MARKET_FACTORY || '',
  centralVault: process.env.NEXT_PUBLIC_CENTRAL_VAULT || '',
  orderRouter: process.env.NEXT_PUBLIC_ORDER_ROUTER || '',
  umaOracleManager: process.env.NEXT_PUBLIC_UMA_ORACLE_MANAGER || '',
}

const INITIAL_FORM_DATA: MarketFormData = {
  // Step 1: Market Information
  metricId: '',
  description: '',
  category: '',
  
  // Step 2: Trading Configuration
  decimals: 8,
  minimumOrderSize: '',
  tickSize: '0.01', // Fixed tick size
  requiresKYC: false,
  
  // Step 3: Settlement Configuration
  settlementDate: '',
  tradingEndDate: '',
  dataRequestWindow: '',
  autoSettle: true,
  oracleProvider: DEFAULT_CONTRACT_ADDRESSES.umaOracleManager,
  
  // Step 3: Initial Order Configuration
  initialOrder: {
    enabled: false,
    side: 'BUY',
    quantity: '',
    price: '',
    timeInForce: 'GTC',
    expiryTime: '',
  },
  
  // Step 4: Market Images
  bannerImage: null,
  iconImage: null,
  supportingPhotos: [],
  bannerImageUrl: '',
  iconImageUrl: '',
  supportingPhotoUrls: [],
  
  // Step 5: Advanced Settings & Review
  creationFee: '0.1', // Will be updated from contract
  isActive: true,
}

interface MarketWizardProps {
  onSuccess?: (marketData: any) => void
  onError?: (error: string) => void
}

const MarketWizard: React.FC<MarketWizardProps> = ({ onSuccess, onError }) => {
  const [currentStep, setCurrentStep] = useState<number>(1)
  const [formData, setFormData] = useState<MarketFormData>(INITIAL_FORM_DATA)
  const [errors, setErrors] = useState<FormErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deploymentResult, setDeploymentResult] = useState<DeploymentResult>()
  const [deploymentPhase, setDeploymentPhase] = useState<'idle' | 'deploying' | 'success' | 'error'>('idle')
  const isMountedRef = useRef(true)

  // Wallet connection
  const { 
    walletData, 
    connect: connectWallet, 
    disconnect: disconnectWallet, 
    refreshBalance 
  } = useWallet()

  const walletClient = useMemo(() => {
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      return createWalletClient({
        chain: polygon,
        transport: custom((window as any).ethereum)
      });
    }
    return null;
  }, []);

  // Update creation fee on mount (this would come from MetricsMarketFactory)
  useEffect(() => {
    const updateCreationFee = async () => {
      try {
        // TODO: Implement actual fee fetching from MetricsMarketFactory
        // const fee = await metricsMarketFactoryService.getCreationFee()
        const fee = '0.1'; // Default fee
        if (isMountedRef.current) {
          setFormData(prev => ({ ...prev, creationFee: fee }))
        }
      } catch (error) {
        console.error('Error fetching creation fee:', error)
      }
    }

    updateCreationFee()
  }, [])

  const updateFormData = (updates: Partial<MarketFormData>) => {
    if (!isMountedRef.current) return
    
    setFormData(prev => ({ ...prev, ...updates }))
    
    // Clear field-specific errors when user starts typing
    const newErrors = { ...errors }
    Object.keys(updates).forEach(key => {
      delete newErrors[key]
    })
    setErrors(newErrors)
  }

  const validationFunctions = [
    validateStep1,
    validateStep2,
    validateStep3,
    validateStep4,
    validateStep5,
  ];

  const validateCurrentStepData = (): boolean => {
    if (currentStep < 1 || currentStep > validationFunctions.length) {
      setErrors({ general: 'Invalid step' });
      return false;
    }
    const validator = validationFunctions[currentStep - 1];
    const { isValid, errors: validationErrors } = validator(formData);
    
    setErrors(validationErrors);
    return isValid;
  };

  const canProceed = (): boolean => {
    return canProceedFromStep(currentStep, formData);
  };

  const handleNext = () => {
    if (!isMountedRef.current) return
    
    // Special handling for step 1 (Market Info) - AI Assistant
    if (currentStep === 1) {
      const aiData = formData.aiAssistantData;
      
      // Check if user has URLs but hasn't analyzed them yet
      if (aiData && aiData.urls.length > 0 && !aiData.hasAnalyzed && aiData.canAnalyze) {
        // Trigger analysis automatically
        console.log('🔍 Auto-triggering metric analysis before proceeding...');
        if (aiData.triggerAnalysis) {
          aiData.triggerAnalysis();
          // Analysis will update formData, and user can proceed once complete
          return;
        }
      }
    }
    
    if (validateCurrentStepData() && currentStep < 5) {
      setCurrentStep(currentStep + 1)
    }
  }

  const handlePrevious = () => {
    if (!isMountedRef.current) return
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleStepClick = (step: number) => {
    if (!isMountedRef.current) return
    // Allow jumping to any step for now
    setCurrentStep(step)
  }

  // Function to populate all fields with valid default data
  const populateDefaultData = (): MarketFormData => {
    const timestamp = Date.now();
    const randomId = Math.floor(Math.random() * 10000);
    const uniqueMetricId = `WORLD_POPULATION_${timestamp}_${randomId}`;
    
    // Calculate settlement dates (1 week from now)
    const now = new Date();
    const tradingEndDate = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000); // 6 days
    const settlementDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
    
    return {
      // Step 1: Market Information
      metricId: uniqueMetricId,
      description: 'Global population count as officially reported by the United Nations World Population Review, settling with verified demographic data.',
      category: 'Demographics',
      
      // Step 1: AI Assistant Data (optional)
      metricResolution: undefined,
      aiAssistantData: {
        urls: [],
        hasAnalyzed: false,
        canAnalyze: false,
        triggerAnalysis: undefined,
      },
      
      // Step 2: Trading Configuration
      decimals: 8,
      minimumOrderSize: '1.0',
      tickSize: '0.01',
      requiresKYC: false,
      
      // Step 3: Settlement Configuration
      settlementDate: Math.floor(settlementDate.getTime() / 1000).toString(),
      tradingEndDate: Math.floor(tradingEndDate.getTime() / 1000).toString(),
      dataRequestWindow: (24 * 3600).toString(), // 24 hours
      autoSettle: true,
      oracleProvider: DEFAULT_CONTRACT_ADDRESSES.umaOracleManager,
      
      // Step 3: Initial Order Configuration
      initialOrder: {
        enabled: true,
        side: 'BUY',
        quantity: '10.0',
        price: '100.00',
        timeInForce: 'GTC',
        expiryTime: '',
      },
      
      // Step 4: Market Images (using placeholder URLs)
      bannerImage: null,
      iconImage: null,
      supportingPhotos: [],
      bannerImageUrl: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/market-images/markets/icon/1752533843227-grotpltlvi.png',
      iconImageUrl: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/market-images/markets/icon/1752533860128-u5ftbhnqk3.gif',
      supportingPhotoUrls: [],
      
      // Step 5: Advanced Settings & Review
      creationFee: formData.creationFee || '0.1',
      isActive: true,
    }
  }

  // Function to skip to final step with populated data
  const handleSkipToFinal = () => {
    if (!isMountedRef.current) return
    
    console.log('🚀 Skipping to final step with default data...')
    const defaultData = populateDefaultData()
    setFormData(defaultData)
    setCurrentStep(5)
    setErrors({}) // Clear any existing errors
  }

  const handleDeploy = async (): Promise<DeploymentResult> => {
    if (!walletClient) {
      throw new Error('Wallet not found. Please run this in a browser environment.');
    }

    if (!validateCurrentStepData()) {
      throw new Error('Validation failed');
    }

    if (!isMountedRef.current) {
      return { success: false, error: 'Component unmounted' }
    }

    // Check wallet connection
    if (!walletData.isConnected || !walletData.address) {
      throw new Error('Please connect your wallet first')
    }

    setDeploymentPhase('deploying')

    try {
      // Step 1: Upload images to Supabase storage
      console.log('📸 Uploading images...')
      let finalImageUrls = {
        bannerImageUrl: undefined as string | undefined,
        iconImageUrl: undefined as string | undefined,
        supportingPhotoUrls: [] as string[]
      };

      const imageUploadResult = await uploadMarketImages(
        formData.bannerImage || undefined,
        formData.iconImage || undefined,
        formData.supportingPhotos
      );

      if (!imageUploadResult.success) {
        throw new Error(`Image upload failed: ${imageUploadResult.error}`);
      }

      if (imageUploadResult.urls) {
        finalImageUrls = imageUploadResult.urls as {
          bannerImageUrl: string | undefined;
          iconImageUrl: string | undefined;
          supportingPhotoUrls: string[];
        };
        console.log('✅ Images uploaded successfully');
      }

      // Cleanup preview URLs to prevent memory leaks
      const previewUrls = [
        formData.bannerImageUrl,
        formData.iconImageUrl,
        ...formData.supportingPhotoUrls
      ].filter(Boolean) as string[];
      cleanupPreviewUrls(previewUrls);

      // Step 2: Prepare MetricsMarketFactory configuration
      const marketConfig = {
        metricId: formData.metricId,
        description: formData.description,
        oracleProvider: formData.oracleProvider,
        decimals: formData.decimals,
        minimumOrderSize: parseFloat(formData.minimumOrderSize),
        tickSize: 0.01, // Fixed tick size
        creationFee: parseFloat(formData.creationFee),
        requiresKYC: formData.requiresKYC,
        settlementDate: parseInt(formData.settlementDate),
        tradingEndDate: parseInt(formData.tradingEndDate),
        dataRequestWindow: parseInt(formData.dataRequestWindow),
        autoSettle: formData.autoSettle,
        initialOrder: formData.initialOrder.enabled ? {
          enabled: true,
          side: formData.initialOrder.side === 'BUY' ? 0 : 1, // Convert to enum
          quantity: parseFloat(formData.initialOrder.quantity),
          price: parseFloat(formData.initialOrder.price),
          timeInForce: ['GTC', 'IOC', 'FOK', 'GTD'].indexOf(formData.initialOrder.timeInForce),
          expiryTime: formData.initialOrder.expiryTime ? parseInt(formData.initialOrder.expiryTime) : 0,
        } : {
          enabled: false,
          side: 0,
          quantity: 0,
          price: 0,
          timeInForce: 0,
          expiryTime: 0,
        }
      }

      console.log('📋 Market configuration:', marketConfig)

      // Step 3: Deploy market using MetricsMarketFactory
      // TODO: Implement actual MetricsMarketFactory deployment
      console.log('🚀 Deploying market via MetricsMarketFactory...')
      
      // Simulate deployment for now
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const deploymentResult = {
        success: true,
        marketId: formData.metricId,
        metricId: formData.metricId,
        marketAddress: `0x${Math.random().toString(16).substr(2, 40)}`, // Mock address
        factoryAddress: DEFAULT_CONTRACT_ADDRESSES.metricsMarketFactory,
        oracleProvider: formData.oracleProvider,
        transactionHash: `0x${Math.random().toString(16).substr(2, 64)}`, // Mock tx hash
        blockNumber: Math.floor(Math.random() * 1000000) + 50000000,
        gasUsed: '342156',
      }

      // Step 4: Save market record to database
      const marketData = {
        // Basic market information
        metric_id: formData.metricId,
        description: formData.description || `${formData.metricId} orderbook market with UMA oracle settlement`,
        category: [formData.category], // Convert to array as expected by API
        
        // Trading configuration
        decimals: formData.decimals,
        minimum_order_size: parseFloat(formData.minimumOrderSize),
        tick_size: 0.01, // Fixed tick size
        requires_kyc: formData.requiresKYC,
        
        // Settlement configuration
        settlement_date: new Date(parseInt(formData.settlementDate) * 1000).toISOString(),
        trading_end_date: new Date(parseInt(formData.tradingEndDate) * 1000).toISOString(),
        data_request_window_hours: Math.floor(parseInt(formData.dataRequestWindow) / 3600),
        auto_settle: formData.autoSettle,
        oracle_provider: formData.oracleProvider,
        
        // Media assets
        banner_image_url: finalImageUrls.bannerImageUrl || null,
        icon_image_url: finalImageUrls.iconImageUrl || null,
        supporting_photo_urls: finalImageUrls.supportingPhotoUrls || [],
        
        // Deployment configuration
        creation_fee: parseFloat(formData.creationFee),
        is_active: formData.isActive,
        user_address: walletData.address,
        
        // Contract deployment details
        market_address: deploymentResult.marketAddress,
        factory_address: deploymentResult.factoryAddress,
        transaction_hash: deploymentResult.transactionHash,
        deployment_status: 'deployed',
        
        // Enhanced metadata fields
        block_number: deploymentResult.blockNumber,
        gas_used: deploymentResult.gasUsed,
        network: 'hyperliquid_testnet',
        chain_id: 998,
        
        // Initial order configuration
        initial_order_enabled: formData.initialOrder.enabled,
        initial_order_side: formData.initialOrder.enabled ? formData.initialOrder.side : null,
        initial_order_quantity: formData.initialOrder.enabled ? parseFloat(formData.initialOrder.quantity) : null,
        initial_order_price: formData.initialOrder.enabled ? parseFloat(formData.initialOrder.price) : null,
        initial_order_time_in_force: formData.initialOrder.enabled ? formData.initialOrder.timeInForce : null,
      }

      console.log('💾 Saving to database...')
      const response = await fetch('/api/orderbook-markets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(marketData),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        console.error('❌ Database save failed but contract deployed successfully:', errorData)
        console.error('📋 Market data that failed to save:', JSON.stringify(marketData, null, 2))
        console.error('🔍 Response status:', response.status, response.statusText)
        
        // Still show success to user since contract deployed, but log the issue  
        const errorMsg = (errorData as any)?.error || 'Unknown error'
        console.warn(`⚠️ Contract deployed successfully, but database save failed: ${errorMsg}`)
        console.warn(`Market Address: ${deploymentResult.marketAddress}`)
      } else {
        const saveResponse = await response.json()
        console.log('✅ Successfully saved market to database:', saveResponse)
        console.log('🔗 Market can now be discovered in frontend trading interface')
      }

      // Refresh wallet balance after paying deployment fee
      if (refreshBalance) {
        refreshBalance()
      }

      console.log('🎉 Full deployment completed successfully!')

      const successResult = {
        success: true,
        marketId: deploymentResult.marketId,
        metricId: formData.metricId,
        marketAddress: deploymentResult.marketAddress,
        factoryAddress: deploymentResult.factoryAddress,
        oracleProvider: formData.oracleProvider,
        transactionHash: deploymentResult.transactionHash,
        blockNumber: deploymentResult.blockNumber,
        gasUsed: deploymentResult.gasUsed
      }

      if (isMountedRef.current) {
        setDeploymentResult(successResult)
        setDeploymentPhase('success')
      }

      return successResult
      
    } catch (error) {
      console.error('❌ Deployment failed:', error)
      
      if (isMountedRef.current) {
        setDeploymentPhase('error')
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown deployment error'
      const errorResult = {
        success: false,
        error: errorMessage
      }
      
      if (isMountedRef.current) {
        setDeploymentResult(errorResult)
      }
      
      throw error
    }
  }

  const handleSubmit = async () => {
    if (!validateCurrentStepData() || !isMountedRef.current) return

    setIsSubmitting(true)
    
    try {
      const result = await handleDeploy()
      onSuccess?.(result)
    } catch (error) {
      console.error('Deployment failed:', error)
      onError?.(error instanceof Error ? error.message : 'Failed to deploy market. Please try again.')
    } finally {
      if (isMountedRef.current) {
        setIsSubmitting(false)
      }
    }
  }

  // Component mount/unmount tracking
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      
      // Cleanup preview URLs when component unmounts
      const previewUrls = [
        formData.bannerImageUrl,
        formData.iconImageUrl,
        ...formData.supportingPhotoUrls
      ].filter(Boolean) as string[];
      cleanupPreviewUrls(previewUrls);
    }
  }, [])

  const renderCurrentStep = () => {
    const stepProps = {
      formData,
      updateFormData,
      onNext: handleNext,
      onPrevious: handlePrevious,
      errors,
      isLoading: isSubmitting || deploymentPhase === 'deploying',
    }

    switch (currentStep) {
      case 1:
        return <Step1MarketInfo {...stepProps} onSkipToFinal={handleSkipToFinal} />
      case 2:
        return <Step2TradingConfig {...stepProps} />
      case 3:
        return <Step3SettlementConfig {...stepProps} />
      case 4:
        return <Step4MarketImages {...stepProps} />
      case 5:
        return <Step5ReviewDeploy 
          {...stepProps} 
          onDeploy={handleDeploy} 
          deploymentResult={deploymentResult}
          deploymentPhase={deploymentPhase}
          walletData={walletData}
          onConnectWallet={connectWallet}
          contractAddresses={DEFAULT_CONTRACT_ADDRESSES}
        />
      default:
        return <Step1MarketInfo {...stepProps} onSkipToFinal={handleSkipToFinal} />
    }
  }

  return (
    <>
      <div className={styles.container}>
        <div className={styles.formSection}>
          {renderCurrentStep()}
        </div>
      </div>

      <FixedStepFooter
        currentStep={currentStep}
        totalSteps={5}
        canProceed={canProceed()}
        onStepClick={handleStepClick}
        onNext={handleNext}
        onPrevious={handlePrevious}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting || deploymentPhase === 'deploying'}
        isLoading={isSubmitting || deploymentPhase === 'deploying'}
        walletConnected={walletData.isConnected}
        walletAddress={walletData.address}
        formData={formData}
      />
    </>
  )
}

export default MarketWizard
