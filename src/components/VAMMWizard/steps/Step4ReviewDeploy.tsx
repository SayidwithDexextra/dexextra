'use client';

import React from 'react';
import Image from 'next/image';
import { StepProps, DeploymentResult } from '../types';
import { WalletData } from '@/types/wallet';
import WalletDiagnostics from '../../WalletDiagnostics';
import NetworkSelector from '../../NetworkSelector';
import styles from '../VAMMWizard.module.css';

interface Step4Props extends StepProps {
  onDeploy: () => Promise<DeploymentResult>;
  deploymentResult?: DeploymentResult;
  deploymentPhase?: 'idle' | 'deploying' | 'waiting' | 'success' | 'error';
  walletData?: WalletData;
  onConnectWallet?: () => Promise<void>;
  defaultAddresses?: {
    mockUSDC: string;
    mockOracle: string;
    vAMMFactory: string;
  };
}

const LoadingSpinner = () => (
  <div className={styles.spinner}>
    <div className={styles.spinnerRing}></div>
  </div>
);

const DeploymentStatus = ({ phase, walletConnected }: { 
  phase: 'idle' | 'deploying' | 'waiting' | 'success' | 'error';
  walletConnected?: boolean;
}) => {
  const getStatusMessage = () => {
    switch (phase) {
      case 'deploying':
        return 'Deploying to blockchain...';
      case 'waiting':
        return 'Confirming transaction...';
      case 'success':
        return 'Market deployed successfully!';
      case 'error':
        return 'Deployment failed';
      default:
        return '';
    }
  };

  const getStatusIcon = () => {
    switch (phase) {
      case 'deploying':
      case 'waiting':
        return <LoadingSpinner />;
      case 'success':
        return <span className={styles.successIcon}>✓</span>;
      case 'error':
        return <span className={styles.errorIcon}>✗</span>;
      default:
        return null;
    }
  };

  if (phase === 'idle') return null;

  return (
    <div className={`${styles.deploymentStatus} ${styles[phase]}`}>
      <div className={styles.statusIcon}>
        {getStatusIcon()}
      </div>
      <div className={styles.statusMessage}>
        {getStatusMessage()}
        {phase === 'deploying' && (
          <div className={styles.statusSubMessage}>
            Smart contract is being deployed to the blockchain...
          </div>
        )}
      </div>
    </div>
  );
};

