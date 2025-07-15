'use client'

import React from 'react'
import Step4ReviewDeploy from '@/components/VAMMWizard/steps/Step4ReviewDeploy'
import { VAMMFormData } from '@/components/VAMMWizard/types'
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

// Mock wallet data
const mockWalletData: WalletData = {
  isConnected: true,
  address: '0x742d35cc6e1c36c74eb5c0f1c1d1f4c4e6f7e8f9',
  balance: '1.2547',
  isConnecting: false,
  chainId: 137
}

export default function VAMMDeployingDemo() {
  const mockOnDeploy = async () => ({ success: false, error: 'Demo mode' })
  const mockOnConnectWallet = async () => {}

  return (
    <div style={{ backgroundColor: '#000000', minHeight: '100vh', padding: '40px' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ marginBottom: '32px', textAlign: 'center' }}>
          <h1 style={{ color: '#ffffff', fontSize: '32px', fontWeight: '700', marginBottom: '8px' }}>
            vAMM Wizard - Deploying Demo
          </h1>
          <p style={{ color: '#9CA3AF', fontSize: '16px' }}>
            This shows the deployment in progress state with loading animations
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
              deploymentResult={undefined}
              deploymentPhase="deploying"
              walletData={mockWalletData}
              onConnectWallet={mockOnConnectWallet}
              defaultAddresses={DEFAULT_ADDRESSES}
              errors={{}}
              isLoading={true}
            />
          </div>
        </div>

        <div style={{ marginTop: '40px', padding: '24px', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: '8px' }}>
          <h3 style={{ color: '#ffffff', fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>
            Demo Information
          </h3>
          <div style={{ color: '#9CA3AF', fontSize: '14px', lineHeight: '1.6' }}>
            <p><strong>Route:</strong> /vamm-deploying-demo</p>
            <p><strong>Component:</strong> Step4ReviewDeploy in deploying state</p>
            <p><strong>Purpose:</strong> Preview the loading/deployment state with spinners</p>
            <p><strong>State:</strong> Shows deployment progress steps and loading animations</p>
          </div>
        </div>
      </div>
    </div>
  )
} 