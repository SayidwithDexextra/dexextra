'use client'

import { formatViewAsLabel, useViewAs } from '@/contexts/ViewAsContext'

export default function DemoViewChip() {
  const {
    demoAddress,
    demoName,
    isHydrated,
    isViewingAs,
    viewAddress,
    exitViewAs,
    reopenModal,
  } = useViewAs()

  if (!isHydrated || !demoAddress) return null

  const activeLabel = formatViewAsLabel(demoName, viewAddress || demoAddress)

  if (isViewingAs) {
    return (
      <div
        className="flex items-center gap-1 max-w-[220px] rounded-md border px-1.5 py-1"
        style={{
          borderColor: 'rgba(59, 130, 246, 0.35)',
          backgroundColor: 'rgba(59, 130, 246, 0.10)',
        }}
      >
        <button
          type="button"
          onClick={reopenModal}
          className="min-w-0 text-left"
          title={activeLabel}
        >
          <span className="block text-[9px] uppercase tracking-wide text-[#93C5FD] leading-none mb-0.5">
            Viewing as
          </span>
          <span className="block truncate text-[11px] font-medium text-white leading-none">
            {demoName || `${demoAddress.slice(0, 6)}...${demoAddress.slice(-4)}`}
          </span>
        </button>
        <button
          type="button"
          onClick={exitViewAs}
          className="shrink-0 text-[10px] text-[#93C5FD] hover:text-white px-1 py-0.5 rounded transition-colors"
        >
          Exit
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={reopenModal}
      className="hidden sm:inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-medium text-[#9CA3AF] hover:text-white hover:border-[#333333] transition-colors"
      style={{ borderColor: 'var(--t-chrome-border-sub)' }}
      title="View the platform through the demo user's book"
    >
      Demo view
    </button>
  )
}
