export default function BridgePage() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Bridge</h1>
        <p className="text-gray-400">Transfer assets between different blockchains</p>
      </div>
      
      <div className="max-w-md mx-auto w-full">
        <div className="p-6 rounded-lg bg-gradient-to-br from-gray-900 to-gray-800 border border-gray-700">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                From Network
              </label>
              <select className="w-full p-3 rounded-lg bg-gray-800 border border-gray-600 text-white focus:border-blue-500 focus:outline-none">
                <option>Ethereum</option>
                <option>Polygon</option>
                <option>Arbitrum</option>
                <option>Optimism</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                To Network
              </label>
              <select className="w-full p-3 rounded-lg bg-gray-800 border border-gray-600 text-white focus:border-blue-500 focus:outline-none">
                <option>Polygon</option>
                <option>Ethereum</option>
                <option>Arbitrum</option>
                <option>Optimism</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Amount
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="0.00"
                  className="flex-1 p-3 rounded-lg bg-gray-800 border border-gray-600 text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none"
                />
                <select className="px-4 py-3 rounded-lg bg-gray-800 border border-gray-600 text-white focus:border-blue-500 focus:outline-none">
                  <option>ETH</option>
                  <option>USDC</option>
                  <option>USDT</option>
                </select>
              </div>
            </div>
            
            <div className="p-3 rounded-lg bg-blue-900/20 border border-blue-700">
              <p className="text-sm text-blue-300">
                Estimated time: 5-10 minutes
              </p>
              <p className="text-sm text-blue-300">
                Bridge fee: ~$5.00
              </p>
            </div>
            
            <button className="w-full p-3 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold hover:from-purple-700 hover:to-pink-700 transition-colors">
              Bridge Assets
            </button>
          </div>
        </div>
      </div>
    </div>
  )
} 