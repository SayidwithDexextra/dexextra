'use client'

import { useState } from 'react'
import useWallet from '@/hooks/useWallet'

export default function CreateMarket() {
  const { walletData } = useWallet()
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: '',
    endDate: '',
    outcomeA: '',
    outcomeB: ''
  })

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!walletData.isConnected) {
      alert('Please connect your wallet to create a market')
      return
    }
    console.log('Creating market:', formData)
    // Handle market creation logic here
  }

  return (
    <div className="p-8 text-white min-h-screen">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-4" style={{ color: '#ffffff' }}>
            Create New Market
          </h1>
          <p className="text-lg" style={{ color: '#a0a0a0' }}>
            Create a prediction market for others to trade on
          </p>
        </div>

        {/* Connection Status */}
        {!walletData.isConnected && (
          <div className="mb-6 p-4 rounded-lg border border-yellow-600" style={{ backgroundColor: '#2a2a2a' }}>
            <p className="text-yellow-400 font-medium">⚠️ Wallet Required</p>
            <p className="text-sm" style={{ color: '#a0a0a0' }}>
              You need to connect your wallet to create a market. Please connect your wallet using the navbar.
            </p>
          </div>
        )}

        {/* Create Market Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div 
            className="p-6 rounded-lg"
            style={{ backgroundColor: '#2a2a2a' }}
          >
            <h2 className="text-xl font-bold mb-4 text-white">Market Details</h2>
            
            {/* Market Title */}
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2" style={{ color: '#a0a0a0' }}>
                Market Title
              </label>
              <input
                type="text"
                name="title"
                value={formData.title}
                onChange={handleInputChange}
                placeholder="e.g., Will Bitcoin reach $100,000 by end of 2024?"
                className="w-full p-3 rounded-lg border focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: '#1a1a1a',
                  borderColor: '#444444',
                  color: '#ffffff'
                }}
                required
              />
            </div>

            {/* Description */}
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2" style={{ color: '#a0a0a0' }}>
                Description
              </label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                placeholder="Provide detailed information about the market conditions and resolution criteria..."
                rows={4}
                className="w-full p-3 rounded-lg border focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: '#1a1a1a',
                  borderColor: '#444444',
                  color: '#ffffff',
                  resize: 'vertical'
                }}
                required
              />
            </div>

            {/* Category */}
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2" style={{ color: '#a0a0a0' }}>
                Category
              </label>
              <select
                name="category"
                value={formData.category}
                onChange={handleInputChange}
                className="w-full p-3 rounded-lg border focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: '#1a1a1a',
                  borderColor: '#444444',
                  color: '#ffffff',
                }}
                required
              >
                <option value="">Select a category</option>
                <option value="crypto">Cryptocurrency</option>
                <option value="sports">Sports</option>
                <option value="politics">Politics</option>
                <option value="technology">Technology</option>
                <option value="finance">Finance</option>
                <option value="other">Other</option>
              </select>
            </div>

            {/* End Date */}
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2" style={{ color: '#a0a0a0' }}>
                Market End Date
              </label>
              <input
                type="datetime-local"
                name="endDate"
                value={formData.endDate}
                onChange={handleInputChange}
                className="w-full p-3 rounded-lg border focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: '#1a1a1a',
                  borderColor: '#444444',
                  color: '#ffffff',
                }}
                required
              />
            </div>
          </div>

          {/* Outcomes */}
          <div 
            className="p-6 rounded-lg"
            style={{ backgroundColor: '#2a2a2a' }}
          >
            <h2 className="text-xl font-bold mb-4 text-white">Market Outcomes</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: '#a0a0a0' }}>
                  Outcome A (Yes/True)
                </label>
                <input
                  type="text"
                  name="outcomeA"
                  value={formData.outcomeA}
                  onChange={handleInputChange}
                  placeholder="e.g., Yes, Bitcoin will reach $100k"
                  className="w-full p-3 rounded-lg border focus:outline-none focus:ring-2"
                  style={{
                    backgroundColor: '#1a1a1a',
                    borderColor: '#444444',
                    color: '#ffffff',
                  }}
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: '#a0a0a0' }}>
                  Outcome B (No/False)
                </label>
                <input
                  type="text"
                  name="outcomeB"
                  value={formData.outcomeB}
                  onChange={handleInputChange}
                  placeholder="e.g., No, Bitcoin will not reach $100k"
                  className="w-full p-3 rounded-lg border focus:outline-none focus:ring-2"
                  style={{
                    backgroundColor: '#1a1a1a',
                    borderColor: '#444444',
                    color: '#ffffff',
                  }}
                  required
                />
              </div>
            </div>
          </div>

          {/* Submit Button */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!walletData.isConnected}
              className="px-8 py-3 rounded-lg font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: walletData.isConnected 
                  ? 'linear-gradient(135deg, #8b5cf6 0%, #ec4899 50%, #f97316 100%)'
                  : '#666666',
                color: '#ffffff',
                border: 'none'
              }}
            >
              {walletData.isConnected ? 'Create Market' : 'Connect Wallet to Create'}
            </button>
          </div>
        </form>

        {/* Wallet Info */}
        {walletData.isConnected && (
          <div className="mt-8 p-4 rounded-lg" style={{ backgroundColor: '#2a2a2a' }}>
            <h3 className="text-sm font-medium mb-2" style={{ color: '#a0a0a0' }}>
              Connected Wallet
            </h3>
            <p className="text-white font-medium">{walletData.address}</p>
            <p className="text-sm" style={{ color: '#a0a0a0' }}>
              Balance: {walletData.balance ? `$${parseFloat(walletData.balance).toLocaleString()}` : '$0.00'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
} 