export default function Step4ReviewDeploy({ 
  formData, 
  onPrevious, 
  onDeploy, 
  deploymentResult, 
  deploymentPhase = 'idle',
  walletData,
  onConnectWallet,
  defaultAddresses,
  isLoading 
}: Step4Props) {
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Check wallet connection first
    if (!walletData?.isConnected && onConnectWallet) {
      try {
        await onConnectWallet();
      } catch (error) {
        console.error('Failed to connect wallet:', error);
        return;
      }
    }
    
    await onDeploy();
  };

  // Show success state
  if (deploymentResult?.success) {
    return (
      <div className={styles.formSection}>
        <div className={styles.stepHeader}>
          <div className={styles.stepNumber}>04.</div>
          <h1 className={styles.pageTitle}>Success</h1>
        </div>

        <div className={styles.successMessage}>
          ✓ Your vAMM market has been deployed successfully!
        </div>

        <div className={styles.reviewSection}>
          <h3 className={styles.reviewTitle}>Deployment Details</h3>
          <div className={styles.reviewItem}>
            <span className={styles.reviewLabel}>Market ID</span>
            <span className={styles.reviewValue}>{deploymentResult.marketId}</span>
          </div>
          <div className={styles.reviewItem}>
            <span className={styles.reviewLabel}>Symbol</span>
            <span className={styles.reviewValue}>{deploymentResult.symbol}</span>
          </div>
          <div className={styles.reviewItem}>
            <span className={styles.reviewLabel}>Transaction</span>
            <span className={styles.reviewValue}>{deploymentResult.transactionHash?.slice(0, 16)}...</span>
          </div>
        </div>

        <div className={styles.reviewSection}>
          <h3 className={styles.reviewTitle}>Contract Addresses</h3>
          <div className={styles.reviewItem}>
            <span className={styles.reviewLabel}>vAMM</span>
            <span className={styles.reviewValue}>{deploymentResult.vammAddress?.slice(0, 16)}...</span>
          </div>
          <div className={styles.reviewItem}>
            <span className={styles.reviewLabel}>Vault</span>
            <span className={styles.reviewValue}>{deploymentResult.vaultAddress?.slice(0, 16)}...</span>
          </div>
          <div className={styles.reviewItem}>
            <span className={styles.reviewLabel}>Oracle</span>
            <span className={styles.reviewValue}>{deploymentResult.oracleAddress?.slice(0, 16)}...</span>
          </div>
        </div>
      </div>
    );
  }

  // Show error state
  if (deploymentResult?.error) {
    return (
      <div className={styles.formSection}>
        <div className={styles.stepHeader}>
          <div className={styles.stepNumber}>04.</div>
          <h1 className={styles.pageTitle}>Error</h1>
        </div>

        <div className={styles.errorMessage}>
          ✗ Deployment failed: {deploymentResult.error}
        </div>

        <div className={styles.retrySection}>
          <p>Please check your connection and try again.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className={styles.retryButton}
          >
            Retry Deployment
          </button>
        </div>
      </div>
    );
  }

  // Show loading/waiting state
  if (deploymentPhase === 'deploying' || deploymentPhase === 'waiting') {
    return (
      <div className={styles.formSection}>
        <div className={styles.stepHeader}>
          <div className={styles.stepNumber}>04.</div>
          <h1 className={styles.pageTitle}>Deploying Market</h1>
        </div>

        <DeploymentStatus 
          phase={deploymentPhase} 
          walletConnected={walletData?.isConnected}
        />

        <div className={styles.deploymentSteps}>
          <div className={`${styles.deploymentStep} ${deploymentPhase === 'deploying' ? styles.active : styles.completed}`}>
            <div className={styles.stepIndicator}>
              {deploymentPhase === 'deploying' ? <LoadingSpinner /> : '✓'}
            </div>
            <div className={styles.stepLabel}>Validating oracle and deploying contracts</div>
          </div>
          
          <div className={`${styles.deploymentStep} ${deploymentPhase === 'waiting' ? styles.active : ''}`}>
            <div className={styles.stepIndicator}>
              {deploymentPhase === 'waiting' ? <LoadingSpinner /> : '○'}
            </div>
            <div className={styles.stepLabel}>Confirming transaction on blockchain</div>
          </div>
          
          <div className={styles.deploymentStep}>
            <div className={styles.stepIndicator}>○</div>
            <div className={styles.stepLabel}>Market ready for trading</div>
          </div>
        </div>

        <div className={styles.deploymentNote}>
          <p>Please do not close this window during deployment.</p>
          {walletData?.isConnected && (
            <p>Connected: {walletData.address}</p>
          )}
        </div>
      </div>
    );
  }

  // Show review and deploy form
  return (
    <form onSubmit={handleSubmit} className={styles.formSection}>
      <div className={styles.stepHeader}>
        <div className={styles.stepNumber}>04.</div>
        <h1 className={styles.pageTitle}>Review & Deploy</h1>
      </div>

      {/* Wallet Connection Status */}
      {!walletData?.isConnected && (
        <div className={styles.walletWarning}>
          <div className={styles.warningIcon}>⚠️</div>
          <div>
            <div className={styles.warningTitle}>Wallet Not Connected</div>
            <div className={styles.warningMessage}>
              You need to connect your wallet to deploy the vAMM market.
            </div>
          </div>
        </div>
      )}

      {/* Wallet Diagnostics for troubleshooting */}
      {/* {!walletData?.isConnected && (
        <WalletDiagnostics />
      )} */}

      {/* Network Selector */}
      {/* <div className={styles.reviewSection}>
        <h3 className={styles.reviewTitle}>Network Selection</h3>
        <div className={styles.networkSelectorContainer}>
          <NetworkSelector 
            compact={true}
            onNetworkChange={(network) => {
              console.log('Network changed to:', network.displayName);
              // Optionally refresh wallet connection here
            }}
          />
          <div className="text-sm text-gray-600 mt-2">
            <p>
              ⚠️ <strong>Important:</strong> Make sure you're connected to <strong>Polygon Mainnet</strong> for the best experience.
              Polygon offers fast transactions and low fees compared to Ethereum.
            </p>
          </div>
        </div>
      </div> */}

      {/* Market Information Review */}
      <div className={styles.reviewSection}>
        <h3 className={styles.reviewTitle}>Market Information</h3>
        <div className={styles.reviewItem}>
          <span className={styles.reviewLabel}>Symbol</span>
          <span className={styles.reviewValue}>{formData.symbol}</span>
        </div>
        <div className={styles.reviewItem}>
          <span className={styles.reviewLabel}>Description</span>
          <span className={styles.reviewValue}>{formData.description}</span>
        </div>
        <div className={styles.reviewItem}>
          <span className={styles.reviewLabel}>Category</span>
          <span className={styles.reviewValue}>{formData.category.join(', ')}</span>
        </div>
      </div>

      {/* Oracle & Pricing */}
      <div className={styles.reviewSection}>
        <h3 className={styles.reviewTitle}>Oracle & Pricing</h3>
        <div className={styles.reviewItem}>
          <span className={styles.reviewLabel}>Oracle</span>
          <span className={styles.reviewValue}>{formData.oracleAddress.slice(0, 16)}...</span>
        </div>
        <div className={styles.reviewItem}>
          <span className={styles.reviewLabel}>Initial Price</span>
          <span className={styles.reviewValue}>${formData.initialPrice}</span>
        </div>
        <div className={styles.reviewItem}>
          <span className={styles.reviewLabel}>Decimals</span>
          <span className={styles.reviewValue}>{formData.priceDecimals}</span>
        </div>
      </div>

      {/* Deployment Details */}
      <div className={styles.reviewSection}>
        <h3 className={styles.reviewTitle}>Deployment Details</h3>
        <div className={styles.reviewItem}>
          <span className={styles.reviewLabel}>Fee</span>
          <span className={styles.reviewValue}>{formData.deploymentFee} ETH</span>
        </div>
        <div className={styles.reviewItem}>
          <span className={styles.reviewLabel}>Status</span>
          <span className={styles.reviewValue}>{formData.isActive ? 'Active' : 'Inactive'}</span>
        </div>
        {walletData?.isConnected && (
          <div className={styles.reviewItem}>
            <span className={styles.reviewLabel}>Deployer</span>
            <span className={styles.reviewValue}>{walletData.address?.slice(0, 16)}...</span>
          </div>
        )}
      </div>


    </form>
  );
} 