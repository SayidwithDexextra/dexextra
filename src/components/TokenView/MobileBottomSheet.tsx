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
  const contentRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef(0);
  const currentOffsetRef = useRef(0);
  const isDraggingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

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
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen]);

  const applyTransform = useCallback((offset: number) => {
    if (sheetRef.current && offset > 0) {
      currentOffsetRef.current = offset;
      sheetRef.current.style.transform = `translateY(${offset}px)`;
      sheetRef.current.style.transition = 'none';
    }
  }, []);

  const finishDrag = useCallback(() => {
    isDraggingRef.current = false;
    if (sheetRef.current) {
      sheetRef.current.style.transition = '';
      if (currentOffsetRef.current > 80) {
        onCloseRef.current();
      }
      sheetRef.current.style.transform = '';
      currentOffsetRef.current = 0;
    }
  }, []);

  // --- Header drag (grab handle + title bar) ---
  const handleHeaderTouchStart = useCallback((e: React.TouchEvent) => {
    startYRef.current = e.touches[0].clientY;
    currentOffsetRef.current = 0;
    isDraggingRef.current = true;
  }, []);

  const handleHeaderTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDraggingRef.current) return;
    const diff = e.touches[0].clientY - startYRef.current;
    if (diff > 0) applyTransform(diff);
  }, [applyTransform]);

  const handleHeaderTouchEnd = useCallback(() => {
    finishDrag();
  }, [finishDrag]);

  // --- Content pull-to-close (native listeners for passive:false) ---
  useEffect(() => {
    const content = contentRef.current;
    if (!content || !isOpen) return;

    let contentStartY = 0;
    let pulling = false;

    const onTouchStart = (e: TouchEvent) => {
      contentStartY = e.touches[0].clientY;
      pulling = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      const diff = e.touches[0].clientY - contentStartY;
      const scrollTop = content.scrollTop;

      if (!pulling && scrollTop <= 0 && diff > 8) {
        pulling = true;
        isDraggingRef.current = true;
        startYRef.current = e.touches[0].clientY;
      }

      if (pulling) {
        e.preventDefault();
        const offset = e.touches[0].clientY - startYRef.current;
        if (offset > 0) applyTransform(offset);
      }
    };

    const onTouchEnd = () => {
      if (pulling) {
        finishDrag();
        pulling = false;
      }
    };

    content.addEventListener('touchstart', onTouchStart, { passive: true });
    content.addEventListener('touchmove', onTouchMove, { passive: false });
    content.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      content.removeEventListener('touchstart', onTouchStart);
      content.removeEventListener('touchmove', onTouchMove);
      content.removeEventListener('touchend', onTouchEnd);
    };
  }, [isOpen, applyTransform, finishDrag]);

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
        className={`fixed bottom-0 left-0 right-0 z-[61] ${heightClass} bg-t-page rounded-t-xl border-t border-t-stroke flex flex-col transition-transform duration-300 ease-out ${
          isOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        {/* Draggable header: grab handle + title */}
        <div
          onTouchStart={handleHeaderTouchStart}
          onTouchMove={handleHeaderTouchMove}
          onTouchEnd={handleHeaderTouchEnd}
          className="flex-shrink-0 cursor-grab active:cursor-grabbing"
        >
          <div className="flex justify-center pt-2.5 pb-1">
            <div className="w-8 h-1 rounded-full bg-t-dot" />
          </div>
          {title && (
            <div className="flex items-center justify-between px-4 pb-2.5 border-b border-t-stroke-sub">
              <h3 className="text-xs font-medium text-t-fg-label uppercase tracking-wide">{title}</h3>
              <button
                onClick={onClose}
                className="w-6 h-6 flex items-center justify-center rounded-full text-t-fg-muted hover:text-t-fg hover:bg-t-stroke transition-colors"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* Scrollable content with pull-to-close */}
        <div
          ref={contentRef}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
        >
          {children}
        </div>
      </div>
    </>,
    document.body
  );
}
