'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

interface WithdrawalSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  amount?: string;
  currency?: string;
  txHash?: string;
  autoClose?: boolean;
  autoCloseDelay?: number;
}

interface ConfettiPiece {
  id: number;
  x: number;
  delay: number;
  duration: number;
  color: string;
  rotation: number;
  size: number;
}

const CONFETTI_COLORS = [
  '#2AC4FC',
  '#5B25D9',
  '#B504FD',
  '#10B981',
  '#6366F1',
];

function generateConfetti(count: number): ConfettiPiece[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    delay: Math.random() * 0.3,
    duration: 2.5 + Math.random() * 1.5,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    rotation: Math.random() * 360,
    size: 4 + Math.random() * 6,
  }));
}

function DexeteraLogo({ className }: { className?: string }) {
  return (
    <svg 
      viewBox="0 0 1340 1340" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <rect width="1340" height="1340" rx="670" fill="#0F0F0F"/>
      <path 
        d="M670 220C789.347 220 903.807 267.41 988.198 351.802C1072.59 436.193 1120 550.653 1120 670C1120 789.347 1072.59 903.807 988.198 988.198C903.807 1072.59 789.347 1120 670 1120V1119.99C669.667 1120 669.334 1120 669 1120C635.863 1120 609 1093.14 609 1060V865C609 831.863 635.863 805 669 805C702.137 805 729 831.863 729 865V994.684C794.597 982.763 855.548 951.144 903.346 903.346C965.233 841.459 1000 757.522 1000 670C1000 582.478 965.233 498.541 903.346 436.654C855.791 389.099 795.216 357.559 730 345.5V475C730 508.137 703.137 535 670 535C636.863 535 610 508.137 610 475V280C610 246.863 636.863 220 670 220ZM280 610C313.137 610 340 636.863 340 670C340 703.137 313.137 730 280 730C246.863 730 220 703.137 220 670C220 636.863 246.863 610 280 610ZM475 610C508.137 610 535 636.863 535 670C535 703.137 508.137 730 475 730C441.863 730 415 703.137 415 670C415 636.863 441.863 610 475 610ZM670 610C703.137 610 730 636.863 730 670C730 703.137 703.137 730 670 730C636.863 730 610 703.137 610 670C610 636.863 636.863 610 670 610Z" 
        fill="url(#paint0_radial_dex)"
      />
      <defs>
        <radialGradient 
          id="paint0_radial_dex" 
          cx="0" cy="0" r="1" 
          gradientUnits="userSpaceOnUse" 
          gradientTransform="translate(1053.47 415.492) rotate(139.793) scale(1091.33 973.456)"
        >
          <stop offset="0.225962" stopColor="#2AC4FC"/>
          <stop offset="0.720121" stopColor="#5B25D9"/>
          <stop offset="0.836538" stopColor="#2D0199"/>
          <stop offset="0.923077" stopColor="#B504FD"/>
        </radialGradient>
      </defs>
    </svg>
  );
}

function Confetti({ pieces }: { pieces: ConfettiPiece[] }) {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {pieces.map((piece) => (
        <motion.div
          key={piece.id}
          className="absolute"
          style={{
            left: `${piece.x}%`,
            top: -20,
            width: piece.size,
            height: piece.size * 0.6,
            backgroundColor: piece.color,
            borderRadius: 1,
          }}
          initial={{ 
            y: -20, 
            rotate: piece.rotation,
            opacity: 0.9,
          }}
          animate={{ 
            y: '120vh',
            rotate: piece.rotation + 540,
            opacity: [0.9, 0.9, 0.6, 0],
          }}
          transition={{
            duration: piece.duration,
            delay: piece.delay,
            ease: [0.25, 0.46, 0.45, 0.94],
          }}
        />
      ))}
    </div>
  );
}

