'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';

interface PositionClosedModalProps {
  isOpen: boolean;
  onClose: () => void;
  marketName?: string;
  marketSymbol?: string;
  marketIconUrl?: string;
  side?: 'LONG' | 'SHORT';
  closeSize?: string;
  entryPrice?: string;
  exitPrice?: string;
  realizedPnl?: number;
  realizedPnlPercent?: number;
  autoClose?: boolean;
  autoCloseDelay?: number;
}

interface FloatingParticle {
  id: number;
  x: number;
  y: number;
  size: number;
  delay: number;
  duration: number;
  direction: 'up' | 'down';
}

function generateParticles(count: number, isProfit: boolean): FloatingParticle[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: 10 + Math.random() * 80,
    y: isProfit ? 80 + Math.random() * 20 : Math.random() * 20,
    size: 2 + Math.random() * 3,
    delay: Math.random() * 2,
    duration: 2 + Math.random() * 1.5,
    direction: isProfit ? 'up' : 'down',
  }));
}

function FloatingParticles({ particles, isProfit }: { particles: FloatingParticle[]; isProfit: boolean }) {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map((particle) => (
        <motion.div
          key={particle.id}
          className={`absolute rounded-full ${isProfit ? 'bg-green-400' : 'bg-red-400'}`}
          style={{
            left: `${particle.x}%`,
            top: `${particle.y}%`,
            width: particle.size,
            height: particle.size,
            opacity: 0.6,
          }}
          initial={{ 
            opacity: 0, 
            y: 0,
            scale: 0 
          }}
          animate={{
            opacity: [0, 0.6, 0.6, 0],
            y: isProfit ? -100 : 100,
            scale: [0, 1, 1, 0],
          }}
          transition={{
            duration: particle.duration,
            delay: particle.delay,
            repeat: Infinity,
            repeatDelay: Math.random() * 1.5,
            ease: 'easeOut',
          }}
        />
      ))}
    </div>
  );
}

function PulseRing({ isProfit }: { isProfit: boolean }) {
  const ringColor = isProfit ? 'rgba(74, 222, 128, 0.3)' : 'rgba(248, 113, 113, 0.3)';
  
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            width: 120,
            height: 120,
            border: `1px solid ${ringColor}`,
          }}
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ 
            scale: [0.5, 2.5],
            opacity: [0.5, 0],
          }}
          transition={{
            duration: 2.5,
            delay: i * 0.8,
            repeat: Infinity,
            ease: 'easeOut',
          }}
        />
      ))}
    </div>
  );
}

const DEXETERA_PLACEHOLDER = '/Dexicon/LOGO-Dexetera-05.svg';

