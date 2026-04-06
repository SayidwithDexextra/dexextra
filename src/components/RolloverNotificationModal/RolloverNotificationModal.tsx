'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';

interface RolloverNotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  childSymbol: string;
  parentSymbol: string;
  parentMarketId?: string;
}

export default function RolloverNotificationModal({
  isOpen,
  onClose,
  childSymbol,
  parentSymbol,
  parentMarketId,
}: RolloverNotificationModalProps) {
  const router = useRouter();
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      onClose();
      setIsExiting(false);
    }, 300);
  };

  const handleGoToParent = () => {
    setIsExiting(true);
    setTimeout(() => {
      onClose();
      setIsExiting(false);
      router.push(`/token/${encodeURIComponent(parentSymbol)}`);
    }, 300);
  };

  const handleStayHere = () => {
    handleClose();
  };

  if (!isOpen) return null;

  const modalContent = (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
        style={{
          animation: isExiting
            ? 'backdropExit 300ms ease-out forwards'
            : 'backdropEnter 200ms ease-out forwards',
        }}
      />

      {/* Modal Card */}
      <div
        className="relative w-full max-w-md text-center bg-[#0F0F0F]"
        style={{
          border: '1px solid #333333',
          borderRadius: '12px',
          padding: '32px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          animation: isExiting
            ? 'modalExit 300ms cubic-bezier(0.4, 0, 0.6, 1) forwards'
            : 'modalPopEnter 400ms cubic-bezier(0.16, 1, 0.3, 1) forwards',
        }}
      >
        {/* Icon */}
        <div
          className="w-14 h-14 mx-auto mb-5 flex items-center justify-center"
          style={{
            backgroundColor: 'rgba(59, 130, 246, 0.15)',
            borderRadius: '50%',
          }}
        >
          <svg
            className="w-7 h-7 text-blue-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </div>

        {/* Title */}
        <h2
          className="text-white font-semibold mb-3"
          style={{
            fontSize: '18px',
            lineHeight: '1.3',
            fontFamily:
              "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif",
          }}
        >
          Market Rollover Complete
        </h2>

        {/* Message */}
        <p
          className="text-[#999999] mb-2"
          style={{
            fontSize: '14px',
            lineHeight: '1.6',
            fontFamily:
              "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif",
          }}
        >
          This page now shows the new contract:
        </p>

        <div
          className="mb-4 py-3 px-4 rounded-lg"
          style={{
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            border: '1px solid rgba(59, 130, 246, 0.2)',
          }}
        >
          <span
            className="text-blue-400 font-medium"
            style={{ fontSize: '16px' }}
          >
            {childSymbol}
          </span>
        </div>

        <p
          className="text-[#808080] mb-6"
          style={{
            fontSize: '13px',
            lineHeight: '1.5',
            fontFamily:
              "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif",
          }}
        >
          The previous contract has been renamed to{' '}
          <span className="text-[#CCCCCC] font-medium">{parentSymbol}</span> and
          will continue trading until settlement.
        </p>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleStayHere}
            className="flex-1 transition-all duration-200 ease-in-out border cursor-pointer"
            style={{
              backgroundColor: 'transparent',
              borderColor: '#444444',
              color: '#CCCCCC',
              padding: '12px 20px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: '500',
              fontFamily:
                "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#1A1A1A';
              e.currentTarget.style.borderColor = '#555555';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.borderColor = '#444444';
            }}
          >
            Stay on {childSymbol}
          </button>

          <button
            onClick={handleGoToParent}
            className="flex-1 transition-all duration-200 ease-in-out border-none cursor-pointer"
            style={{
              backgroundColor: '#3B82F6',
              color: '#FFFFFF',
              padding: '12px 20px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: '500',
              fontFamily:
                "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#2563EB';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#3B82F6';
            }}
          >
            Go to {parentSymbol}
          </button>
        </div>
      </div>

      {/* Styles for animations */}
      <style jsx>{`
        @keyframes modalPopEnter {
          0% {
            opacity: 0;
            transform: scale(0.9) translateY(-10px);
          }
          50% {
            opacity: 1;
            transform: scale(1.02) translateY(0);
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
            transform: scale(0.9) translateY(-10px);
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

  return createPortal(modalContent, document.body);
}
