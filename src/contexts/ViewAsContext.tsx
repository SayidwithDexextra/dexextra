'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useWallet } from '@/hooks/useWallet'
import { ProfileApi } from '@/lib/profileApi'
import { DEFAULT_PROFILE_IMAGE } from '@/types/userProfile'

const ADDRESS_STORAGE_KEY = 'dexetera:view-as:address'
const MODAL_STORAGE_KEY = 'dexetera:view-as:modal'
const AVATAR_STORAGE_KEY = 'dexetera:view-as:avatar'

export type ViewAsModalState = 'open' | 'minimized'

export type ViewAsContextValue = {
  connectedAddress: string | null
  viewAddress: string | null
  dataAddress: string | null
  isViewingAs: boolean
  canMutate: boolean
  demoAddress: string | null
  demoName: string | null
  demoAvatarUrl: string | null
  modalState: ViewAsModalState
  isHydrated: boolean
  enterDemoView: () => void
  exitViewAs: () => void
  dismissModal: () => void
  reopenModal: () => void
}

const ViewAsContext = createContext<ViewAsContextValue | undefined>(undefined)

function normalizeAddress(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return null
  return trimmed
}

function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return a.toLowerCase() === b.toLowerCase()
}

function readDemoAddress(): string | null {
  return normalizeAddress(process.env.NEXT_PUBLIC_DEMO_VIEW_ADDRESS)
}

function readDemoName(): string | null {
  const name = String(process.env.NEXT_PUBLIC_DEMO_VIEW_NAME || '').trim()
  return name || null
}

function persistAddress(address: string | null) {
  if (typeof window === 'undefined') return
  try {
    if (address) {
      window.localStorage.setItem(ADDRESS_STORAGE_KEY, address)
    } else {
      window.localStorage.removeItem(ADDRESS_STORAGE_KEY)
    }
  } catch {
    // ignore quota / private-mode failures
  }
}

function isUsableAvatar(url: string | null | undefined): url is string {
  if (!url) return false
  if (url === DEFAULT_PROFILE_IMAGE) return false
  return true
}

function readCachedAvatar(address: string | null): string | null {
  if (typeof window === 'undefined' || !address) return null
  try {
    const raw = window.localStorage.getItem(AVATAR_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { address?: string; url?: string }
    if (!parsed?.url || !sameAddress(parsed.address, address)) return null
    return isUsableAvatar(parsed.url) ? parsed.url : null
  } catch {
    return null
  }
}

function persistAvatar(address: string, url: string) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(AVATAR_STORAGE_KEY, JSON.stringify({ address, url }))
  } catch {
    // ignore
  }
}

function preloadAvatar(url: string) {
  if (typeof window === 'undefined') return
  const img = new window.Image()
  img.decoding = 'async'
  img.src = url
}

if (typeof window !== 'undefined') {
  const eagerAddress = readDemoAddress()
  const eagerCached = readCachedAvatar(eagerAddress)
  if (eagerCached) {
    preloadAvatar(eagerCached)
  } else if (eagerAddress) {
    ProfileApi.getProfile(eagerAddress)
      .then((profile) => {
        if (!isUsableAvatar(profile?.profile_image_url)) return
        persistAvatar(eagerAddress, profile.profile_image_url)
        preloadAvatar(profile.profile_image_url)
      })
      .catch(() => {})
  }
}

function persistModal(state: ViewAsModalState) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(MODAL_STORAGE_KEY, state)
  } catch {
    // ignore
  }
}

