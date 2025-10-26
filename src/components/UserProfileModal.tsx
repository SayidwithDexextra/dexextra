'use client'

import { useEffect, useState, useCallback } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useWallet } from '@/hooks/useWallet'
import { supabase } from '@/lib/supabase'

// Check Icon Component
const CheckIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

// Eye Icon Component
const EyeIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M1 12S5 4 12 4S23 12 23 12S19 20 12 20S1 12 1 12Z" stroke="currentColor" strokeWidth="2"/>
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
  </svg>
)

// Profile Icon Component
const ProfileIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M20 21V19C20 17.9391 19.5786 16.9217 18.8284 16.1716C18.0783 15.4214 17.0609 15 16 15H8C6.93913 15 5.92172 15.4214 5.17157 16.1716C4.42143 16.9217 4 17.9391 4 19V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="2"/>
  </svg>
)

// Logout Icon Component
const LogoutIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M9 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <polyline points="16,17 21,12 16,7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <line x1="21" y1="12" x2="9" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  </svg>
)

interface UserProfileModalProps {
  isOpen: boolean
  onClose: () => void
  walletAddress?: string
  balance?: string
  isConnected?: boolean
  profilePhotoUrl?: string
}

export default function UserProfileModal({ 
  isOpen, 
  onClose, 
  walletAddress = "0x60d1...796b", 
  balance = "$31.07",
  isConnected = true,
  profilePhotoUrl
}: UserProfileModalProps) {
  const router = useRouter()
  const { disconnect } = useWallet() as { disconnect?: () => Promise<void> | void }
  const [isVisible, setIsVisible] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)
  const [imageError, setImageError] = useState(false)
  
  const handleLogout = useCallback(async () => {
    try {
      // Best-effort Supabase sign-out (if using auth)
      try {
        await supabase.auth.signOut()
      } catch {
        // ignore if auth not initialized/used
      }
      // Disconnect wallet context/state
      if (typeof disconnect === 'function') {
        await Promise.resolve(disconnect())
      }
    } finally {
      onClose()
    }
  }, [disconnect, onClose])
  
  // Handle modal opening/closing with animation
  useEffect(() => {
    if (isOpen) {
      setIsVisible(true)
      // Trigger animation after modal is visible
      setTimeout(() => setIsAnimating(true), 10)
    } else {
      setIsAnimating(false)
      // Hide modal after animation completes
      setTimeout(() => setIsVisible(false), 300)
    }
  }, [isOpen])

  // Close modal on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    
    if (isVisible) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }
    
    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = 'unset'
    }
  }, [isVisible, onClose])

  if (!isVisible) return null

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center transition-all duration-500 ease-out"
      style={{ 
        backgroundColor: 'transparent',
        opacity: isAnimating ? 1 : 0
      }}
      onClick={onClose}
    >
      <div 
        className="relative rounded-xl shadow-2xl transition-all duration-1000 ease-out"
        style={{
          backgroundColor: '#2a2a2a',
          border: '1px solid #444444',
          width: '320px',
          padding: '0',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          transform: isAnimating ? 'scale(1) translateY(0)' : 'scale(0.8) translateY(-20px)',
          opacity: isAnimating ? 1 : 0
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Connected Wallet Section */}
        {isConnected && (
          <div 
            className="flex items-center justify-between p-4 border-b"
            style={{ borderColor: '#444444' }}
          >
            <div className="flex items-center gap-3">
              <div 
                className="flex items-center justify-center rounded-lg overflow-hidden"
                style={{
                  width: '40px',
                  height: '40px',
                  backgroundColor: '#00d4aa',
                  border: '2px solid #00d4aa'
                }}
              >
                {/* Profile Photo or Fallback */}
                {profilePhotoUrl && !imageError ? (
                  <Image
                    src={profilePhotoUrl}
                    alt="Profile"
                    width={40}
                    height={40}
                    className="w-full h-full object-cover"
                    onError={() => setImageError(true)}
                    unoptimized={profilePhotoUrl.startsWith('data:') || profilePhotoUrl.startsWith('blob:')}
                  />
                ) : (
                  <div className="w-6 h-6 bg-blue-500 rounded flex items-center justify-center">
                    <ProfileIcon />
                  </div>
                )}
              </div>
              <div>
                <div 
                  className="font-medium"
                  style={{ 
                    color: '#ffffff', 
                    fontSize: '16px',
                    lineHeight: '1.2'
                  }}
                >
                  {walletAddress}
                </div>
                <div 
                  style={{ 
                    color: '#a0a0a0', 
                    fontSize: '14px',
                    lineHeight: '1.2',
                    marginTop: '2px'
                  }}
                >
                  {balance}
                </div>
              </div>
            </div>
            <div style={{ color: '#00d4aa' }}>
              <CheckIcon />
            </div>
          </div>
        )}

        {/* Menu Items */}
        <div className="py-2">
          {/* Watchlist */}
          <button 
            className="w-full flex items-center gap-3 px-4 py-3 transition-all duration-200 hover:bg-opacity-80"
            style={{ 
              backgroundColor: 'transparent',
              border: 'none',
              textAlign: 'left'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent'
            }}
            onClick={() => {
              // Handle watchlist navigation
              onClose()
            }}
          >
            <div style={{ color: '#ffffff' }}>
              <EyeIcon />
            </div>
            <span 
              style={{ 
                color: '#ffffff', 
                fontSize: '16px',
                fontWeight: '500'
              }}
            >
              Watchlist
            </span>
          </button>

          {/* Profile */}
          <button 
            className="w-full flex items-center gap-3 px-4 py-3 transition-all duration-200"
            style={{ 
              backgroundColor: 'transparent',
              border: 'none',
              textAlign: 'left'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent'
            }}
            onClick={() => {
              router.push('/settings')
              onClose()
            }}
          >
            <div style={{ color: '#ffffff' }}>
              <ProfileIcon />
            </div>
            <span 
              style={{ 
                color: '#ffffff', 
                fontSize: '16px',
                fontWeight: '500'
              }}
            >
              Profile
            </span>
          </button>

          {/* Logout */}
          <button 
            className="w-full flex items-center gap-3 px-4 py-3 transition-all duration-200"
            style={{ 
              backgroundColor: 'transparent',
              border: 'none',
              textAlign: 'left'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent'
            }}
            onClick={handleLogout}
          >
            <div style={{ color: '#ef4444' }}>
              <LogoutIcon />
            </div>
            <span 
              style={{ 
                color: '#ef4444', 
                fontSize: '16px',
                fontWeight: '500'
              }}
            >
              Logout
            </span>
          </button>
        </div>
      </div>
    </div>
  )
} 