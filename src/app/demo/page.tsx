'use client';

import React, { useState } from 'react';
import Step5ReviewDeploy from '@/components/VAMMWizard/steps/Step5ReviewDeploy';
import { DeploymentResult } from '@/components/VAMMWizard/types';
import { WalletData } from '@/types/wallet';

// Mock form data that would normally come from previous steps
const mockFormData = {
  symbol: 'DEMO-METRIC',
  description: 'Demo Metric for Testing VAMMWizard Step 5',
  category: 'Economic',
  metricName: 'Demo Economic Indicator',
  metricDataSource: 'https://api.demo-data.com/economic',
  settlementPeriod: '2592000', // 30 days in seconds
  templateType: 'custom' as const,
  presetTemplate: '',
  customTemplate: {
    maxLeverage: '50',
    tradingFeeRate: '50', // 0.5% in basis points
    liquidationFeeRate: '250', // 2.5% in basis points
    maintenanceMarginRatio: '500', // 5% in basis points
    initialReserves: '1000000',
    volumeScaleFactor: '100'
  },
  oracleAddress: '0x75fDD9eE5b547fd8b3CE5cD69e83dAD38B37bd08',
  initialPrice: '1000.00',
  priceDecimals: 18,
  deploymentFee: '0.1',
  customTemplateFee: '0.05',
  isActive: true,
  // Additional required properties
  bannerImage: null,
  iconImage: null,
  supportingPhotos: [],
  bannerImageUrl: '',
  iconImageUrl: '',
  supportingPhotoUrls: []
};

// Mock wallet data
const mockWalletData: WalletData = {
  isConnected: true,
  isConnecting: false,
  address: '0x742d35Cc6634C0532925a3b8D94C5e10aBc45633',
  balance: '1.2345',
  chainId: 137
};

// Mock default addresses
const mockDefaultAddresses = {
  mockUSDC: '0xbD9E0b8e723434dCd41700e82cC4C8C539F66377',
  mockOracle: '0x75fDD9eE5b547fd8b3CE5cD69e83dAD38B37bd08',
  vAMMFactory: '0x0990B9591ed1cC070652c5F5F11dAC4B0375Cd93'
};

