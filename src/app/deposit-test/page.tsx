'use client';

import { useState } from 'react';
import { useWallet } from '@/hooks/useWallet';
import DepositModal from '@/components/DepositModal';

export default function DepositTestPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { walletData, connect } = useWallet();

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">USDC Deposit Test</h1>
        
        <div className="mb-8 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
          <h2 className="text-xl font-semibold mb-4">Wallet Status</h2>
          
          {walletData.isConnected ? (
            <div>
              <p className="mb-2">
                <span className="font-medium">Connected Address:</span> {walletData.address}
              </p>
              <p className="mb-2">
                <span className="font-medium">Chain ID:</span> {walletData.chainId}
              </p>
              <div className="mt-4">
                <button
                  onClick={() => setIsModalOpen(true)}
                  className="bg-green-500 hover:bg-green-600 text-white px-6 py-2 rounded-lg"
                >
                  Open Deposit Modal
                </button>
              </div>
            </div>
          ) : (
            <div>
              <p className="mb-4 text-yellow-600 dark:text-yellow-400">
                Wallet not connected. Please connect your wallet to continue.
              </p>
              <button
                onClick={() => connect()}
                className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded-lg"
              >
                Connect Wallet
              </button>
            </div>
          )}
        </div>
        
        <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
          <h2 className="text-xl font-semibold mb-4">Instructions</h2>
          <ol className="list-decimal pl-5 space-y-2">
            <li>Connect your wallet using the button above</li>
            <li>Click "Open Deposit Modal" to open the deposit interface</li>
            <li>Use the faucet to get test USDC (this calls the MockUSDC.faucet() function)</li>
            <li>Deposit USDC to the CoreVault contract</li>
            <li>You can view your balances and transaction status in the modal</li>
          </ol>
          
          <div className="mt-6 p-3 bg-blue-100 dark:bg-blue-900 rounded-lg">
            <h3 className="font-medium mb-2">About the Implementation</h3>
            <p>
              This implementation uses the Dexetrav5 contract configuration system to interact with 
              the MockUSDC and CoreVault contracts. The useUSDCDeposit hook provides a clean interface 
              for requesting USDC from the faucet and depositing it to the vault.
            </p>
          </div>
        </div>
      </div>
      
      {/* Deposit Modal */}
      <DepositModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
      />
    </main>
  );
}
