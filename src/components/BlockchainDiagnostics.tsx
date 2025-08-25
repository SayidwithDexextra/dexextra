'use client';

import React, { useState, useEffect } from 'react';
// Removed useBlockchainConnection hook - smart contract functionality disabled
// Removed queryVAMMEvents import - smart contract functionality disabled

interface DiagnosticResult {
  test: string;
  status: 'running' | 'success' | 'error' | 'idle';
  message: string;
  duration?: number;
  data?: any;
}

export default function BlockchainDiagnostics() {
  const [diagnostics, setDiagnostics] = useState<DiagnosticResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [contractAddress, setContractAddress] = useState('');
  // Stub values - smart contract functionality removed
  const connectionStatus = { connected: false, chainId: 0, blockNumber: 0, networkName: 'Unknown' }
  const isChecking = false
  const checkConnection = async () => console.log('Blockchain connection check disabled')

  const addDiagnostic = (test: string, status: DiagnosticResult['status'], message: string, duration?: number, data?: any) => {
    setDiagnostics(prev => [...prev, { test, status, message, duration, data }]);
  };

  const updateDiagnostic = (test: string, status: DiagnosticResult['status'], message: string, duration?: number, data?: any) => {
    setDiagnostics(prev => prev.map(d => 
      d.test === test ? { ...d, status, message, duration, data } : d
    ));
  };

  const runDiagnostics = async () => {
    if (!contractAddress) {
      alert('Please enter a contract address first');
      return;
    }

    setIsRunning(true);
    setDiagnostics([]);

    try {
      // Test 1: Basic Connection
      addDiagnostic('connection', 'running', 'Testing blockchain connection...');
      
      const connectionResult = await fetch('/api/blockchain-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test-connection' })
      });
      
      const connectionData = await connectionResult.json();
      
      if (connectionData.success) {
        updateDiagnostic('connection', 'success', 
          `Connected to ${connectionData.connectionStatus.networkName} (Chain ID: ${connectionData.connectionStatus.chainId})`, 
          connectionData.connectionStatus.responseTime,
          connectionData.connectionStatus
        );
      } else {
        updateDiagnostic('connection', 'error', 
          `Connection failed: ${connectionData.connectionStatus?.error || 'Unknown error'}`,
          undefined,
          connectionData
        );
        return;
      }

      // Test 2: Sample Query
      addDiagnostic('sample-query', 'running', 'Querying sample events...');
      
      const queryResult = await fetch('/api/blockchain-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'query-sample', 
          contractAddress,
          limit: 5 
        })
      });
      
      const queryData = await queryResult.json();
      
      if (queryData.success) {
        updateDiagnostic('sample-query', 'success', 
          `Found ${queryData.data.length} events in ${queryData.metadata.queryTime}ms`,
          queryData.metadata.queryTime,
          queryData
        );
      } else {
        updateDiagnostic('sample-query', 'error', 
          `Query failed: ${queryData.error}`,
          undefined,
          queryData
        );
      }

      // Test 3: Direct Hook Query
      addDiagnostic('direct-query', 'running', 'Testing direct blockchain querier...');
      
      const startTime = Date.now();
      const directResult = await queryVAMMEvents(contractAddress, {
        limit: 5,
        maxBlockRange: 5000
      });
      const directDuration = Date.now() - startTime;
      
      if (directResult.error) {
        updateDiagnostic('direct-query', 'error', 
          `Direct query failed: ${directResult.error}`,
          directDuration,
          directResult
        );
      } else {
        updateDiagnostic('direct-query', 'success', 
          `Direct query found ${directResult.events.length} events in ${directDuration}ms`,
          directDuration,
          directResult
        );
      }

      // Test 4: Performance Test
      addDiagnostic('performance', 'running', 'Running performance test...');
      
      const perfStartTime = Date.now();
      const perfResult = await queryVAMMEvents(contractAddress, {
        limit: 20,
        maxBlockRange: 10000
      });
      const perfDuration = Date.now() - perfStartTime;
      
      if (perfResult.error) {
        updateDiagnostic('performance', 'error', 
          `Performance test failed: ${perfResult.error}`,
          perfDuration,
          perfResult
        );
      } else {
        updateDiagnostic('performance', 'success', 
          `Performance test: ${perfResult.events.length} events in ${perfDuration}ms (${perfResult.totalLogs} logs processed)`,
          perfDuration,
          perfResult
        );
      }

    } catch (error) {
      console.error('Diagnostic error:', error);
      addDiagnostic('error', 'error', 
        `Diagnostic failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setIsRunning(false);
    }
  };

  const getStatusIcon = (status: DiagnosticResult['status']) => {
    switch (status) {
      case 'running': return '🔄';
      case 'success': return '✅';
      case 'error': return '❌';
      default: return '⏳';
    }
  };

  const getStatusColor = (status: DiagnosticResult['status']) => {
    switch (status) {
      case 'running': return 'text-yellow-400';
      case 'success': return 'text-green-400';
      case 'error': return 'text-red-400';
      default: return 'text-gray-400';
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 bg-[#0A0A0A] rounded-lg border border-[#333333]">
      <h2 className="text-2xl font-bold text-white mb-6">Blockchain Diagnostics</h2>
      
      <div className="mb-6">
        <p className="text-[#9CA3AF] mb-4">
          Test the direct blockchain querying functionality. This will query events directly from the blockchain 
          without using the database layer.
        </p>
        
        <div className="flex gap-4 mb-4">
          <input
            type="text"
            placeholder="Enter vAMM contract address (0x...)"
            value={contractAddress}
            onChange={(e) => setContractAddress(e.target.value)}
            className="flex-1 px-4 py-2 bg-[#1F1F1F] border border-[#333333] rounded-lg text-white placeholder-[#6B7280] focus:outline-none focus:border-[#22C55E]"
          />
          <button
            onClick={runDiagnostics}
            disabled={isRunning || !contractAddress}
            className="px-6 py-2 bg-[#22C55E] hover:bg-[#16A34A] disabled:bg-[#333333] disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            {isRunning ? 'Running...' : 'Run Diagnostics'}
          </button>
        </div>
        
        <button
          onClick={checkConnection}
          disabled={isChecking}
          className="px-4 py-2 bg-[#3B82F6] hover:bg-[#2563EB] disabled:bg-[#333333] disabled:cursor-not-allowed text-white rounded-lg transition-colors mr-4"
        >
          {isChecking ? 'Checking...' : 'Test Connection'}
        </button>
      </div>

      {/* Connection Status */}
      {connectionStatus && (
        <div className="mb-6 p-4 bg-[#1F1F1F] rounded-lg border border-[#333333]">
          <h3 className="text-lg font-semibold text-white mb-2">Connection Status</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-[#9CA3AF]">Status:</span>
              <span className={`ml-2 ${connectionStatus.connected ? 'text-green-400' : 'text-red-400'}`}>
                {connectionStatus.connected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <div>
              <span className="text-[#9CA3AF]">Network:</span>
              <span className="ml-2 text-white">{connectionStatus.networkName}</span>
            </div>
            <div>
              <span className="text-[#9CA3AF]">Chain ID:</span>
              <span className="ml-2 text-white">{connectionStatus.chainId}</span>
            </div>
            <div>
              <span className="text-[#9CA3AF]">Block:</span>
              <span className="ml-2 text-white">{connectionStatus.blockNumber.toLocaleString()}</span>
            </div>
          </div>
          {connectionStatus.error && (
            <div className="mt-2 text-red-400 text-sm">
              Error: {connectionStatus.error}
            </div>
          )}
        </div>
      )}

      {/* Diagnostic Results */}
      {diagnostics.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-white">Diagnostic Results</h3>
          
          {diagnostics.map((diagnostic, index) => (
            <div key={index} className="p-4 bg-[#1F1F1F] rounded-lg border border-[#333333]">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{getStatusIcon(diagnostic.status)}</span>
                  <span className="font-medium text-white capitalize">{diagnostic.test.replace('-', ' ')}</span>
                  {diagnostic.duration && (
                    <span className="text-xs text-[#9CA3AF] bg-[#333333] px-2 py-1 rounded">
                      {diagnostic.duration}ms
                    </span>
                  )}
                </div>
                <span className={`text-sm ${getStatusColor(diagnostic.status)}`}>
                  {diagnostic.status}
                </span>
              </div>
              
              <p className="text-[#9CA3AF] text-sm mb-2">{diagnostic.message}</p>
              
              {diagnostic.data && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-[#6B7280] hover:text-[#9CA3AF]">
                    View Details
                  </summary>
                  <pre className="mt-2 p-2 bg-[#0A0A0A] rounded text-[#9CA3AF] overflow-x-auto">
                    {JSON.stringify(diagnostic.data, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Usage Examples */}
      <div className="mt-8 p-4 bg-[#1F1F1F] rounded-lg border border-[#333333]">
        <h3 className="text-lg font-semibold text-white mb-4">Usage Examples</h3>
        
        <div className="space-y-4 text-sm">
          <div>
            <h4 className="font-medium text-white mb-2">API Endpoint:</h4>
            <pre className="p-2 bg-[#0A0A0A] rounded text-[#9CA3AF] overflow-x-auto">
{`GET /api/blockchain-events?contractAddress=0x...&limit=10&eventTypes=PositionOpened,PositionClosed`}
            </pre>
          </div>
          
          <div>
            <h4 className="font-medium text-white mb-2">React Hook:</h4>
            <pre className="p-2 bg-[#0A0A0A] rounded text-[#9CA3AF] overflow-x-auto">
{`import { useTransactionTableEvents } from '@/hooks/useBlockchainEvents';

const { events, isLoading, error } = useTransactionTableEvents(vammAddress, {
  limit: 50,
  refetchInterval: 30000
});`}
            </pre>
          </div>
          
          <div>
            <h4 className="font-medium text-white mb-2">Direct Query:</h4>
            <pre className="p-2 bg-[#0A0A0A] rounded text-[#9CA3AF] overflow-x-auto">
{`import { queryVAMMEvents } from '@/lib/blockchainEventQuerier';

const result = await queryVAMMEvents(contractAddress, {
  eventTypes: ['PositionOpened', 'PositionClosed'],
  limit: 100
});`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
} 