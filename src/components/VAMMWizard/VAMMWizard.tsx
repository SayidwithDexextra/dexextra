'use client'

import React, { useState, useEffect, useRef } from 'react'
import { ethers } from 'ethers'
import styles from './VAMMWizard.module.css'
import { VAMMFormData, FormErrors, StepId, DeploymentResult } from './types'
import { validateStep1, validateStep2, validateStep3, validateStep4 } from './validation'
import FixedStepFooter from './FixedStepFooter'
import { useWallet } from '@/hooks/useWallet'
import { contractDeploymentService, DEFAULT_ADDRESSES } from '@/lib/contractDeployment'
import type { MarketDeploymentParams } from '@/lib/contractDeployment'

// Step components
import Step1MarketInfo from './steps/Step1MarketInfo'
import Step2OracleSetup from './steps/Step2OracleSetup'
import Step3MarketImages from './steps/Step3MarketImages'
import Step4ReviewDeploy from './steps/Step4ReviewDeploy'

const INITIAL_FORM_DATA: VAMMFormData = {
  symbol: '',
  description: '',
  category: [],
  oracleAddress: DEFAULT_ADDRESSES.mockOracle, // Default to deployed oracle
  initialPrice: '',
  priceDecimals: 8,
  bannerImage: null,
  iconImage: null,
  supportingPhotos: [],
  bannerImageUrl: '',
  iconImageUrl: '',
  supportingPhotoUrls: [],
  deploymentFee: '0.1', // Will be updated from contract
  isActive: true,
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
  const [deploymentPhase, setDeploymentPhase] = useState<'idle' | 'deploying' | 'waiting' | 'success' | 'error'>('idle')
  const isMountedRef = useRef(true)

  // Wallet connection
  const { 
    walletData, 
    connect: connectWallet, 
    disconnect: disconnectWallet, 
    refreshBalance 
  } = useWallet()

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

  const validateCurrentStepData = (): boolean => {
    let stepValidation;
    switch (currentStep) {
      case 1:
        stepValidation = validateStep1(formData);
        break;
      case 2:
        stepValidation = validateStep2(formData);
        break;
      case 3:
        stepValidation = validateStep3(formData);
        break;
      case 4:
        stepValidation = validateStep4(formData);
        break;
      default:
        stepValidation = { isValid: false, errors: { general: 'Invalid step' } };
    }
    if (isMountedRef.current) {
      setErrors(stepValidation.errors)
    }
    return stepValidation.isValid
  }

  const canProceed = (): boolean => {
    let stepValidation;
    switch (currentStep) {
      case 1:
        stepValidation = validateStep1(formData);
        break;
      case 2:
        stepValidation = validateStep2(formData);
        break;
      case 3:
        stepValidation = validateStep3(formData);
        break;
      case 4:
        stepValidation = validateStep4(formData);
        break;
      default:
        stepValidation = { isValid: false, errors: { general: 'Invalid step' } };
    }
    return stepValidation.isValid
  }

  const handleNext = () => {
    if (!isMountedRef.current) return
    if (validateCurrentStepData() && currentStep < 4) {
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

  const handleDeploy = async (): Promise<DeploymentResult> => {
    if (!validateCurrentStepData()) {
      throw new Error('Validation failed')
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
      console.log('🚀 Starting real contract deployment...')

      // Get the signer from the connected wallet
      const provider = new ethers.BrowserProvider(window.ethereum!)
      const signer = await provider.getSigner()

      // Validate oracle before deployment
      console.log('🔮 Validating oracle...')
      const oracleValidation = await contractDeploymentService.validateOracle(formData.oracleAddress)
      if (!oracleValidation.isValid) {
        throw new Error(`Oracle validation failed: ${oracleValidation.error}`)
      }

      console.log('✅ Oracle validated. Current price:', oracleValidation.price, 'USD')

      // Prepare deployment parameters
      const deploymentParams: MarketDeploymentParams = {
        symbol: formData.symbol,
        description: formData.description,
        oracleAddress: formData.oracleAddress,
        collateralTokenAddress: DEFAULT_ADDRESSES.mockUSDC, // Use default USDC
        initialPrice: formData.initialPrice,
        userAddress: walletData.address
      }

      console.log('📋 Deployment parameters:', deploymentParams)

      // Deploy the market using the factory contract
      const deploymentResult = await contractDeploymentService.deployMarket(
        deploymentParams,
        signer
      )

      if (!deploymentResult.success) {
        throw new Error(deploymentResult.error || 'Contract deployment failed')
      }

      // Create the market record in Supabase with contract details
      const marketData = {
        symbol: formData.symbol,
        description: formData.description,
        category: formData.category,
        oracle_address: formData.oracleAddress,
        initial_price: formData.initialPrice,
        price_decimals: formData.priceDecimals,
        banner_image_url: formData.bannerImageUrl,
        icon_image_url: formData.iconImageUrl,
        supporting_photo_urls: formData.supportingPhotoUrls,
        deployment_fee: formData.deploymentFee,
        is_active: formData.isActive,
        user_address: walletData.address,
        // Contract deployment details
        vamm_address: deploymentResult.vammAddress,
        vault_address: deploymentResult.vaultAddress,
        market_id: deploymentResult.marketId,
        transaction_hash: deploymentResult.transactionHash,
        deployment_status: 'deployed'
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
        const errorData = await response.json()
        console.warn('Database save failed but contract deployed successfully:', errorData)
        // Don't throw error here - contract is deployed successfully
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
          initial_price: formData.initialPrice,
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
        return <Step1MarketInfo {...stepProps} />
      case 2:
        return <Step2OracleSetup 
          {...stepProps} 
          defaultOracle={DEFAULT_ADDRESSES.mockOracle}
        />
      case 3:
        return <Step3MarketImages {...stepProps} />
      case 4:
        return <Step4ReviewDeploy 
          {...stepProps} 
          onDeploy={handleDeploy} 
          deploymentResult={deploymentResult}
          deploymentPhase={deploymentPhase}
          walletData={walletData}
          onConnectWallet={connectWallet}
          defaultAddresses={DEFAULT_ADDRESSES}
        />
      default:
        return <Step1MarketInfo {...stepProps} />
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
        totalSteps={4}
        canProceed={canProceed()}
        onStepClick={handleStepClick}
        onNext={handleNext}
        onPrevious={handlePrevious}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting || deploymentPhase === 'deploying'}
        walletConnected={walletData.isConnected}
        walletAddress={walletData.address}
      />
    </>
  )
}

export default VAMMWizard 