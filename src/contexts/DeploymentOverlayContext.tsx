'use client';

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { ProgressOverlay } from '@/components/create-market/ProgressOverlay';

type DeploymentOverlayState = {
  isVisible: boolean;
  isFadingOut: boolean;
  splashVisible: boolean;
  title: string;
  subtitle: string;
  messages: string[];
  activeIndex: number;
  percentComplete: number;
};

type OpenOptions = {
  title?: string;
  subtitle?: string;
  messages: string[];
  splashMs?: number;
};

type UpdateOptions = Partial<Pick<DeploymentOverlayState, 'activeIndex' | 'percentComplete' | 'title' | 'subtitle' | 'messages'>>;

type DeploymentOverlayContextValue = {
  open: (opts: OpenOptions) => void;
  update: (opts: UpdateOptions) => void;
  fadeOutAndClose: (delayMs?: number) => void;
  close: () => void;
};

const DeploymentOverlayContext = createContext<DeploymentOverlayContextValue | null>(null);

export function DeploymentOverlayProvider({ children }: { children: React.ReactNode }) {
  const splashTimerRef = useRef<number | null>(null);
  const [overlay, setOverlay] = useState<DeploymentOverlayState>({
    isVisible: false,
    isFadingOut: false,
    splashVisible: false,
    title: 'Deployment Pipeline',
    subtitle: 'Initializing market and registering oracle',
    messages: [],
    activeIndex: 0,
    percentComplete: 0,
  });

  const open = useCallback((opts: OpenOptions) => {
    if (splashTimerRef.current) {
      window.clearTimeout(splashTimerRef.current);
      splashTimerRef.current = null;
    }
    setOverlay({
      isVisible: true,
      isFadingOut: false,
      splashVisible: Boolean(opts.splashMs && opts.splashMs > 0),
      title: opts.title || 'Deployment Pipeline',
      subtitle: opts.subtitle || 'Initializing market and registering oracle',
      messages: opts.messages,
      activeIndex: 0,
      percentComplete: 0,
    });
    if (opts.splashMs && opts.splashMs > 0) {
      splashTimerRef.current = window.setTimeout(() => {
        setOverlay(prev => ({ ...prev, splashVisible: false }));
        splashTimerRef.current = null;
      }, opts.splashMs);
    }
  }, []);

  const update = useCallback((opts: UpdateOptions) => {
    setOverlay(prev => ({
      ...prev,
      ...opts,
      activeIndex: typeof opts.activeIndex === 'number' ? Math.max(0, opts.activeIndex) : prev.activeIndex,
      percentComplete: typeof opts.percentComplete === 'number'
        ? Math.max(0, Math.min(100, opts.percentComplete))
        : prev.percentComplete,
      messages: Array.isArray(opts.messages) ? opts.messages : prev.messages,
      title: typeof opts.title === 'string' ? opts.title : prev.title,
      subtitle: typeof opts.subtitle === 'string' ? opts.subtitle : prev.subtitle,
    }));
  }, []);

  const fadeOutAndClose = useCallback((delayMs: number = 450) => {
    if (splashTimerRef.current) {
      window.clearTimeout(splashTimerRef.current);
      splashTimerRef.current = null;
    }
    setOverlay(prev => ({ ...prev, isFadingOut: true }));
    window.setTimeout(() => {
      setOverlay(prev => ({
        ...prev,
        isFadingOut: false,
        isVisible: false,
        splashVisible: false,
        messages: [],
        activeIndex: 0,
        percentComplete: 0,
      }));
    }, delayMs);
  }, []);

  const close = useCallback(() => {
    if (splashTimerRef.current) {
      window.clearTimeout(splashTimerRef.current);
      splashTimerRef.current = null;
    }
    setOverlay(prev => ({
      ...prev,
      isVisible: false,
      isFadingOut: false,
      splashVisible: false,
      messages: [],
      activeIndex: 0,
      percentComplete: 0,
    }));
  }, []);

  const value = useMemo<DeploymentOverlayContextValue>(() => ({
    open,
    update,
    fadeOutAndClose,
    close,
  }), [open, update, fadeOutAndClose, close]);

  return (
    <DeploymentOverlayContext.Provider value={value}>
      {children}
      <ProgressOverlay
        visible={overlay.isVisible}
        isFadingOut={overlay.isFadingOut}
        showSplash={overlay.splashVisible}
        messages={overlay.messages}
        activeIndex={overlay.activeIndex}
        percentComplete={overlay.percentComplete}
        title={overlay.title}
        subtitle={overlay.subtitle}
      />
    </DeploymentOverlayContext.Provider>
  );
}

export function useDeploymentOverlay(): DeploymentOverlayContextValue {
  const ctx = useContext(DeploymentOverlayContext);
  if (!ctx) {
    throw new Error('useDeploymentOverlay must be used within a DeploymentOverlayProvider');
  }
  return ctx;
}


