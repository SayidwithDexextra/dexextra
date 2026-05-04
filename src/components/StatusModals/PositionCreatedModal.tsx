'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import { formatCompactSize } from '@/lib/formatters';

interface PositionCreatedModalProps {
  isOpen: boolean;
  onClose: () => void;
  marketName?: string;
  marketSymbol?: string;
  marketIconUrl?: string;
  side?: 'LONG' | 'SHORT';
  size?: string;
  entryPrice?: string;
  leverage?: number;
  orderType?: 'MARKET' | 'LIMIT';
  notionalValue?: string;
  autoClose?: boolean;
  autoCloseDelay?: number;
}

interface Sparkle {
  id: number;
  x: number;
  y: number;
  size: number;
  delay: number;
  duration: number;
}

function generateSparkles(count: number): Sparkle[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: 20 + Math.random() * 60,
    y: 10 + Math.random() * 80,
    size: 3 + Math.random() * 4,
    delay: Math.random() * 2,
    duration: 1.5 + Math.random() * 1,
  }));
}

function SparkleEffect({ sparkles }: { sparkles: Sparkle[] }) {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {sparkles.map((sparkle) => (
        <motion.div
          key={sparkle.id}
          className="absolute"
          style={{
            left: `${sparkle.x}%`,
            top: `${sparkle.y}%`,
            width: sparkle.size,
            height: sparkle.size,
          }}
          initial={{ opacity: 0, scale: 0 }}
          animate={{
            opacity: [0, 1, 1, 0],
            scale: [0, 1, 1, 0],
            rotate: [0, 180],
          }}
          transition={{
            duration: sparkle.duration,
            delay: sparkle.delay,
            repeat: Infinity,
            repeatDelay: Math.random() * 2,
            ease: 'easeInOut',
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
            <path
              d="M12 0L14.59 9.41L24 12L14.59 14.59L12 24L9.41 14.59L0 12L9.41 9.41L12 0Z"
              fill="url(#sparkleGradient)"
            />
            <defs>
              <linearGradient id="sparkleGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#2AC4FC" />
                <stop offset="100%" stopColor="#B504FD" />
              </linearGradient>
            </defs>
          </svg>
        </motion.div>
      ))}
    </div>
  );
}

function RadialRays() {
  const rayCount = 12;
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
      <motion.div
        className="relative w-[400px] h-[400px]"
        initial={{ opacity: 0, rotate: 0 }}
        animate={{ opacity: 1, rotate: 360 }}
        transition={{ 
          opacity: { duration: 0.5 },
          rotate: { duration: 60, repeat: Infinity, ease: 'linear' }
        }}
      >
        {Array.from({ length: rayCount }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute left-1/2 top-1/2 origin-bottom"
            style={{
              width: 2,
              height: 180,
              marginLeft: -1,
              marginTop: -180,
              transform: `rotate(${(360 / rayCount) * i}deg)`,
              background: `linear-gradient(to top, transparent, rgba(42, 196, 252, ${0.03 + (i % 3) * 0.02}))`,
            }}
            initial={{ scaleY: 0, opacity: 0 }}
            animate={{ scaleY: 1, opacity: 1 }}
            transition={{ duration: 0.8, delay: i * 0.03 }}
          />
        ))}
      </motion.div>
    </div>
  );
}

const DEXETERA_PLACEHOLDER = '/Dexicon/LOGO-Dexetera-05.svg';