export default function DemoPage() {
  const [deploymentPhase, setDeploymentPhase] = useState<'idle' | 'deploying' | 'waiting' | 'success' | 'error'>('deploying');
  const [deploymentResult, setDeploymentResult] = useState<DeploymentResult | undefined>();
  const [walletData, setWalletData] = useState<WalletData | undefined>(mockWalletData);
  const [isLoading, setIsLoading] = useState(true);

  // Auto-start deployment simulation when component loads
  React.useEffect(() => {
    const startDeployment = async () => {
      console.log('🚀 Auto-starting deployment simulation...');
      
      // Start in deploying phase (contract signing)
      setDeploymentPhase('deploying');
      setIsLoading(true);

      // Simulate contract deployment and signing (3 seconds)
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Move to waiting phase (blockchain confirmation)
      setDeploymentPhase('waiting');
      await new Promise(resolve => setTimeout(resolve, 4000));

      // Complete with success
      const result: DeploymentResult = {
        success: true,
        marketId: '0xdemo123456789abcdef',
        vammAddress: '0xF4a4CE6743aC7189736fCdE3D1056c17164E20b3',
        vaultAddress: '0x0990B9591ed1cC070652c5F5F11dAC4B0375Cd93',
        oracleAddress: '0x75fDD9eE5b547fd8b3CE5cD69e83dAD38B37bd08',
        transactionHash: '0xabcdef1234567890abcdef1234567890abcdef12',
        blockNumber: 52341234,
        gasUsed: '2341234',
        symbol: mockFormData.symbol
      };

      setDeploymentResult(result);
      setDeploymentPhase('success');
      setIsLoading(false);
    };

    startDeployment();
  }, []);

  const handleDeploy = async (): Promise<DeploymentResult> => {
    console.log('🚀 Manual deployment restart...');
    setDeploymentPhase('deploying');
    setIsLoading(true);

    // Simulate deployment process
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    setDeploymentPhase('waiting');
    await new Promise(resolve => setTimeout(resolve, 4000));

    // Simulate successful deployment
    const result: DeploymentResult = {
      success: true,
      marketId: '0xdemo123456789abcdef',
      vammAddress: '0xF4a4CE6743aC7189736fCdE3D1056c17164E20b3',
      vaultAddress: '0x0990B9591ed1cC070652c5F5F11dAC4B0375Cd93',
      oracleAddress: '0x75fDD9eE5b547fd8b3CE5cD69e83dAD38B37bd08',
      transactionHash: '0xabcdef1234567890abcdef1234567890abcdef12',
      blockNumber: 52341234,
      gasUsed: '2341234',
      symbol: mockFormData.symbol
    };

    setDeploymentResult(result);
    setDeploymentPhase('success');
    setIsLoading(false);
    
    return result;
  };

  const handleConnectWallet = async (): Promise<void> => {
    console.log('🔗 Demo wallet connection...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    setWalletData(mockWalletData);
  };

  const handlePrevious = () => {
    console.log('⬅️ Previous step clicked');
  };

  const toggleWalletConnection = () => {
    setWalletData(prev => prev ? undefined : mockWalletData);
  };

  const resetDemo = () => {
    setDeploymentPhase('deploying');
    setDeploymentResult(undefined);
    setIsLoading(true);
    
    // Restart the deployment simulation
    setTimeout(async () => {
      // Start in deploying phase (contract signing)
      setDeploymentPhase('deploying');
      
      // Simulate contract deployment and signing (3 seconds)
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Move to waiting phase (blockchain confirmation)
      setDeploymentPhase('waiting');
      await new Promise(resolve => setTimeout(resolve, 4000));

      // Complete with success
      const result: DeploymentResult = {
        success: true,
        marketId: '0xdemo123456789abcdef',
        vammAddress: '0xF4a4CE6743aC7189736fCdE3D1056c17164E20b3',
        vaultAddress: '0x0990B9591ed1cC070652c5F5F11dAC4B0375Cd93',
        oracleAddress: '0x75fDD9eE5b547fd8b3CE5cD69e83dAD38B37bd08',
        transactionHash: '0xabcdef1234567890abcdef1234567890abcdef12',
        blockNumber: 52341234,
        gasUsed: '2341234',
        symbol: mockFormData.symbol
      };

      setDeploymentResult(result);
      setDeploymentPhase('success');
      setIsLoading(false);
    }, 100);
  };

  const simulateError = async (): Promise<DeploymentResult> => {
    setDeploymentPhase('deploying');
    setIsLoading(true);
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const errorResult: DeploymentResult = {
      success: false,
      error: 'Demo error: Factory contract not deployed at address 0x75fDD9eE5b547fd8b3CE5cD69e83dAD38B37bd08'
    };

    setDeploymentResult(errorResult);
    setDeploymentPhase('error');
    setIsLoading(false);
    
    return errorResult;
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <div style={{ 
        background: '#f8f9fa', 
        padding: '1rem', 
        borderRadius: '8px', 
        marginBottom: '2rem',
        border: '1px solid #dee2e6'
      }}>
                 <h1 style={{ margin: '0 0 1rem 0', color: '#212529' }}>
           📋 Smart Contract Deployment Demo
         </h1>
         <p style={{ margin: '0 0 1rem 0', color: '#6c757d' }}>
           This shows the deployment waiting screen where users watch the smart contract 
           being signed and deployed to the blockchain. Auto-starts deployment simulation on load.
         </p>
        
                 <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
           <button 
             onClick={resetDemo}
             style={{
               padding: '0.5rem 1rem',
               background: '#007bff',
               color: 'white',
               border: 'none',
               borderRadius: '4px',
               cursor: 'pointer'
             }}
           >
             🔄 Restart Deployment
           </button>
           
           <button 
             onClick={simulateError}
             style={{
               padding: '0.5rem 1rem',
               background: '#dc3545',
               color: 'white',
               border: 'none',
               borderRadius: '4px',
               cursor: 'pointer'
             }}
           >
             ❌ Simulate Error
           </button>
           
           <button 
             onClick={toggleWalletConnection}
             style={{
               padding: '0.5rem 1rem',
               background: walletData ? '#dc3545' : '#28a745',
               color: 'white',
               border: 'none',
               borderRadius: '4px',
               cursor: 'pointer'
             }}
           >
             {walletData ? '🔌 Disconnect Wallet' : '🔗 Connect Wallet'}
           </button>
         </div>
        
        <div style={{ marginTop: '1rem', fontSize: '0.875rem', color: '#6c757d' }}>
          <strong>Current State:</strong> {deploymentPhase} | 
          <strong> Wallet:</strong> {walletData ? 'Connected' : 'Disconnected'} |
          <strong> Result:</strong> {deploymentResult ? (deploymentResult.success ? 'Success' : 'Error') : 'None'}
        </div>
      </div>

             <Step5ReviewDeploy
         formData={mockFormData as any}
         onPrevious={handlePrevious}
         onDeploy={handleDeploy}
         deploymentResult={deploymentResult}
         deploymentPhase={deploymentPhase}
         walletData={walletData}
         onConnectWallet={handleConnectWallet}
         defaultAddresses={mockDefaultAddresses}
         isLoading={isLoading}
         updateFormData={() => {}}
         onNext={() => {}}
         errors={{}}
       />
    </div>
  );
} 