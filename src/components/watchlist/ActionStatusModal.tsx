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
 
   // Escape key
   useEffect(() => {
     if (!isOpen) return;
     const onKeyDown = (e: KeyboardEvent) => {
       if (e.key === 'Escape') onClose();
     };
     document.addEventListener('keydown', onKeyDown);
     return () => document.removeEventListener('keydown', onKeyDown);
   }, [isOpen, onClose]);
 
   // Click outside
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
         return { dot: 'bg-yellow-400', ring: 'border-yellow-500/20', icon: 'text-yellow-400', badge: 'bg-yellow-500/10 text-yellow-400' };
       case 'success':
         return { dot: 'bg-green-400', ring: 'border-green-500/20', icon: 'text-green-400', badge: 'bg-green-500/10 text-green-400' };
       case 'error':
         return { dot: 'bg-red-400', ring: 'border-red-500/20', icon: 'text-red-400', badge: 'bg-red-500/10 text-red-400' };
       default:
         return { dot: 'bg-blue-400', ring: 'border-blue-500/20', icon: 'text-blue-400', badge: 'bg-blue-500/10 text-blue-400' };
     }
   }, [tone]);
 
   const primaryToneClasses = useMemo(() => {
     const t = primaryAction?.tone || 'default';
     if (t === 'danger') return 'border-red-500/20 text-red-400 hover:border-red-500/30 hover:bg-red-500/5';
     if (t === 'success') return 'border-green-500/30 text-green-400 hover:border-green-500/40 hover:bg-green-500/5';
     if (t === 'warning') return 'border-yellow-500/20 text-yellow-400 hover:border-yellow-500/30 hover:bg-yellow-500/5';
     return 'border-[#222222] text-[#808080] hover:border-[#333333] hover:bg-[#1A1A1A] hover:text-white';
   }, [primaryAction?.tone]);
 
   if (!isOpen) return null;
 
   return (
     <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-opacity duration-200 ${isAnimating ? 'opacity-100' : 'opacity-0'}`}>
       <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} />
 
       <div
         ref={modalRef}
         className="relative z-10 w-full bg-[#0F0F0F] rounded-md border border-[#222222] transition-all duration-200"
         style={{
           maxWidth: '560px',
           boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)',
         }}
       >
         <div className="p-4 border-b border-[#1A1A1A]">
           <div className="flex items-start justify-between gap-3">
             <div className="min-w-0">
               <div className="flex items-center gap-2 min-w-0">
                 <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${toneMeta.dot}`} />
                 <div className="text-white text-[13px] font-medium tracking-tight truncate">{title}</div>
                 <div className={`text-[10px] px-1.5 py-0.5 rounded ${toneMeta.badge}`}>{tone.toUpperCase()}</div>
               </div>
               {description ? (
                 <div className="mt-1 text-[10px] text-[#606060] leading-relaxed">
                   {description}
                 </div>
               ) : null}
             </div>
 
             <button
               onClick={onClose}
               className="p-2 rounded-md border border-[#222222] hover:border-[#333333] hover:bg-[#1A1A1A] text-[#808080] transition-all duration-200"
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
           <div className="p-4 border-t border-[#1A1A1A] bg-black/10">
             {footerNote ? (
               <div className="text-[9px] text-[#606060] mb-3">
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
                       ? 'border-[#222222] text-[#606060]'
                       : 'border-[#222222] text-[#808080] hover:border-[#333333] hover:bg-[#1A1A1A] hover:text-white'
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
                       ? 'border-[#222222] text-[#606060]'
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

