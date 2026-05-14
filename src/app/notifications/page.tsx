'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  useNotifications,
  type NotificationItem,
  type NotificationSeverity,
} from '@/contexts/NotificationContext'

type FilterId = 'all' | 'unread' | NotificationSeverity

interface FilterChip {
  id: FilterId
  label: string
}

const FILTERS: FilterChip[] = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'info', label: 'Updates' },
  { id: 'success', label: 'Wins' },
  { id: 'warning', label: 'Heads-up' },
  { id: 'critical', label: 'Critical' },
]

interface SeverityTheme {
  // Tailwind semantic palette — keeps the page on the platform's color
  // contract (no bespoke purples/cyans). Hex values match Tailwind's
  // `*-400` shade so the dot/bar/CTA pick up the same accent the rest of
  // the chrome uses for active/loading/warning/error states.
  color: string
  label: string
}

const SEVERITY_THEME: Record<NotificationSeverity, SeverityTheme> = {
  info: { color: '#60a5fa', label: 'Update' }, // blue-400
  success: { color: '#4ade80', label: 'Live' }, // green-400
  warning: { color: '#facc15', label: 'Heads-up' }, // yellow-400
  critical: { color: '#f87171', label: 'Critical' }, // red-400
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

function formatAbsolute(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  try {
    return new Date(t).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return new Date(t).toISOString()
  }
}

function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href)
}

interface RowProps {
  item: NotificationItem
  onMarkRead: (id: string) => void
}

