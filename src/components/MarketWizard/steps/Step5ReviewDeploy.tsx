'use client';

import React, { useState } from 'react';
import { StepProps, DeploymentResult } from '../types';
import styles from '../MarketWizard.module.css';

interface Step5ReviewDeployProps extends StepProps {
  onDeploy: () => Promise<DeploymentResult>;
  deploymentResult?: DeploymentResult;
  deploymentPhase: 'idle' | 'deploying' | 'success' | 'error';
  walletData: {
    isConnected: boolean;
    address: string | null;
    balance: string;
  };
  onConnectWallet: () => void;
  contractAddresses: {
    metricsMarketFactory?: string;
    centralVault?: string;
    orderRouter?: string;
    umaOracleManager?: string;
  };
}

export default function Step5ReviewDeploy({
  formData,
  updateFormData,
  onNext,
  errors,
  onDeploy,
  deploymentResult,
  deploymentPhase,
  walletData,
  onConnectWallet,
  contractAddresses
}: Step5ReviewDeployProps) {
  const [isDeploying, setIsDeploying] = useState(false);

  const handleDeploy = async () => {
    if (!walletData.isConnected) {
      onConnectWallet();
      return;
    }

    setIsDeploying(true);
    try {
      await onDeploy();
    } catch (error) {
      console.error('Deployment failed:', error);
    } finally {
      setIsDeploying(false);
    }
  };

  const formatDateTime = (timestamp: string) => {
    if (!timestamp) return 'Not set';
    const date = new Date(parseInt(timestamp) * 1000);
    return date.toLocaleString();
  };

  const formatDuration = (seconds: string) => {
    if (!seconds) return 'Not set';
    const hours = Math.floor(parseInt(seconds) / 3600);
    return `${hours} hours`;
  };

  const getDeploymentStatusContent = () => {
    if (deploymentPhase === 'success' && deploymentResult?.success) {
      return (
        <div className={styles.deploymentSuccess}>
          <div className={styles.successIcon}>✅</div>
          <h3 className={styles.successTitle}>Market Deployed Successfully!</h3>
          <div className={styles.deploymentDetails}>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Market ID:</span>
              <span className={styles.detailValue}>{deploymentResult.metricId}</span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Market Address:</span>
              <span className={styles.detailValue}>{deploymentResult.marketAddress}</span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Transaction Hash:</span>
              <span className={styles.detailValue}>{deploymentResult.transactionHash}</span>
            </div>
            {deploymentResult.blockNumber && (
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>Block Number:</span>
                <span className={styles.detailValue}>{deploymentResult.blockNumber}</span>
              </div>
            )}
          </div>
          <div className={styles.successActions}>
            <button
              onClick={() => window.open(`https://polygonscan.com/tx/${deploymentResult.transactionHash}`, '_blank')}
              className={styles.viewTransactionButton}
            >
              View on Polygonscan
            </button>
          </div>
        </div>
      );
    }

    if (deploymentPhase === 'error' && deploymentResult?.error) {
      return (
        <div className={styles.deploymentError}>
          <div className={styles.errorIcon}>❌</div>
          <h3 className={styles.errorTitle}>Deployment Failed</h3>
          <div className={styles.errorMessage}>{deploymentResult.error}</div>
          <div className={styles.errorActions}>
            <button
              onClick={handleDeploy}
              className={styles.retryButton}
              disabled={isDeploying}
            >
              Retry Deployment
            </button>
          </div>
        </div>
      );
    }

    if (deploymentPhase === 'deploying' || isDeploying) {
      return (
        <div className={styles.deploymentProgress}>
          <div className={styles.loadingIcon}>
            <div className={styles.spinner}></div>
          </div>
          <h3 className={styles.progressTitle}>Deploying Market...</h3>
          <div className={styles.progressSteps}>
            <div className={styles.progressStep}>
              <span className={styles.progressNumber}>1</span>
              <span className={styles.progressLabel}>Validating configuration</span>
              <span className={styles.progressStatus}>✅</span>
            </div>
            <div className={styles.progressStep}>
              <span className={styles.progressNumber}>2</span>
              <span className={styles.progressLabel}>Deploying to MetricsMarketFactory</span>
              <span className={styles.progressStatus}>⏳</span>
            </div>
            <div className={styles.progressStep}>
              <span className={styles.progressNumber}>3</span>
              <span className={styles.progressLabel}>Configuring UMA oracle</span>
              <span className={styles.progressStatus}>⏳</span>
            </div>
            <div className={styles.progressStep}>
              <span className={styles.progressNumber}>4</span>
              <span className={styles.progressLabel}>Saving to database</span>
              <span className={styles.progressStatus}>⏳</span>
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className={styles.formSection}>
      <div className={styles.stepHeader}>
        <div className={styles.stepNumber}>05.</div>
        <h1 className={styles.pageTitle}>Review & Deploy</h1>
      </div>

      {/* Deployment Status (if in progress or completed) */}
      {(deploymentPhase !== 'idle') && (
        <div className={styles.deploymentStatus}>
          {getDeploymentStatusContent()}
        </div>
      )}

      {/* Configuration Review (only show if not deploying or completed) */}
      {deploymentPhase === 'idle' && (
        <>
          {/* Market Information */}
          <div className={styles.reviewSection}>
            <h3 className={styles.reviewSectionTitle}>Market Information</h3>
            <div className={styles.reviewGrid}>
              <div className={styles.reviewItem}>
                <span className={styles.reviewLabel}>Metric ID:</span>
                <span className={styles.reviewValue}>{formData.metricId}</span>
              </div>
              <div className={styles.reviewItem}>
                <span className={styles.reviewLabel}>Description:</span>
                <span className={styles.reviewValue}>{formData.description}</span>
              </div>
              <div className={styles.reviewItem}>
                <span className={styles.reviewLabel}>Category:</span>
                <span className={styles.reviewValue}>{formData.category}</span>
              </div>
            </div>
          </div>

          {/* Trading Configuration */}
          <div className={styles.reviewSection}>
            <h3 className={styles.reviewSectionTitle}>Trading Configuration</h3>
            <div className={styles.reviewGrid}>
              <div className={styles.reviewItem}>
                <span className={styles.reviewLabel}>Decimals:</span>
                <span className={styles.reviewValue}>{formData.decimals}</span>
              </div>
              <div className={styles.reviewItem}>
                <span className={styles.reviewLabel}>Minimum Order Size:</span>
                <span className={styles.reviewValue}>{formData.minimumOrderSize}</span>
              </div>
              <div className={styles.reviewItem}>
                <span className={styles.reviewLabel}>Tick Size:</span>
                <span className={styles.reviewValue}>0.01 (Fixed)</span>
              </div>
              <div className={styles.reviewItem}>
                <span className={styles.reviewLabel}>KYC Required:</span>
                <span className={styles.reviewValue}>{formData.requiresKYC ? 'Yes' : 'No'}</span>
              </div>
            </div>
          </div>

          {/* Settlement Configuration */}
          <div className={styles.reviewSection}>
            <h3 className={styles.reviewSectionTitle}>Settlement Configuration</h3>
            <div className={styles.reviewGrid}>
              <div className={styles.reviewItem}>
                <span className={styles.reviewLabel}>Trading End Date:</span>
                <span className={styles.reviewValue}>{formatDateTime(formData.tradingEndDate)}</span>
              </div>
              <div className={styles.reviewItem}>
                <span className={styles.reviewLabel}>Settlement Date:</span>
                <span className={styles.reviewValue}>{formatDateTime(formData.settlementDate)}</span>
              </div>
              <div className={styles.reviewItem}>
                <span className={styles.reviewLabel}>Data Request Window:</span>
                <span className={styles.reviewValue}>{formatDuration(formData.dataRequestWindow)}</span>
              </div>
              <div className={styles.reviewItem}>
                <span className={styles.reviewLabel}>Auto Settlement:</span>
                <span className={styles.reviewValue}>{formData.autoSettle ? 'Yes' : 'No'}</span>
              </div>
              <div className={styles.reviewItem}>
                <span className={styles.reviewLabel}>Oracle Provider:</span>
                <span className={styles.reviewValue}>{formData.oracleProvider}</span>
              </div>
            </div>
          </div>

          {/* Initial Order Configuration */}
          {formData.initialOrder.enabled && (
            <div className={styles.reviewSection}>
              <h3 className={styles.reviewSectionTitle}>Initial Order</h3>
              <div className={styles.reviewGrid}>
                <div className={styles.reviewItem}>
                  <span className={styles.reviewLabel}>Side:</span>
                  <span className={styles.reviewValue}>{formData.initialOrder.side}</span>
                </div>
                <div className={styles.reviewItem}>
                  <span className={styles.reviewLabel}>Quantity:</span>
                  <span className={styles.reviewValue}>{formData.initialOrder.quantity}</span>
                </div>
                <div className={styles.reviewItem}>
                  <span className={styles.reviewLabel}>Price:</span>
                  <span className={styles.reviewValue}>{formData.initialOrder.price}</span>
                </div>
                <div className={styles.reviewItem}>
                  <span className={styles.reviewLabel}>Time in Force:</span>
                  <span className={styles.reviewValue}>{formData.initialOrder.timeInForce}</span>
                </div>
                {formData.initialOrder.timeInForce === 'GTD' && formData.initialOrder.expiryTime && (
                  <div className={styles.reviewItem}>
                    <span className={styles.reviewLabel}>Expiry Time:</span>
                    <span className={styles.reviewValue}>{formatDateTime(formData.initialOrder.expiryTime)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Market Images */}
          <div className={styles.reviewSection}>
            <h3 className={styles.reviewSectionTitle}>Market Images</h3>
            <div className={styles.imagePreviewGrid}>
              {formData.bannerImageUrl && (
                <div className={styles.imagePreview}>
                  <span className={styles.imageLabel}>Banner Image:</span>
                  <img src={formData.bannerImageUrl} alt="Banner" className={styles.bannerPreview} />
                </div>
              )}
              {formData.iconImageUrl && (
                <div className={styles.imagePreview}>
                  <span className={styles.imageLabel}>Icon Image:</span>
                  <img src={formData.iconImageUrl} alt="Icon" className={styles.iconPreview} />
                </div>
              )}
              {formData.supportingPhotoUrls.length > 0 && (
                <div className={styles.imagePreview}>
                  <span className={styles.imageLabel}>Supporting Photos:</span>
                  <div className={styles.supportingPhotos}>
                    {formData.supportingPhotoUrls.map((url, index) => (
                      <img key={index} src={url} alt={`Supporting ${index + 1}`} className={styles.supportingPhoto} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Contract Integration */}
          <div className={styles.reviewSection}>
            <h3 className={styles.reviewSectionTitle}>Contract Integration</h3>
            <div className={styles.reviewGrid}>
              <div className={styles.reviewItem}>
                <span className={styles.reviewLabel}>Factory Address:</span>
                <span className={styles.reviewValue}>{contractAddresses.metricsMarketFactory || 'Will be set during deployment'}</span>
              </div>
              <div className={styles.reviewItem}>
                <span className={styles.reviewLabel}>Central Vault:</span>
                <span className={styles.reviewValue}>{contractAddresses.centralVault || 'Will be set during deployment'}</span>
              </div>
              <div className={styles.reviewItem}>
                <span className={styles.reviewLabel}>Order Router:</span>
                <span className={styles.reviewValue}>{contractAddresses.orderRouter || 'Will be set during deployment'}</span>
              </div>
              <div className={styles.reviewItem}>
                <span className={styles.reviewLabel}>UMA Oracle Manager:</span>
                <span className={styles.reviewValue}>{contractAddresses.umaOracleManager || formData.oracleProvider}</span>
              </div>
            </div>
          </div>

          {/* Deployment Cost */}
          <div className={styles.reviewSection}>
            <h3 className={styles.reviewSectionTitle}>Deployment Cost</h3>
            <div className={styles.costBreakdown}>
              <div className={styles.costItem}>
                <span className={styles.costLabel}>Market Creation Fee:</span>
                <span className={styles.costValue}>{formData.creationFee} ETH</span>
              </div>
              <div className={styles.costItem}>
                <span className={styles.costLabel}>Estimated Gas:</span>
                <span className={styles.costValue}>~0.001 ETH</span>
              </div>
              <div className={styles.costDivider}></div>
              <div className={styles.costItem}>
                <span className={styles.costLabel}>Total Estimated Cost:</span>
                <span className={styles.costValue}>{(parseFloat(formData.creationFee) + 0.001).toFixed(3)} ETH</span>
              </div>
            </div>
          </div>

          {/* Wallet Connection */}
          <div className={styles.walletSection}>
            {walletData.isConnected ? (
              <div className={styles.walletConnected}>
                <div className={styles.walletIcon}>👛</div>
                <div className={styles.walletInfo}>
                  <div className={styles.walletAddress}>
                    Connected: {walletData.address?.slice(0, 6)}...{walletData.address?.slice(-4)}
                  </div>
                  <div className={styles.walletBalance}>
                    Balance: {parseFloat(walletData.balance).toFixed(4)} ETH
                  </div>
                </div>
              </div>
            ) : (
              <div className={styles.walletDisconnected}>
                <div className={styles.walletIcon}>🔒</div>
                <div className={styles.walletInfo}>
                  <div className={styles.walletMessage}>Wallet not connected</div>
                  <button
                    onClick={onConnectWallet}
                    className={styles.connectWalletButton}
                  >
                    Connect Wallet
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Deploy Button */}
          <div className={styles.deploySection}>
            <button
              onClick={handleDeploy}
              disabled={isDeploying || deploymentPhase === 'deploying'}
              className={`${styles.deployButton} ${
                (!walletData.isConnected || isDeploying) ? styles.deployButtonDisabled : ''
              }`}
            >
              {isDeploying ? (
                <span className={styles.deployingText}>
                  <div className={styles.deploySpinner}></div>
                  Deploying Market...
                </span>
              ) : (
                'Deploy Market to Orderbook DEX'
              )}
            </button>
            {!walletData.isConnected && (
              <div className={styles.deployNote}>
                Please connect your wallet to deploy the market
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
