'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'
import { Button } from '@/components/ui/Button'

interface FormData {
  marketName: string
  symbol: string
  description: string
  underlyingAsset: string
  contractSize: string
  expirationDate: string
  settlementType: string
  minimumPriceIncrement: string
  initialMarginRate: string
  maintenanceMarginRate: string
  positionLimit: string
  dailyPriceLimit: string
  tradingHours: string
  category: string
}

interface UploadedFile {
  file: File
  preview: string
  name: string
  size: string
}

export default function CreateMarketForm() {
  const [formData, setFormData] = useState<FormData>({
    marketName: '',
    symbol: '',
    description: '',
    underlyingAsset: '',
    contractSize: '',
    expirationDate: '',
    settlementType: 'cash',
    minimumPriceIncrement: '',
    initialMarginRate: '',
    maintenanceMarginRate: '',
    positionLimit: '',
    dailyPriceLimit: '',
    tradingHours: '24/7',
    category: 'cryptocurrency'
  })

  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleFileSelect = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    processFiles(files)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    processFiles(files)
  }

  const processFiles = (files: File[]) => {
    const imageFiles = files.filter(file => file.type.startsWith('image/'))
    
    imageFiles.forEach(file => {
      const reader = new FileReader()
      reader.onload = () => {
        const newFile: UploadedFile = {
          file,
          preview: reader.result as string,
          name: file.name,
          size: `${(file.size / 1024 / 1024).toFixed(1)}MB`
        }
        setUploadedFiles(prev => [...prev, newFile])
      }
      reader.readAsDataURL(file)
    })
  }

  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
     console.log('Form Data:', formData)
     console.log('Uploaded Files:', uploadedFiles)
    // Handle form submission here
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      {/* Form Section */}
      <div className="lg:col-span-2">
        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Basic Market Information */}
          <div className="bg-[#2a2a2a] rounded-xl p-8 border border-[#404040]">
            <h2 className="text-lg font-medium text-white mb-6">Basic Market Information</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-[#a1a1a1] mb-2">
                  Market Name
                </label>
                <input
                  type="text"
                  name="marketName"
                  value={formData.marketName}
                  onChange={handleInputChange}
                  placeholder="Bitcoin Futures Dec 2024"
                  className="w-full h-12 px-4 bg-[#353535] border border-[#404040] rounded-lg text-white placeholder-[#666666] focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/20 transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#a1a1a1] mb-2">
                  Symbol
                </label>
                <input
                  type="text"
                  name="symbol"
                  value={formData.symbol}
                  onChange={handleInputChange}
                  placeholder="BTCUSD1224"
                  className="w-full h-12 px-4 bg-[#353535] border border-[#404040] rounded-lg text-white placeholder-[#666666] focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/20 transition-colors"
                />
              </div>
            </div>

            <div className="mt-6">
              <label className="block text-sm font-medium text-[#a1a1a1] mb-2">
                Description
              </label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                placeholder="Detailed description of the futures market..."
                rows={4}
                className="w-full px-4 py-3 bg-[#353535] border border-[#404040] rounded-lg text-white placeholder-[#666666] focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/20 transition-colors resize-none"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
              <div>
                <label className="block text-sm font-medium text-[#a1a1a1] mb-2">
                  Underlying Asset
                </label>
                <select
                  name="underlyingAsset"
                  value={formData.underlyingAsset}
                  onChange={handleInputChange}
                  className="w-full h-12 px-4 bg-[#353535] border border-[#404040] rounded-lg text-white focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/20 transition-colors"
                >
                  <option value="">Select underlying asset</option>
                  <option value="BTC">Bitcoin (BTC)</option>
                  <option value="ETH">Ethereum (ETH)</option>
                  <option value="SOL">Solana (SOL)</option>
                  <option value="ADA">Cardano (ADA)</option>
                  <option value="MATIC">Polygon (MATIC)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#a1a1a1] mb-2">
                  Category
                </label>
                <select
                  name="category"
                  value={formData.category}
                  onChange={handleInputChange}
                  className="w-full h-12 px-4 bg-[#353535] border border-[#404040] rounded-lg text-white focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/20 transition-colors"
                >
                  <option value="cryptocurrency">Cryptocurrency</option>
                  <option value="defi">DeFi</option>
                  <option value="nft">NFT</option>
                  <option value="gaming">Gaming</option>
                </select>
              </div>
            </div>
          </div>

          {/* Contract Specifications */}
          <div className="bg-[#2a2a2a] rounded-xl p-8 border border-[#404040]">
            <h2 className="text-lg font-medium text-white mb-6">Contract Specifications</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-[#a1a1a1] mb-2">
                  Contract Size
                </label>
                <input
                  type="text"
                  name="contractSize"
                  value={formData.contractSize}
                  onChange={handleInputChange}
                  placeholder="1.0"
                  className="w-full h-12 px-4 bg-[#353535] border border-[#404040] rounded-lg text-white placeholder-[#666666] focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/20 transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#a1a1a1] mb-2">
                  Expiration Date
                </label>
                <input
                  type="date"
                  name="expirationDate"
                  value={formData.expirationDate}
                  onChange={handleInputChange}
                  className="w-full h-12 px-4 bg-[#353535] border border-[#404040] rounded-lg text-white focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/20 transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#a1a1a1] mb-2">
                  Settlement Type
                </label>
                <select
                  name="settlementType"
                  value={formData.settlementType}
                  onChange={handleInputChange}
                  className="w-full h-12 px-4 bg-[#353535] border border-[#404040] rounded-lg text-white focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/20 transition-colors"
                >
                  <option value="cash">Cash Settlement</option>
                  <option value="physical">Physical Delivery</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#a1a1a1] mb-2">
                  Trading Hours
                </label>
                <select
                  name="tradingHours"
                  value={formData.tradingHours}
                  onChange={handleInputChange}
                  className="w-full h-12 px-4 bg-[#353535] border border-[#404040] rounded-lg text-white focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/20 transition-colors"
                >
                  <option value="24/7">24/7</option>
                  <option value="market-hours">Market Hours Only</option>
                  <option value="custom">Custom Hours</option>
                </select>
              </div>
            </div>
          </div>

          {/* Trading Parameters */}
          <div className="bg-[#2a2a2a] rounded-xl p-8 border border-[#404040]">
            <h2 className="text-lg font-medium text-white mb-6">Trading Parameters</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-[#a1a1a1] mb-2">
                  Minimum Price Increment
                </label>
                <input
                  type="text"
                  name="minimumPriceIncrement"
                  value={formData.minimumPriceIncrement}
                  onChange={handleInputChange}
                  placeholder="0.01"
                  className="w-full h-12 px-4 bg-[#353535] border border-[#404040] rounded-lg text-white placeholder-[#666666] focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/20 transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#a1a1a1] mb-2">
                  Daily Price Limit (%)
                </label>
                <input
                  type="text"
                  name="dailyPriceLimit"
                  value={formData.dailyPriceLimit}
                  onChange={handleInputChange}
                  placeholder="10"
                  className="w-full h-12 px-4 bg-[#353535] border border-[#404040] rounded-lg text-white placeholder-[#666666] focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/20 transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#a1a1a1] mb-2">
                  Initial Margin Rate (%)
                </label>
                <input
                  type="text"
                  name="initialMarginRate"
                  value={formData.initialMarginRate}
                  onChange={handleInputChange}
                  placeholder="5"
                  className="w-full h-12 px-4 bg-[#353535] border border-[#404040] rounded-lg text-white placeholder-[#666666] focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/20 transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#a1a1a1] mb-2">
                  Maintenance Margin Rate (%)
                </label>
                <input
                  type="text"
                  name="maintenanceMarginRate"
                  value={formData.maintenanceMarginRate}
                  onChange={handleInputChange}
                  placeholder="3"
                  className="w-full h-12 px-4 bg-[#353535] border border-[#404040] rounded-lg text-white placeholder-[#666666] focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/20 transition-colors"
                />
              </div>
            </div>

            <div className="mt-6">
              <label className="block text-sm font-medium text-[#a1a1a1] mb-2">
                Position Limit
              </label>
              <input
                type="text"
                name="positionLimit"
                value={formData.positionLimit}
                onChange={handleInputChange}
                placeholder="1000"
                className="w-full h-12 px-4 bg-[#353535] border border-[#404040] rounded-lg text-white placeholder-[#666666] focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/20 transition-colors"
              />
            </div>
          </div>

          {/* File Upload Section with Click-Spark */}
          <div className="bg-[#2a2a2a] rounded-xl p-8 border border-[#404040]">
            <h2 className="text-lg font-medium text-white mb-6">Market Images</h2>
            
            <div
              className="border-2 border-dashed border-[#404040] rounded-lg p-8 text-center cursor-pointer transition-all duration-200 hover:border-[#3b82f6] hover:bg-[#353535]"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={handleFileSelect}
              style={{
                borderColor: isDragOver ? '#3b82f6' : '#404040',
                backgroundColor: isDragOver ? '#353535' : 'transparent'
              }}
            >
              <div className="text-4xl mb-4">📁</div>
              <p className="text-[#a1a1a1] mb-2">
                Drag and drop your market images here, or click to browse
              </p>
              <p className="text-sm text-[#666666]">
                Supports: JPG, PNG, GIF (Max 5MB each)
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />

            {/* File Preview with Remove Button Click-Spark */}
            {uploadedFiles.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-6">
                {uploadedFiles.map((file, index) => (
                  <div key={index} className="relative group">
                    <Image
                      src={file.preview}
                      alt={file.name}
                      width={96}
                      height={96}
                      className="w-full h-24 object-cover rounded-lg border border-[#404040]"
                    />
                    <button
                      type="button"
                      onClick={() => removeFile(index)}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-[#ef4444] text-white rounded-full flex items-center justify-center text-xs transition-all duration-200 hover:scale-110"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Submit Section */}
          <div className="flex gap-4 justify-end">
            <Button variant="secondary" type="button">
              Save as Draft
            </Button>
            <Button variant="primary" type="submit">
              Create Market
            </Button>
          </div>
        </form>
      </div>

      {/* Image Upload Section */}
      <div className="lg:col-span-1">
        <div className="bg-[#2a2a2a] rounded-xl p-8 border border-[#404040] sticky top-8">
          <h2 className="text-lg font-medium text-white mb-6">Market Images</h2>
          
          {/* File Upload Area */}
          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
              isDragOver 
                ? 'border-[#3b82f6] bg-[#1e3a8a]/10' 
                : 'border-[#404040] hover:border-[#525252]'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleFileSelect}
          >
            <div className="space-y-3">
              <div className="w-12 h-12 mx-auto bg-[#353535] rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-[#a1a1a1]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </div>
              <div>
                <p className="text-white font-medium">Upload market images</p>
                <p className="text-[#a1a1a1] text-sm">Drag and drop or click to select</p>
                <p className="text-[#666666] text-xs mt-1">PNG, JPG up to 10MB</p>
              </div>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
          />

          {/* Uploaded Files */}
          {uploadedFiles.length > 0 && (
            <div className="mt-6 space-y-3">
              <h3 className="text-sm font-medium text-[#a1a1a1]">Uploaded Images ({uploadedFiles.length})</h3>
              
              {uploadedFiles.map((file, index) => (
                <div key={index} className="bg-[#353535] rounded-lg p-4 border border-[#404040]">
                  <div className="flex items-start space-x-3">
                    <Image
                      src={file.preview}
                      alt={file.name}
                      width={64}
                      height={64}
                      className="w-16 h-16 object-cover rounded-lg border border-[#404040]"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{file.name}</p>
                      <p className="text-[#a1a1a1] text-xs">{file.size}</p>
                      <div className="mt-2 bg-[#2a2a2a] rounded-full h-1">
                        <div className="bg-[#3b82f6] h-1 rounded-full w-full"></div>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        removeFile(index)
                      }}
                      className="text-[#a1a1a1] hover:text-white transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
} 