export default function PositionClosedModal({
  isOpen,
  onClose,
  marketName = 'Unknown Market',
  marketSymbol = 'UNKNOWN',
  marketIconUrl,
  side = 'LONG',
  closeSize = '0.00',
  entryPrice = '0.00',
  exitPrice = '0.00',
  realizedPnl = 0,
  realizedPnlPercent = 0,
  autoClose = false,
  autoCloseDelay = 8000,
}: PositionClosedModalProps) {
  const [particles, setParticles] = useState<FloatingParticle[]>([]);
  const [showContent, setShowContent] = useState(false);

  const isProfit = realizedPnl >= 0;
  const pnlColor = isProfit ? 'text-green-400' : 'text-red-400';
  const pnlBgColor = isProfit ? 'bg-green-400/10' : 'bg-red-400/10';
  const pnlBorderColor = isProfit ? 'border-green-400/20' : 'border-red-400/20';

  const isLong = side === 'LONG';
  const sideColor = isLong ? 'text-green-400' : 'text-red-400';

  useEffect(() => {
    if (isOpen) {
      setParticles(generateParticles(20, isProfit));
      const timer = setTimeout(() => setShowContent(true), 100);
      return () => clearTimeout(timer);
    } else {
      setShowContent(false);
      setParticles([]);
    }
  }, [isOpen, isProfit]);

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

  const formatPnl = (value: number) => {
    const prefix = value >= 0 ? '+' : '';
    return `${prefix}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatPnlPercent = (value: number) => {
    const prefix = value >= 0 ? '+' : '';
    return `${prefix}${value.toFixed(2)}%`;
  };

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
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          {/* Pulse rings behind modal */}
          <PulseRing isProfit={isProfit} />

          {/* Modal Card - Wide horizontal layout */}
          <motion.div
            className="group relative w-full max-w-2xl bg-[#0F0F0F] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 overflow-hidden"
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
          >
            {/* Floating particles effect */}
            <FloatingParticles particles={particles} isProfit={isProfit} />

            {/* Header gradient accent */}
            <div className={`absolute top-0 left-0 right-0 h-1 ${isProfit ? 'bg-gradient-to-r from-green-500 via-green-400 to-emerald-500' : 'bg-gradient-to-r from-red-500 via-red-400 to-rose-500'}`} />

            {/* Main content - horizontal layout */}
            <div className="p-8 flex gap-8">
              {/* Left side - Icon, title, actions */}
              <div className="flex flex-col items-center justify-between w-40 flex-shrink-0 py-2">
                <div className="flex flex-col items-center">
                  <motion.div
                    className="relative mb-4"
                    initial={{ scale: 0, rotate: -180 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ duration: 0.5, delay: 0.1, type: 'spring', damping: 12 }}
                  >
                    {/* Glow ring */}
                    <div className={`absolute -inset-2 rounded-full ${pnlBgColor} blur-xl opacity-60`} />
                    
                    {/* Icon container */}
                    <div className={`relative w-16 h-16 rounded-full border-2 ${pnlBorderColor} overflow-hidden bg-[#1A1A1A]`}>
                      <Image
                        src={marketIconUrl || DEXETERA_PLACEHOLDER}
                        alt={marketSymbol}
                        width={64}
                        height={64}
                        className={marketIconUrl ? 'w-full h-full object-cover' : 'w-full h-full object-contain p-2'}
                      />
                    </div>

                    {/* Checkmark badge */}
                    <motion.div
                      className={`absolute -bottom-1 -right-1 w-6 h-6 rounded-full ${pnlBgColor} border ${pnlBorderColor} flex items-center justify-center`}
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.4, type: 'spring', damping: 15 }}
                    >
                      <svg className={`w-3 h-3 ${pnlColor}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </motion.div>
                  </motion.div>

                  {/* Title */}
                  <motion.div
                    className="text-center"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                  >
                    <h2 className="text-sm font-semibold text-white uppercase tracking-wide mb-1">Position Closed</h2>
                    <p className="text-[10px] text-[#606060]">
                      {side} position settled
                    </p>
                  </motion.div>
                </div>

                {/* Actions at bottom of left column */}
                <motion.div
                  className="flex flex-col gap-2.5 w-full mt-6"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.35 }}
                >
                  <button
                    onClick={onClose}
                    className={`w-full py-2.5 px-3 ${pnlBgColor} hover:opacity-80 border ${pnlBorderColor} rounded-md text-[11px] font-medium ${pnlColor} transition-all duration-200`}
                  >
                    View History
                  </button>
                  <button
                    onClick={onClose}
                    className="w-full py-2.5 px-3 bg-[#1A1A1A] hover:bg-[#2A2A2A] border border-[#222222] hover:border-[#333333] rounded-md text-[11px] font-medium text-[#808080] transition-all duration-200"
                  >
                    Done
                  </button>
                </motion.div>
              </div>

              {/* Vertical divider */}
              <div className="w-px bg-[#222222] self-stretch" />

              {/* Right side - Position details */}
              <div className="flex-1 min-w-0 py-2">
                {/* Market header */}
                <motion.div
                  className="flex items-center justify-between mb-5"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">{marketName}</span>
                    <span className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                      {marketSymbol}
                    </span>
                  </div>
                  <div className={`text-[10px] font-semibold ${sideColor} ${isLong ? 'bg-green-400/10' : 'bg-red-400/10'} px-2 py-1 rounded`}>
                    {side} CLOSED
                  </div>
                </motion.div>

                {/* P&L Highlight */}
                <motion.div
                  className={`mb-5 p-4 rounded-md border ${pnlBorderColor} ${pnlBgColor}`}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.22 }}
                >
                  <div className="text-[9px] text-[#606060] uppercase tracking-wide mb-1">Realized P&L</div>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-xl font-semibold ${pnlColor} font-mono`}>
                      {formatPnl(realizedPnl)}
                    </span>
                    <span className={`text-[11px] ${pnlColor} font-mono`}>
                      ({formatPnlPercent(realizedPnlPercent)})
                    </span>
                  </div>
                </motion.div>

                {/* Stats grid - 4 columns */}
                <motion.div
                  className="grid grid-cols-4 gap-3 mb-5"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.25 }}
                >
                  <div className="bg-[#1A1A1A] rounded-md p-3 border border-[#222222] min-w-0">
                    <div className="text-[9px] text-[#606060] uppercase tracking-wide mb-1.5">Size</div>
                    <div className="text-[12px] font-medium text-white font-mono truncate">{closeSize}</div>
                  </div>
                  <div className="bg-[#1A1A1A] rounded-md p-3 border border-[#222222] min-w-0">
                    <div className="text-[9px] text-[#606060] uppercase tracking-wide mb-1.5">Entry</div>
                    <div className="text-[12px] font-medium text-white font-mono truncate">${entryPrice}</div>
                  </div>
                  <div className="bg-[#1A1A1A] rounded-md p-3 border border-[#222222] min-w-0">
                    <div className="text-[9px] text-[#606060] uppercase tracking-wide mb-1.5">Exit</div>
                    <div className="text-[12px] font-medium text-white font-mono truncate">${exitPrice}</div>
                  </div>
                  <div className="bg-[#1A1A1A] rounded-md p-3 border border-[#222222] min-w-0">
                    <div className="text-[9px] text-[#606060] uppercase tracking-wide mb-1.5">Payout</div>
                    <div className="text-[12px] font-medium text-white font-mono truncate">
                      ${(parseFloat(closeSize) * parseFloat(exitPrice)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </motion.div>

                {/* Hint text */}
                <motion.p
                  className="text-[9px] text-[#404040] mt-4"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}
                >
                  Your realized P&L has been added to your available balance.
                </motion.p>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(modalContent, document.body);
}
