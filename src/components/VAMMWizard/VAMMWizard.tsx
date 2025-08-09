'use client'

import React, { useState, useEffect, useRef, useMemo } from 'react'

// Use existing ethereum type declarations
import { createWalletClient, custom } from 'viem'
import { polygon } from 'viem/chains'
import styles from './VAMMWizard.module.css'
import { VAMMFormData, FormErrors, StepId, DeploymentResult } from './types'
import { validateStep1, validateStep2, validateStep3, validateStep4, validateStep5 } from './validation'
import FixedStepFooter from './FixedStepFooter'
import { useWallet } from '@/hooks/useWallet'
import { contractDeploymentService, DEFAULT_ADDRESSES } from '@/lib/contractDeployment'
import type { MarketDeploymentParams } from '@/lib/contractDeployment'
import { uploadMarketImages, cleanupPreviewUrls } from '@/lib/imageUpload'

// Step components
import Step1MarketInfo from './steps/Step1MarketInfo'
import Step2MetricsSetup from './steps/Step2MetricsSetup'
import Step3VAMMTemplate from './steps/Step3VAMMTemplate'
import Step4MarketImages from './steps/Step4MarketImages'
import Step5ReviewDeploy from './steps/Step5ReviewDeploy'

const INITIAL_FORM_DATA: VAMMFormData = {
  symbol: '',
  description: '',
  category: '', // Single category string for DexV2
  metricName: '',
  metricDataSource: '',
  settlementPeriod: '86400', // 1 day default
  templateType: 'preset',
  presetTemplate: 'standard',
  customTemplate: {
    maxLeverage: '50',
    tradingFeeRate: '30', // 0.3%
    liquidationFeeRate: '500', // 5%
    maintenanceMarginRatio: '500', // 5%
    initialReserves: '10000',
    volumeScaleFactor: '1000',
    startPrice: '1' // Default start price of $1
  },
  bannerImage: null,
  iconImage: null,
  supportingPhotos: [],
  bannerImageUrl: '',
  iconImageUrl: '',
  supportingPhotoUrls: [],
  deploymentFee: '0.1', // Will be updated from contract
  customTemplateFee: '0.05', // Additional fee for custom templates
  isActive: true,
        oracleAddress: DEFAULT_ADDRESSES.mockOracle.includes('placeholder') 
        ? '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419' // Chainlink ETH/USD fallback
        : DEFAULT_ADDRESSES.mockOracle,
  initialPrice: '',
  priceDecimals: 8,
}

interface VAMMWizardProps {
  onSuccess?: (marketData: any) => void
  onError?: (error: string) => void
}

