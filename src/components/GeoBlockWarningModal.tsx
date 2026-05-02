'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface GeoBlockWarningModalProps {
  country?: string;
  forceShow?: boolean;
  onClose?: () => void;
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
  return null;
}

export default function GeoBlockWarningModal({ country, forceShow, onClose }: GeoBlockWarningModalProps) {
  const [isBlocked, setIsBlocked] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [detectedCountry, setDetectedCountry] = useState<string>(country || 'US');
  const [mounted, setMounted] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  // Handle dismissal - works with or without onClose prop
  const handleDismiss = useCallback(() => {
    setIsAnimating(false);
    setTimeout(() => {
      setIsDismissed(true);
      // Call external onClose if provided (for debug mode)
      onClose?.();
    }, 200);
  }, [onClose]);

  useEffect(() => {
    setMounted(true);
    
    if (forceShow) {
      setIsBlocked(true);
      setIsDismissed(false);
      setDetectedCountry(country || 'US');
      setTimeout(() => setIsAnimating(true), 10);
      return;
    }
    
    const blocked = getCookie('geo-blocked') === 'true';
    const geoCountry = getCookie('geo-country') || country || '';
    
    setIsBlocked(blocked);
    setDetectedCountry(geoCountry);
    
    if (blocked) {
      setTimeout(() => setIsAnimating(true), 10);
    }
  }, [country, forceShow]);

  if (!mounted || !isBlocked || isDismissed) return null;

  const countryName = detectedCountry === 'US' ? 'United States' : detectedCountry;

  const modalContent = (
    <div 
      className={`fixed inset-0 z-[9999] flex items-center justify-center p-4 transition-opacity duration-300 ${isAnimating ? 'opacity-100' : 'opacity-0'}`}
    >
      {/* Backdrop - minimal blur, can see background clearly */}
      <div 
        className={`absolute inset-0 bg-black/30 backdrop-blur-[2px] transition-opacity duration-200 ${isAnimating ? 'opacity-100' : 'opacity-0'}`}
        onClick={handleDismiss}
      />
      
      {/* Modal Card - Wide design matching design system */}
      <div 
        className={`group relative z-10 w-full max-w-md bg-[#0F0F0F] rounded-md border border-[#222222] transition-all duration-200 transform ${isAnimating ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
        style={{
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-2.5 border-b border-[#1A1A1A]">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-400" />
            <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
              Region Restricted
            </h4>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-[10px] text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded border border-red-400/20">
              {detectedCountry}
            </div>
            <button
              onClick={handleDismiss}
              className="p-1 rounded hover:bg-[#1A1A1A] text-[#606060] hover:text-[#9CA3AF] transition-all duration-200"
              aria-label="Close"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-2.5">
          {/* Location Row */}
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-3 h-3 text-[#606060] flex-shrink-0" viewBox="0 0 24 24" fill="none">
              <path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="text-[11px] font-medium text-[#808080]">
              Detected location: <span className="text-white">{countryName}</span>
            </span>
          </div>

          {/* Message */}
          <p className="text-[10px] text-[#606060] leading-relaxed mb-3">
            This service is not available in your region due to regulatory restrictions. 
            Access is only permitted from supported regions.
          </p>

          {/* Info Card */}
          <div className="bg-[#1A1A1A] rounded border border-[#222222] p-2 mb-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <div className="w-1 h-1 rounded-full bg-[#404040]" />
              <span className="text-[9px] text-[#606060] uppercase tracking-wide">To access this service</span>
            </div>
            <ul className="space-y-1">
              <li className="flex items-start gap-1.5">
                <span className="text-[#404040] text-[9px] mt-px">•</span>
                <span className="text-[9px] text-[#808080]">Connect VPN to a supported region</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-[#404040] text-[9px] mt-px">•</span>
                <span className="text-[9px] text-[#808080]">Clear browser cache and refresh</span>
              </li>
            </ul>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <a
              href="/support"
              className="flex-1 flex items-center justify-center gap-1.5 bg-[#1A1A1A] hover:bg-[#2A2A2A] border border-[#222222] hover:border-[#333333] rounded px-2.5 py-2 transition-all duration-200"
            >
              <svg className="w-3 h-3 text-[#808080]" viewBox="0 0 24 24" fill="none">
                <path d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="text-[10px] font-medium text-[#808080]">Support</span>
            </a>
            <a
              href="/terms"
              className="flex items-center justify-center bg-[#1A1A1A] hover:bg-[#2A2A2A] border border-[#222222] hover:border-[#333333] rounded px-2.5 py-2 transition-all duration-200"
            >
              <span className="text-[10px] font-medium text-[#606060]">Terms</span>
            </a>
            <a
              href="/privacy"
              className="flex items-center justify-center bg-[#1A1A1A] hover:bg-[#2A2A2A] border border-[#222222] hover:border-[#333333] rounded px-2.5 py-2 transition-all duration-200"
            >
              <span className="text-[10px] font-medium text-[#606060]">Privacy</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
