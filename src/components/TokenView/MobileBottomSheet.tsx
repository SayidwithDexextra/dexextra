'use client';

import React, { useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';

interface MobileBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  height?: 'full' | 'tall' | 'half';
}

export default function MobileBottomSheet({
  isOpen,
  onClose,
  title,
  children,
  height = 'full',
}: MobileBottomSheetProps) {
  const [mounted, setMounted] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef(0);
  const isDraggingRef = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startYRef.current = e.touches[0].clientY;
    isDraggingRef.current = true;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDraggingRef.current) return;
    const diff = e.touches[0].clientY - startYRef.current;
    if (diff > 0 && sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${diff}px)`;
      sheetRef.current.style.transition = 'none';
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    if (sheetRef.current) {
      sheetRef.current.style.transition = '';
      const raw = sheetRef.current.style.transform;
      const match = raw.match(/translateY\((\d+)px\)/);
      const yOffset = match ? parseInt(match[1], 10) : 0;
      if (yOffset > 80) {
        onClose();
      }
      sheetRef.current.style.transform = '';
    }
  }, [onClose]);

  if (!mounted) return null;

  const heightClass =
    height === 'full' ? 'h-[94svh]' :
    height === 'tall' ? 'h-[78svh]' :
    'h-[55svh]';

  return createPortal(
    <>
      <div
        className={`fixed inset-0 z-[60] bg-black/60 backdrop-blur-[2px] transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />
      <div
        ref={sheetRef}
        className={`fixed bottom-0 left-0 right-0 z-[61] ${heightClass} bg-[#0A0A0A] rounded-t-xl border-t border-[#222222] flex flex-col transition-transform duration-300 ease-out ${
          isOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div
          className="flex-shrink-0 flex justify-center pt-2.5 pb-1 cursor-grab active:cursor-grabbing"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="w-8 h-1 rounded-full bg-[#444444]" />
        </div>
        {title && (
          <div className="flex-shrink-0 flex items-center justify-between px-4 pb-2.5 border-b border-[#1a1a1a]">
            <h3 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">{title}</h3>
            <button
              onClick={onClose}
              className="w-6 h-6 flex items-center justify-center rounded-full text-[#606060] hover:text-white hover:bg-[#222222] transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </div>
    </>,
    document.body
  );
}
