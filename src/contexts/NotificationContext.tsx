'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useWallet } from '@/hooks/useWallet'
import { getSupabaseClient } from '@/lib/supabase-browser'
import { getPusherClient } from '@/lib/pusher-client'

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'critical'
export type NotificationKind = 'announcement' | 'maintenance' | 'release' | 'incident'

export interface NotificationItem {
  id: string
  kind: NotificationKind
  severity: NotificationSeverity
  title: string
  body: string
  cta_label: string | null
  cta_href: string | null
  audience: Record<string, unknown>
  published_at: string
  expires_at: string | null
  created_by: string
  created_at: string
  is_read: boolean
}

interface NotificationContextValue {
  items: NotificationItem[]
  unreadCount: number
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  refresh: () => Promise<void>
  isLoading: boolean
}

const NotificationContext = createContext<NotificationContextValue | null>(null)

const FEED_ENDPOINT = '/api/notifications'
const READ_ENDPOINT = '/api/notifications/read'
const MAX_ITEMS = 50

function dedupeAndSort(items: NotificationItem[]): NotificationItem[] {
  const byId = new Map<string, NotificationItem>()
  for (const it of items) {
    const existing = byId.get(it.id)
    // If we already have this row, keep whichever has the more permissive
    // `is_read` flag (true wins) so a later mark-read can't get clobbered by
    // a stale realtime echo from the INSERT.
    if (!existing) {
      byId.set(it.id, it)
    } else {
      byId.set(it.id, { ...it, is_read: existing.is_read || it.is_read })
    }
  }
  return Array.from(byId.values())
    .sort((a, b) => b.published_at.localeCompare(a.published_at))
    .slice(0, MAX_ITEMS)
}

function notExpired(n: NotificationItem): boolean {
  if (!n.expires_at) return true
  const t = Date.parse(n.expires_at)
  if (!Number.isFinite(t)) return true
  return t > Date.now()
}

interface NotificationProviderProps {
  children: ReactNode
}

export function NotificationProvider({ children }: NotificationProviderProps) {
  const { walletData } = useWallet()
  const wallet = (walletData.address || '').toLowerCase()

  const [items, setItems] = useState<NotificationItem[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  // Keep latest items in a ref so realtime handlers added once at mount don't
  // close over stale state.
  const itemsRef = useRef<NotificationItem[]>([])
  itemsRef.current = items

  const refresh = useCallback(async () => {
    try {
      const url = new URL(FEED_ENDPOINT, window.location.origin)
      if (wallet) url.searchParams.set('wallet', wallet)
      const res = await fetch(url.toString(), { cache: 'no-store' })
      if (!res.ok) throw new Error(`feed status ${res.status}`)
      const json = (await res.json()) as { items?: NotificationItem[] }
      const incoming = Array.isArray(json.items) ? json.items : []
      setItems(dedupeAndSort(incoming.filter(notExpired)))
    } catch (e) {
      console.warn('[notifications] refresh failed:', e)
    } finally {
      setIsLoading(false)
    }
  }, [wallet])

  // Initial fetch + refetch when the wallet identity changes (so unread state
  // reflects the new user immediately).
  useEffect(() => {
    setIsLoading(true)
    refresh()
  }, [refresh])

  // Pusher: instant delivery on `platform-notifications` (public channel).
  useEffect(() => {
    if (typeof window === 'undefined') return
    let unsubscribe: (() => void) | null = null
    try {
      const pusher = getPusherClient()
      unsubscribe = pusher.subscribeToChannel('platform-notifications', {
        new: (data: unknown) => {
          if (!data || typeof data !== 'object') return
          const incoming = data as NotificationItem
          if (!incoming.id || !incoming.title || !incoming.published_at) return
          if (!notExpired(incoming)) return
          setItems((prev) =>
            dedupeAndSort([
              { ...incoming, is_read: false },
              ...prev,
            ]),
          )
        },
      })
    } catch (e) {
      // Pusher init can throw if NEXT_PUBLIC_PUSHER_KEY isn't set locally —
      // not fatal because Supabase Realtime is the durable backstop.
      console.warn('[notifications] pusher subscribe failed:', e)
    }
    return () => {
      try {
        unsubscribe?.()
      } catch {
        // ignore
      }
    }
  }, [])

  // Supabase Realtime: durable fan-out via postgres_changes on
  // public.notifications. Same pattern ComingSoonOverlay uses for site_settings.
  useEffect(() => {
    if (typeof window === 'undefined') return
    let supabase: ReturnType<typeof getSupabaseClient> | null = null
    try {
      supabase = getSupabaseClient()
    } catch (e) {
      console.warn('[notifications] supabase init failed:', e)
      return
    }
    if (!supabase) return

    const channel = supabase
      .channel('platform-notifications-feed')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        (payload) => {
          const row = (payload?.new as NotificationItem | undefined) ?? null
          if (!row || !row.id) return
          if (!notExpired(row)) return
          setItems((prev) =>
            dedupeAndSort([
              { ...row, is_read: false },
              ...prev,
            ]),
          )
        },
      )
      .subscribe()

    return () => {
      try {
        supabase?.removeChannel(channel)
      } catch {
        // ignore
      }
    }
  }, [])

  // Refresh on visibility change — catches notifications that were missed
  // while the tab was backgrounded and ensures expired ones drop off.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [refresh])

  const unreadCount = useMemo(
    () => items.reduce((acc, n) => (n.is_read ? acc : acc + 1), 0),
    [items],
  )

  const markRead = useCallback(
    async (id: string) => {
      if (!wallet) {
        // Anon users: optimistic local-only mark. We don't persist because
        // there's no stable identity to key on yet.
        setItems((prev) =>
          prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
        )
        return
      }
      // Optimistic update first so the UI feels instant.
      setItems((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
      )
      try {
        const res = await fetch(READ_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet, ids: [id] }),
        })
        if (!res.ok) throw new Error(`status ${res.status}`)
      } catch (e) {
        console.warn('[notifications] markRead failed:', e)
        // Rollback so the badge count stays accurate.
        setItems((prev) =>
          prev.map((n) => (n.id === id ? { ...n, is_read: false } : n)),
        )
      }
    },
    [wallet],
  )

  const markAllRead = useCallback(async () => {
    if (!wallet) {
      setItems((prev) => prev.map((n) => ({ ...n, is_read: true })))
      return
    }
    const previous = itemsRef.current
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })))
    try {
      const res = await fetch(READ_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet, all: true }),
      })
      if (!res.ok) throw new Error(`status ${res.status}`)
    } catch (e) {
      console.warn('[notifications] markAllRead failed:', e)
      // Restore exact prior state on failure so the badge doesn't lie.
      setItems(previous)
    }
  }, [wallet])

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])
  const toggle = useCallback(() => setIsOpen((v) => !v), [])

  const value = useMemo<NotificationContextValue>(
    () => ({
      items,
      unreadCount,
      isOpen,
      open,
      close,
      toggle,
      markRead,
      markAllRead,
      refresh,
      isLoading,
    }),
    [items, unreadCount, isOpen, open, close, toggle, markRead, markAllRead, refresh, isLoading],
  )

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  )
}

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext)
  if (!ctx) {
    // Soft fallback so a missing provider doesn't crash the header — just
    // disables the bell quietly.
    return {
      items: [],
      unreadCount: 0,
      isOpen: false,
      open: () => {},
      close: () => {},
      toggle: () => {},
      markRead: async () => {},
      markAllRead: async () => {},
      refresh: async () => {},
      isLoading: false,
    }
  }
  return ctx
}
