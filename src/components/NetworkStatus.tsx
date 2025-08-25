'use client'

// Removed useCentralizedVault import - smart contract functionality deleted

interface NetworkStatusProps {
  userAddress?: string | null
  showDetails?: boolean
}

export function NetworkStatus({ userAddress, showDetails = false }: NetworkStatusProps) {
  // Stub values - smart contract functionality removed
  const userNetwork = 'polygon'
  const isOnCorrectNetwork = true
  const defaultNetworkName = 'Polygon'
  const networkWarning = null
  const switchToCorrectNetwork = () => console.log('Network switching disabled')
  const canPerformTransactions = false

  if (!userAddress) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
        <span>Data from {defaultNetworkName}</span>
      </div>
    )
  }

  if (isOnCorrectNetwork) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-600">
        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
        <span>Connected to {defaultNetworkName}</span>
        {showDetails && (
          <span className="text-xs opacity-75">• Transactions enabled</span>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-2 text-sm text-amber-600">
        <div className="w-2 h-2 bg-amber-500 rounded-full"></div>
        <span>Wrong network detected</span>
      </div>
      
      {showDetails && networkWarning && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600">•</span>
          <button
            onClick={switchToCorrectNetwork}
            className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded transition-colors"
          >
            Switch to {defaultNetworkName}
          </button>
        </div>
      )}
    </div>
  )
}

export function NetworkWarningBanner({ userAddress }: { userAddress?: string | null }) {
  // Stub values - smart contract functionality removed
  const networkWarning = null
  const switchToCorrectNetwork = () => console.log('Network switching disabled')
  const defaultNetworkName = 'Polygon'
  const isOnCorrectNetwork = true

  if (!userAddress || isOnCorrectNetwork || !networkWarning) {
    return null
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center">
            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <p className="text-amber-800 font-medium">Network Switch Required</p>
            <p className="text-amber-700 text-sm">{networkWarning}</p>
            <p className="text-amber-600 text-xs mt-1">
              Note: You can view data from any network, but transactions require {defaultNetworkName}.
            </p>
          </div>
        </div>
        <button
          onClick={switchToCorrectNetwork}
          className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          Switch Network
        </button>
      </div>
    </div>
  )
} 