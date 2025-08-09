'use client';

import React, { useState } from 'react';
import { diagnoseWalletIssues } from '@/lib/wallet';

const WalletDiagnostics: React.FC = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [lastRun, setLastRun] = useState<Date | null>(null);

  const runDiagnostics = async () => {
    setIsRunning(true);
    try {
       console.log('🔧 Starting wallet diagnostics...');
      await diagnoseWalletIssues();
      setLastRun(new Date());
       console.log('✅ Wallet diagnostics completed. Check the console for details.');
    } catch (error) {
      console.error('❌ Error running wallet diagnostics:', error);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="bg-gray-100 border border-gray-300 rounded-lg p-4 my-4">
      <h3 className="text-lg font-semibold mb-2 text-gray-800">Wallet Diagnostics</h3>
      <p className="text-sm text-gray-600 mb-3">
        If you're experiencing wallet connection issues, run diagnostics to identify the problem.
        Results will be shown in the browser console (F12 → Console).
      </p>
      
      <div className="flex items-center gap-3">
        <button
          onClick={runDiagnostics}
          disabled={isRunning}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            isRunning
              ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {isRunning ? 'Running...' : 'Run Diagnostics'}
        </button>
        
        {lastRun && (
          <span className="text-xs text-gray-500">
            Last run: {lastRun.toLocaleTimeString()}
          </span>
        )}
      </div>
      
      <div className="mt-3 text-xs text-gray-500">
        <p className="mb-1">This will check:</p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>Browser environment and security</li>
          <li>Available wallet providers</li>
          <li>Ethereum provider functionality</li>
          <li>Network connectivity</li>
          <li>Account and balance access</li>
        </ul>
      </div>
    </div>
  );
};

export default WalletDiagnostics; 