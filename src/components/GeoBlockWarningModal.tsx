'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface GeoBlockWarningModalProps {
  country?: string;
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
  return null;
}

export default function GeoBlockWarningModal({ country }: GeoBlockWarningModalProps) {
  const [isBlocked, setIsBlocked] = useState(false);
  const [detectedCountry, setDetectedCountry] = useState<string>(country || '');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    
    const blocked = getCookie('geo-blocked') === 'true';
    const geoCountry = getCookie('geo-country') || country || '';
    
    setIsBlocked(blocked);
    setDetectedCountry(geoCountry);
  }, [country]);

  if (!mounted || !isBlocked) return null;

  const countryName = detectedCountry === 'US' ? 'United States' : detectedCountry;

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop - fully blocks interaction */}
      <div 
        className="absolute inset-0"
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.95)',
          backdropFilter: 'blur(8px)',
        }}
      />
      
      {/* Modal Card */}
      <div 
        className="relative w-full max-w-md text-center"
        style={{
          backgroundColor: '#0F0F0F',
          border: '1px solid #FF4444',
          borderRadius: '12px',
          padding: '40px 32px',
          boxShadow: '0 0 60px rgba(255, 68, 68, 0.15), 0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          animation: 'modalPopEnter 400ms cubic-bezier(0.16, 1, 0.3, 1) forwards'
        }}
      >
        {/* Warning Icon */}
        <div 
          className="w-16 h-16 mx-auto mb-6 flex items-center justify-center"
          style={{
            backgroundColor: 'rgba(255, 68, 68, 0.15)',
            borderRadius: '50%',
            border: '2px solid rgba(255, 68, 68, 0.3)'
          }}
        >
          <svg 
            className="w-8 h-8" 
            fill="none" 
            stroke="#FF4444" 
            viewBox="0 0 24 24"
            strokeWidth={2}
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" 
            />
          </svg>
        </div>
        
        {/* Title */}
        <h2 
          className="text-white font-semibold mb-3"
          style={{
            fontSize: '20px',
            lineHeight: '1.3',
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif",
          }}
        >
          Region Restricted
        </h2>
        
        {/* Location Badge */}
        <div 
          className="inline-flex items-center gap-2 mb-5 px-3 py-1.5 rounded-full"
          style={{
            backgroundColor: 'rgba(255, 68, 68, 0.1)',
            border: '1px solid rgba(255, 68, 68, 0.2)',
          }}
        >
          <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-red-400 text-sm font-medium">
            Detected: {countryName}
          </span>
        </div>
        
        {/* Main Message */}
        <p 
          className="text-[#999999] mb-6"
          style={{
            fontSize: '14px',
            lineHeight: '1.6',
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif",
          }}
        >
          This service is not available to users in the {countryName} due to regulatory restrictions. 
          Access is only permitted from supported regions.
        </p>
        
        {/* Divider */}
        <div 
          className="w-full h-px mb-6"
          style={{ backgroundColor: 'rgba(255, 255, 255, 0.1)' }}
        />
        
        {/* Info Section */}
        <div 
          className="text-left p-4 rounded-lg mb-6"
          style={{
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
          }}
        >
          <p 
            className="text-[#666666] text-xs mb-2"
            style={{ fontFamily: "'Inter', sans-serif" }}
          >
            If you believe this is an error:
          </p>
          <ul className="text-[#888888] text-xs space-y-1" style={{ fontFamily: "'Inter', sans-serif" }}>
            <li className="flex items-start gap-2">
              <span className="text-[#444444] mt-0.5">•</span>
              <span>Check that your VPN is connected to a supported region</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#444444] mt-0.5">•</span>
              <span>Clear your browser cache and cookies</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#444444] mt-0.5">•</span>
              <span>Contact support if the issue persists</span>
            </li>
          </ul>
        </div>
        
        {/* Support Link */}
        <a
          href="/support"
          className="inline-flex items-center gap-2 transition-all duration-200 ease-in-out"
          style={{
            backgroundColor: '#1A1A1A',
            color: '#FFFFFF',
            padding: '12px 24px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: '500',
            textDecoration: 'none',
            border: '1px solid #333333',
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif"
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#252525';
            e.currentTarget.style.borderColor = '#444444';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = '#1A1A1A';
            e.currentTarget.style.borderColor = '#333333';
          }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Contact Support
        </a>
        
        {/* Legal Links */}
        <div className="mt-6 flex items-center justify-center gap-4">
          <a 
            href="/terms" 
            className="text-[#555555] hover:text-[#888888] text-xs transition-colors"
            style={{ fontFamily: "'Inter', sans-serif" }}
          >
            Terms of Service
          </a>
          <span className="text-[#333333]">|</span>
          <a 
            href="/privacy" 
            className="text-[#555555] hover:text-[#888888] text-xs transition-colors"
            style={{ fontFamily: "'Inter', sans-serif" }}
          >
            Privacy Policy
          </a>
        </div>
      </div>
      
      {/* Animation Styles */}
      <style jsx>{`
        @keyframes modalPopEnter {
          0% {
            opacity: 0;
            transform: scale(0.9) translateY(-10px);
          }
          100% {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
    </div>
  );

  return createPortal(modalContent, document.body);
}
