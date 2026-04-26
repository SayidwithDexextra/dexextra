'use client'

import { useState, useEffect, useCallback } from 'react'

const COMING_SOON_PASSWORD = process.env.NEXT_PUBLIC_COMING_SOON_PASSWORD || 'dexetera2026'
const SESSION_KEY = 'dexetera_coming_soon_unlocked'

interface ComingSoonGateProps {
  children: React.ReactNode
}

export default function ComingSoonGate({ children }: ComingSoonGateProps) {
  const [isUnlocked, setIsUnlocked] = useState<boolean | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isShaking, setIsShaking] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    
    // TEMPORARY: Show overlay in development for testing
    // TODO: Restore production-only check before deploying:
    // const isProduction = process.env.NODE_ENV === 'production'
    // if (!isProduction) {
    //   setIsUnlocked(true)
    //   return
    // }

    // Check session storage for unlocked state
    const unlocked = sessionStorage.getItem(SESSION_KEY)
    setIsUnlocked(unlocked === 'true')
  }, [])

  const handleUnlock = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    
    if (password === COMING_SOON_PASSWORD) {
      sessionStorage.setItem(SESSION_KEY, 'true')
      setIsUnlocked(true)
      setError('')
    } else {
      setError('Invalid access code')
      setIsShaking(true)
      setTimeout(() => setIsShaking(false), 500)
    }
  }, [password])

  // Loading state - show minimal loading screen
  if (isUnlocked === null) {
    return (
      <div className="fixed inset-0 bg-[#0A0A0A] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#333333] border-t-white rounded-full animate-spin" />
      </div>
    )
  }

  // Unlocked - render the app
  if (isUnlocked) {
    return <>{children}</>
  }

  // Show coming soon gate
  return (
    <div className="fixed inset-0 bg-[#0A0A0A] flex items-center justify-center overflow-auto">
      {/* Content */}
      <div className="flex flex-col items-center justify-center px-6 py-12 text-center max-w-lg">
        {/* Logo */}
        <div className="mb-8">
          <img 
            src="/Dexicon/LOGO-Dexetera-03.svg" 
            alt="Dexetera" 
            className="w-16 h-16 mx-auto"
          />
        </div>
        
        {/* Coming Soon Badge */}
        <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-2 py-1 rounded uppercase tracking-widest mb-6 border border-[#222222]">
          Coming Soon
        </div>
        
        {/* Main Title */}
        <h1 className="text-3xl md:text-4xl font-medium text-white mb-3 tracking-tight">
          Dexetera
        </h1>
        
        {/* Subtitle */}
        <p className="text-[#808080] text-sm md:text-base mb-6 leading-relaxed">
          Gas-free trading on Hyperliquid.<br />
          Create and trade any measurable market.
        </p>
        
        {/* Star Wars Reference */}
        <div className="mb-8">
          <p className="text-[#9CA3AF] text-lg md:text-xl font-medium mb-2 italic">
            May the 4th be with you
          </p>
          <div className="flex items-center justify-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-[11px] text-[#606060] uppercase tracking-wide">
              Release Date: May 4th, 2026
            </span>
          </div>
        </div>
        
        {/* Password Form */}
        <form onSubmit={handleUnlock} className="w-full max-w-xs mb-8">
          <div className="group bg-[#0F0F0F] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 overflow-hidden">
            <div className="flex items-center">
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setError('')
                }}
                placeholder="Enter access code"
                className={`flex-1 bg-transparent px-4 py-3 text-sm text-white placeholder-[#404040] outline-none transition-all duration-200 ${
                  isShaking ? 'animate-shake' : ''
                }`}
                autoFocus
              />
              <button
                type="submit"
                className="px-4 py-3 text-[#808080] hover:text-white transition-colors duration-200 border-l border-[#222222]"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
            </div>
          </div>
          
          {/* Error Message */}
          {error && (
            <p className="text-red-400 text-[11px] mt-2 text-left px-1">
              {error}
            </p>
          )}
        </form>
        
        {/* Link to main site */}
        <div className="flex flex-col items-center gap-3">
          <span className="text-[10px] text-[#404040] uppercase tracking-widest">
            Learn more
          </span>
          <a
            href="https://dexetera.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-2 bg-[#1A1A1A] hover:bg-[#2A2A2A] rounded-md border border-[#222222] hover:border-[#333333] px-4 py-2.5 transition-all duration-200"
          >
            <span className="text-sm text-[#9CA3AF] group-hover:text-white transition-colors duration-200">
              dexetera.org
            </span>
            <svg 
              className="w-3.5 h-3.5 text-[#606060] group-hover:text-[#808080] transition-colors duration-200" 
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor" 
              strokeWidth="2"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>
        
        {/* Subtle border decoration */}
        <div className="mt-12 w-24 h-px bg-gradient-to-r from-transparent via-[#333333] to-transparent" />
      </div>
      
      {/* Custom shake animation */}
      <style jsx>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
          20%, 40%, 60%, 80% { transform: translateX(4px); }
        }
        .animate-shake {
          animation: shake 0.5s ease-in-out;
        }
      `}</style>
    </div>
  )
}
