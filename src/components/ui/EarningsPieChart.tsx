'use client'

import React, { useMemo, useEffect, useState, useRef } from 'react'
import { LiveValue } from '@/components/ui/LiveValue'

const PALETTE = [
  '#4a9eff', // platform primary blue
  '#10B981', // emerald / success green
  '#8B5CF6', // violet (trending cards, accents)
  '#F59E0B', // amber (header, trending)
  '#06B6D4', // cyan (deposit gradient)
  '#EC4899', // pink (trending cards)
  '#6366F1', // indigo (card gradients)
  '#00d4aa', // teal (vault connected)
  '#f97316', // orange (header glow)
  '#a78bfa', // soft violet (differentiation)
]

export interface EarningsPieSlice {
  label: string
  value: number
  color?: string
}

interface Props {
  slices: EarningsPieSlice[]
  size?: number
  thickness?: number
  animate?: boolean
  className?: string
  compact?: boolean
  formatValue?: (v: number) => string
  /** When true, plays a green glow pulse (wire to liveMarketKeys) */
  live?: boolean
}

function defaultFormat(v: number) {
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

interface ResolvedSlice extends EarningsPieSlice {
  pct: number
  color: string
  arcLen: number
  offset: number
}

export default function EarningsPieChart({
  slices,
  size = 120,
  thickness = 0.38,
  animate = true,
  className = '',
  compact = false,
  formatValue = defaultFormat,
  live = false,
}: Props) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const [revealed, setRevealed] = useState(!animate)
  const [pulsing, setPulsing] = useState(false)
  const mountedRef = useRef(false)
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout>>()

  const total = useMemo(
    () => slices.reduce((s, sl) => s + Math.max(0, sl.value), 0),
    [slices],
  )

  // Initial sweep animation — runs only once on mount
  useEffect(() => {
    if (!animate) { setRevealed(true); return }
    const id = requestAnimationFrame(() => setRevealed(true))
    return () => cancelAnimationFrame(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate])

  // Green glow pulse when live prop fires
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    if (live) {
      setPulsing(true)
      clearTimeout(pulseTimerRef.current)
      pulseTimerRef.current = setTimeout(() => setPulsing(false), 1200)
    }
  }, [live])

  // Clean up timer
  useEffect(() => () => clearTimeout(pulseTimerRef.current), [])

  const cx = size / 2
  const cy = size / 2
  const outerR = size / 2 - 2
  const donutWidth = outerR * thickness
  const centerR = outerR - donutWidth / 2
  const C = 2 * Math.PI * centerR

  const GAP_PX = 3

  const resolved = useMemo<ResolvedSlice[]>(() => {
    if (total === 0) return []

    const positive = slices
      .filter((s) => s.value > 0)
      .map((s, i) => ({
        ...s,
        pct: s.value / total,
        color: s.color || PALETTE[i % PALETTE.length],
      }))
      .sort((a, b) => b.value - a.value)

    const gapTotal = positive.length > 1 ? GAP_PX * positive.length : 0
    const usableC = C - gapTotal
    const gapPerSlice = positive.length > 1 ? GAP_PX : 0

    let cumOffset = 0
    return positive.map((sl) => {
      const arcLen = sl.pct * usableC
      const offset = cumOffset
      cumOffset += arcLen + gapPerSlice
      return { ...sl, arcLen, offset }
    })
  }, [slices, total, C, GAP_PX])

  if (total === 0) {
    return (
      <div className={`flex flex-col items-center ${className}`}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={cx}
            cy={cy}
            r={centerR}
            fill="none"
            stroke="#1A1A1A"
            strokeWidth={donutWidth}
          />
          <text
            x={cx}
            y={cy}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#606060"
            fontSize={10}
          >
            No data
          </text>
        </svg>
      </div>
    )
  }

  const TRANSITION = 'stroke-dasharray 0.6s cubic-bezier(0.33,1,0.68,1), stroke-dashoffset 0.6s cubic-bezier(0.33,1,0.68,1), opacity 0.2s ease'

  return (
    <div
      className={`flex ${compact ? 'flex-col items-center gap-2.5' : 'items-start gap-5'} ${className}`}
    >
      <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          style={{
            filter: pulsing
              ? 'drop-shadow(0 0 8px rgba(74, 222, 128, 0.35))'
              : 'drop-shadow(0 0 4px rgba(74, 222, 128, 0.08))',
            transition: 'filter 0.3s ease',
          }}
        >
          {/* Background ring */}
          <circle
            cx={cx}
            cy={cy}
            r={centerR}
            fill="none"
            stroke="#1A1A1A"
            strokeWidth={donutWidth}
          />

          {/* Slices */}
          {resolved.map((sl, i) => (
            <circle
              key={`slice-${sl.label}-${i}`}
              cx={cx}
              cy={cy}
              r={centerR}
              fill="none"
              stroke={sl.color}
              strokeWidth={donutWidth}
              strokeLinecap="butt"
              strokeDasharray={
                revealed ? `${sl.arcLen} ${C - sl.arcLen}` : `0 ${C}`
              }
              strokeDashoffset={revealed ? -sl.offset : 0}
              opacity={hoveredIdx === null || hoveredIdx === i ? 1 : 0.3}
              style={{
                transition: revealed ? TRANSITION : 'none',
                transform: 'rotate(-90deg)',
                transformOrigin: `${cx}px ${cy}px`,
              }}
              className="cursor-pointer"
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            />
          ))}
        </svg>

        {/* Center label */}
        <div
          className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
          style={{ padding: outerR * thickness + 4 }}
        >
          {hoveredIdx !== null && resolved[hoveredIdx] ? (
            <>
              <span className="text-[9px] text-[#9CA3AF] uppercase tracking-wide truncate max-w-full text-center leading-tight">
                {resolved[hoveredIdx].label}
              </span>
              <LiveValue value={resolved[hoveredIdx].value} className="text-[13px] font-semibold text-white font-mono leading-tight mt-0.5">
                {formatValue(resolved[hoveredIdx].value)}
              </LiveValue>
              <span className="text-[9px] text-[#606060] font-mono leading-tight">
                {(resolved[hoveredIdx].pct * 100).toFixed(1)}%
              </span>
            </>
          ) : (
            <>
              <span className="text-[9px] text-[#606060] uppercase tracking-wide">
                Total
              </span>
              <LiveValue value={total} className={`text-[14px] font-semibold font-mono leading-tight mt-0.5 transition-colors duration-300 ${
                  pulsing ? 'text-green-400' : 'text-white'
                }`}>
                {formatValue(total)}
              </LiveValue>
            </>
          )}
        </div>
      </div>

      {/* Legend */}
      {resolved.length > 0 && (
        <div
          className={`flex flex-col min-w-0 ${compact ? 'w-full gap-1' : 'flex-1 gap-1.5 pt-1'}`}
        >
          {resolved.map((sl, i) => (
            <div
              key={`leg-${sl.label}-${i}`}
              className={`flex items-center gap-2 cursor-pointer rounded px-1 -mx-1 py-0.5
                transition-opacity duration-200 hover:bg-white/[0.03]
                ${hoveredIdx !== null && hoveredIdx !== i ? 'opacity-30' : 'opacity-100'}`}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              <div
                className="w-2 h-2 rounded-sm flex-shrink-0 ring-1 ring-white/10"
                style={{ backgroundColor: sl.color }}
              />
              <span
                className={`text-[#9CA3AF] truncate flex-1 ${compact ? 'text-[10px]' : 'text-[11px]'}`}
              >
                {sl.label}
              </span>
              <span
                className={`font-medium font-mono flex-shrink-0 tabular-nums ${compact ? 'text-[10px] text-[#ccc]' : 'text-[11px] text-white'}`}
              >
                {formatValue(sl.value)}
              </span>
              <span
                className={`font-mono flex-shrink-0 tabular-nums ${compact ? 'text-[9px] text-[#606060]' : 'text-[10px] text-[#606060]'}`}
              >
                {(sl.pct * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
