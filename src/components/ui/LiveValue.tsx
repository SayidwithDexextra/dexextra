'use client'

import React, { useEffect, useRef, useState, useMemo } from 'react'

/* ─────────────────────────────────────────────
   LiveValue – penny-counter animation

   When `value` changes, the displayed number counts
   up (or down) one cent at a time in quick succession
   until it reaches the new value. A green glow is
   applied while the counter is ticking.
   ───────────────────────────────────────────── */

interface LiveValueProps {
  value: number | string
  children: React.ReactNode
  className?: string
}

export function LiveValue({ value, children, className }: LiveValueProps) {
  const childText = useMemo(() => extractText(children), [children])
  const [countText, setCountText] = useState<string | null>(null)
  const prevValueRef = useRef<number | string>(value)
  const mountedRef = useRef(false)
  const rafRef = useRef<number>()

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      prevValueRef.current = value
      return
    }

    const oldVal = Number(prevValueRef.current)
    const newVal = Number(value)
    prevValueRef.current = value

    if (isNaN(oldVal) || isNaN(newVal) || oldVal === newVal) return

    const format = detectFormat(childText)
    if (!format) return

    const totalCents = Math.round(Math.abs(newVal - oldVal) * 100)
    if (totalCents === 0) return

    const direction = newVal > oldVal ? 1 : -1
    const oldCents = Math.round(oldVal * 100)
    const targetCents = Math.round(newVal * 100)

    // Speed: 1 cent per frame, but batch if > 150 frames (~2.5s at 60fps)
    const centsPerFrame = Math.max(1, Math.ceil(totalCents / 150))
    let currentCents = oldCents

    const tick = () => {
      currentCents += direction * centsPerFrame

      const overshot =
        (direction > 0 && currentCents >= targetCents) ||
        (direction < 0 && currentCents <= targetCents)

      if (overshot) {
        setCountText(null)
        return
      }

      setCountText(format.prefix + (currentCents / 100).toFixed(format.decimals))
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [value, childText])

  const counting = countText !== null
  const cls = `dex-slot-wrapper ${counting ? 'dex-slot-active' : ''} ${className || ''}`.trim()

  return (
    <span className={cls}>
      {counting ? countText : children}
    </span>
  )
}

/* ─────────────────────────────────────────────
   LiveRow – highlights a newly-arrived row
   ───────────────────────────────────────────── */

interface LiveRowProps {
  id: string | number
  liveIds: Set<string | number>
  children: React.ReactNode
  className?: string
}

export function LiveRow({ id, liveIds, children, className }: LiveRowProps) {
  const isLive = liveIds.has(id)
  return (
    <div className={`${className || ''} ${isLive ? 'dex-live-row-enter' : ''}`.trim()}>
      {children}
    </div>
  )
}

/* ─────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────── */

/** Detect if text is a simple dollar format like "$12.75" or "+$1.25" */
function detectFormat(text: string): { prefix: string; decimals: number } | null {
  const match = text.match(/^(\+?\$)([\d,.]+)$/)
  if (!match) return null
  const [, prefix, numPart] = match
  const decMatch = numPart.match(/\.(\d+)$/)
  return { prefix, decimals: decMatch ? decMatch[1].length : 0 }
}

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (React.isValidElement(node) && node.props?.children) {
    return extractText(node.props.children)
  }
  return ''
}
