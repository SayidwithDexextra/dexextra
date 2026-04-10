'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { useWallet } from '@/hooks/useWallet'
import {
  type AnalyticsPrivacySettings,
  DEFAULT_ANALYTICS_PRIVACY,
} from '@/types/userProfile'

interface UseAnalyticsPrivacyOptions {
  targetWallet?: string
}

interface UseAnalyticsPrivacyResult {
  privacySettings: AnalyticsPrivacySettings
  hideValues: boolean
  isPublicView: boolean
  isSelf: boolean
  isHiddenFromPublic: boolean
  updatePrivacySetting: <K extends keyof AnalyticsPrivacySettings>(
    key: K,
    value: AnalyticsPrivacySettings[K]
  ) => Promise<void>
  toggleHideValues: () => void
  isLoading: boolean
  isSaving: boolean
  error: string | null
}

export function useAnalyticsPrivacy(
  options: UseAnalyticsPrivacyOptions = {}
): UseAnalyticsPrivacyResult {
  const { targetWallet } = options
  const { walletData } = useWallet() as any
  const currentWallet = walletData?.address

  const [privacySettings, setPrivacySettings] = useState<AnalyticsPrivacySettings>(
    DEFAULT_ANALYTICS_PRIVACY
  )
  const [hideValues, setHideValues] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isSelf = useMemo(() => {
    if (!currentWallet || !targetWallet) return !targetWallet
    return currentWallet.toLowerCase() === targetWallet.toLowerCase()
  }, [currentWallet, targetWallet])

  const isPublicView = Boolean(targetWallet && !isSelf)

  const isHiddenFromPublic = useMemo(() => {
    return isPublicView && privacySettings.hide_from_public
  }, [isPublicView, privacySettings.hide_from_public])

  useEffect(() => {
    const fetchPrivacySettings = async () => {
      const wallet = targetWallet || currentWallet
      if (!wallet) {
        setIsLoading(false)
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/profile?wallet=${encodeURIComponent(wallet)}`)
        const data = await response.json()

        if (data.success && data.data?.analytics_privacy) {
          setPrivacySettings({
            ...DEFAULT_ANALYTICS_PRIVACY,
            ...data.data.analytics_privacy,
          })
          if (!isPublicView && data.data.analytics_privacy.hide_portfolio_value) {
            setHideValues(true)
          }
        } else {
          setPrivacySettings(DEFAULT_ANALYTICS_PRIVACY)
        }
      } catch (err) {
        console.error('[useAnalyticsPrivacy] Failed to fetch settings:', err)
        setError('Failed to load privacy settings')
      } finally {
        setIsLoading(false)
      }
    }

    void fetchPrivacySettings()
  }, [targetWallet, currentWallet, isPublicView])

  const updatePrivacySetting = useCallback(
    async <K extends keyof AnalyticsPrivacySettings>(
      key: K,
      value: AnalyticsPrivacySettings[K]
    ) => {
      if (!currentWallet || !isSelf) {
        setError('Cannot update privacy settings for another user')
        return
      }

      const newSettings = {
        ...privacySettings,
        [key]: value,
      }

      setPrivacySettings(newSettings)
      setIsSaving(true)
      setError(null)

      try {
        const response = await fetch('/api/profile', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wallet_address: currentWallet,
            analytics_privacy: newSettings,
          }),
        })

        const data = await response.json()
        if (!data.success) {
          throw new Error(data.error || 'Failed to update privacy settings')
        }
      } catch (err) {
        console.error('[useAnalyticsPrivacy] Failed to save settings:', err)
        setError(err instanceof Error ? err.message : 'Failed to save settings')
        setPrivacySettings(privacySettings)
      } finally {
        setIsSaving(false)
      }
    },
    [currentWallet, isSelf, privacySettings]
  )

  const toggleHideValues = useCallback(() => {
    setHideValues((prev) => !prev)
  }, [])

  return {
    privacySettings,
    hideValues,
    isPublicView,
    isSelf,
    isHiddenFromPublic,
    updatePrivacySetting,
    toggleHideValues,
    isLoading,
    isSaving,
    error,
  }
}

export function maskValue(value: string | number, hide: boolean): string {
  if (!hide) {
    return typeof value === 'number' ? String(value) : value
  }
  return '••••••'
}

export function maskCurrency(
  value: number,
  hide: boolean,
  formatter?: (v: number) => string
): string {
  if (!hide) {
    return formatter ? formatter(value) : `$${value.toLocaleString()}`
  }
  return '$••••••'
}
