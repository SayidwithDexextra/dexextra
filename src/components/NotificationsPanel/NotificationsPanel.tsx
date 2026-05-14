'use client'

import { useEffect, useMemo } from 'react'
import Link from 'next/link'
import {
  useNotifications,
  type NotificationItem,
  type NotificationSeverity,
} from '@/contexts/NotificationContext'

interface NotificationsPanelProps {
  /**
   * Parent owns the open state — same contract as `FooterSupportPopup`
   * and `FooterWatchlistPopup`. The parent wraps the trigger + this panel
   * in a relative container with onMouseEnter/onMouseLeave + grace-period
   * close timer.
   */
  isOpen: boolean
  onClose: () => void
  /** Caps for preview rows; the full archive lives at /notifications. */
  newLimit?: number
  oldLimit?: number
}

const SEVERITY_STYLE: Record<
  NotificationSeverity,
  { dot: string; badge: string; label: string }
> = {
  // Tailwind semantic palette — keeps the panel on-platform (no bespoke
  // accent colors). Badges are the same hex with 12–14% alpha.
  info: { dot: '#60a5fa', badge: 'rgba(96, 165, 250, 0.14)', label: 'Update' },
  success: { dot: '#4ade80', badge: 'rgba(74, 222, 128, 0.14)', label: 'Live' },
  warning: { dot: '#facc15', badge: 'rgba(250, 204, 21, 0.14)', label: 'Heads-up' },
  critical: { dot: '#f87171', badge: 'rgba(248, 113, 113, 0.14)', label: 'Critical' },
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

interface NotificationRowProps {
  item: NotificationItem
  onClose: () => void
  onMarkRead: (id: string) => void | Promise<void>
}

function NotificationRow({ item, onClose, onMarkRead }: NotificationRowProps) {
  const style = SEVERITY_STYLE[item.severity] ?? SEVERITY_STYLE.info
  const hasCta = Boolean(item.cta_href)
  const external = hasCta && isExternalHref(item.cta_href!)
  // CTA exists → deep-link to it. No CTA → route to /notifications so the
  // user can read the full body. Either way the row marks the item read.
  const targetHref = hasCta ? item.cta_href! : '/notifications'

  const handleClick = () => {
    if (!item.is_read) {
      Promise.resolve(onMarkRead(item.id)).catch(() => {})
    }
    onClose()
  }

  const inner = (
    <div className="flex items-start gap-2 p-2.5">
      {/* Unread severity dot — mirrors the footer popup status-dot pattern. */}
      <div
        className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 transition-opacity duration-150"
        style={{
          backgroundColor: style.dot,
          opacity: item.is_read ? 0.3 : 1,
        }}
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0 mb-0.5">
          <span
            className="text-[9px] uppercase tracking-wider px-1.5 py-[1px] rounded font-medium flex-shrink-0"
            style={{ backgroundColor: style.badge, color: style.dot }}
          >
            {style.label}
          </span>
          <span
            className={[
              'text-[11px] font-medium truncate',
              item.is_read ? 'text-[#9CA3AF]' : 'text-white',
            ].join(' ')}
            title={item.title}
          >
            {item.title}
          </span>
        </div>
        <div className="text-[10px] text-[#808080] leading-snug mt-0.5 line-clamp-2">
          {item.body}
        </div>
        <div className="text-[9px] text-[#606060] font-mono mt-1">
          {formatRelative(item.published_at)}
          {item.cta_label && hasCta ? (
            <span className="ml-1 text-[#9CA3AF]">· {item.cta_label} →</span>
          ) : null}
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

  const commonClass =
    'group block w-full rounded-md transition-all duration-200 text-left bg-[#0F0F0F] hover:bg-[#1A1A1A]'
  const ariaLabel = `${item.title} — ${item.is_read ? 'read' : 'unread'}`

  if (external) {
    return (
      <a
        href={targetHref}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleClick}
        className={commonClass}
        aria-label={ariaLabel}
      >
        {inner}
      </a>
    )
  }

  return (
    <Link
      href={targetHref}
      onClick={handleClick}
      className={commonClass}
      aria-label={ariaLabel}
    >
      {inner}
    </Link>
  )
}

/**
 * NotificationsPanel
 *
 * Inline hover dropdown for the header bell. Mirrors the visual + posit-
 * ioning vocabulary of `FooterSupportPopup` and `FooterWatchlistPopup`:
 * absolutely positioned inside a relatively-positioned parent that the
 * caller wraps around the bell + this panel together. The caller manages
 * `isOpen` via mouseEnter/mouseLeave + a 200ms grace-period close timer.
 *
 * Layout: a NEW section (or "No new messages" empty state), followed by
 * an EARLIER section that fades into the popover background via CSS
 * mask, then a "View all notifications" footer linking to the standalone
 * /notifications page.
 */
export default function NotificationsPanel({
  isOpen,
  onClose,
  newLimit = 3,
  oldLimit = 4,
}: NotificationsPanelProps) {
  const { items, unreadCount, markRead, isLoading } = useNotifications()

  // Esc closes — same UX contract as the footer popups.
  useEffect(() => {
    if (!isOpen) return
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose])

  const { newItems, oldItems } = useMemo(() => {
    const unread = items.filter((n) => !n.is_read).slice(0, newLimit)
    const read = items.filter((n) => n.is_read).slice(0, oldLimit)
    return { newItems: unread, oldItems: read }
  }, [items, newLimit, oldLimit])

  if (!isOpen) return null

  return (
    <div
      // `top-full mt-2` drops the panel below the bell, right-aligned so it
      // stays inside the viewport even when the bell sits near the right
      // edge of the desktop header.
      className="absolute top-full right-0 mt-2 z-50"
      style={{ minWidth: '320px', maxWidth: '380px', width: '360px' }}
      role="dialog"
      aria-label="Notifications"
    >
      <div
        className="bg-[#0F0F0F] rounded-md border border-[#222222] overflow-hidden shadow-xl"
        style={{
          animation: 'notifications-panel-expand 160ms ease-out',
          transformOrigin: 'top right',
        }}
      >
        {/* Header — same shape as FooterSupportPopup */}
        <div className="flex items-center justify-between p-2.5 border-b border-[#1A1A1A]">
          <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
            Notifications
          </h4>
          {unreadCount > 0 ? (
            <span
              className="text-[10px] font-medium font-mono px-1.5 py-0.5 rounded uppercase tracking-wider"
              style={{
                backgroundColor: 'rgba(96, 165, 250, 0.14)',
                color: '#60a5fa',
              }}
              aria-label={`${unreadCount} unread`}
            >
              {unreadCount > 99 ? '99+' : unreadCount} new
            </span>
          ) : (
            <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
              {items.length}
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
          {isLoading && items.length === 0 ? (
            <div className="px-2.5 py-6 text-center">
              <div className="inline-block w-4 h-4 border-2 border-[#222222] border-t-[#808080] rounded-full animate-spin" />
            </div>
          ) : newItems.length === 0 ? (
            <div className="flex items-start gap-2 px-2.5 py-2.5">
              <div className="w-1.5 h-1.5 rounded-full bg-[#404040] flex-shrink-0 mt-1.5" />
              <div className="flex-1 min-w-0">
                <span className="text-[11px] font-medium text-[#808080]">
                  No new messages at this time
                </span>
                <div className="text-[10px] text-[#606060] leading-snug mt-0.5">
                  You&apos;re all caught up. New platform updates appear here
                  in real time.
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-0.5">
              {newItems.map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  onClose={onClose}
                  onMarkRead={markRead}
                />
              ))}
            </div>
          )}
        </div>

        {/* EARLIER section — bottom of the list dissolves into the
            popover background via a CSS mask, giving "older messages
            slipping away" the affordance the user described. Only
            rendered when there are read items to show. */}
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
                WebkitMaskImage:
                  'linear-gradient(to bottom, black 45%, rgba(0,0,0,0.4) 80%, transparent 100%)',
                maskImage:
                  'linear-gradient(to bottom, black 45%, rgba(0,0,0,0.4) 80%, transparent 100%)',
              }}
            >
              {oldItems.map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  onClose={onClose}
                  onMarkRead={markRead}
                />
              ))}
            </div>
          </>
        )}

        {/* Footer — same shape as FooterSupportPopup's "Support center →".
            Drops the user onto the standalone /notifications page where
            they can read full bodies, mark all read, and filter. */}
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

      <style jsx>{`
        @keyframes notifications-panel-expand {
          from {
            opacity: 0;
            transform: translateY(-6px) scale(0.985);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  )
}
