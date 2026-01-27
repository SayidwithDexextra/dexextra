import React from 'react';

export function Badge({
  children,
  variant = 'blue',
}: {
  children: React.ReactNode;
  variant?: 'blue' | 'neutral';
}) {
  const cls =
    variant === 'blue'
      ? 'bg-[#1f3cff]/20 text-[#9bb0ff] border-[#1f3cff]/30'
      : 'bg-white/10 text-white/80 border-white/15';

  return (
    <span
      className={[
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] leading-none',
        cls,
      ].join(' ')}
    >
      {children}
    </span>
  );
}

