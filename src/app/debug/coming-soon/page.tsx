'use client'

import React from 'react'
import ComingSoonGate from '@/components/ComingSoonOverlay'

export default function DebugComingSoonPage() {
  const debugEnabled =
    process.env.NODE_ENV !== 'production' ||
    String(process.env.NEXT_PUBLIC_ENABLE_DEBUG_PAGES || '').toLowerCase() === 'true'

  const [showPreview, setShowPreview] = React.useState(false)

  if (!debugEnabled) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
          <div className="text-[12px] font-medium text-white">Debug pages disabled</div>
          <div className="mt-1 text-[11px] text-[#9CA3AF]">
            Set <span className="font-mono text-white/80">NEXT_PUBLIC_ENABLE_DEBUG_PAGES=true</span> to enable in production.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl p-4">
      <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-[12px] font-medium text-white">Debug: Coming Soon Overlay</div>
            <div className="mt-1 text-[11px] text-[#9CA3AF]">
              Force-render the coming-soon gate even after you&apos;ve passed the waitlist / whitelist
              check. Includes the Early Access rewards slide-up sheet.
            </div>
          </div>
          <a
            className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-[11px] text-white hover:bg-[#1A1A1A]"
            href="/debug"
          >
            ← Debug home
          </a>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={() => setShowPreview(true)}
            className="rounded bg-white px-3 py-2 text-[12px] font-medium text-black hover:bg-white/90"
          >
            Open coming-soon preview
          </button>
          <div className="text-[11px] text-[#606060]">
            The overlay renders on top of everything. Use the &ldquo;Exit preview&rdquo; button (top-right) or
            press <span className="font-mono text-white/80">Esc</span> to close.
          </div>
        </div>
      </div>

      {showPreview && (
        <div className="fixed inset-0 z-[10000]">
          {/* Exit control layered above the previewed gate (gate is z-[9998]) */}
          <button
            onClick={() => setShowPreview(false)}
            className="fixed top-3 right-3 z-[10001] rounded-md border border-[#333333] bg-[#141414]/90 px-3 py-1.5 text-[11px] font-medium text-white backdrop-blur hover:bg-[#1A1A1A]"
          >
            Exit preview ✕
          </button>
          <EscToClose onClose={() => setShowPreview(false)} />
          {/* The gate in preview mode always shows the overlay; children never render. */}
          <ComingSoonGate previewMode>
            <div />
          </ComingSoonGate>
        </div>
      )}
    </div>
  )
}

function EscToClose({ onClose }: { onClose: () => void }) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return null
}
