'use client'

import { useCallback, useEffect } from 'react'
import Link from 'next/link'
import {
  useNotifications,
  type NotificationItem,
  type NotificationSeverity,
} from '@/contexts/NotificationContext'

interface NotificationsPanelProps {
  /**
   * 'desktop' anchors the popup snug to the header bell (max 360px wide).
   * 'mobile' stretches the popup to full viewport width so the rows are
   * thumb-friendly underneath the 56px mobile header.
   */
  variant?: 'desktop' | 'mobile'
}

const SEVERITY_STYLE: Record<
  NotificationSeverity,
  { dot: string; badge: string; label: string }
> = {
  info: { dot: '#4a9eff', badge: 'rgba(74,158,255,0.12)', label: 'Update' },
  success: { dot: '#00d4aa', badge: 'rgba(0,212,170,0.12)', label: 'Success' },
  warning: { dot: '#f59e0b', badge: 'rgba(245,158,11,0.12)', label: 'Heads-up' },
  critical: { dot: '#ff6b6b', badge: 'rgba(255,107,107,0.12)', label: 'Critical' },
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
  onMarkRead: (id: string) => void
  onCtaClick: (id: string) => void
}

function NotificationRow({ item, onMarkRead, onCtaClick }: NotificationRowProps) {
  const style = SEVERITY_STYLE[item.severity] ?? SEVERITY_STYLE.info

  // The whole row is a single tap target — clicking marks it read and (if
  // there's a CTA) follows the link. This matches the FooterSupportPopup's
  // "row is a button" interaction model.
  const handleRowClick = () => {
    if (!item.cta_href) {
      if (!item.is_read) onMarkRead(item.id)
      return
    }
    onCtaClick(item.id)
  }

  const linkProps = item.cta_href
    ? isExternalHref(item.cta_href)
      ? { as: 'a' as const, href: item.cta_href, target: '_blank', rel: 'noopener noreferrer' }
      : { as: 'link' as const, href: item.cta_href }
    : null

  const RowInner = (
    <div className="flex items-start gap-2 p-2.5">
      {/* Unread severity dot (mirrors the footer popup's status-dot pattern). */}
      <div
        className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 transition-opacity duration-150"
        style={{
          backgroundColor: style.dot,
          opacity: item.is_read ? 0 : 1,
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
              item.is_read ? 'text-[#808080]' : 'text-white',
            ].join(' ')}
            title={item.title}
          >
            {item.title}
          </span>
        </div>
        <div className="text-[10px] text-[#808080] leading-snug mt-0.5 line-clamp-3">
          {item.body}
        </div>
        <div className="text-[9px] text-[#606060] font-mono mt-1">
          {formatRelative(item.published_at)}
          {item.cta_label && item.cta_href ? (
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
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
      </svg>
    </div>
  )

  if (linkProps?.as === 'link') {
    return (
      <Link
        href={linkProps.href}
        onClick={handleRowClick}
        className="group block w-full rounded-md transition-all duration-200 text-left bg-[#0F0F0F] hover:bg-[#1A1A1A]"
        aria-label={`${item.title} — ${item.is_read ? 'read' : 'unread'}`}
      >
        {RowInner}
      </Link>
    )
  }

  if (linkProps?.as === 'a') {
    return (
      <a
        href={linkProps.href}
        target={linkProps.target}
        rel={linkProps.rel}
        onClick={handleRowClick}
        className="group block w-full rounded-md transition-all duration-200 text-left bg-[#0F0F0F] hover:bg-[#1A1A1A]"
        aria-label={`${item.title} — ${item.is_read ? 'read' : 'unread'}`}
      >
        {RowInner}
      </a>
    )
  }

  return (
    <button
      type="button"
      onClick={handleRowClick}
      className="group w-full rounded-md transition-all duration-200 text-left bg-[#0F0F0F] hover:bg-[#1A1A1A]"
      aria-label={`${item.title} — ${item.is_read ? 'read' : 'unread'}`}
    >
      {RowInner}
    </button>
  )
}

/**
 * NotificationsPanel
 *
 * Inline expanding dropdown that mirrors the visual + positioning pattern
 * of `FooterSupportPopup` and `FooterWatchlistPopup`. The component is
 * absolutely positioned inside its parent, so the caller MUST wrap the
 * trigger (the bell button) and this panel together inside a relatively
 * positioned container. This matches how the footer popups are mounted.
 */
export default function NotificationsPanel({ variant = 'desktop' }: NotificationsPanelProps) {
  const { items, unreadCount, isOpen, close, markRead, markAllRead, isLoading } =
    useNotifications()

  // Esc closes — same UX contract as the footer popups.
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, close])

  const handleCtaClick = useCallback(
    (id: string) => {
      markRead(id)
      close()
    },
    [markRead, close],
  )

  if (!isOpen) return null

  const isMobile = variant === 'mobile'

  return (
    <div
      // `top-full` drops the panel below the trigger, mirroring the footer
      // popup that uses `bottom-full` to rise above its trigger.
      className={[
        'absolute z-50',
        isMobile ? 'right-0 mt-2' : 'right-0 mt-3.5',
      ].join(' ')}
      style={
        isMobile
          ? {
              top: '100%',
              // Pull the panel out of the bell's parent flexbox so it spans
              // the viewport instead of being constrained to the bell's
              // 40px-wide column. `right: -8px` aligns the panel's right
              // edge with the mobile header's 12px outer padding.
              right: '-8px',
              width: 'calc(100vw - 16px)',
              maxWidth: '420px',
            }
          : {
              top: '100%',
              minWidth: '320px',
              maxWidth: '380px',
              width: '360px',
            }
      }
      role="dialog"
      aria-label="Notifications"
    >
      <div
        className="bg-[#0F0F0F] rounded-md border border-[#222222] overflow-hidden shadow-xl"
        style={{
          // Lightweight expand animation — feels like the footer popups
          // even though they don't animate. Keeps the "expanding drop-down"
          // wording the user asked for honest.
          animation: 'notifications-panel-expand 160ms ease-out',
          transformOrigin: 'top right',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-2.5 border-b border-[#1A1A1A]">
          <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
            Notifications
          </h4>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <span
                className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: 'rgba(74,158,255,0.14)',
                  color: '#4a9eff',
                }}
                aria-label={`${unreadCount} unread`}
              >
                {unreadCount > 99 ? '99+' : unreadCount} new
              </span>
            )}
            <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
              {items.length}
            </div>
          </div>
        </div>

        {/* Content */}
        <div
          className="p-1.5 overflow-y-auto"
          style={{ maxHeight: isMobile ? '60vh' : '420px' }}
        >
          {isLoading && items.length === 0 ? (
            <div className="px-2.5 py-8 text-center">
              <div className="inline-block w-4 h-4 border-2 border-[#222222] border-t-[#808080] rounded-full animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <div className="px-2.5 py-8 text-center">
              <div className="text-[11px] font-medium text-white">No notifications yet</div>
              <div className="text-[10px] text-[#606060] mt-1 leading-snug">
                Platform updates, releases, and incident notices will land here.
              </div>
            </div>
          ) : (
            <div className="space-y-0.5">
              {items.map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  onMarkRead={markRead}
                  onCtaClick={handleCtaClick}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer row — matches FooterSupportPopup's "Support center" CTA shape. */}
        <div className="p-1.5 border-t border-[#1A1A1A]">
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={() => markAllRead()}
              className="w-full flex items-center justify-center gap-1.5 p-2 rounded-md text-[11px] font-medium text-[#808080] hover:text-white bg-[#0F0F0F] hover:bg-[#1A1A1A] border border-[#222222] hover:border-[#333333] transition-all duration-200"
            >
              Mark all as read
              <svg
                className="w-3 h-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </button>
          ) : (
            <div className="w-full flex items-center justify-center gap-1.5 p-2 rounded-md text-[11px] font-medium text-[#606060]">
              You&apos;re all caught up
            </div>
          )}
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
