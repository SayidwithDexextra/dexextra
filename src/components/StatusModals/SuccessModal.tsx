'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface SuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  message: string;
  buttonText?: string;
  autoClose?: boolean;
  autoCloseDelay?: number;
}

export default function SuccessModal({ 
  isOpen, 
  onClose, 
  title = "Trade Success", 
  message = "Action completed successfully.", 
  buttonText = "Get Started",
  autoClose = true, 
  autoCloseDelay = 2000 
}: SuccessModalProps) {
  const [isExiting, setIsExiting] = useState(false);

  // Auto-close functionality
  useEffect(() => {
    if (isOpen && autoClose) {
      const timer = setTimeout(() => {
        setIsExiting(true);
        // Wait for exit animation to complete before closing
        setTimeout(() => {
          onClose();
          setIsExiting(false);
        }, 300); // Match the exit animation duration
      }, autoCloseDelay);
      
      return () => clearTimeout(timer);
    }
  }, [isOpen, autoClose, autoCloseDelay, onClose]);

  // Close on Escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const modalContent = (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0"
        onClick={onClose}
        style={{
          backgroundColor: 'transparent',
          animation: isExiting 
            ? 'backdropExit 300ms ease-out forwards' 
            : 'backdropEnter 200ms ease-out forwards'
        }}
      />
      
      {/* Modal Card */}
      <div 
        className="relative w-full max-w-sm min-h-[200px] text-center"
        style={{
          background: 'linear-gradient(135deg, #4ADE80 0%, #22C55E 100%)',
          borderRadius: '24px',
          padding: '32px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          animation: isExiting 
            ? 'modalExit 300ms cubic-bezier(0.4, 0, 0.6, 1) forwards' 
            : 'modalPopEnter 400ms cubic-bezier(0.16, 1, 0.3, 1) forwards'
        }}
      >
        {/* Icon */}
        <div 
          className="w-12 h-12 mx-auto mb-4 flex items-center justify-center"
          style={{
            backgroundColor: 'rgba(31, 41, 55, 0.1)',
            borderRadius: '50%'
          }}
        >
          <svg 
            className="w-6 h-6 text-gray-800" 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={3} 
              d="M5 13l4 4L19 7" 
            />
          </svg>
        </div>
        
        {/* Title */}
        <h2 
          className="text-gray-800 font-bold mb-4"
          style={{
            fontSize: '20px',
            lineHeight: '1.25',
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif",
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {title.length > 25 ? `${title.substring(0, 25)}...` : title}
        </h2>
        
        {/* Message */}
        <p 
          className="text-gray-700 mb-6"
          style={{
            fontSize: '14px',
            lineHeight: '1.5',
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif",
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical' as any,
            maxHeight: '42px' // 2 lines * 21px line height
          }}
        >
          {message.length > 80 ? `${message.substring(0, 80)}...` : message}
        </p>
        
        {/* Button */}
        <button
          onClick={onClose}
          className="transition-all duration-200 ease-in-out border-none cursor-pointer"
          style={{
            backgroundColor: '#22C55E',
            color: '#FFFFFF',
            padding: '12px 24px',
            borderRadius: '16px',
            fontSize: '14px',
            fontWeight: '600',
            minWidth: '100px',
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif"
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#16A34A';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = '#22C55E';
          }}
        >
          {buttonText}
        </button>
      </div>
      
      {/* Styles for animations */}
      <style jsx>{`
        @keyframes modalPopEnter {
          0% {
            opacity: 0;
            transform: scale(0.8) translateY(-20px);
          }
          50% {
            opacity: 1;
            transform: scale(1.05) translateY(0);
          }
          100% {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
        
        @keyframes modalExit {
          0% {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
          100% {
            opacity: 0;
            transform: scale(0.8) translateY(-20px);
          }
        }
        
        @keyframes backdropEnter {
          0% {
            opacity: 0;
          }
          100% {
            opacity: 1;
          }
        }
        
        @keyframes backdropExit {
          0% {
            opacity: 1;
          }
          100% {
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );

  // Render in portal to ensure it appears above everything else
  return createPortal(modalContent, document.body);
} 