'use client';

import React from 'react';
// Removed useTransactionTableEvents hook - smart contract functionality disabled

interface DebugTransactionTableProps {
  vammAddress?: string;
}

export default function DebugTransactionTable({ vammAddress }: DebugTransactionTableProps) {
  const hookResult = useTransactionTableEvents(vammAddress, {
    limit: 10,
    refetchInterval: 30000,
  });

  const {
    events,
    queryResult,
    isLoading,
    isFetching,
    error,
    isError,
    isSuccess,
    refetch,
    reset
  } = hookResult;

  return (
    <div className="p-4 bg-gray-900 text-white rounded-lg border border-gray-700 font-mono text-sm">
      <h3 className="text-lg font-bold mb-4 text-yellow-400">🐛 Debug: TransactionTable Hook State</h3>
      
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <strong className="text-blue-400">Input:</strong>
          <div>vammAddress: {vammAddress || 'undefined'}</div>
          <div>enabled: {!!vammAddress ? 'true' : 'false'}</div>
        </div>
        
        <div>
          <strong className="text-green-400">States:</strong>
          <div className={isLoading ? 'text-yellow-400' : ''}>isLoading: {isLoading.toString()}</div>
          <div className={isFetching ? 'text-yellow-400' : ''}>isFetching: {isFetching.toString()}</div>
          <div className={isError ? 'text-red-400' : ''}>isError: {isError.toString()}</div>
          <div className={isSuccess ? 'text-green-400' : ''}>isSuccess: {isSuccess.toString()}</div>
        </div>
      </div>

      <div className="mb-4">
        <strong className="text-purple-400">Data:</strong>
        <div>events.length: {events.length}</div>
        <div>queryResult: {queryResult ? 'exists' : 'null'}</div>
        <div>error: {error || 'null'}</div>
      </div>

      {queryResult && (
        <div className="mb-4">
          <strong className="text-cyan-400">Query Result:</strong>
          <div>fromBlock: {queryResult.fromBlock}</div>
          <div>toBlock: {queryResult.toBlock}</div>
          <div>queryTime: {queryResult.queryTime}ms</div>
          <div>totalLogs: {queryResult.totalLogs}</div>
        </div>
      )}

      {error && (
        <div className="mb-4 p-2 bg-red-900 border border-red-600 rounded">
          <strong className="text-red-400">Error:</strong>
          <div className="whitespace-pre-wrap">{error}</div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={refetch}
          disabled={isLoading || isFetching}
          className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded text-sm"
        >
          Refetch
        </button>
        <button
          onClick={reset}
          className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-sm"
        >
          Reset
        </button>
      </div>

      {events.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-gray-400 hover:text-white">
            View Events ({events.length})
          </summary>
          <pre className="mt-2 p-2 bg-gray-800 rounded text-xs overflow-x-auto">
            {JSON.stringify(events.slice(0, 3), null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
} 