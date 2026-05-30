'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

const STORAGE_KEY = 'dexetera-mvp-warning-acknowledged';

interface MVPWarningModalProps {
  forceShow?: boolean;
  onClose?: () => void;
}

export default function EarlyAccessWarningModal({ forceShow, onClose }: MVPWarningModalProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isChecked, setIsChecked] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  const handleDismiss = useCallback(() => {
    if (!isChecked && !forceShow) return;
    
    setIsAnimating(false);
    setTimeout(() => {
      setIsDismissed(true);
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, 'true');
      }
      onClose?.();
    }, 200);
  }, [isChecked, forceShow, onClose]);

  useEffect(() => {
    setMounted(true);
    
    if (forceShow) {
      setIsVisible(true);
      setIsDismissed(false);
      setTimeout(() => setIsAnimating(true), 10);
      return;
    }
    
    const acknowledged = typeof window !== 'undefined' 
      ? localStorage.getItem(STORAGE_KEY) === 'true'
      : false;
    
    if (!acknowledged) {
      setIsVisible(true);
      setTimeout(() => setIsAnimating(true), 10);
    }
  }, [forceShow]);

  if (!mounted || !isVisible || isDismissed) return null;

  const modalContent = (
    <div 
      className={`fixed inset-0 z-[9999] flex items-center justify-center p-4 transition-opacity duration-200 ${isAnimating ? 'opacity-100' : 'opacity-0'}`}
    >
      {/* Backdrop */}
      <div 
        className={`absolute inset-0 bg-black/50 backdrop-blur-[2px] transition-opacity duration-200 ${isAnimating ? 'opacity-100' : 'opacity-0'}`}
      />
      
      {/* Modal Card - Following SophisticatedMinimalDesignSystem */}
      <div 
        className={`group relative z-10 w-full max-w-md bg-[#0F0F0F] rounded-md border border-[#222222] transition-all duration-200 transform ${isAnimating ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
        style={{ boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-2.5 border-b border-[#1A1A1A]">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-yellow-400" />
            <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
              MVP Notice
            </h4>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-[10px] text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded border border-yellow-400/20">
              Beta
            </div>
            <button
              onClick={() => {
                if (isChecked || forceShow) handleDismiss();
              }}
              className={`p-1 rounded transition-all duration-200 ${
                isChecked || forceShow 
                  ? 'hover:bg-[#1A1A1A] text-[#606060] hover:text-[#9CA3AF] cursor-pointer' 
                  : 'text-[#404040] cursor-not-allowed'
              }`}
              aria-label="Close"
              disabled={!isChecked && !forceShow}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-2.5">
          {/* Main Message */}
          <p className="text-[11px] text-[#808080] leading-relaxed mb-3">
            <span className="text-white font-medium">Dexetera is currently in MVP.</span>{' '}
            This application is actively being developed and may contain bugs or undergo significant changes.
          </p>

          {/* Warning Text */}
          <p className="text-[11px] text-[#808080] leading-relaxed mb-2.5">
            By proceeding, you acknowledge and accept:
          </p>

          {/* Bullet Points */}
          <div className="space-y-2 mb-3">
            <div className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 mt-1 flex-shrink-0" />
              <span className="text-[10px] text-[#606060]">There may be visual bugs and interface issues</span>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 mt-1 flex-shrink-0" />
              <span className="text-[10px] text-[#606060]">Data may not always be live and may require page refreshes</span>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 mt-1 flex-shrink-0" />
              <span className="text-[10px] text-[#606060]">Features and functionality may not work as intended</span>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 mt-1 flex-shrink-0" />
              <span className="text-[10px] text-[#606060]">The application is under active development</span>
            </div>
          </div>

          {/* Discord Link */}
          <p className="text-[10px] text-[#606060] mb-3">
            Please report bugs in our{' '}
            <a 
              href="https://discord.gg/dexetera" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-[#5865F2] hover:text-[#7289DA] hover:underline inline-flex items-center gap-1 transition-all duration-200"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
              </svg>
              Discord
            </a>
          </p>

          {/* Checkbox */}
          <label className="flex items-center gap-2 cursor-pointer group/checkbox mb-3">
            <div className="relative">
              <input
                type="checkbox"
                checked={isChecked}
                onChange={(e) => setIsChecked(e.target.checked)}
                className="sr-only peer"
              />
              <div className={`w-4 h-4 rounded border transition-all duration-200 flex items-center justify-center ${
                isChecked 
                  ? 'bg-white border-white' 
                  : 'border-[#333333] group-hover/checkbox:border-[#444444]'
              }`}>
                {isChecked && (
                  <svg className="w-2.5 h-2.5 text-[#0F0F0F]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
            </div>
            <span className="text-[11px] text-[#808080] group-hover/checkbox:text-[#9CA3AF] transition-all duration-200">
              I understand the risks and agree to continue
            </span>
          </label>

          {/* Continue Button */}
          <button
            onClick={handleDismiss}
            disabled={!isChecked && !forceShow}
            className={`w-full py-2 px-2.5 rounded-md text-[11px] font-medium transition-all duration-200 ${
              isChecked || forceShow
                ? 'bg-white text-[#0F0F0F] hover:bg-[#E5E5E5] cursor-pointer'
                : 'bg-[#1A1A1A] text-[#404040] border border-[#222222] cursor-not-allowed'
            }`}
          >
            I Understand, Continue to App
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