export function ViewAsProvider({ children }: { children: ReactNode }) {
  const { walletData } = useWallet()
  const connectedAddress = walletData?.address || null

  const demoAddress = useMemo(() => readDemoAddress(), [])
  const demoName = useMemo(() => readDemoName(), [])

  const [viewAddress, setViewAddress] = useState<string | null>(null)
  const [modalState, setModalState] = useState<ViewAsModalState>('minimized')
  const [isHydrated, setIsHydrated] = useState(false)
  const [demoAvatarUrl, setDemoAvatarUrl] = useState<string | null>(null)

  useEffect(() => {
    const storedAddress = normalizeAddress(
      typeof window !== 'undefined' ? window.localStorage.getItem(ADDRESS_STORAGE_KEY) : null
    )
    const storedModal = typeof window !== 'undefined' ? window.localStorage.getItem(MODAL_STORAGE_KEY) : null

    if (storedAddress && demoAddress && sameAddress(storedAddress, demoAddress)) {
      setViewAddress(storedAddress)
    } else if (storedAddress && !demoAddress) {
      persistAddress(null)
    }

    if (storedModal === 'minimized' || storedModal === 'open') {
      setModalState(storedModal)
    } else if (demoAddress) {
      setModalState('open')
    }

    const cachedAvatar = readCachedAvatar(demoAddress)
    if (cachedAvatar) {
      setDemoAvatarUrl(cachedAvatar)
      preloadAvatar(cachedAvatar)
    }

    setIsHydrated(true)
  }, [demoAddress])

  useEffect(() => {
    if (!demoAddress) return
    let cancelled = false
    ProfileApi.getProfile(demoAddress)
      .then((profile) => {
        if (cancelled || !profile) return
        if (isUsableAvatar(profile.profile_image_url)) {
          persistAvatar(demoAddress, profile.profile_image_url)
          preloadAvatar(profile.profile_image_url)
          setDemoAvatarUrl(profile.profile_image_url)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [demoAddress])

  const enterDemoView = useCallback(() => {
    if (!demoAddress) return
    setViewAddress(demoAddress)
    persistAddress(demoAddress)
    setModalState('minimized')
    persistModal('minimized')
  }, [demoAddress])

  const exitViewAs = useCallback(() => {
    setViewAddress(null)
    persistAddress(null)
    setModalState('minimized')
    persistModal('minimized')
  }, [])

  const dismissModal = useCallback(() => {
    setModalState('minimized')
    persistModal('minimized')
  }, [])

  const reopenModal = useCallback(() => {
    if (!demoAddress) return
    setModalState('open')
    persistModal('open')
  }, [demoAddress])

  const isViewingAs = Boolean(viewAddress && !sameAddress(viewAddress, connectedAddress))
  const dataAddress = viewAddress || connectedAddress
  const canMutate = !isViewingAs

  const value = useMemo<ViewAsContextValue>(
    () => ({
      connectedAddress,
      viewAddress,
      dataAddress,
      isViewingAs,
      canMutate,
      demoAddress,
      demoName,
      demoAvatarUrl,
      modalState,
      isHydrated,
      enterDemoView,
      exitViewAs,
      dismissModal,
      reopenModal,
    }),
    [
      connectedAddress,
      viewAddress,
      dataAddress,
      isViewingAs,
      canMutate,
      demoAddress,
      demoName,
      demoAvatarUrl,
      modalState,
      isHydrated,
      enterDemoView,
      exitViewAs,
      dismissModal,
      reopenModal,
    ]
  )

  return <ViewAsContext.Provider value={value}>{children}</ViewAsContext.Provider>
}

export function formatViewAsLabel(demoName: string | null, viewAddress: string | null): string {
  if (demoName) return `Viewing as ${demoName}`
  if (viewAddress) return `Viewing as ${viewAddress.slice(0, 6)}...${viewAddress.slice(-4)}`
  return 'Viewing as demo user'
}

export function useViewAs(): ViewAsContextValue {
  const context = useContext(ViewAsContext)
  if (context === undefined) {
    throw new Error('useViewAs must be used within a ViewAsProvider')
  }
  return context
}

/** Chrome avatar: demo user's photo while viewing as, otherwise the connected profile. */
export function useChromeAvatar(ownAvatar?: string | null): string {
  const { isViewingAs, demoAvatarUrl } = useViewAs()
  if (isViewingAs && demoAvatarUrl) return demoAvatarUrl
  return ownAvatar || DEFAULT_PROFILE_IMAGE
}
