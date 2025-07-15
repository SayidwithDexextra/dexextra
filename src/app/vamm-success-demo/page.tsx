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

// Mock successful deployment result
const mockDeploymentResult: DeploymentResult = {
  success: true,
  marketId: 'market_123456',
  symbol: 'ETHUSD',
  vammAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
  vaultAddress: '0x9876543210987654321098765432109876543210',
  oracleAddress: '0x1234567890123456789012345678901234567890',
  collateralToken: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
  transactionHash: '0xdef456def456def456def456def456def456def456def456def456def456def456',
  blockNumber: 45123789,
  gasUsed: '2847563'
}

// Mock wallet data
const mockWalletData: WalletData = {
  isConnected: true,
  address: '0x742d35cc6e1c36c74eb5c0f1c1d1f4c4e6f7e8f9',
  balance: '1.2547',
  isConnecting: false,
  chainId: 137
}

export default function VAMMSuccessDemo() {
  const mockOnDeploy = async () => mockDeploymentResult
  const mockOnConnectWallet = async () => {}

  return (
    <div style={{ backgroundColor: '#000000', minHeight: '100vh', padding: '40px' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ marginBottom: '32px', textAlign: 'center' }}>
          <h1 style={{ color: '#ffffff', fontSize: '32px', fontWeight: '700', marginBottom: '8px' }}>
            vAMM Wizard - Success Demo
          </h1>
          <p style={{ color: '#9CA3AF', fontSize: '16px' }}>
            This is the final step showing a successful contract deployment
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
              deploymentPhase="success"
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
            <p><strong>Route:</strong> /vamm-success-demo</p>
            <p><strong>Component:</strong> Step4ReviewDeploy in success state</p>
            <p><strong>Purpose:</strong> Preview and edit the successful deployment screen</p>
            <p><strong>Mock Data:</strong> Includes sample market info, wallet connection, and deployment results</p>
          </div>
        </div>
      </div>
    </div>
  )
} 