export default function PositionCreatedModal({
  isOpen,
  onClose,
  marketName = 'Unknown Market',
  marketSymbol = 'UNKNOWN',
  marketIconUrl,
  side = 'LONG',
  size = '0.00',
  entryPrice = '0.00',
  leverage = 1,
  orderType = 'MARKET',
  notionalValue = '0.00',
  autoClose = false,
  autoCloseDelay = 8000,
}: PositionCreatedModalProps) {
  const [sparkles, setSparkles] = useState<Sparkle[]>([]);
  const [showContent, setShowContent] = useState(false);

  const isLong = side === 'LONG';
  const sideColor = isLong ? 'text-green-400' : 'text-red-400';
  const sideBgColor = isLong ? 'bg-green-400/10' : 'bg-red-400/10';
  const sideBorderColor = isLong ? 'border-green-400/20' : 'border-red-400/20';

  useEffect(() => {
    if (isOpen) {
      setSparkles(generateSparkles(15));
      const timer = setTimeout(() => setShowContent(true), 100);
      return () => clearTimeout(timer);
    } else {
      setShowContent(false);
      setSparkles([]);
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
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          {/* Radial rays behind modal */}
          <RadialRays />

          {/* Modal Card - Wide horizontal layout */}
          <motion.div
            className="group relative w-full max-w-2xl bg-[#0F0F0F] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 overflow-hidden"
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
          >
            {/* Sparkle effect */}
            <SparkleEffect sparkles={sparkles} />

            {/* Header gradient accent */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#2AC4FC] via-[#5B25D9] to-[#B504FD]" />

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
                    <div className={`absolute -inset-2 rounded-full ${sideBgColor} blur-xl opacity-60`} />
                    
                    {/* Icon container */}
                    <div className={`relative w-16 h-16 rounded-full border-2 ${sideBorderColor} overflow-hidden bg-[#1A1A1A]`}>
                      <Image
                        src={marketIconUrl || DEXETERA_PLACEHOLDER}
                        alt={marketSymbol}
                        width={64}
                        height={64}
                        className={marketIconUrl ? 'w-full h-full object-cover' : 'w-full h-full object-contain p-2'}
                      />
                    </div>

                    {/* Side badge */}
                    <motion.div
                      className={`absolute -bottom-1 -right-1 px-1.5 py-0.5 rounded-full ${sideBgColor} border ${sideBorderColor}`}
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.4, type: 'spring', damping: 15 }}
                    >
                      <span className={`text-[9px] font-semibold ${sideColor}`}>{side}</span>
                    </motion.div>
                  </motion.div>

                  {/* Title */}
                  <motion.div
                    className="text-center"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                  >
                    <h2 className="text-sm font-semibold text-white uppercase tracking-wide mb-1">Position Opened</h2>
                    <p className="text-[10px] text-[#606060]">
                      {orderType} order filled
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
                    className={`w-full py-2.5 px-3 ${sideBgColor} hover:opacity-80 border ${sideBorderColor} rounded-md text-[11px] font-medium ${sideColor} transition-all duration-200`}
                  >
                    View Position
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
                  <div className={`text-[10px] font-semibold ${sideColor} ${sideBgColor} px-2 py-1 rounded`}>
                    {leverage}x {side}
                  </div>
                </motion.div>

                {/* Stats grid - 3 columns: Size, Notional, Leverage */}
                <motion.div
                  className="grid grid-cols-3 gap-3 mb-5"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.25 }}
                >
                  <div className="bg-[#1A1A1A] rounded-md p-3 border border-[#222222] min-w-0">
                    <div className="text-[9px] text-[#606060] uppercase tracking-wide mb-1.5">Size</div>
                    <div className="text-[12px] font-medium text-white font-mono whitespace-nowrap">{formatCompactSize(size)}</div>
                  </div>
                  <div className="bg-[#1A1A1A] rounded-md p-3 border border-[#222222] min-w-0">
                    <div className="text-[9px] text-[#606060] uppercase tracking-wide mb-1.5">Notional</div>
                    <div className="text-[12px] font-medium text-white font-mono truncate">${notionalValue}</div>
                  </div>
                  <div className="bg-[#1A1A1A] rounded-md p-3 border border-[#222222] min-w-0">
                    <div className="text-[9px] text-[#606060] uppercase tracking-wide mb-1.5">Leverage</div>
                    <div className="text-[12px] font-medium text-white font-mono">{leverage}x</div>
                  </div>
                </motion.div>

                {/* Bottom row details */}
                <motion.div
                  className="flex gap-3"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 }}
                >
                  <div className="flex-1 flex items-center justify-between p-2.5 bg-[#0F0F0F] rounded-md border border-[#1A1A1A]">
                    <span className="text-[10px] text-[#606060]">Order Type</span>
                    <span className="text-[11px] text-[#9CA3AF]">{orderType}</span>
                  </div>
                  <div className="flex-1 flex items-center justify-between p-2.5 bg-[#0F0F0F] rounded-md border border-[#1A1A1A]">
                    <span className="text-[10px] text-[#606060]">Unrealized P&L</span>
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                      <span className="text-[11px] text-[#808080] font-mono">$0.00</span>
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
                  Monitor your position in the Portfolio sidebar or on the market page.
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
