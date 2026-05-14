'use client'

import React, { useEffect, useMemo } from 'react'
import Link from 'next/link'
import {
  useNotifications,
  type NotificationItem,
  type NotificationSeverity,
} from '@/contexts/NotificationContext'

type NotificationsPopoverProps = {
  isOpen: boolean
  onClose: () => void
  // Caps so the popover stays a preview — full list lives at
  // /notifications, which is one footer-tap away.
  newLimit?: number
  oldLimit?: number
}

const SEVERITY_COLOR: Record<NotificationSeverity, string> = {
  info: '#60a5fa', // blue-400
  success: '#4ade80', // green-400
  warning: '#facc15', // yellow-400
  critical: '#f87171', // red-400
}

function formatRelative(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const diff = Date.now() - t
  const sec = Math.max(1, Math.floor(diff / 1000))
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  const wk = Math.floor(day / 7)
  if (wk < 5) return `${wk}w ago`
  const mo = Math.floor(day / 30)
  if (mo < 12) return `${mo}mo ago`
  const yr = Math.floor(day / 365)
  return `${yr}y ago`
}

function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href)
}

export function NotificationsPopover({
  isOpen,
  onClose,
  newLimit = 3,
  oldLimit = 4,
}: NotificationsPopoverProps) {
  const { items, unreadCount, markRead } = useNotifications()

  const { newItems, oldItems } = useMemo(() => {
    const unread = items.filter((n) => !n.is_read).slice(0, newLimit)
    const read = items.filter((n) => n.is_read).slice(0, oldLimit)
    return { newItems: unread, oldItems: read }
  }, [items, newLimit, oldLimit])

  // Esc to close — matches FooterSupportPopup behavior.
  useEffect(() => {
    if (!isOpen) return
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      className="absolute top-full right-0 mt-2 z-50"
      style={{ minWidth: '320px', maxWidth: '360px' }}
    >
      <div className="bg-[#0F0F0F] rounded-md border border-[#222222] overflow-hidden shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-2.5 border-b border-[#1A1A1A]">
          <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
            Notifications
          </h4>
          {unreadCount > 0 ? (
            <div className="text-[10px] text-blue-400 bg-blue-400/10 border border-blue-400/20 px-1.5 py-0.5 rounded font-medium uppercase tracking-wider">
              {unreadCount} new
            </div>
          ) : (
            <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
              0 new
            </div>
          )}
        </div>

        {/* NEW section */}
        <div className="p-1.5">
          <div className="px-1.5 pb-1">
            <span className="text-[9px] font-medium uppercase tracking-wider text-[#606060]">
              New
            </span>
          </div>
          {newItems.length === 0 ? (
            <div className="flex items-start gap-2 px-2.5 py-2.5">
              <div className="w-1.5 h-1.5 rounded-full bg-[#404040] flex-shrink-0 mt-1.5" />
              <div className="flex-1 min-w-0">
                <span className="text-[11px] font-medium text-[#808080]">
                  No new messages at this time
                </span>
                <div className="text-[10px] text-[#606060] leading-snug mt-0.5">
                  You&apos;re all caught up. New platform updates show up here
                  in real time.
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-0.5">
              {newItems.map((item) => (
                <PopoverRow
                  key={item.id}
                  item={item}
                  onClose={onClose}
                  markRead={markRead}
                />
              ))}
            </div>
          )}
        </div>

        {/* EARLIER section — fades out toward the bottom via CSS mask. */}
        {oldItems.length > 0 && (
          <>
            <div className="px-3 pt-2 pb-1 border-t border-[#1A1A1A]">
              <span className="text-[9px] font-medium uppercase tracking-wider text-[#606060]">
                Earlier
              </span>
            </div>
            <div
              className="p-1.5 space-y-0.5"
              style={{
                // Linear fade so the bottom of the list dissolves into the
                // popover background — gives the "older messages slipping
                // away" affordance the design called for.
                WebkitMaskImage:
                  'linear-gradient(to bottom, black 45%, rgba(0,0,0,0.4) 80%, transparent 100%)',
                maskImage:
                  'linear-gradient(to bottom, black 45%, rgba(0,0,0,0.4) 80%, transparent 100%)',
              }}
            >
              {oldItems.map((item) => (
                <PopoverRow
                  key={item.id}
                  item={item}
                  onClose={onClose}
                  markRead={markRead}
                />
              ))}
            </div>
          </>
        )}

        {/* Footer: View all */}
        <div className="p-1.5 border-t border-[#1A1A1A]">
          <Link
            href="/notifications"
            onClick={onClose}
            className="w-full flex items-center justify-center gap-1.5 p-2 rounded-md text-[11px] font-medium text-[#808080] hover:text-white bg-[#0F0F0F] hover:bg-[#1A1A1A] border border-[#222222] hover:border-[#333333] transition-all duration-200"
          >
            View all notifications
            <svg
              className="w-3 h-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  )
}

// ─── Row ──────────────────────────────────────────────────────────────

interface RowProps {
  item: NotificationItem
  onClose: () => void
  markRead: (id: string) => void | Promise<void>
}

function PopoverRow({ item, onClose, markRead }: RowProps) {
  const color = SEVERITY_COLOR[item.severity] ?? SEVERITY_COLOR.info
  const hasCta = Boolean(item.cta_href)
  const external = hasCta && isExternalHref(item.cta_href!)
  // If a CTA exists, the row deep-links to it; otherwise it routes to the
  // standalone page so the user can read the full message.
  const targetHref = hasCta ? item.cta_href! : '/notifications'

  const handleClick = () => {
    if (!item.is_read) {
      // Fire-and-forget; provider handles the optimistic UI + rollback.
      Promise.resolve(markRead(item.id)).catch(() => {})
    }
    onClose()
  }

  const inner = (
    <div className="group flex items-start gap-2 p-2.5 rounded-md bg-[#0F0F0F] hover:bg-[#1A1A1A] transition-all duration-200">
      <div
        className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 transition-opacity duration-150"
        style={{ backgroundColor: color, opacity: item.is_read ? 0.3 : 1 }}
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={[
              'text-[11px] font-medium truncate',
              item.is_read ? 'text-[#9CA3AF]' : 'text-white',
            ].join(' ')}
          >
            {item.title}
          </span>
        </div>
        <div className="text-[10px] text-[#808080] leading-snug mt-0.5 truncate">
          {item.body}
        </div>
        <div className="text-[9px] text-[#606060] font-mono mt-1">
          {formatRelative(item.published_at)}
        </div>
      </div>
      <svg
        className="w-3 h-3 text-[#404040] group-hover:text-[#606060] transition-colors duration-200 flex-shrink-0 mt-0.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d={external ? 'M7 17L17 7M17 7H9M17 7V15' : 'M9 5l7 7-7 7'}
        />
      </svg>
    </div>
  )

  return external ? (
    <a
      href={targetHref}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
      className="block"
    >
      {inner}
    </a>
  ) : (
    <Link href={targetHref} onClick={handleClick} className="block">
      {inner}
    </Link>
  )
}
