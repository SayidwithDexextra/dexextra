'use client'

import { useEffect, useState, useCallback, useRef, type RefObject } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useWallet } from '@/hooks/useWallet'
import { supabase } from '@/lib/supabase'

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
  anchorRef?: RefObject<HTMLElement | null>
}

export default function UserProfileModal({ 
  isOpen, 
  onClose, 
  walletAddress = "0x60d1...796b", 
  balance = "$31.07",
  isConnected = true,
  profilePhotoUrl,
  anchorRef,
}: UserProfileModalProps) {
  const router = useRouter()
  const { disconnect } = useWallet() as { disconnect?: () => Promise<void> | void }
  const [isVisible, setIsVisible] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)
  const [imageError, setImageError] = useState(false)
  const dropdownRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null)
  
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
      // Hide dropdown after animation completes
      setTimeout(() => setIsVisible(false), 200)
    }
  }, [isOpen])

  // Close dropdown on escape key (dropdown behavior)
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    
    if (!isVisible) return
    document.addEventListener('keydown', handleEscape)
    
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isVisible, onClose])

  // Position dropdown under the profile button (right-aligned).
  useEffect(() => {
    if (!isVisible) return

    const updatePosition = () => {
      const el = anchorRef?.current
      if (!el) {
        setPosition({ top: 56, right: 16 })
        return
      }
      const rect = el.getBoundingClientRect()
      const vw = window.innerWidth || 0
      const panelWidth = Math.min(320, Math.max(0, vw - 24)) // respects maxWidth: calc(100vw - 24px)
      const minEdge = 12

      // Right-align panel to the trigger's right edge, but clamp so it never overflows left.
      const rawRight = vw - rect.right
      const maxRight = Math.max(minEdge, vw - panelWidth - minEdge)
      const right = Math.max(minEdge, Math.min(rawRight, maxRight))

      const top = Math.round(rect.bottom + 8) // small gap below trigger
      setPosition({ top, right })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [isVisible, anchorRef])

  // Close dropdown on outside click (dropdown behavior)
  useEffect(() => {
    if (!isVisible) return

    const handlePointerDown = (event: MouseEvent | PointerEvent) => {
      const node = dropdownRef.current
      if (!node) return
      const anchor = anchorRef?.current

      // Clicking the profile trigger should toggle (handled in Header), not auto-close here.
      if (anchor && anchor.contains(event.target as Node)) return
      if (node.contains(event.target as Node)) return
      onClose()
    }

    // Use capture so it closes even if inner elements stop propagation.
    document.addEventListener('pointerdown', handlePointerDown as any, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown as any, true)
  }, [isVisible, onClose, anchorRef])

  if (!isVisible) return null

  return (
    <div
      ref={dropdownRef}
      className="fixed"
      role="menu"
      aria-label="Profile menu"
      style={{
        // Must sit above the navbar (Navbar uses zIndex: 9999) and header content.
        zIndex: 10000,
        top: `${position?.top ?? 56}px`,
        right: `${position?.right ?? 16}px`,
        width: '320px',
        maxWidth: 'calc(100vw - 24px)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        transformOrigin: 'top right',
        transform: isAnimating ? 'translateY(0) scale(1)' : 'translateY(-8px) scale(0.98)',
        opacity: isAnimating ? 1 : 0,
        transition: 'transform 160ms ease-out, opacity 160ms ease-out',
        pointerEvents: isAnimating ? 'auto' : 'none',
      }}
    >
      <div
        className="relative overflow-hidden rounded-md border border-[#222222] bg-[#0F0F0F] transition-all duration-200"
        style={{
          width: '100%',
          padding: '0',
          // Match the subtle elevation used across overlays (see watchlist "Add assets" modal)
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)',
        }}
      >
        {/* Connected Wallet Section */}
        {isConnected && (
          <div 
            className="flex items-center justify-between p-2.5 border-b border-[#1A1A1A]"
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div 
                className="w-7 h-7 rounded-full overflow-hidden bg-[#2A2A2A] flex-shrink-0 border border-[#222222]"
              >
                {/* Profile Photo or Fallback */}
                {profilePhotoUrl && !imageError ? (
                  <Image
                    src={profilePhotoUrl}
                    alt="Profile"
                    width={28}
                    height={28}
                    className="w-full h-full object-cover"
                    onError={() => setImageError(true)}
                    unoptimized={profilePhotoUrl.startsWith('data:') || profilePhotoUrl.startsWith('blob:')}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[10px] font-medium text-[#808080]">
                    {(walletAddress || 'U').slice(0, 1).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium text-white font-mono truncate">{walletAddress}</div>
                <div className="text-[10px] text-[#606060] font-mono truncate">{balance}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 pl-3">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400" />
              <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                Connected
              </div>
            </div>
          </div>
        )}

        {/* Menu Items */}
        <div className="py-1">
          {/* Watchlist */}
          <button 
            className="w-full text-left group transition-all duration-200"
            onClick={() => {
              router.push('/watchlist')
              onClose()
            }}
          >
            <div className="flex items-center justify-between p-2.5 hover:bg-[#1A1A1A]">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040] group-hover:bg-blue-400 transition-colors duration-200" />
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="text-[#9CA3AF] group-hover:text-white transition-colors duration-200">
                    <EyeIcon />
                  </span>
                  <span className="text-[11px] font-medium text-[#808080] group-hover:text-white transition-colors duration-200">
                    Watchlist
                  </span>
                </div>
              </div>
            </div>
          </button>

          {/* Profile */}
          <Link 
            href="/settings"
            className="block w-full text-left group transition-all duration-200"
            onClick={onClose}
          >
            <div className="flex items-center justify-between p-2.5 hover:bg-[#1A1A1A] border-t border-[#1A1A1A]">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040] group-hover:bg-blue-400 transition-colors duration-200" />
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="text-[#9CA3AF] group-hover:text-white transition-colors duration-200">
                    <ProfileIcon />
                  </span>
                  <span className="text-[11px] font-medium text-[#808080] group-hover:text-white transition-colors duration-200">
                    Profile
                  </span>
                </div>
              </div>
            </div>
          </Link>

          {/* Logout */}
          <button 
            className="w-full text-left group transition-all duration-200"
            onClick={handleLogout}
          >
            <div className="flex items-center justify-between p-2.5 border-t border-[#1A1A1A] hover:bg-red-500/5">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-400/70 group-hover:bg-red-400 transition-colors duration-200" />
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="text-red-400 group-hover:text-red-300 transition-colors duration-200">
                    <LogoutIcon />
                  </span>
                  <span className="text-[11px] font-medium text-red-400 group-hover:text-red-300 transition-colors duration-200">
                    Logout
                  </span>
                </div>
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  )
} 