const VAMMWizard: React.FC<VAMMWizardProps> = ({ onSuccess, onError }) => {
  const [currentStep, setCurrentStep] = useState<number>(1)
  const [formData, setFormData] = useState<VAMMFormData>(INITIAL_FORM_DATA)
  const [errors, setErrors] = useState<FormErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deploymentResult, setDeploymentResult] = useState<any>()
  const [deploymentPhase, setDeploymentPhase] = useState<'idle' | 'registering_metric' | 'creating_template' | 'deploying_contracts' | 'confirming' | 'success' | 'error'>('idle')
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

  // Update deployment fee on mount
  useEffect(() => {
    const updateDeploymentFee = async () => {
      try {
        const fee = await contractDeploymentService.getDeploymentFee()
        if (isMountedRef.current) {
          setFormData(prev => ({ ...prev, deploymentFee: fee }))
        }
      } catch (error) {
        console.error('Error fetching deployment fee:', error)
      }
    }

    updateDeploymentFee()
  }, [])

  const updateFormData = (updates: Partial<VAMMFormData>) => {
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
    const { isValid, errors } = validator(formData);
    
    // Debug logging for Step 2 validation issues
    if (currentStep === 2 && !isValid) {
      console.log('🔍 Step 2 Validation Failed:', {
        formData: {
          metricName: formData.metricName,
          metricDataSource: formData.metricDataSource,
          settlementPeriod: formData.settlementPeriod,
          metricResolution: formData.metricResolution
        },
        errors,
        isValid
      });
    }
    
    setErrors(errors);
    return isValid;
  };

  const canProceed = (): boolean => {
    if (currentStep < 1 || currentStep > validationFunctions.length) {
      return false;
    }
    const validator = validationFunctions[currentStep - 1];
    const { isValid } = validator(formData);
    
    // Debug logging for canProceed
    if (currentStep === 2) {
      console.log('🔍 Step 2 canProceed check:', {
        isValid,
        metricName: formData.metricName,
        metricDataSource: formData.metricDataSource,
        settlementPeriod: formData.settlementPeriod,
        hasMetricResolution: !!formData.metricResolution,
        metricResolutionStatus: formData.metricResolution?.status
      });
    }
    
    return isValid;
  };

  const handleNext = () => {
    if (!isMountedRef.current) return
    
    // Special handling for step 2 (Metrics Setup)
    if (currentStep === 2) {
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
  const populateDefaultData = (): VAMMFormData => {
    // Create unique metric name and category with timestamp + random component to avoid duplicates
    const timestamp = Date.now();
    const randomId = Math.floor(Math.random() * 10000); // Add random number 0-9999
    const uniqueMetricName = `Gold V6 Test ${timestamp}-${randomId}`;
    const uniqueCategory = `Gold price tracking metric with automated settlement v${timestamp}-${randomId}`;
    
    console.log('🎲 Generated unique category:', uniqueCategory); // Debug log
    
    return {
      // Step 1: Market Information
      symbol: uniqueMetricName,
      description: 'Gold price tracking metric with automated settlement',
      category: uniqueCategory,
      
      // Step 2: Metrics Configuration
      metricName: uniqueMetricName,
      metricDataSource: 'https://api.goldapi.io/api/XAU/USD', // Valid URL with "api" and "https" keywords
      settlementPeriod: '604800', // 7 days in seconds (7 * 24 * 60 * 60)
      
      // Step 3: VAMM Template Configuration
      templateType: 'preset',
      presetTemplate: 'standard',
      customTemplate: {
        maxLeverage: '50',
        tradingFeeRate: '30',
        liquidationFeeRate: '500',
        maintenanceMarginRatio: '500',
        initialReserves: '500',
        volumeScaleFactor: '1000',
        startPrice: '10' // $10 sample price
      },
      
      // Step 4: Market Images (using placeholder URLs)
      bannerImage: null,
      iconImage: null,
      supportingPhotos: [],
      bannerImageUrl: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/market-images/markets/icon/1752533843227-grotpltlvi.png',
      iconImageUrl: 'https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/market-images/markets/icon/1752533860128-u5ftbhnqk3.gif',
      supportingPhotoUrls: [],
      
      // Step 5: Advanced Settings & Review
      deploymentFee: formData.deploymentFee || '0.1',
      customTemplateFee: '0.05',
      isActive: true,
      oracleAddress: formData.oracleAddress || (DEFAULT_ADDRESSES.mockOracle.includes('placeholder') 
        ? '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419' // Chainlink ETH/USD fallback
        : DEFAULT_ADDRESSES.mockOracle),
      initialPrice: '100',
      priceDecimals: 8,
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

    // Enhanced authorization debugging
    console.log('🔐 AUTHORIZATION DEBUG - Checking deployment authorization...');
    console.log('🔍 Connected wallet address:', walletData.address);
    console.log('🔍 Wallet client account addresses:', await walletClient.getAddresses());
    
    const authStatus = await contractDeploymentService.checkDeploymentAuthorization(walletData.address);
    
    console.log('🔍 Authorization status result:', {
      isAuthorized: authStatus.isAuthorized,
      ownerAddress: authStatus.ownerAddress,
      checkedAddress: walletData.address,
      errorMessage: authStatus.errorMessage
    });
    
    if (!authStatus.isAuthorized) {
      const authError = authStatus.errorMessage || 'Not authorized to deploy VAMMs';
      console.error('❌ AUTHORIZATION FAILED:');
      console.error('   - Checked Address:', walletData.address);
      console.error('   - Factory Owner:', authStatus.ownerAddress);
      console.error('   - Error:', authError);
      
      // Provide helpful guidance to the user
      const guidanceMessage = authStatus.ownerAddress 
        ? `AUTHORIZATION REJECTED: Your wallet (${walletData.address}) is not authorized to deploy VAMMs. Factory Owner: ${authStatus.ownerAddress}. Please contact the system administrator to authorize your wallet address, or use an authorized wallet.`
        : `AUTHORIZATION REJECTED: ${authError}. Wallet: ${walletData.address}`;
        
      throw new Error(guidanceMessage);
    }
    
    console.log('✅ User is authorized to deploy VAMMs');
    setDeploymentPhase('registering_metric')

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

      // Step 2: Register metric first
      if (isMountedRef.current) {
        setDeploymentPhase('registering_metric');
      }

      // Step 2: Get the signer from the connected wallet
      // const walletClient = createWalletClient({
      //   chain: polygon,
      //   transport: custom(window.ethereum)
      // })

      // Step 3: Validate oracle before deployment
      // console.log('🔮 Validating oracle...')
      // const oracleValidation = await contractDeploymentService.validateOracle(formData.oracleAddress)
      // if (!oracleValidation.isValid) {
      //   throw new Error(`Oracle validation failed: ${oracleValidation.error}`)
      // }

      // console.log('✅ Oracle validated. Current price:', oracleValidation.price, 'USD')

      // Step 4: Prepare deployment parameters
      const deploymentParams: MarketDeploymentParams = {
        symbol: formData.symbol,
        description: formData.description,
        category: formData.category, // CRITICAL: Pass the unique category from form data
        oracleAddress: formData.oracleAddress,
        collateralTokenAddress: DEFAULT_ADDRESSES.mockUSDC, // Use default USDC
        initialPrice: formData.customTemplate.startPrice, // Use the startPrice from VAMM template
        userAddress: walletData.address,
        templateName: formData.templateType === 'preset' ? formData.presetTemplate : undefined, // Only use preset template if specified
        // Metric registration parameters
        metricName: formData.metricName || formData.symbol,
        metricDataSource: formData.metricDataSource || 'https://api.example.com/price-feed',
        settlementPeriod: formData.settlementPeriod ? Math.floor(parseInt(formData.settlementPeriod) / 86400) : 7, // Convert seconds to days
        // Custom template parameters (for custom templates)
        customTemplate: formData.templateType === 'custom' ? {
          maxLeverage: formData.customTemplate.maxLeverage,
          tradingFeeRate: formData.customTemplate.tradingFeeRate,
          liquidationFeeRate: formData.customTemplate.liquidationFeeRate,
          maintenanceMarginRatio: formData.customTemplate.maintenanceMarginRatio,
          initialReserves: formData.customTemplate.initialReserves,
          volumeScaleFactor: formData.customTemplate.volumeScaleFactor,
          startPrice: formData.customTemplate.startPrice
        } : undefined
      }

       console.log('📋 Deployment parameters:', deploymentParams)

      // Step 3: Deploy the market using the factory contract (includes metric registration)
      if (isMountedRef.current) {
        setDeploymentPhase('deploying_contracts');
      }
      
      console.log('🚀 CONTRACT DEPLOYMENT DEBUG - Starting deployment...');
      console.log('🔍 Final wallet addresses for deployment:', await walletClient.getAddresses());
      console.log('🔍 Deployment parameters:', {
        userAddress: deploymentParams.userAddress,
        symbol: deploymentParams.symbol,
        metricName: deploymentParams.metricName
      });
      
      let deploymentResult;
      try {
        deploymentResult = await contractDeploymentService.deployMarket(
          deploymentParams,
          walletClient
        );
        console.log('✅ Contract deployment succeeded:', deploymentResult);
      } catch (deploymentError) {
        const error = deploymentError as any;
        console.error('❌ CONTRACT DEPLOYMENT FAILED:');
        console.error('   - User Address:', deploymentParams.userAddress);
        console.error('   - Connected Addresses:', await walletClient.getAddresses());
        console.error('   - Error:', error);
        
        if (error?.message?.includes('not authorized')) {
          console.error('🔍 AUTHORIZATION REJECTION AT CONTRACT LEVEL:');
          console.error('   - The factory contract rejected the deployment');
          console.error('   - Wallet used:', deploymentParams.userAddress);
          console.error('   - This suggests a mismatch between connected wallet and authorized address');
        }
        
        throw error;
      }

      // Step 4: Wait for confirmation
      if (isMountedRef.current) {
        setDeploymentPhase('confirming');
      }

      if (!deploymentResult.success) {
        throw new Error(deploymentResult.error || 'Contract deployment failed')
      }

      // Step 6: Create the market record in Supabase with contract details  
      // NOTE: Using ALL available fields from enhanced vamm_markets schema
      const marketData = {
        // Basic market information (ensure no null values)
        symbol: formData.symbol,
        description: formData.description || `${formData.symbol} specialized VAMM market with automated trading`,
        category: [formData.category], // FIXED: Convert to array as expected by API
        oracle_address: formData.oracleAddress,
        initial_price: parseFloat(formData.customTemplate.startPrice) || 1.0, // Ensure valid number
        price_decimals: formData.priceDecimals || 8,
        
        // Media assets (properly handle nulls)
        banner_image_url: finalImageUrls.bannerImageUrl || null,
        icon_image_url: finalImageUrls.iconImageUrl || null,
        supporting_photo_urls: finalImageUrls.supportingPhotoUrls || [],
        
        // Deployment configuration (ensure valid numbers)
        deployment_fee: parseFloat(formData.deploymentFee) || 0.1,
        is_active: formData.isActive !== undefined ? formData.isActive : true,
        user_address: walletData.address,
        
        // Contract deployment details (ensure all available data is captured)
        vamm_address: deploymentResult.vammAddress,
        vault_address: deploymentResult.vaultAddress,
        market_id: deploymentResult.marketId,
        transaction_hash: deploymentResult.transactionHash,
        deployment_status: 'deployed',
        
        // Enhanced metadata fields (NEW! - comprehensive deployment tracking)
        block_number: deploymentResult.blockNumber,
        gas_used: deploymentResult.gasUsed,
        template_type: formData.templateType, // 'preset' or 'custom'
        template_name: formData.templateType === 'preset' ? formData.presetTemplate : 'custom',
        metric_name: formData.metricName || formData.symbol,
        metric_data_source: formData.metricDataSource || 'Manual Resolution',
        settlement_period_days: formData.settlementPeriod ? Math.floor(parseInt(formData.settlementPeriod) / 86400) : 7,
        max_leverage: parseInt(formData.customTemplate.maxLeverage) || 50,
        trading_fee_rate: parseInt(formData.customTemplate.tradingFeeRate) || 30, // basis points
        volume_scale_factor: parseInt(formData.customTemplate.volumeScaleFactor) || 1000,
        collateral_token: DEFAULT_ADDRESSES.mockUSDC, // Always USDC for V2
        network: 'polygon', // Always Polygon for production
        
        // System Integration Fields (NEW! - Complete contract ecosystem tracking)
        metric_registry_address: DEFAULT_ADDRESSES.metricRegistry,
        centralized_vault_address: DEFAULT_ADDRESSES.centralVault,
        chain_id: 137, // Polygon mainnet
        factory_address: DEFAULT_ADDRESSES.vAMMFactory,
        router_address: null, // Router address not available from current deployment flow
        collateral_token_address: DEFAULT_ADDRESSES.mockUSDC,
        metric_id: deploymentResult.marketId || null // Use marketId as metric identifier
      }

       console.log('💾 Saving to database...')
      const response = await fetch('/api/markets', {
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
        console.warn(`Contract Address: ${deploymentResult.vammAddress}`)
      } else {
        const saveResponse = await response.json()
        console.log('✅ Successfully saved VAMM to Supabase database:', saveResponse)
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
        symbol: formData.symbol,
        vammAddress: deploymentResult.vammAddress,
        vaultAddress: deploymentResult.vaultAddress,
        oracleAddress: formData.oracleAddress,
        collateralToken: DEFAULT_ADDRESSES.mockUSDC,
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
      
      // Save failed deployment to database for tracking
      try {
        const failedMarketData = {
          symbol: formData.symbol,
          description: formData.description,
          category: formData.category,
          oracle_address: formData.oracleAddress,
          initial_price: formData.customTemplate.startPrice, // Use the startPrice from VAMM template
          price_decimals: formData.priceDecimals,
          banner_image_url: formData.bannerImageUrl,
          icon_image_url: formData.iconImageUrl,
          supporting_photo_urls: formData.supportingPhotoUrls,
          deployment_fee: formData.deploymentFee,
          is_active: false,
          user_address: walletData.address,
          // Mark as failed deployment
          vamm_address: null,
          vault_address: null,
          market_id: null,
          transaction_hash: null,
          deployment_status: 'failed'
        }

        await fetch('/api/markets', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(failedMarketData),
        })
      } catch (saveError) {
        console.error('Failed to save failed deployment record:', saveError)
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
      onError?.(error instanceof Error ? error.message : 'Failed to deploy vAMM. Please try again.')
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
      isLoading: isSubmitting || deploymentPhase === 'registering_metric' || deploymentPhase === 'creating_template' || deploymentPhase === 'deploying_contracts',
    }

    switch (currentStep) {
      case 1:
        return <Step1MarketInfo {...stepProps} onSkipToFinal={handleSkipToFinal} />
      case 2:
        return <Step2MetricsSetup {...stepProps} />
      case 3:
        return <Step3VAMMTemplate {...stepProps} />
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
          defaultAddresses={DEFAULT_ADDRESSES}
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
        isSubmitting={isSubmitting || deploymentPhase === 'registering_metric' || deploymentPhase === 'creating_template' || deploymentPhase === 'deploying_contracts'}
        isLoading={isSubmitting || deploymentPhase === 'registering_metric' || deploymentPhase === 'creating_template' || deploymentPhase === 'deploying_contracts' || formData.metricResolution?.status === 'processing'}
        walletConnected={walletData.isConnected}
        walletAddress={walletData.address}
        formData={formData}
      />
    </>
  )
}

export default VAMMWizard 