export default function WithdrawalSuccessModal({ 
  isOpen, 
  onClose, 
  amount = '0.00',
  currency = 'USDC',
  txHash,
  autoClose = false, 
  autoCloseDelay = 5000 
}: WithdrawalSuccessModalProps) {
  const [confettiPieces, setConfettiPieces] = useState<ConfettiPiece[]>([]);
  const [showCheckmark, setShowCheckmark] = useState(false);

  const truncateTxHash = useCallback((hash: string) => {
    if (!hash) return '';
    return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
  }, []);

  useEffect(() => {
    if (isOpen) {
      setConfettiPieces(generateConfetti(40));
      const timer = setTimeout(() => setShowCheckmark(true), 150);
      return () => clearTimeout(timer);
    } else {
      setShowCheckmark(false);
      setConfettiPieces([]);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && autoClose) {
      const timer = setTimeout(onClose, autoCloseDelay);
      return () => clearTimeout(timer);
    }
  }, [isOpen, autoClose, autoCloseDelay, onClose]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const modalContent = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[99999] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Backdrop - subtle fade to emphasize modal */}
          <motion.div 
            className="absolute inset-0 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          
          {/* Confetti Layer */}
          <Confetti pieces={confettiPieces} />
          
          {/* Modal Card - following design system container pattern */}
          <motion.div 
            className="group relative w-full max-w-xs bg-[#0F0F0F] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200"
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          >
            {/* Main content area */}
            <div className="p-6">
              {/* Logo + checkmark section */}
              <div className="flex flex-col items-center mb-4">
                <motion.div 
                  className="relative mb-4"
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.2, delay: 0.05 }}
                >
                  {/* Logo container */}
                  <div className="w-16 h-16 rounded-full border border-[#222222] overflow-hidden">
                    <DexeteraLogo className="w-full h-full" />
                  </div>
                  
                  {/* Success checkmark badge */}
                  <AnimatePresence>
                    {showCheckmark && (
                      <motion.div
                        className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-green-400 flex items-center justify-center"
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                      >
                        <svg 
                          className="w-3 h-3 text-[#0F0F0F]" 
                          fill="none" 
                          viewBox="0 0 24 24" 
                          stroke="currentColor"
                          strokeWidth={3}
                        >
                          <path 
                            strokeLinecap="round" 
                            strokeLinejoin="round" 
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
                
                {/* Title - following typography system */}
                <motion.h2 
                  className="text-xs font-medium text-white uppercase tracking-wide mb-1"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: 0.1 }}
                >
                  Withdrawal Successful
                </motion.h2>
                
                {/* Subtitle */}
                <motion.p 
                  className="text-[10px] text-[#606060]"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: 0.12 }}
                >
                  Your funds are on their way
                </motion.p>
              </div>
              
              {/* Amount display - using secondary container pattern */}
              <motion.div 
                className="bg-[#1A1A1A] rounded-md p-3 mb-3"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: 0.15 }}
              >
                <div className="text-[9px] text-[#606060] uppercase tracking-wide mb-1 text-center">
                  Amount Withdrawn
                </div>
                <div className="flex items-baseline justify-center gap-1.5">
                  <span className="text-lg font-medium text-white font-mono">
                    {amount}
                  </span>
                  <span className="text-[11px] text-[#9CA3AF]">
                    {currency}
                  </span>
                </div>
              </motion.div>
              
              {/* Transaction details - using data display pattern */}
              {txHash && (
                <motion.div 
                  className="space-y-1.5 mb-4"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: 0.18 }}
                >
                  {/* Transaction row */}
                  <div className="flex items-center justify-between p-2 bg-[#0F0F0F] rounded border border-[#1A1A1A]">
                    <span className="text-[10px] text-[#606060]">Transaction</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-white font-mono">
                        {truncateTxHash(txHash)}
                      </span>
                      <button
                        onClick={() => navigator.clipboard.writeText(txHash)}
                        className="p-1 hover:bg-[#1A1A1A] rounded transition-all duration-200"
                        title="Copy transaction hash"
                      >
                        <svg className="w-3 h-3 text-[#404040] hover:text-[#808080] transition-colors duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  
                  {/* Status row */}
                  <div className="flex items-center justify-between p-2 bg-[#0F0F0F] rounded border border-[#1A1A1A]">
                    <span className="text-[10px] text-[#606060]">Status</span>
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400" />
                      <span className="text-[10px] text-green-400">Confirmed</span>
                    </div>
                  </div>
                </motion.div>
              )}
              
              {/* Action button - following button pattern */}
              <motion.button
                onClick={onClose}
                className="w-full py-2.5 px-4 bg-[#1A1A1A] hover:bg-[#2A2A2A] border border-[#222222] hover:border-[#333333] rounded-md text-[11px] font-medium text-white transition-all duration-200"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: 0.22 }}
              >
                Done
              </motion.button>
            </div>
            
            {/* Expandable details on hover - following design system pattern */}
            <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-16 overflow-hidden transition-all duration-200">
              <div className="px-6 pb-4 border-t border-[#1A1A1A]">
                <div className="text-[9px] pt-2">
                  <span className="text-[#606060]">Funds typically arrive within 1-5 minutes depending on network conditions.</span>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(modalContent, document.body);
}
