'use client'

import React from 'react'
import Step4ReviewDeploy from '@/components/VAMMWizard/steps/Step4ReviewDeploy'
import { VAMMFormData, DeploymentResult } from '@/components/VAMMWizard/types'
import { WalletData } from '@/types/wallet'
import { DEFAULT_ADDRESSES } from '@/lib/contractDeployment'
import styles from '@/components/VAMMWizard/VAMMWizard.module.css'

// Mock form data
const mockFormData: VAMMFormData = {
  symbol: 'ETHUSD',
  description: 'Ethereum to USD Price Prediction Market',
  category: ['Crypto', 'DeFi'],
  oracleAddress: '0x1234567890123456789012345678901234567890',
  initialPrice: '2345.67',
  priceDecimals: 8,
  bannerImage: null,
  iconImage: null,
  supportingPhotos: [],
  bannerImageUrl: '',
  iconImageUrl: '',
  supportingPhotoUrls: [],
  deploymentFee: '0.1',
  isActive: true,
}

// Mock failed deployment result
const mockDeploymentResult: DeploymentResult = {
  success: false,
  error: 'Insufficient funds for gas fees. Please ensure you have enough ETH to cover the deployment cost of 0.1 ETH plus gas fees.'
}

// Mock wallet data
const mockWalletData: WalletData = {
  isConnected: true,
  address: '0x742d35cc6e1c36c74eb5c0f1c1d1f4c4e6f7e8f9',
  balance: '0.0234',
  isConnecting: false,
  chainId: 137
}

export default function VAMMErrorDemo() {
  const mockOnDeploy = async () => mockDeploymentResult
  const mockOnConnectWallet = async () => {}

  return (
    <div style={{ backgroundColor: '#000000', minHeight: '100vh', padding: '40px' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ marginBottom: '32px', textAlign: 'center' }}>
          <h1 style={{ color: '#ffffff', fontSize: '32px', fontWeight: '700', marginBottom: '8px' }}>
            vAMM Wizard - Error Demo
          </h1>
          <p style={{ color: '#9CA3AF', fontSize: '16px' }}>
            This shows the error state when deployment fails
          </p>
        </div>

        <div className={styles.container}>
          <div className={styles.formSection}>
            <Step4ReviewDeploy
              formData={mockFormData}
              updateFormData={() => {}}
              onNext={() => {}}
              onPrevious={() => {}}
              onDeploy={mockOnDeploy}
              deploymentResult={mockDeploymentResult}
              deploymentPhase="error"
              walletData={mockWalletData}
              onConnectWallet={mockOnConnectWallet}
              defaultAddresses={DEFAULT_ADDRESSES}
              errors={{}}
              isLoading={false}
            />
          </div>
        </div>

        <div style={{ marginTop: '40px', padding: '24px', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: '8px' }}>
          <h3 style={{ color: '#ffffff', fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>
            Demo Information
          </h3>
          <div style={{ color: '#9CA3AF', fontSize: '14px', lineHeight: '1.6' }}>
            <p><strong>Route:</strong> /vamm-error-demo</p>
            <p><strong>Component:</strong> Step4ReviewDeploy in error state</p>
            <p><strong>Purpose:</strong> Preview what users see when deployment fails</p>
            <p><strong>Error:</strong> Shows insufficient funds error with retry option</p>
          </div>
        </div>
      </div>
    </div>
  )
} 