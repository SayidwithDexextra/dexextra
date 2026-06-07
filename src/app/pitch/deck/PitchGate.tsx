'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export default function PitchGate() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/pitch/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || 'Incorrect password');
        setPassword('');
      }
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  }

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center overflow-y-auto bg-[#0A0A0A] px-4 py-10 text-white"
      style={{ height: '100dvh' }}
    >
      {/* Ambient gradient orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 top-1/4 h-96 w-96 rounded-full bg-[#00D4FF]/10 blur-[120px]" />
        <div className="absolute -right-24 bottom-1/4 h-80 w-80 rounded-full bg-[#00D4FF]/5 blur-[120px]" />
      </div>

      <form
        onSubmit={handleSubmit}
        className="relative z-10 w-full max-w-sm rounded-2xl border border-[#222222] bg-[#0F0F0F]/80 p-8 backdrop-blur-xl"
      >
        <div className="mb-6 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#00D4FF] shadow-[0_0_12px_#00D4FF]" />
          <span className="text-sm font-medium tracking-wide text-[#9CA3AF]">DEXETERA</span>
        </div>

        <h1 className="text-2xl font-semibold tracking-tight">Pitch Deck</h1>
        <p className="mt-2 text-sm text-[#808080]">
          This deck is private. Enter the password to continue.
        </p>

        <div className="mt-6">
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full rounded-lg border border-[#333333] bg-[#1A1A1A] px-4 py-3 text-sm text-white placeholder-[#606060] outline-none transition focus:border-[#00D4FF] focus:ring-1 focus:ring-[#00D4FF]"
          />
        </div>

        {error && <p className="mt-3 text-sm text-[#f87171]">{error}</p>}

        <button
          type="submit"
          disabled={loading || !password}
          className="mt-6 w-full rounded-lg bg-[#00D4FF] px-4 py-3 text-sm font-semibold text-[#0A0A0A] transition hover:bg-[#00D4FF]/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? 'Unlocking…' : 'Enter'}
        </button>
      </form>
    </div>,
    document.body,
  );
}