function NotificationCard({ item, onMarkRead }: RowProps) {
  const theme = SEVERITY_THEME[item.severity] ?? SEVERITY_THEME.info
  const hasCta = Boolean(item.cta_href)
  const ctaLabel = item.cta_label || (hasCta ? 'Open' : null)

  return (
    <article
      className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 overflow-hidden flex"
    >
      {/* Severity stripe — 2px accent on the left edge. Stays full when
          unread, dims to 20% once read. The stripe is the only place we
          use the severity color directly so the card silhouette matches
          the rest of the platform regardless of severity. */}
      <div
        className="w-[2px] flex-shrink-0 transition-opacity duration-200"
        style={{
          backgroundColor: theme.color,
          opacity: item.is_read ? 0.2 : 1,
        }}
        aria-hidden="true"
      />

      <div className="flex-1 min-w-0 p-4">
        {/* Meta row */}
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span
            className="inline-flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-wider"
            style={{ color: theme.color }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: theme.color }}
              aria-hidden="true"
            />
            {theme.label}
          </span>
          <span
            className="text-[10px] text-[#606060] font-mono"
            title={formatAbsolute(item.published_at)}
          >
            {formatRelative(item.published_at)}
          </span>
          {!item.is_read && (
            <span className="text-[9px] font-medium uppercase tracking-wider text-blue-400 bg-blue-400/10 px-1.5 py-[1px] rounded">
              New
            </span>
          )}
          {item.kind !== 'announcement' && (
            <span className="text-[9px] uppercase tracking-wider text-[#606060]">
              · {item.kind}
            </span>
          )}
        </div>

        {/* Title */}
        <h2
          className={[
            'text-[13px] font-medium leading-snug',
            item.is_read ? 'text-[#9CA3AF]' : 'text-white',
          ].join(' ')}
        >
          {item.title}
        </h2>

        {/* Body */}
        <p className="text-[11px] text-[#808080] leading-relaxed mt-1.5 whitespace-pre-wrap">
          {item.body}
        </p>

        {/* Footer: CTA + mark-as-read */}
        {(hasCta || !item.is_read) && (
          <div className="flex items-center gap-3 flex-wrap mt-3">
            {hasCta && item.cta_href ? (
              isExternalHref(item.cta_href) ? (
                <a
                  href={item.cta_href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    if (!item.is_read) onMarkRead(item.id)
                  }}
                  className="inline-flex items-center gap-1.5 bg-[#1A1A1A] hover:bg-[#2A2A2A] py-1.5 px-3 rounded-md text-[10px] font-medium transition-all duration-200 border border-[#222222] hover:border-[#333333]"
                  style={{ color: theme.color }}
                >
                  {ctaLabel}
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
                      d="M7 17L17 7M17 7H9M17 7V15"
                    />
                  </svg>
                </a>
              ) : (
                <Link
                  href={item.cta_href}
                  onClick={() => {
                    if (!item.is_read) onMarkRead(item.id)
                  }}
                  className="inline-flex items-center gap-1.5 bg-[#1A1A1A] hover:bg-[#2A2A2A] py-1.5 px-3 rounded-md text-[10px] font-medium transition-all duration-200 border border-[#222222] hover:border-[#333333]"
                  style={{ color: theme.color }}
                >
                  {ctaLabel}
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
              )
            ) : null}

            {!item.is_read && (
              <button
                type="button"
                onClick={() => onMarkRead(item.id)}
                className="text-[10px] text-[#606060] hover:text-white transition-colors duration-150"
              >
                Mark as read
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  )
}

function SkeletonCard() {
  return (
    <div
      className="bg-[#0F0F0F] rounded-md border border-[#222222] overflow-hidden flex"
      aria-hidden="true"
    >
      <div className="w-[2px] flex-shrink-0 bg-[#222222]" />
      <div className="flex-1 p-4 space-y-2">
        <div className="h-2 w-24 bg-[#1A1A1A] rounded animate-pulse" />
        <div className="h-3 w-2/3 bg-[#1A1A1A] rounded animate-pulse" />
        <div className="h-2 w-full bg-[#1A1A1A] rounded animate-pulse" />
        <div className="h-2 w-4/5 bg-[#1A1A1A] rounded animate-pulse" />
      </div>
    </div>
  )
}

interface EmptyStateProps {
  filter: FilterId
}

function EmptyState({ filter }: EmptyStateProps) {
  const title =
    filter === 'all'
      ? 'No notifications yet'
      : filter === 'unread'
        ? 'No unread notifications'
        : `No ${filter} notifications`
  const detail =
    filter === 'all'
      ? 'Platform-wide announcements, releases, and incident notices appear here in real time.'
      : 'Try switching filters to see other categories.'

  return (
    <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
      <div className="flex items-center justify-between p-2.5">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="text-[11px] font-medium text-[#808080]">
              {title}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <svg
            className="w-3 h-3 text-[#404040]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
            />
          </svg>
        </div>
      </div>
      <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
        <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
          <div className="text-[9px] pt-1.5">
            <span className="text-[#606060]">{detail}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function NotificationsPage() {
  const { items, unreadCount, markRead, markAllRead, refresh, isLoading } =
    useNotifications()
  const [filter, setFilter] = useState<FilterId>('all')

  // Refresh once on mount so a hard-load of /notifications never lags
  // behind the realtime cache the provider already keeps in memory.
  useEffect(() => {
    refresh().catch(() => {
      // Provider already logs + degrades gracefully on its own.
    })
  }, [refresh])

  const filtered = useMemo<NotificationItem[]>(() => {
    if (filter === 'all') return items
    if (filter === 'unread') return items.filter((n) => !n.is_read)
    return items.filter((n) => n.severity === filter)
  }, [items, filter])

  const counts = useMemo(() => {
    return {
      all: items.length,
      unread: unreadCount,
      info: items.filter((n) => n.severity === 'info').length,
      success: items.filter((n) => n.severity === 'success').length,
      warning: items.filter((n) => n.severity === 'warning').length,
      critical: items.filter((n) => n.severity === 'critical').length,
    } as Record<FilterId, number>
  }, [items, unreadCount])

  const showSkeletons = isLoading && items.length === 0

  return (
    <main className="min-h-screen bg-black text-white px-5 py-10 sm:py-14">
      <div className="mx-auto max-w-[900px]">
        {/* Title — matches the /support page exactly: centered, small,
            uppercase, [#9CA3AF]. Nothing more, nothing less. */}
        <h1 className="text-center text-sm font-medium text-[#9CA3AF] uppercase tracking-wide mb-8">
          Notifications
        </h1>

        {/* Filter chips + mark-all-read on the same row, design-system styling */}
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div
            className="flex items-center gap-1.5 overflow-x-auto"
            role="tablist"
            aria-label="Notification filters"
            style={{ scrollbarWidth: 'none' }}
          >
            {FILTERS.map((f) => {
              const isActive = f.id === filter
              const count = counts[f.id] ?? 0
              return (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setFilter(f.id)}
                  className={[
                    'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium uppercase tracking-wider transition-all duration-200 border whitespace-nowrap flex-shrink-0',
                    isActive
                      ? 'bg-[#1A1A1A] text-white border-[#333333]'
                      : 'bg-[#0F0F0F] text-[#808080] hover:text-white border-[#222222] hover:border-[#333333]',
                  ].join(' ')}
                >
                  {f.label}
                  {count > 0 && (
                    <span
                      className={[
                        'text-[9px] font-mono px-1.5 py-0.5 rounded',
                        isActive
                          ? 'bg-[#0F0F0F] text-[#9CA3AF]'
                          : 'bg-[#1A1A1A] text-[#606060]',
                      ].join(' ')}
                    >
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={() => markAllRead()}
              className="inline-flex items-center gap-1.5 bg-[#1A1A1A] hover:bg-[#2A2A2A] text-white py-1.5 px-3 rounded-md text-[10px] font-medium uppercase tracking-wider transition-all duration-200 border border-[#222222] hover:border-[#333333] flex-shrink-0"
            >
              <svg
                className="w-3 h-3 text-green-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
              Mark all read
              <span className="text-[9px] font-mono text-[#606060] bg-[#0F0F0F] px-1.5 py-0.5 rounded">
                {unreadCount}
              </span>
            </button>
          ) : (
            <div className="inline-flex items-center gap-2 bg-[#0F0F0F] border border-[#222222] py-1.5 px-3 rounded-md flex-shrink-0">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
              <span className="text-[10px] font-medium text-[#808080] uppercase tracking-wider">
                All caught up
              </span>
            </div>
          )}
        </div>

        {/* List */}
        {showSkeletons ? (
          <div className="space-y-2">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState filter={filter} />
        ) : (
          <div className="space-y-2">
            {filtered.map((item) => (
              <NotificationCard
                key={item.id}
                item={item}
                onMarkRead={markRead}
              />
            ))}
          </div>
        )}

        {/* Live footer hint — standard design-system status dot + uppercase microcopy. */}
        <div className="flex items-center justify-center gap-1.5 mt-6">
          <div
            className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse flex-shrink-0"
            aria-hidden="true"
          />
          <span className="text-[9px] uppercase tracking-wider text-[#404040]">
            Live · New notifications arrive instantly
          </span>
        </div>
      </div>
    </main>
  )
}
