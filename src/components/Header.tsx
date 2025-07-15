'use client'

import { useState } from 'react'
import Image from 'next/image'
import UserProfileModal from './UserProfileModal'
import SearchModal from './SearchModal'
import { useWallet } from '@/hooks/useWallet'

// Search Icon Component
const SearchIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="11" cy="11" r="8" stroke="#ffffff" strokeWidth="2"/>
    <path d="m21 21-4.35-4.35" stroke="#ffffff" strokeWidth="2" strokeLinecap="round"/>
  </svg>
)

// Notification Icon Component
const NotificationIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" stroke="currentColor" strokeWidth="2"/>
    <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" strokeWidth="2"/>
  </svg>
)

// Chevron Down Icon Component
const ChevronDownIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

export default function Header() {
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false)
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false)
  const { walletData } = useWallet()

  // Helper function to get display name
  const getDisplayName = () => {
    if (!walletData.isConnected) return 'Connect Wallet'
    if (walletData.userProfile?.display_name) return walletData.userProfile.display_name
    if (walletData.userProfile?.username) return walletData.userProfile.username
    if (walletData.address) return `${walletData.address.slice(0, 6)}...${walletData.address.slice(-4)}`
    return 'User'
  }

  // Helper function to get avatar
  const getAvatarContent = () => {
    if (walletData.userProfile?.profile_image_url) {
      return (
        <Image 
          src={walletData.userProfile.profile_image_url} 
          alt="Profile" 
          width={20}
          height={20}
          className="w-full h-full object-cover rounded-full"
        />
      )
    }
    
    // Fallback to initials or default
    const displayName = getDisplayName()
    const initial = displayName.charAt(0).toUpperCase()
    return (
      <span style={{ color: '#000000', fontSize: '10px', fontWeight: 600 }}>
        {initial}
      </span>
    )
  }

  return (
    <>
      <header 
        className="fixed top-0 right-0 z-40 flex items-center justify-between transition-all duration-300 ease-in-out"
        style={{
          height: '48px',
          backgroundColor: '#1a1a1a',
          padding: '0 16px',
          borderBottom: '1px solid #333333',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          left: '60px', // Fixed position for collapsed navbar only
          width: 'calc(100vw - 60px)' // Fixed width for collapsed navbar only
        }}
      >
        {/* Search Section */}
        <div className="flex items-center flex-1 max-w-xl">
          <div className="relative w-full max-w-sm">
            <div 
              className="absolute left-3 top-1/2 transform -translate-y-1/2 z-10 pointer-events-none"
              style={{ color: '#ffffff' }}
            >
              <SearchIcon />
            </div>
            <input
              type="text"
              placeholder="Search Active Markets"
              value=""
              readOnly
              onClick={() => setIsSearchModalOpen(true)}
              className="w-full pl-10 pr-12 py-2 rounded-md border transition-all duration-200 focus:outline-none cursor-pointer"
              style={{
                height: '30px',
                backgroundColor: '#2a2a2a',
                borderColor: '#444444',
                color: '#ffffff',
                fontSize: '14px',
                minWidth: '240px'
              }}
              onMouseEnter={(e) => {
                const target = e.target as HTMLInputElement
                target.style.borderColor = '#555555'
                target.style.boxShadow = '0 0 0 2px rgba(255, 255, 255, 0.05)'
              }}
              onMouseLeave={(e) => {
                const target = e.target as HTMLInputElement
                target.style.borderColor = '#444444'
                target.style.boxShadow = 'none'
              }}
            />
            <div 
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-xs px-1.5 py-0.5 rounded"
              style={{
                color: '#666666',
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                fontSize: '11px'
              }}
            >
              /
            </div>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-3">
          {/* Price Display */}
          <div 
            className="hidden sm:block"
            style={{
              fontSize: '14px',
              fontWeight: 500,
              color: '#ffffff'
            }}
          >
            ETH $3,241.52
          </div>

          {/* Notification Icon */}
          <button 
            className="p-1.5 rounded-md transition-all duration-200"
            style={{ color: '#ffffff' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#b3b3b3'
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = '#ffffff'
              e.currentTarget.style.backgroundColor = 'transparent'
            }}
          >
            <NotificationIcon />
          </button>

          {/* User Profile Section */}
          <div 
            className="flex items-center gap-1.5 px-1.5 py-1 rounded-md cursor-pointer transition-all duration-200"
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent'
            }}
            onClick={() => setIsProfileModalOpen(true)}
          >
            {/* Avatar */}
            <div 
              className="flex items-center justify-center rounded-full overflow-hidden"
              style={{
                width: '30px',
                height: '30px',
                backgroundColor: '#00d4aa',
                border: '2px solid #00d4aa'
              }}
            >
              {getAvatarContent()}
            </div>

            {/* Username (hidden on mobile) */}
            <span 
              className="hidden sm:block text-sm font-medium"
              style={{ color: '#ffffff', fontSize: '13px' }}
            >
              {getDisplayName()}
            </span>

            {/* Dropdown Arrow */}
            <div style={{ color: '#b3b3b3' }}>
              <ChevronDownIcon />
            </div>
          </div>
        </div>
      </header>

      {/* User Profile Modal */}
      <UserProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        walletAddress={walletData.address ? `${walletData.address.slice(0, 6)}...${walletData.address.slice(-4)}` : 'Not connected'}
        balance={walletData.balance ? `${parseFloat(walletData.balance).toFixed(4)} ETH` : '$0.00'}
        isConnected={walletData.isConnected}
        profilePhotoUrl={walletData.userProfile?.profile_image_url}
      />

      {/* Search Modal */}
      <SearchModal
        isOpen={isSearchModalOpen}
        onClose={() => setIsSearchModalOpen(false)}
      />
    </>
  )
} 