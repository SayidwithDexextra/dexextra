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
  deploymentPhase?: 'idle' | 'registering_metric' | 'creating_template' | 'deploying_contracts' | 'confirming' | 'success' | 'error';
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
  phase: 'idle' | 'registering_metric' | 'creating_template' | 'deploying_contracts' | 'confirming' | 'success' | 'error';
  walletConnected?: boolean;
}) => {
  const getStatusMessage = () => {
    switch (phase) {
      case 'registering_metric':
        return 'Registering custom metric...';
      case 'creating_template':
        return 'Creating custom template...';
      case 'deploying_contracts':
        return 'Deploying market contracts...';
      case 'confirming':
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
      case 'registering_metric':
      case 'creating_template':
      case 'deploying_contracts':
      case 'confirming':
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

export default function Step5ReviewDeploy({ 
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
            <span className={styles.reviewValue}>
              {deploymentResult.vammAddress?.slice(0, 16)}...
              <a 
                href={`https://polygonscan.com/address/${deploymentResult.vammAddress}`}
                target="_blank" 
                rel="noopener noreferrer"
                style={{ marginLeft: '8px', color: '#007bff', textDecoration: 'none' }}
              >
                🔗
              </a>
            </span>
          </div>
          <div className={styles.reviewItem}>
            <span className={styles.reviewLabel}>Vault</span>
            <span className={styles.reviewValue}>
              {deploymentResult.vaultAddress?.slice(0, 16)}...
              <a 
                href={`https://polygonscan.com/address/${deploymentResult.vaultAddress}`}
                target="_blank" 
                rel="noopener noreferrer"
                style={{ marginLeft: '8px', color: '#007bff', textDecoration: 'none' }}
              >
                🔗
              </a>
            </span>
          </div>
          <div className={styles.reviewItem}>
            <span className={styles.reviewLabel}>Oracle</span>
            <span className={styles.reviewValue}>
              {deploymentResult.oracleAddress?.slice(0, 16)}...
              <a 
                href={`https://polygonscan.com/address/${deploymentResult.oracleAddress}`}
                target="_blank" 
                rel="noopener noreferrer"
                style={{ marginLeft: '8px', color: '#007bff', textDecoration: 'none' }}
              >
                🔗
              </a>
            </span>
          </div>
        </div>

        {/* Action buttons */}
        <div className={styles.reviewSection}>
          <h3 className={styles.reviewTitle}>Next Steps</h3>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <a 
              href={`/token/${deploymentResult.symbol}`}
              style={{
                display: 'inline-block',
                padding: '12px 24px',
                backgroundColor: '#1A1A1A',
                color: 'white',
                textDecoration: 'none',
                borderRadius: '8px',
                fontWeight: '500',
                transition: 'background-color 0.2s'
              }}
              onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#333'}
              onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#1A1A1A'}
            >
              📊 View Market Page
            </a>
            <a 
              href={`https://polygonscan.com/tx/${deploymentResult.transactionHash}`}
              target="_blank" 
              rel="noopener noreferrer"
              style={{
                display: 'inline-block',
                padding: '12px 24px',
                backgroundColor: '#007bff',
                color: 'white',
                textDecoration: 'none',
                borderRadius: '8px',
                fontWeight: '500',
                transition: 'background-color 0.2s'
              }}
              onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#0056b3'}
              onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#007bff'}
            >
              🔍 View Transaction
            </a>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '12px 24px',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontWeight: '500',
                cursor: 'pointer',
                transition: 'background-color 0.2s'
              }}
              onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#1e7e34'}
              onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#28a745'}
            >
              🚀 Deploy Another Market
            </button>
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
  if (deploymentPhase === 'registering_metric' || deploymentPhase === 'creating_template' || deploymentPhase === 'deploying_contracts' || deploymentPhase === 'confirming') {
    return (
      <div className={styles.formSection}>
        <div className={styles.stepHeader}>
          <div className={styles.stepNumber}>05.</div>
          <h1 className={styles.pageTitle}>Deploying Market</h1>
        </div>

        <DeploymentStatus 
          phase={deploymentPhase} 
          walletConnected={walletData?.isConnected}
        />

        <div className={styles.deploymentSteps}>
          <div className={`${styles.deploymentStep} ${
            deploymentPhase === 'registering_metric' ? styles.active : 
            (deploymentPhase === 'creating_template' || deploymentPhase === 'deploying_contracts' || deploymentPhase === 'confirming') ? styles.completed : ''
          }`}>
            <div className={styles.stepIndicator}>
              {deploymentPhase === 'registering_metric' ? <LoadingSpinner /> : 
               (deploymentPhase === 'creating_template' || deploymentPhase === 'deploying_contracts' || deploymentPhase === 'confirming') ? '✓' : '○'}
            </div>
            <div className={styles.stepLabel}>Registering custom metric on-chain</div>
          </div>
          
          <div className={`${styles.deploymentStep} ${
            deploymentPhase === 'creating_template' ? styles.active : 
            (deploymentPhase === 'deploying_contracts' || deploymentPhase === 'confirming') ? styles.completed : ''
          }`}>
            <div className={styles.stepIndicator}>
              {deploymentPhase === 'creating_template' ? <LoadingSpinner /> : 
               (deploymentPhase === 'deploying_contracts' || deploymentPhase === 'confirming') ? '✓' : '○'}
            </div>
            <div className={styles.stepLabel}>Creating custom template with your parameters</div>
          </div>
          
          <div className={`${styles.deploymentStep} ${
            deploymentPhase === 'deploying_contracts' ? styles.active : 
            deploymentPhase === 'confirming' ? styles.completed : ''
          }`}>
            <div className={styles.stepIndicator}>
              {deploymentPhase === 'deploying_contracts' ? <LoadingSpinner /> : 
               deploymentPhase === 'confirming' ? '✓' : '○'}
            </div>
            <div className={styles.stepLabel}>Deploying vAMM and market contracts</div>
          </div>
          
          <div className={`${styles.deploymentStep} ${deploymentPhase === 'confirming' ? styles.active : ''}`}>
            <div className={styles.stepIndicator}>
              {deploymentPhase === 'confirming' ? <LoadingSpinner /> : '○'}
            </div>
            <div className={styles.stepLabel}>Confirming transactions on blockchain</div>
          </div>
          
          <div className={styles.deploymentStep}>
            <div className={styles.stepIndicator}>○</div>
            <div className={styles.stepLabel}>Market ready for trading</div>
          </div>
        </div>

        <div className={styles.deploymentNote}>
          <p>Please do not close this window during deployment.</p>
          <p className={styles.phaseNote}>
            {deploymentPhase === 'registering_metric' && 'Creating your custom metric in the registry...'}
            {deploymentPhase === 'creating_template' && 'Setting up your custom template with start price and reserves...'}
            {deploymentPhase === 'deploying_contracts' && 'Setting up trading infrastructure...'}
            {deploymentPhase === 'confirming' && 'Waiting for blockchain confirmation...'}
          </p>
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
        <div className={styles.stepNumber}>05.</div>
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
          <span className={styles.reviewValue}>{formData.category}</span>
        </div>
      </div>

      {/* Metrics Configuration Review */}
      <div className={styles.reviewSection}>
        <h3 className={styles.reviewTitle}>Metrics Configuration</h3>
        <div className={styles.reviewItem}>
          <span className={styles.reviewLabel}>Primary Metric</span>
          <span className={styles.reviewValue}>{formData.metricName}</span>
        </div>
        <div className={styles.reviewItem}>
          <span className={styles.reviewLabel}>Data Source</span>
          <span className={styles.reviewValue}>{formData.metricDataSource}</span>
        </div>
        <div className={styles.reviewItem}>
          <span className={styles.reviewLabel}>Settlement Period</span>
          <span className={styles.reviewValue}>
            {(() => {
              const seconds = parseInt(formData.settlementPeriod);
              const days = Math.floor(seconds / 86400);
              const hours = Math.floor((seconds % 86400) / 3600);
              const minutes = Math.floor((seconds % 3600) / 60);
              const secs = seconds % 60;
              
              const parts = [];
              if (days > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`);
              if (hours > 0) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
              if (minutes > 0) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);
              if (secs > 0) parts.push(`${secs} second${secs > 1 ? 's' : ''}`);
              
              return parts.length > 0 ? parts.join(', ') : '0 seconds';
            })()}
          </span>
        </div>
        <div className={styles.reviewItem}>
          <span className={styles.reviewLabel}>Auto-Generated</span>
          <span className={styles.reviewValue}>
            Metric ID, Monthly updates, 18 decimal precision
          </span>
        </div>
      </div>

      {/* VAMM Template Review */}
      <div className={styles.reviewSection}>
        <h3 className={styles.reviewTitle}>VAMM Template</h3>
        <div className={styles.reviewItem}>
          <span className={styles.reviewLabel}>Template Type</span>
          <span className={styles.reviewValue}>{formData.templateType === 'preset' ? 'Preset' : 'Custom'}</span>
        </div>
        {formData.templateType === 'preset' ? (
          <div className={styles.reviewItem}>
            <span className={styles.reviewLabel}>Preset Template</span>
            <span className={styles.reviewValue}>{formData.presetTemplate}</span>
          </div>
        ) : (
          <>
            <div className={styles.reviewItem}>
              <span className={styles.reviewLabel}>Max Leverage</span>
              <span className={styles.reviewValue}>{formData.customTemplate.maxLeverage}x</span>
            </div>
            <div className={styles.reviewItem}>
              <span className={styles.reviewLabel}>Trading Fee</span>
              <span className={styles.reviewValue}>{(parseInt(formData.customTemplate.tradingFeeRate) / 100).toFixed(2)}%</span>
            </div>
            <div className={styles.reviewItem}>
              <span className={styles.reviewLabel}>Liquidation Fee</span>
              <span className={styles.reviewValue}>{(parseInt(formData.customTemplate.liquidationFeeRate) / 100).toFixed(1)}%</span>
            </div>
            <div className={styles.reviewItem}>
              <span className={styles.reviewLabel}>Maintenance Margin</span>
              <span className={styles.reviewValue}>{(parseInt(formData.customTemplate.maintenanceMarginRatio) / 100).toFixed(1)}%</span>
            </div>
            <div className={styles.reviewItem}>
              <span className={styles.reviewLabel}>Initial Reserves</span>
              <span className={styles.reviewValue}>{parseInt(formData.customTemplate.initialReserves).toLocaleString()}</span>
            </div>
            <div className={styles.reviewItem}>
              <span className={styles.reviewLabel}>Volume Scale Factor</span>
              <span className={styles.reviewValue}>{formData.customTemplate.volumeScaleFactor}</span>
            </div>
          </>
        )}
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
          <span className={styles.reviewLabel}>Base Fee</span>
          <span className={styles.reviewValue}>{formData.deploymentFee} ETH</span>
        </div>
        {formData.templateType === 'custom' && (
          <div className={styles.reviewItem}>
            <span className={styles.reviewLabel}>Custom Template Fee</span>
            <span className={styles.reviewValue}>{formData.customTemplateFee} ETH</span>
          </div>
        )}
        <div className={styles.reviewItem}>
          <span className={styles.reviewLabel}>Total Fee</span>
          <span className={styles.reviewValue}>
            {formData.templateType === 'custom' 
              ? (parseFloat(formData.deploymentFee) + parseFloat(formData.customTemplateFee)).toFixed(3)
              : formData.deploymentFee} ETH
          </span>
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

      {/* Action Buttons */}
      <div className={styles.actionButtons}>
        <button
          type="button"
          onClick={onPrevious}
          className={styles.secondaryButton}
          disabled={isLoading}
        >
          ← Previous
        </button>
        
        <button
          type="submit"
          className={styles.primaryButton}
          disabled={isLoading || (!walletData?.isConnected && !onConnectWallet)}
        >
          {!walletData?.isConnected ? 'Connect Wallet & Deploy' : 'Deploy Market'}
        </button>
      </div>
    </form>
  );
} 