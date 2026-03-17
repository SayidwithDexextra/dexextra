'use client';
 
import React, { useEffect, useMemo, useRef, useState } from 'react';
 
type Tone = 'warning' | 'success' | 'error' | 'info';
 
export type ActionStatusModalProps = {
  isOpen: boolean;
  onClose: () => void;
  tone?: Tone;
  title: string;
  description?: string | null;
 
  primaryAction?: {
    label: string;
    onClick: () => void | Promise<void>;
    disabled?: boolean;
    loading?: boolean;
    tone?: 'default' | 'danger' | 'success' | 'warning';
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
  };
 
  footerNote?: string | null;
  children?: React.ReactNode;
};
 
export function ActionStatusModal({
  isOpen,
  onClose,
  tone = 'info',
  title,
  description,
  primaryAction,
  secondaryAction,
  footerNote,
  children,
}: ActionStatusModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [isAnimating, setIsAnimating] = useState(false);
 
  useEffect(() => {
    if (!isOpen) {
      setIsAnimating(false);
      return;
    }
    setIsAnimating(true);
  }, [isOpen]);
 
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);
 
  useEffect(() => {
    if (!isOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!modalRef.current) return;
      if (!modalRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [isOpen, onClose]);
 
  const toneMeta = useMemo(() => {
    switch (tone) {
      case 'warning':
        return { dot: 'bg-t-warning', ring: 'border-t-warning/20', icon: 'text-t-warning', badge: 'bg-t-warning/10 text-t-warning' };
      case 'success':
        return { dot: 'bg-t-positive', ring: 'border-t-positive/20', icon: 'text-t-positive', badge: 'bg-t-positive/10 text-t-positive' };
      case 'error':
        return { dot: 'bg-t-negative', ring: 'border-t-negative/20', icon: 'text-t-negative', badge: 'bg-t-negative/10 text-t-negative' };
      default:
        return { dot: 'bg-t-accent', ring: 'border-t-accent/20', icon: 'text-t-accent', badge: 'bg-t-accent/10 text-t-accent' };
    }
  }, [tone]);
 
  const primaryToneClasses = useMemo(() => {
    const t = primaryAction?.tone || 'default';
    if (t === 'danger') return 'border-t-negative/20 text-t-negative hover:border-t-negative/30 hover:bg-t-negative/5';
    if (t === 'success') return 'border-t-positive/30 text-t-positive hover:border-t-positive/40 hover:bg-t-positive/5';
    if (t === 'warning') return 'border-t-warning/20 text-t-warning hover:border-t-warning/30 hover:bg-t-warning/5';
    return 'border-t-stroke text-t-fg-sub hover:border-t-stroke-hover hover:bg-t-card-hover hover:text-t-fg';
  }, [primaryAction?.tone]);
 
  if (!isOpen) return null;
 
  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-opacity duration-200 ${isAnimating ? 'opacity-100' : 'opacity-0'}`}>
      <div className="absolute inset-0 backdrop-blur-sm" style={{ background: 'var(--t-overlay)' }} onClick={onClose} />

      <div
        ref={modalRef}
        className="relative z-10 w-full bg-t-card rounded-md border border-t-stroke transition-all duration-200"
        style={{
          maxWidth: '560px',
          boxShadow: 'var(--t-shadow-lg)',
        }}
      >
        <div className="p-4 border-b border-t-stroke-sub">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${toneMeta.dot}`} />
                <div className="text-t-fg text-[13px] font-medium tracking-tight truncate">{title}</div>
                <div className={`text-[10px] px-1.5 py-0.5 rounded ${toneMeta.badge}`}>{tone.toUpperCase()}</div>
              </div>
              {description ? (
                <div className="mt-1 text-[10px] text-t-fg-muted leading-relaxed">
                  {description}
                </div>
              ) : null}
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-md border border-t-stroke hover:border-t-stroke-hover hover:bg-t-card-hover text-t-fg-sub transition-all duration-200"
              aria-label="Close"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-4">
          {children}
        </div>

        {(primaryAction || secondaryAction || footerNote) ? (
          <div className="p-4 border-t border-t-stroke-sub bg-black/5">
            {footerNote ? (
              <div className="text-[9px] text-t-fg-muted mb-3">
                {footerNote}
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              {secondaryAction ? (
                <button
                  type="button"
                  onClick={secondaryAction.onClick}
                  disabled={secondaryAction.disabled}
                  className={`px-3 py-2 rounded-md text-[11px] border transition-all duration-200 ${
                    secondaryAction.disabled
                      ? 'border-t-stroke text-t-fg-muted'
                      : 'border-t-stroke text-t-fg-sub hover:border-t-stroke-hover hover:bg-t-card-hover hover:text-t-fg'
                  }`}
                >
                  {secondaryAction.label}
                </button>
              ) : null}

              {primaryAction ? (
                <button
                  type="button"
                  onClick={primaryAction.onClick}
                  disabled={primaryAction.disabled || primaryAction.loading}
                  className={`px-3 py-2 rounded-md text-[11px] border transition-all duration-200 flex items-center gap-2 ${
                    (primaryAction.disabled || primaryAction.loading)
                      ? 'border-t-stroke text-t-fg-muted'
                      : primaryToneClasses
                  }`}
                >
                  {primaryAction.loading ? (
                    <>
                      <div className={`w-1.5 h-1.5 rounded-full ${toneMeta.dot} animate-pulse`} />
                      Processing…
                    </>
                  ) : (
                    primaryAction.label
                  )}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
 
export default ActionStatusModal;
