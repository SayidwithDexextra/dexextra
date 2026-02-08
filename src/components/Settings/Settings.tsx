'use client'

import React, { useMemo, useRef, useState, useEffect } from 'react'
import Image from 'next/image'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ethers } from 'ethers'
import { useWallet } from '@/hooks/useWallet'
import { ProfileApi } from '@/lib/profileApi'
import { formDataToUserProfile, userProfileToFormData } from '@/types/userProfile'
import FuturesMarketFactoryAbi from '@/lib/abis/FuturesMarketFactory.json'
import ActionStatusModal from '@/components/watchlist/ActionStatusModal'

export interface SettingsProps {
  className?: string
}

export default function Settings({ className }: SettingsProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { walletData, refreshProfile } = useWallet()
  const [uiStatusModal, setUiStatusModal] = useState<{
    isOpen: boolean
    tone: 'warning' | 'success' | 'error' | 'info'
    title: string
    description?: string | null
  }>({ isOpen: false, tone: 'info', title: '', description: null })
  const [formData, setFormData] = useState({
    username: '',
    name: '',
    bio: '',
    email: '',
    website: '',
    twitter: '',
    discord: '',
    instagram: '',
    youtube: '',
    facebook: ''
  })

  const [profileImage, setProfileImage] = useState<string | null>(null)
  const [bannerImage, setBannerImage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')

  // Load user profile data when wallet connects or component mounts
  useEffect(() => {
    if (walletData.userProfile) {
      // Convert profile data to form data (includes saved email)
      setFormData(userProfileToFormData(walletData.userProfile))
      setProfileImage(walletData.userProfile.profile_image_url || null)
      setBannerImage(walletData.userProfile.banner_image_url || null)
    } else if (walletData.isConnected && walletData.address) {
      // If wallet is connected but no profile data, try to refresh it
      refreshProfile()
    }
  }, [walletData.userProfile, walletData.isConnected, walletData.address, refreshProfile])

  // Validate username as user types
  const validateUsername = (username: string): string | null => {
    if (!username) return null // Allow empty username
    
    const usernameRegex = /^[a-zA-Z0-9_-]{3,30}$/
    if (!usernameRegex.test(username)) {
      return 'Username must be 3-30 characters long and can only contain letters, numbers, underscores, and hyphens'
    }
    if (username.startsWith('0x')) {
      return 'Username cannot start with 0x'
    }
    return null
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
    
    // Validate username on change
    if (name === 'username') {
      setUsernameError(validateUsername(value))
    }
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'profile' | 'banner' = 'profile') => {
    const file = e.target.files?.[0]
    if (!file || !walletData.address) {
      return
    }

    // Validate file immediately
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      setUiStatusModal({
        isOpen: true,
        tone: 'error',
        title: 'Invalid file type',
        description: 'Please select a JPEG, PNG, GIF, or WebP image.',
      })
      return
    }

    const maxSize = 10 * 1024 * 1024 // 10MB
    if (file.size > maxSize) {
      setUiStatusModal({
        isOpen: true,
        tone: 'error',
        title: 'File too large',
        description: 'Please select an image smaller than 10MB.',
      })
      return
    }

    setIsLoading(true)
    
    try {
      // Show preview immediately using FileReader
      const reader = new FileReader()
      reader.onload = (e) => {
        const imageUrl = e.target?.result as string
        if (type === 'profile') {
          setProfileImage(imageUrl)
        } else {
          setBannerImage(imageUrl)
        }
      }
      reader.readAsDataURL(file)

      // Upload to server
      const result = await ProfileApi.uploadImage(walletData.address, file, type)
      
      // Update with actual uploaded URL
      if (type === 'profile') {
        setProfileImage(result.imageUrl)
      } else {
        setBannerImage(result.imageUrl)
      }

      // Refresh profile data
      await refreshProfile()
      
       console.log(`${type} image uploaded successfully:`, result.imageUrl)
    } catch (error) {
      console.error('Error uploading image:', error)
      setUiStatusModal({
        isOpen: true,
        tone: 'error',
        title: `Failed to upload ${type} image`,
        description: 'Please try again.',
      })
      
      // Reset to previous state on error
      if (type === 'profile') {
        setProfileImage(walletData.userProfile?.profile_image_url || null)
      } else {
        setBannerImage(walletData.userProfile?.banner_image_url || null)
      }
    } finally {
      setIsLoading(false)
      // Clear the input so the same file can be selected again
      e.target.value = ''
    }
  }

  const handleRemoveImage = async (type: 'profile' | 'banner' = 'profile') => {
    if (!walletData.address) {
      return
    }

    setIsLoading(true)
    
    try {
      await ProfileApi.removeImage(walletData.address, type)
      
      // Update UI
      if (type === 'profile') {
        setProfileImage(null)
      } else {
        setBannerImage(null)
      }

      // Refresh profile data
      await refreshProfile()
      
       console.log(`${type} image removed successfully`)
    } catch (error) {
      console.error('Error removing image:', error)
      setUiStatusModal({
        isOpen: true,
        tone: 'error',
        title: `Failed to remove ${type} image`,
        description: 'Please try again.',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [usernameError, setUsernameError] = useState<string | null>(null)

  const walletAddress: string | null = walletData?.address || null
  const isWalletConnected = Boolean(walletData?.isConnected && walletAddress)
  const profileLabel: string = String(
    walletData?.userProfile?.display_name ||
      walletData?.userProfile?.username ||
      (walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : 'Guest')
  )
  const profileInitial = (profileLabel.trim().slice(0, 1) || 'D').toUpperCase()
  const shortAddress = walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : 'Connect wallet'

  type SettingsTabId = 'profile' | 'links' | 'notifications' | 'markets' | 'preferences'
  const tabs = useMemo(
    () =>
      [
        { id: 'profile' as const, label: 'Profile' },
        { id: 'links' as const, label: 'Links' },
        { id: 'notifications' as const, label: 'Notifications' },
        { id: 'markets' as const, label: 'My Markets' },
        { id: 'preferences' as const, label: 'Preferences' },
      ] satisfies Array<{ id: SettingsTabId; label: string }>,
    []
  )

  const tabParamRaw = String(searchParams?.get('tab') || '').toLowerCase().trim()
  const tabParam = tabs.find((t) => t.id === (tabParamRaw as any))?.id || null
  const [activeTab, setActiveTab] = useState<SettingsTabId>(tabParam || 'profile')
  useEffect(() => {
    if (tabParam) setActiveTab(tabParam)
  }, [tabParam])

  type MyMarketRow = {
    id: string
    market_identifier?: string | null
    symbol?: string | null
    name?: string | null
    icon_image_url?: string | null
    banner_image_url?: string | null
    market_address?: string | null
    market_id_bytes32?: string | null
    created_at?: string | null
    settlement_date?: string | null
    market_status?: string | null
    deployment_status?: string | null
    creator_wallet_address?: string | null
  }

  const creatorOverrideRaw = String(searchParams?.get('creator') || '').trim()
  const creatorOverride =
    creatorOverrideRaw && creatorOverrideRaw.startsWith('0x') && creatorOverrideRaw.length === 42 ? creatorOverrideRaw : null
  const marketsCreator = creatorOverride || walletAddress

  const [myMarkets, setMyMarkets] = useState<MyMarketRow[]>([])
  const [myMarketsLoading, setMyMarketsLoading] = useState(false)
  const [myMarketsError, setMyMarketsError] = useState<string | null>(null)
  const [myMarketsSearch, setMyMarketsSearch] = useState('')
  const fetchedForCreatorRef = useRef<string | null>(null)

  type BondEligibility = {
    loaded: boolean
    loading: boolean
    error?: string | null
    bondManager?: string | null
    bond?: {
      creator: string
      refundableAmount6: bigint
      refunded: boolean
    } | null
    activity?: {
      totalTrades?: bigint | null
      buyOrders?: bigint | null
      sellOrders?: bigint | null
      totalMarginLocked6?: bigint | null
    } | null
    eligible?: boolean
    ineligibleReason?: string | null
    lastTxHash?: string | null
  }

  const [bondManagerAddress, setBondManagerAddress] = useState<string | null>(null)
  const [bondManagerError, setBondManagerError] = useState<string | null>(null)
  const [bondByMarketDbId, setBondByMarketDbId] = useState<Record<string, BondEligibility>>({})
  const [bondExpandedMarketDbId, setBondExpandedMarketDbId] = useState<string | null>(null)
  const [refundConfirmMarket, setRefundConfirmMarket] = useState<MyMarketRow | null>(null)
  const [refundProcessingDbId, setRefundProcessingDbId] = useState<string | null>(null)
  const [refundSuccess, setRefundSuccess] = useState<{ isOpen: boolean; title: string; message: string; txHash?: string | null }>({
    isOpen: false,
    title: 'Bond refunded',
    message: 'Your market creation bond was refunded successfully.',
    txHash: null,
  })

  const getFactoryAddress = (): string | null => {
    const a =
      (process as any)?.env?.NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS ||
      (globalThis as any)?.process?.env?.NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS
    const s = String(a || '').trim()
    return s && s.startsWith('0x') && s.length === 42 ? s : null
  }

  const buildDeactivateMessage = (args: {
    marketId: string
    orderBook: string
    factory: string
    creator: string
    issuedAt: string
    deadline: string
  }) => {
    return (
      `Dexextra: Deactivate market (bond refund)\n` +
      `marketId: ${args.marketId}\n` +
      `orderBook: ${args.orderBook}\n` +
      `factory: ${args.factory}\n` +
      `creator: ${args.creator}\n` +
      `issuedAt: ${args.issuedAt}\n` +
      `deadline: ${args.deadline}\n`
    )
  }

  const formatUsd6 = (v: bigint | null | undefined) => {
    try {
      if (v === null || v === undefined) return '—'
      return `$${Number(ethers.formatUnits(v, 6)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    } catch {
      return '—'
    }
  }

  const ensureBondManagerAddress = async (): Promise<string | null> => {
    if (bondManagerAddress) return bondManagerAddress
    setBondManagerError(null)
    try {
      const factoryAddress = getFactoryAddress()
      if (!factoryAddress) throw new Error('Factory address not configured')
      if (typeof window === 'undefined' || !(window as any).ethereum) throw new Error('No injected wallet found')
      const browserProvider = new ethers.BrowserProvider((window as any).ethereum)
      const factoryAbi = (FuturesMarketFactoryAbi as any)?.abi || (FuturesMarketFactoryAbi as any)
      const factory = new ethers.Contract(factoryAddress, factoryAbi, browserProvider)
      const bm = await factory.bondManager()
      const bmAddr = String(bm || '').trim()
      if (!bmAddr || !bmAddr.startsWith('0x') || bmAddr.length !== 42) throw new Error('Bond manager not configured')
      setBondManagerAddress(bmAddr)
      return bmAddr
    } catch (e: any) {
      const msg = String(e?.message || e || 'Failed to resolve bond manager')
      setBondManagerError(msg)
      return null
    }
  }

  const loadBondEligibility = async (m: MyMarketRow) => {
    const dbId = String(m.id || '')
    if (!dbId) return

    const prev = bondByMarketDbId[dbId]
    if (prev?.loading) return

    setBondByMarketDbId((cur) => ({
      ...cur,
      [dbId]: {
        ...(cur[dbId] || { loaded: false }),
        loading: true,
        loaded: false,
        error: null,
      },
    }))

    try {
      if (typeof window === 'undefined' || !(window as any).ethereum) throw new Error('No injected wallet found')
      const marketId = String(m.market_id_bytes32 || '').trim()
      const orderBook = String(m.market_address || '').trim()
      if (!marketId || !marketId.startsWith('0x') || marketId.length !== 66) {
        throw new Error('Missing market_id_bytes32 for this market')
      }
      if (!orderBook || !orderBook.startsWith('0x') || orderBook.length !== 42) {
        throw new Error('Missing market_address for this market')
      }

      const bmAddr = await ensureBondManagerAddress()
      if (!bmAddr) throw new Error(bondManagerError || 'Bond manager not configured')

      const browserProvider = new ethers.BrowserProvider((window as any).ethereum)

      const bondManager = new ethers.Contract(
        bmAddr,
        [
          'function bondByMarket(bytes32 marketId) view returns (address creator, uint96 amount, bool refunded)',
          'function creationPenaltyBps() view returns (uint16)',
          'function defaultBondAmount() view returns (uint256)',
        ],
        browserProvider
      )

      const bondRaw = await bondManager.bondByMarket(marketId)
      const bondCreator = String(bondRaw?.creator || ethers.ZeroAddress)
      const refundableAmount6 = BigInt(bondRaw?.amount ?? 0)
      const refunded = Boolean(bondRaw?.refunded)

      const bondExists = bondCreator !== ethers.ZeroAddress

      // Activity checks (must be zero for refund)
      const tradeStats = new ethers.Contract(
        orderBook,
        ['function getTradeStatistics() view returns (uint256 totalTrades, uint256 totalVolume, uint256 totalFees)'],
        browserProvider
      )
      const viewFacet2 = new ethers.Contract(
        orderBook,
        [
          'function getActiveOrdersCount() view returns (uint256 buyCount, uint256 sellCount)',
          'function totalMarginLockedInMarket() view returns (uint256 totalLocked6)',
        ],
        browserProvider
      )
      const viewFacet1 = new ethers.Contract(
        orderBook,
        ['function getActiveOrdersCount() view returns (uint256 count)'],
        browserProvider
      )

      let totalTrades: bigint | null = null
      let buyOrders: bigint | null = null
      let sellOrders: bigint | null = null
      let totalMarginLocked6: bigint | null = null

      try {
        const ts = await tradeStats.getTradeStatistics()
        totalTrades = BigInt(ts?.totalTrades ?? ts?.[0] ?? 0)
      } catch {
        totalTrades = null
      }

      try {
        const oc = await viewFacet2.getActiveOrdersCount()
        buyOrders = BigInt(oc?.buyCount ?? oc?.[0] ?? 0)
        sellOrders = BigInt(oc?.sellCount ?? oc?.[1] ?? 0)
      } catch {
        try {
          const c = await viewFacet1.getActiveOrdersCount()
          const n = BigInt(c ?? 0)
          buyOrders = n
          sellOrders = 0n
        } catch {
          buyOrders = null
          sellOrders = null
        }
      }

      try {
        const locked = await viewFacet2.totalMarginLockedInMarket()
        totalMarginLocked6 = BigInt(locked ?? 0)
      } catch {
        totalMarginLocked6 = null
      }

      const wallet = String(walletAddress || '').toLowerCase()
      const isBondCreator = wallet && bondCreator && wallet === bondCreator.toLowerCase()

      const hasTrades = totalTrades !== null ? totalTrades !== 0n : false
      const hasOpenOrders =
        buyOrders !== null && sellOrders !== null ? (buyOrders + sellOrders) !== 0n : false
      const hasLockedMargin = totalMarginLocked6 !== null ? totalMarginLocked6 !== 0n : false

      const eligible =
        bondExists &&
        !refunded &&
        isBondCreator &&
        totalTrades !== null &&
        buyOrders !== null &&
        sellOrders !== null &&
        totalMarginLocked6 !== null &&
        !hasTrades &&
        !hasOpenOrders &&
        !hasLockedMargin

      const ineligibleReason = (() => {
        if (!bondExists) return 'No bond recorded for this market'
        if (refunded) return 'Bond already refunded'
        if (!isBondCreator) return 'Only the market creator can refund this bond'
        if (totalTrades === null || buyOrders === null || sellOrders === null || totalMarginLocked6 === null) {
          return 'Unable to verify refund requirements on-chain'
        }
        if (hasTrades) return 'Market has trades'
        if (hasOpenOrders) return 'Market has open orders'
        if (hasLockedMargin) return 'Market has locked margin (open positions)'
        return null
      })()

      setBondByMarketDbId((cur) => ({
        ...cur,
        [dbId]: {
          loaded: true,
          loading: false,
          error: null,
          bondManager: bmAddr,
          bond: bondExists
            ? { creator: bondCreator, refundableAmount6, refunded }
            : null,
          activity: {
            totalTrades,
            buyOrders,
            sellOrders,
            totalMarginLocked6,
          },
          eligible,
          ineligibleReason,
          lastTxHash: cur?.[dbId]?.lastTxHash || null,
        },
      }))
    } catch (e: any) {
      setBondByMarketDbId((cur) => ({
        ...cur,
        [dbId]: {
          loaded: true,
          loading: false,
          error: String(e?.message || e || 'Failed to load bond eligibility'),
          bondManager: bondManagerAddress,
          bond: null,
          activity: null,
          eligible: false,
          ineligibleReason: null,
          lastTxHash: cur?.[dbId]?.lastTxHash || null,
        },
      }))
    }
  }

  const refundBondByDeactivating = async (m: MyMarketRow) => {
    const dbId = String(m.id || '')
    if (!dbId) return
    const orderBook = String(m.market_address || '').trim()
    if (!orderBook || !orderBook.startsWith('0x') || orderBook.length !== 42) {
      setBondByMarketDbId((cur) => ({
        ...cur,
        [dbId]: { ...(cur[dbId] || { loaded: true, loading: false }), error: 'Missing market_address for this market' },
      }))
      return
    }
    if (typeof window === 'undefined' || !(window as any).ethereum) {
      setBondByMarketDbId((cur) => ({
        ...cur,
        [dbId]: { ...(cur[dbId] || { loaded: true, loading: false }), error: 'No injected wallet found' },
      }))
      return
    }
    if (!walletAddress) {
      setBondByMarketDbId((cur) => ({
        ...cur,
        [dbId]: { ...(cur[dbId] || { loaded: true, loading: false }), error: 'Connect your wallet to sign this request' },
      }))
      return
    }
 
    setRefundProcessingDbId(dbId)
    setBondByMarketDbId((cur) => ({
      ...cur,
      [dbId]: { ...(cur[dbId] || { loaded: true }), loading: true, error: null },
    }))

    try {
      const factoryAddress = getFactoryAddress()
      if (!factoryAddress) throw new Error('Factory address not configured')
      const browserProvider = new ethers.BrowserProvider((window as any).ethereum)
      const signer = await browserProvider.getSigner()
      const issuedAt = new Date().toISOString()
      const deadline = new Date(Date.now() + 2 * 60 * 1000).toISOString()
      const message = buildDeactivateMessage({
        marketId: dbId,
        orderBook,
        factory: factoryAddress,
        creator: walletAddress,
        issuedAt,
        deadline,
      })
      const signature = await signer.signMessage(message)

      const res = await fetch('/api/markets/deactivate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          marketId: dbId,
          orderBook,
          creatorWalletAddress: walletAddress,
          signature,
          issuedAt,
          deadline,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) {
        throw new Error(String(json?.details || json?.error || json?.message || 'Deactivate failed'))
      }
      const hash = String(json?.txHash || '')
      const settleHash = String(json?.settlementTxHash || '')
      setBondByMarketDbId((cur) => ({
        ...cur,
        [dbId]: { ...(cur[dbId] || { loaded: true }), lastTxHash: hash || null },
      }))
      // Re-check bond + eligibility (should show refunded)
      await loadBondEligibility(m)
      setRefundConfirmMarket(null)
      setRefundSuccess({
        isOpen: true,
        title: 'Bond refunded',
        message: `Market settled${settleHash ? ` (${settleHash.slice(0, 10)}…)` : ''} and deactivated by relayer; bond refund processed on-chain.`,
        txHash: hash || null,
      })
    } catch (e: any) {
      setBondByMarketDbId((cur) => ({
        ...cur,
        [dbId]: { ...(cur[dbId] || { loaded: true, loading: false }), loading: false, error: String(e?.reason || e?.message || e || 'Refund failed') },
      }))
    } finally {
      setRefundProcessingDbId((cur) => (cur === dbId ? null : cur))
    }
  }

  const fetchMyMarkets = async (opts?: { force?: boolean }) => {
    const creator = marketsCreator
    if (!creator) return
    if (!opts?.force && fetchedForCreatorRef.current === creator && myMarkets.length > 0) return

    setMyMarketsLoading(true)
    setMyMarketsError(null)
    try {
      const params = new URLSearchParams({
        creator,
        limit: '200',
        offset: '0',
      })
      const res = await fetch(`/api/markets?${params.toString()}`)
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || json?.message || 'Failed to fetch markets')
      }
      const rows = Array.isArray(json?.markets) ? (json.markets as any[]) : []
      const cleaned: MyMarketRow[] = rows
        .filter(Boolean)
        .map((m: any) => ({
          id: String(m?.id || ''),
          market_identifier: m?.market_identifier ?? null,
          symbol: m?.symbol ?? null,
          name: m?.name ?? null,
          icon_image_url: m?.icon_image_url ?? null,
          banner_image_url: m?.banner_image_url ?? null,
          market_address: m?.market_address ?? null,
          market_id_bytes32: m?.market_id_bytes32 ?? null,
          created_at: m?.created_at ?? null,
          settlement_date: m?.settlement_date ?? null,
          market_status: m?.market_status ?? null,
          deployment_status: m?.deployment_status ?? null,
          creator_wallet_address: m?.creator_wallet_address ?? null,
        }))
        .filter((m) => Boolean(m.id))

      setMyMarkets(cleaned)
      fetchedForCreatorRef.current = creator
    } catch (e: any) {
      setMyMarketsError(String(e?.message || e || 'Failed to fetch markets'))
      setMyMarkets([])
    } finally {
      setMyMarketsLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab !== 'markets') return
    if (!marketsCreator) return
    void fetchMyMarkets()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, marketsCreator])

  const navigateTab = (id: SettingsTabId) => {
    setActiveTab(id)
    try {
      const next = new URLSearchParams(searchParams?.toString() || '')
      next.set('tab', id)
      router.replace(`${pathname}?${next.toString()}`)
    } catch {
      // ignore
    }
  }

  const handleSave = async () => {
    if (!walletData.isConnected || !walletData.address) {
      setErrorMessage('Please connect your wallet first')
      return
    }

    setSaveStatus('saving')
    setIsLoading(true)
    setErrorMessage(null)

    try {
      // Convert form data to update request format
      const updateData = formDataToUserProfile(
        formData,
        walletData.address,
        profileImage || undefined,
        bannerImage || undefined
      )

      // Update profile via API
      await ProfileApi.updateProfile(walletData.address, updateData)
      
      // Refresh the profile data in wallet context
      await refreshProfile()
      
      setSaveStatus('success')
      console.log('Profile updated successfully!')
      
      // Clear success status after 3 seconds
      setTimeout(() => setSaveStatus('idle'), 3000)
    } catch (error) {
      console.error('Error saving profile:', error)
      setSaveStatus('error')
      
      // Set specific error message
      if (error instanceof Error) {
        setErrorMessage(error.message)
      } else {
        setErrorMessage('Failed to save profile. Please try again.')
      }
      
      // Clear error status after 5 seconds
      setTimeout(() => {
        setSaveStatus('idle')
        setErrorMessage(null)
      }, 5000)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className={`dex-page-enter-up w-full h-[calc(100vh-96px)] flex bg-transparent overflow-hidden ${className || ''}`}>
      <div className="flex-1 min-w-0 overflow-y-auto scrollbar-none text-white font-sans">
        <ActionStatusModal
          isOpen={uiStatusModal.isOpen}
          onClose={() => setUiStatusModal((cur) => ({ ...cur, isOpen: false }))}
          tone={uiStatusModal.tone}
          title={uiStatusModal.title}
          description={uiStatusModal.description || undefined}
          primaryAction={{
            label: 'OK',
            tone: uiStatusModal.tone === 'error' ? 'danger' : uiStatusModal.tone === 'success' ? 'success' : uiStatusModal.tone === 'warning' ? 'warning' : 'default',
            onClick: () => setUiStatusModal((cur) => ({ ...cur, isOpen: false })),
          }}
        >
          <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-3">
            <div className="flex items-center gap-2">
              <div
                className={[
                  'w-1.5 h-1.5 rounded-full flex-shrink-0',
                  uiStatusModal.tone === 'error'
                    ? 'bg-red-400'
                    : uiStatusModal.tone === 'success'
                      ? 'bg-green-400'
                      : uiStatusModal.tone === 'warning'
                        ? 'bg-yellow-400'
                        : 'bg-blue-400',
                ].join(' ')}
              />
              <span className="text-[11px] text-[#808080]">
                {uiStatusModal.tone === 'error'
                  ? 'Action failed'
                  : uiStatusModal.tone === 'success'
                    ? 'Action completed'
                    : uiStatusModal.tone === 'warning'
                      ? 'Action required'
                      : 'Notice'}
              </span>
            </div>
          </div>
        </ActionStatusModal>

        <ActionStatusModal
          isOpen={Boolean(refundConfirmMarket)}
          onClose={() => {
            if (refundProcessingDbId) return
            setRefundConfirmMarket(null)
          }}
          tone="warning"
          title="Deactivate market to refund bond"
          description="Refunding your market creation bond requires deactivating this market. You will sign a message; the relayer submits the on-chain transaction (no gas required)."
          footerNote="Refund requirements: 0 trades, 0 open orders, 0 locked margin. If any requirement fails, the transaction will revert."
          secondaryAction={{
            label: 'Cancel',
            onClick: () => setRefundConfirmMarket(null),
            disabled: Boolean(refundProcessingDbId),
          }}
          primaryAction={{
            label: 'Deactivate & refund',
            tone: 'warning',
            loading: Boolean(refundProcessingDbId),
            disabled: (() => {
              if (!refundConfirmMarket) return true
              const s = bondByMarketDbId[String(refundConfirmMarket.id || '')]
              return !s?.eligible || Boolean(s?.loading)
            })(),
            onClick: async () => {
              if (!refundConfirmMarket) return
              await refundBondByDeactivating(refundConfirmMarket)
            },
          }}
        >
          {(() => {
            const m = refundConfirmMarket
            if (!m) return null
            const s = bondByMarketDbId[String(m.id || '')]
            const creatorOk =
              Boolean(s?.bond?.creator) &&
              String(s?.bond?.creator || '').toLowerCase() === String(walletAddress || '').toLowerCase()
            const tradesOk = s?.activity?.totalTrades === 0n
            const ordersOk =
              s?.activity?.buyOrders !== null &&
              s?.activity?.sellOrders !== null &&
              s?.activity?.buyOrders !== undefined &&
              s?.activity?.sellOrders !== undefined &&
              (s.activity.buyOrders + s.activity.sellOrders) === 0n
            const lockedOk = s?.activity?.totalMarginLocked6 === 0n
 
            return (
              <div className="space-y-3">
                <div className="group bg-[#0F0F0F] rounded-md border border-[#222222] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-medium text-white truncate">{String(m.name || m.symbol || m.market_identifier || 'Market')}</div>
                      <div className="mt-1 text-[10px] text-[#606060] font-mono truncate">
                        {String(m.market_identifier || m.symbol || '—').toUpperCase()}
                      </div>
                    </div>
                    <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded font-mono">
                      {s?.bond ? (s.bond.refunded ? 'Refunded' : formatUsd6(s.bond.refundableAmount6)) : '—'}
                    </div>
                  </div>
                </div>
 
                <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-3">
                  <div className="text-[10px] text-[#606060] uppercase tracking-wide">Requirements</div>
                  <div className="mt-2 space-y-1">
                    {[
                      { label: 'You are the creator', ok: creatorOk, value: s?.bond?.creator ? 'Verified' : '—' },
                      { label: '0 trades', ok: tradesOk, value: s?.activity?.totalTrades !== null && s?.activity?.totalTrades !== undefined ? String(s.activity.totalTrades) : '—' },
                      {
                        label: '0 open orders',
                        ok: ordersOk,
                        value:
                          s?.activity?.buyOrders !== null &&
                          s?.activity?.sellOrders !== null &&
                          s?.activity?.buyOrders !== undefined &&
                          s?.activity?.sellOrders !== undefined
                            ? `${String(s.activity.buyOrders)} / ${String(s.activity.sellOrders)}`
                            : '—',
                      },
                      { label: '0 locked margin', ok: lockedOk, value: s?.activity?.totalMarginLocked6 !== null && s?.activity?.totalMarginLocked6 !== undefined ? formatUsd6(s.activity.totalMarginLocked6) : '—' },
                    ].map((r) => (
                      <div key={r.label} className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${r.ok ? 'bg-green-400' : 'bg-[#404040]'}`} />
                          <span className="text-[10px] text-[#808080] truncate">{r.label}</span>
                        </div>
                        <span className="text-[10px] text-white font-mono">{r.value}</span>
                      </div>
                    ))}
                  </div>
 
                  {s?.ineligibleReason ? (
                    <div className="mt-2 text-[10px] text-[#606060]">
                      <span className="text-[#808080]">Status:</span> {s.ineligibleReason}
                    </div>
                  ) : null}
 
                  {s?.error ? (
                    <div className="mt-2 text-[10px] text-red-400">{s.error}</div>
                  ) : null}
                </div>
              </div>
            )
          })()}
        </ActionStatusModal>
 
        <ActionStatusModal
          isOpen={refundSuccess.isOpen}
          onClose={() => setRefundSuccess((cur) => ({ ...cur, isOpen: false }))}
          tone="success"
          title={refundSuccess.title}
          description={refundSuccess.message}
          primaryAction={{
            label: 'OK',
            onClick: () => setRefundSuccess((cur) => ({ ...cur, isOpen: false })),
            tone: 'success',
          }}
        >
          {refundSuccess.txHash ? (
            <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-3">
              <div className="text-[10px] text-[#606060] uppercase tracking-wide">Transaction</div>
              <div className="mt-1 text-[10px] text-[#9CA3AF] font-mono break-all">{refundSuccess.txHash}</div>
            </div>
          ) : null}
        </ActionStatusModal>

        {/* Expanded profile header (inspired by portfolio sidebar + screenshot) */}
        <div className="border-b border-[#1A1A1A] bg-gradient-to-b from-[#141414] to-[#0F0F0F]" data-walkthrough="settings-header">
          <div className="relative h-[190px] md:h-[240px] overflow-hidden">
            <div
              className="absolute inset-0"
              style={{
                background: `
                  radial-gradient(560px 200px at 18% 30%, rgba(74,158,255,0.18), transparent 60%),
                  radial-gradient(520px 200px at 80% 38%, rgba(16,185,129,0.14), transparent 62%),
                  linear-gradient(180deg, rgba(20,20,20,0.92) 0%, rgba(15,15,15,0.96) 100%)
                `,
              }}
            />
            {bannerImage ? (
              <img
                src={bannerImage}
                alt="Profile banner"
                className="absolute inset-0 w-full h-full object-cover opacity-65"
              />
            ) : null}
            <div className="absolute inset-0 bg-black/30" />
            <div className="absolute inset-0" style={{ boxShadow: 'inset 0 -1px 0 rgba(34,34,34,0.9)' }} />

            {/* Banner actions */}
            <input
              type="file"
              id="banner-image"
              accept="image/*"
              onChange={(e) => handleImageUpload(e, 'banner')}
              className="hidden"
              disabled={isLoading}
            />
            <div className="absolute top-3 right-3 flex items-center gap-2">
              {bannerImage ? (
                <button
                  type="button"
                  onClick={() => handleRemoveImage('banner')}
                  className="w-8 h-8 rounded-md border border-white/10 bg-black/40 hover:bg-black/60 backdrop-blur-sm flex items-center justify-center transition-all duration-200"
                  title="Remove banner image"
                  disabled={isLoading}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M12 4L4 12M4 4l8 8" stroke="white" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              ) : null}
              <label
                htmlFor="banner-image"
                className={`w-8 h-8 rounded-md border border-white/10 bg-black/40 hover:bg-black/60 backdrop-blur-sm flex items-center justify-center cursor-pointer transition-all duration-200 ${
                  isLoading ? 'opacity-60 cursor-not-allowed' : ''
                }`}
                title="Upload banner image"
              >
                {isLoading ? (
                  <div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
                      fill="white"
                    />
                  </svg>
                )}
              </label>
            </div>

            {/* Profile icon (bottom-left, like portfolio sidebar) */}
            <div className="absolute left-6 bottom-5">
              <div className="relative group">
                <div className="w-[92px] h-[92px] md:w-[112px] md:h-[112px] rounded-full overflow-hidden border border-[#222222] bg-[#0F0F0F] shadow-2xl">
                  {profileImage ? (
                    <Image
                      src={profileImage}
                      alt={profileLabel}
                      width={112}
                      height={112}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div
                      className="w-full h-full flex items-center justify-center text-[28px] md:text-[34px] font-semibold text-white"
                      style={{
                        background:
                          'linear-gradient(135deg, rgba(74,158,255,0.22), rgba(16,185,129,0.16))',
                      }}
                    >
                      {profileInitial}
                    </div>
                  )}
                </div>

                {/* Avatar actions */}
                <input
                  type="file"
                  id="profile-image"
                  accept="image/*"
                  onChange={(e) => handleImageUpload(e, 'profile')}
                  className="hidden"
                  disabled={isLoading}
                />
                <label
                  htmlFor="profile-image"
                  className={`absolute inset-0 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 cursor-pointer ${
                    isLoading ? 'pointer-events-none' : ''
                  }`}
                  title="Upload profile image"
                  style={{ background: 'rgba(0,0,0,0.42)' }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
                      fill="white"
                    />
                  </svg>
                </label>
                {profileImage ? (
                  <button
                    type="button"
                    onClick={() => handleRemoveImage('profile')}
                    className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-red-500/80 hover:bg-red-500 border border-white/10 flex items-center justify-center transition-all duration-200"
                    title="Remove profile image"
                    disabled={isLoading}
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                      <path d="M12 4L4 12M4 4l8 8" stroke="white" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {/* Header row (uniform with Watchlist) */}
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isWalletConnected ? 'bg-green-400' : 'bg-[#404040]'}`} />
              <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide truncate">Settings</h4>
              <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">Profile</div>
            </div>
            <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded font-mono">
              {shortAddress}
            </div>
          </div>

          <div className="px-6 pb-5">
            <div className="text-white text-xl font-medium tracking-tight truncate">{profileLabel}</div>
            <p className="text-[#606060] text-[11px] mt-1 max-w-2xl">
              Update your public profile, social links, and notification preferences.
            </p>

            {/* Horizontal settings nav (OpenSea-style) */}
            <div className="mt-4 -mx-6 px-6 border-b border-[#1A1A1A]">
              <div className="flex items-center gap-4 overflow-x-auto scrollbar-none">
                {tabs.map((t) => {
                  const isActive = activeTab === t.id
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => navigateTab(t.id)}
                      aria-current={isActive ? 'page' : undefined}
                      className={[
                        'relative py-3 text-[12px] font-medium whitespace-nowrap transition-colors duration-200',
                        isActive ? 'text-white' : 'text-[#808080] hover:text-white',
                      ].join(' ')}
                    >
                      {t.label}
                      <span
                        className={[
                          'pointer-events-none absolute left-0 right-0 -bottom-[1px] h-[2px] rounded-full transition-opacity duration-200',
                          isActive ? 'bg-white/80 opacity-100' : 'opacity-0',
                        ].join(' ')}
                      />
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-6">
          <div
            className={[
              'w-full',
              activeTab === 'markets' ? 'max-w-none' : 'mx-auto max-w-4xl',
            ].join(' ')}
          >
            {/* Tab panel enter animation (Watchlist-style) */}
            <div key={activeTab} className="dex-page-enter-up">
        {activeTab === 'profile' ? (
          <>
            {/* Basic Information */}
            <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 mb-6">
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Basic Information</h4>
                  <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">Public</div>
                </div>

                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label htmlFor="username" className="block text-[11px] font-medium text-[#808080]">
                        Username *
                      </label>
                      {formData.username && (
                        <div
                          className={`text-[10px] px-1.5 py-0.5 rounded ${
                            usernameError ? 'bg-red-500/10 text-red-500' : 'bg-green-500/10 text-green-500'
                          }`}
                        >
                          {usernameError ? 'Invalid' : 'Valid'}
                        </div>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        type="text"
                        id="username"
                        name="username"
                        data-walkthrough="settings-username"
                        value={formData.username}
                        onChange={handleInputChange}
                        placeholder="Enter username..."
                        className={`w-full bg-[#1A1A1A] border rounded-md px-3 py-2.5 text-[11px] text-white placeholder-[#606060] focus:outline-none transition-colors duration-200 ${
                          usernameError
                            ? 'border-red-500/50 focus:border-red-500'
                            : formData.username
                              ? 'border-green-500/50 focus:border-green-500'
                              : 'border-[#333333] focus:border-[#333333]'
                        }`}
                      />
                      {formData.username && (
                        <div className="absolute right-2 top-1/2 -translate-y-1/2">
                          {usernameError ? (
                            <svg className="w-4 h-4 text-red-500" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                              <path
                                d="M15 9l-6 6M9 9l6 6"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                              />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4 text-green-500" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                              <path
                                d="M8 12l3 3 5-5"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="mt-2 flex items-start gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#606060] flex-shrink-0 mt-1" />
                      <span className="text-[9px] text-[#606060]">
                        Username must be 3-30 characters long and can only contain letters, numbers, underscores, and hyphens
                      </span>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="name" className="block text-[11px] font-medium text-[#808080] mb-2">
                      Display Name
                    </label>
                    <input
                      type="text"
                      id="name"
                      name="name"
                      value={formData.name}
                      onChange={handleInputChange}
                      placeholder="Enter display name..."
                      className="w-full bg-[#1A1A1A] border border-[#333333] rounded-md px-3 py-2.5 text-[11px] text-white placeholder-[#606060] focus:border-[#333333] focus:outline-none transition-colors duration-200"
                    />
                  </div>

                  <div>
                    <label htmlFor="bio" className="block text-[11px] font-medium text-[#808080] mb-2">
                      Bio
                    </label>
                    <textarea
                      id="bio"
                      name="bio"
                      value={formData.bio}
                      onChange={handleInputChange}
                      placeholder="Tell us about yourself..."
                      rows={4}
                      className="w-full bg-[#1A1A1A] border border-[#333333] rounded-md px-3 py-2.5 text-[11px] text-white placeholder-[#606060] focus:border-[#333333] focus:outline-none transition-colors duration-200 resize-none"
                    />
                    <div className="flex justify-between items-center mt-2">
                      <span className="text-[9px] text-[#606060]">Share your story with the community</span>
                      <span className="text-[9px] text-[#606060]">{formData.bio.length}/180</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : null}

        {activeTab === 'notifications' ? (
          <>
            {/* Email Notifications */}
            <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 mb-6">
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Email Notifications</h4>
                  <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">Optional</div>
                </div>

                <p className="text-[10px] text-[#606060] mb-4">
                  Get notifications about your activity. Your email won&apos;t be shared or visible publicly.
                </p>

                <div>
                  <label htmlFor="email" className="block text-[11px] font-medium text-[#808080] mb-2">
                    Email Address
                  </label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    placeholder="Enter your email..."
                    className="w-full bg-[#1A1A1A] border border-[#333333] rounded-md px-3 py-2.5 text-[11px] text-white placeholder-[#606060] focus:border-[#333333] focus:outline-none transition-colors duration-200"
                  />
                </div>
              </div>
            </div>
          </>
        ) : null}

        {activeTab === 'links' ? (
          <>
            {/* Social Links */}
            <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 mb-6">
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Social & Web Links</h4>
                  <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">Public</div>
                </div>

                <div className="space-y-4">
              <div>
                <label htmlFor="website" className="block text-[11px] font-medium text-[#808080] mb-2">
                  Website
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 transform -translate-y-1/2">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-[#606060]">
                      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M8 1a7 7 0 0 0 0 14A7 7 0 0 0 8 1z" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M1 8h14" stroke="currentColor" strokeWidth="1.5"/>
                    </svg>
                  </div>
                  <input
                    type="url"
                    id="website"
                    name="website"
                    value={formData.website}
                    onChange={handleInputChange}
                    placeholder="https://your-website.com"
                    className="w-full bg-[#1A1A1A] border border-[#333333] rounded-md pl-10 pr-3 py-2.5 text-[11px] text-white placeholder-[#606060] focus:border-[#333333] focus:outline-none transition-colors duration-200"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="twitter" className="block text-[11px] font-medium text-[#808080] mb-2">
                  Twitter
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 transform -translate-y-1/2">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-[#606060]">
                      <path d="M16 3.037a6.5 6.5 0 0 1-1.885.516 3.28 3.28 0 0 0 1.443-1.816 6.57 6.57 0 0 1-2.085.795 3.28 3.28 0 0 0-5.593 2.99A9.32 9.32 0 0 1 1.114 2.1a3.28 3.28 0 0 0 1.015 4.381A3.28 3.28 0 0 1 .64 6.07v.041a3.28 3.28 0 0 0 2.633 3.218 3.28 3.28 0 0 1-1.482.056 3.28 3.28 0 0 0 3.067 2.277A6.58 6.58 0 0 1 0 13.027a9.29 9.29 0 0 0 5.032 1.475c6.038 0 9.34-5.002 9.34-9.34 0-.142-.003-.284-.009-.425A6.68 6.68 0 0 0 16 3.037z" fill="currentColor"/>
                    </svg>
                  </div>
                  <input
                    type="url"
                    id="twitter"
                    name="twitter"
                    value={formData.twitter}
                    onChange={handleInputChange}
                    placeholder="https://twitter.com/username"
                    className="w-full bg-[#1A1A1A] border border-[#333333] rounded-md pl-10 pr-3 py-2.5 text-[11px] text-white placeholder-[#606060] focus:border-[#333333] focus:outline-none transition-colors duration-200"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="discord" className="block text-[11px] font-medium text-[#808080] mb-2">
                  Discord
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 transform -translate-y-1/2">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-[#606060]">
                      <path d="M13.545 2.907a13.2 13.2 0 0 0-3.257-1.011.05.05 0 0 0-.052.025c-.141.25-.297.577-.406.833a12.2 12.2 0 0 0-3.658 0 8 8 0 0 0-.412-.833.05.05 0 0 0-.052-.025c-1.125.194-2.22.534-3.257 1.011a.04.04 0 0 0-.021.018C.356 6.024-.213 9.047.066 12.032c.001.014.01.028.021.037a13.3 13.3 0 0 0 3.995 2.02.05.05 0 0 0 .056-.019c.308-.42.582-.863.818-1.329a.05.05 0 0 0-.01-.059.05.05 0 0 0-.018-.011 8.9 8.9 0 0 1-1.248-.595.05.05 0 0 1-.02-.066.05.05 0 0 1 .015-.019c.084-.063.168-.129.248-.195a.05.05 0 0 1 .051-.007c2.619 1.196 5.454 1.196 8.041 0a.05.05 0 0 1 .053.007c.08.066.164.132.248.195a.05.05 0 0 1-.004.085 8.3 8.3 0 0 1-1.249.594.05.05 0 0 0-.03.03.05.05 0 0 0 .003.041c.24.465.515.909.817 1.329a.05.05 0 0 0 .056.019 13.2 13.2 0 0 0 4.001-2.02.05.05 0 0 0 .021-.037c.334-3.451-.559-6.449-2.366-9.106a.03.03 0 0 0-.02-.018" fill="currentColor"/>
                    </svg>
                  </div>
                  <input
                    type="url"
                    id="discord"
                    name="discord"
                    value={formData.discord}
                    onChange={handleInputChange}
                    placeholder="https://discord.gg/invite"
                    className="w-full bg-[#1A1A1A] border border-[#333333] rounded-md pl-10 pr-3 py-2.5 text-[11px] text-white placeholder-[#606060] focus:border-[#333333] focus:outline-none transition-colors duration-200"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="instagram" className="block text-[11px] font-medium text-[#808080] mb-2">
                  Instagram
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 transform -translate-y-1/2">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-[#606060]">
                      <rect x="1" y="1" width="14" height="14" rx="3" stroke="currentColor" strokeWidth="1.5"/>
                      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5"/>
                      <circle cx="12" cy="4" r="0.5" fill="currentColor"/>
                    </svg>
                  </div>
                  <input
                    type="text"
                    id="instagram"
                    name="instagram"
                    value={formData.instagram}
                    onChange={handleInputChange}
                    placeholder="@username or https://www.instagram.com/username/"
                    className="w-full bg-[#1A1A1A] border border-[#333333] rounded-md pl-10 pr-3 py-2.5 text-[11px] text-white placeholder-[#606060] focus:border-[#333333] focus:outline-none transition-colors duration-200"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="facebook" className="block text-[11px] font-medium text-[#808080] mb-2">
                  Facebook
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 transform -translate-y-1/2">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-[#606060]">
                      <path
                        d="M9.2 15V9.2h2l.3-2.3H9.2V5.4c0-.7.2-1.2 1.2-1.2h1.3V2.1c-.2 0-1 0-2 0-2 0-3.3 1.2-3.3 3.5v1.3H4.3v2.3h2.1V15h2.8z"
                        fill="currentColor"
                      />
                    </svg>
                  </div>
                  <input
                    type="text"
                    id="facebook"
                    name="facebook"
                    value={formData.facebook}
                    onChange={handleInputChange}
                    placeholder="@username or https://www.facebook.com/username"
                    className="w-full bg-[#1A1A1A] border border-[#333333] rounded-md pl-10 pr-3 py-2.5 text-[11px] text-white placeholder-[#606060] focus:border-[#333333] focus:outline-none transition-colors duration-200"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="youtube" className="block text-[11px] font-medium text-[#808080] mb-2">
                  YouTube
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 transform -translate-y-1/2">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-[#606060]">
                      <path d="M15.841 4.258S15.692 3.177 15.225 2.687c-.468-.49-1.135-.49-1.394-.49C11.833 2.087 8.002 2.087 8.002 2.087s-3.831 0-5.829.11c-.259 0-.926 0-1.394.49C.312 3.177.163 4.258.163 4.258S.014 5.438.014 6.619v1.142c0 1.181.149 2.361.149 2.361s.149 1.081.616 1.571c.468.49 1.135.49 1.394.49 2.598.11 5.829.11 5.829.11s3.831 0 5.829-.11c.259 0 .926 0 1.394-.49.467-.49.616-1.571.616-1.571s.149-1.18.149-2.361V6.619c0-1.181-.149-2.361-.149-2.361zM6.4 9.6V5.6l4.267 2L6.4 9.6z" fill="currentColor"/>
                    </svg>
                  </div>
                  <input
                    type="url"
                    id="youtube"
                    name="youtube"
                    value={formData.youtube}
                    onChange={handleInputChange}
                    placeholder="https://youtube.com/@username"
                    className="w-full bg-[#1A1A1A] border border-[#333333] rounded-md pl-10 pr-3 py-2.5 text-[11px] text-white placeholder-[#606060] focus:border-[#333333] focus:outline-none transition-colors duration-200"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
          </>
        ) : null}

        {activeTab === 'markets' ? (
          <>
            <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 mb-6">
              <div className="p-6">
                <div className="flex items-center justify-between mb-3">
                  <div className="min-w-0">
                    <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">My Markets</h4>
                    <div className="mt-1 text-[10px] text-[#606060] font-mono truncate">
                      Creator: {marketsCreator || '—'}
                      {creatorOverride ? (
                        <span className="ml-2 text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">override</span>
                      ) : null}
                    </div>
                  </div>
                </div>

                {!marketsCreator ? (
                  <div className="group bg-[#0F0F0F] rounded-md border border-[#222222] p-3">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                      <span className="text-[11px] text-[#808080]">
                        Connect your wallet to view markets you created.
                      </span>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="relative flex-1 max-w-md">
                        <svg
                          className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[#606060]"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                          />
                        </svg>
                        <input
                          type="text"
                          placeholder="Search your markets"
                          value={myMarketsSearch}
                          onChange={(e) => setMyMarketsSearch(e.target.value)}
                          className="w-full bg-[#0F0F0F] border border-[#222222] hover:border-[#333333] focus:border-[#333333] rounded-md pl-8 pr-3 py-2 text-[11px] text-white placeholder-[#606060] focus:outline-none transition-all duration-200"
                        />
                      </div>
                      <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                        {myMarkets.length}
                      </div>
                    </div>

                    {myMarketsError ? (
                      <div className="group bg-[#0F0F0F] rounded-md border border-red-500/20 p-3">
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-400" />
                          <span className="text-[11px] text-red-400">Markets error: {myMarketsError}</span>
                        </div>
                      </div>
                    ) : null}

                    {(() => {
                      const q = myMarketsSearch.trim().toLowerCase()
                      const rows = q
                        ? myMarkets.filter((m) => {
                            const hay = `${m.market_identifier || ''} ${m.symbol || ''} ${m.name || ''}`.toLowerCase()
                            return hay.includes(q)
                          })
                        : myMarkets

                      if (myMarketsLoading && myMarkets.length === 0) {
                        return (
                          <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-3">
                            <div className="flex items-center gap-2">
                              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400 animate-pulse" />
                              <span className="text-[11px] text-[#808080]">Loading your markets…</span>
                            </div>
                          </div>
                        )
                      }

                      if (rows.length === 0) {
                        return (
                          <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-6 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <div className="w-1.5 h-1.5 rounded-full bg-[#404040]" />
                              <span className="text-[11px] text-[#606060]">
                                {q ? 'No markets match your search' : 'No markets found for this creator'}
                              </span>
                            </div>
                          </div>
                        )
                      }

                      const goToMarket = (m: MyMarketRow) => {
                        const id = String(m.market_identifier || m.symbol || '').trim()
                        if (!id) return
                        router.push(`/token/${encodeURIComponent(id)}`)
                      }

                      const fmtDate = (iso: string | null | undefined) => {
                        if (!iso) return '—'
                        const d = new Date(iso)
                        if (!Number.isFinite(d.getTime())) return '—'
                        return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
                      }

                      return (
                        <div className="w-full">
                          {/* Loading skeleton cards */}
                          {myMarketsLoading && myMarkets.length === 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 items-start">
                              {Array.from({ length: 6 }).map((_, i) => (
                                <div
                                  key={i}
                                  className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 overflow-hidden"
                                >
                                  <div className="h-[104px] bg-[#1A1A1A] border-b border-[#1A1A1A]" />
                                  <div className="p-2.5">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2 min-w-0 flex-1">
                                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400 animate-pulse" />
                                        <div className="w-7 h-7 rounded-full bg-[#2A2A2A] animate-pulse flex-shrink-0" />
                                        <div className="min-w-0 flex-1 space-y-1">
                                          <div className="h-3 w-32 bg-[#2A2A2A] rounded animate-pulse" />
                                          <div className="h-2 w-16 bg-[#2A2A2A] rounded animate-pulse" />
                                        </div>
                                      </div>
                                      <div className="w-10 h-4 bg-[#2A2A2A] rounded animate-pulse" />
                                    </div>
                                    <div className="mt-3 grid grid-cols-2 gap-2">
                                      <div className="space-y-1">
                                        <div className="h-2 w-14 bg-[#2A2A2A] rounded animate-pulse" />
                                        <div className="h-3 w-20 bg-[#2A2A2A] rounded animate-pulse" />
                                      </div>
                                      <div className="space-y-1">
                                        <div className="h-2 w-16 bg-[#2A2A2A] rounded animate-pulse" />
                                        <div className="h-3 w-20 bg-[#2A2A2A] rounded animate-pulse" />
                                      </div>
                                    </div>
                                    <div className="mt-2 space-y-1">
                                      <div className="h-2 w-24 bg-[#2A2A2A] rounded animate-pulse" />
                                      <div className="h-3 w-40 bg-[#2A2A2A] rounded animate-pulse" />
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 items-start">
                              {rows.map((m) => {
                                const label = String(m.name || m.symbol || m.market_identifier || 'Market')
                                const status = String(m.market_status || '—').toUpperCase()
                                const deploy = String(m.deployment_status || '').toUpperCase()
                                const icon = String(m.icon_image_url || '').trim()
                                const banner = String(m.banner_image_url || '').trim()
                                const sym = String(m.symbol || '').toUpperCase()
                                const ident = String(m.market_identifier || '').toUpperCase()
                                const statusDot =
                                  status === 'ACTIVE'
                                    ? 'bg-green-400'
                                    : status === 'PENDING'
                                      ? 'bg-yellow-400'
                                      : status === 'SETTLED'
                                        ? 'bg-blue-400'
                                        : 'bg-[#404040]'

                                const isBondSectionOpen = bondExpandedMarketDbId === m.id
                                const bondState = bondByMarketDbId[m.id]
                                const showBondControls =
                                  Boolean(walletAddress) &&
                                  Boolean(m.creator_wallet_address) &&
                                  String(walletAddress).toLowerCase() === String(m.creator_wallet_address).toLowerCase()

                                return (
                                  <div
                                    key={m.id}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => goToMarket(m)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') goToMarket(m)
                                    }}
                                    className="group text-left bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 overflow-hidden min-h-[300px] cursor-pointer"
                                  >
                                    {/* Banner */}
                                    <div className="relative h-[104px] overflow-hidden border-b border-[#1A1A1A]">
                                      <div
                                        className="absolute inset-0"
                                        style={{
                                          background: `
                                            radial-gradient(220px 80px at 20% 30%, rgba(74,158,255,0.16), transparent 60%),
                                            radial-gradient(220px 80px at 80% 40%, rgba(16,185,129,0.10), transparent 62%),
                                            linear-gradient(180deg, #141414 0%, #0F0F0F 100%)
                                          `,
                                        }}
                                      />
                                      {banner ? (
                                        <img
                                          src={banner}
                                          alt=""
                                          className="absolute inset-0 w-full h-full object-cover opacity-55"
                                          loading="lazy"
                                        />
                                      ) : null}
                                      <div className="absolute inset-0 bg-black/20" />
                                    </div>

                                    {/* Content */}
                                    <div className="p-2.5">
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 min-w-0 flex-1">
                                          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot}`} />
                                          <div className="w-7 h-7 rounded-full overflow-hidden bg-[#2A2A2A] flex-shrink-0">
                                            {icon ? (
                                              <Image
                                                src={icon}
                                                alt={label}
                                                width={28}
                                                height={28}
                                                className="w-full h-full object-cover"
                                              />
                                            ) : (
                                              <div className="w-full h-full flex items-center justify-center text-[9px] font-medium text-[#808080]">
                                                {(sym || ident || label).slice(0, 2).toUpperCase()}
                                              </div>
                                            )}
                                          </div>
                                          <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-1.5 min-w-0">
                                              <span className="text-[11px] font-medium text-white truncate">{label}</span>
                                              <span className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                                                {status || '—'}
                                              </span>
                                            </div>
                                            <div className="text-[10px] text-[#606060] font-mono truncate">
                                              {sym || ident || '—'}
                                            </div>
                                          </div>
                                        </div>

                                        <svg
                                          className="w-3 h-3 text-[#404040] opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex-shrink-0"
                                          fill="none"
                                          viewBox="0 0 24 24"
                                          stroke="currentColor"
                                        >
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
                                        </svg>
                                      </div>

                                      <div className="mt-3 grid grid-cols-2 gap-2">
                                        <div className="min-w-0">
                                          <div className="text-[9px] text-[#606060] uppercase tracking-wide">Created</div>
                                          <div className="mt-1 text-[10px] text-white font-mono truncate">{fmtDate(m.created_at)}</div>
                                        </div>
                                        <div className="min-w-0">
                                          <div className="text-[9px] text-[#606060] uppercase tracking-wide">Settlement</div>
                                          <div className="mt-1 text-[10px] text-white font-mono truncate">
                                            {fmtDate(m.settlement_date)}
                                          </div>
                                        </div>
                                      </div>

                                      <div className="mt-2">
                                        <div className="text-[9px] text-[#606060] uppercase tracking-wide">Identifier</div>
                                        <div className="mt-1 text-[10px] text-[#9CA3AF] font-mono truncate">
                                          {ident || sym || '—'}
                                        </div>
                                      </div>

                                      {/* Bond refund (owner-only) */}
                                      {showBondControls ? (
                                        <div className="mt-3">
                                          <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2 min-w-0 flex-1">
                                              <div
                                                className={[
                                                  'w-1.5 h-1.5 rounded-full flex-shrink-0',
                                                  bondState?.eligible
                                                    ? 'bg-green-400'
                                                    : bondState?.bond?.refunded
                                                      ? 'bg-blue-400'
                                                      : bondState?.loaded
                                                        ? 'bg-[#404040]'
                                                        : 'bg-yellow-400',
                                                ].join(' ')}
                                              />
                                              <div className="text-[10px] text-[#606060] uppercase tracking-wide">Bond refund</div>
                                              <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded font-mono">
                                                {bondState?.bond
                                                  ? bondState.bond.refunded
                                                    ? 'Refunded'
                                                    : formatUsd6(bondState.bond.refundableAmount6)
                                                  : bondState?.loaded
                                                    ? 'No bond'
                                                    : 'Check'}
                                              </div>
                                            </div>

                                            <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                                              <button
                                                type="button"
                                                onClick={async () => {
                                                  const nextOpen = isBondSectionOpen ? null : m.id
                                                  setBondExpandedMarketDbId(nextOpen)
                                                  if (!isBondSectionOpen) {
                                                    await loadBondEligibility(m)
                                                  }
                                                }}
                                                className="px-2.5 py-1.5 rounded-md text-[11px] border border-[#222222] text-[#808080] hover:border-[#333333] hover:bg-[#1A1A1A] hover:text-white transition-all duration-200"
                                              >
                                                {isBondSectionOpen ? 'Hide' : 'Details'}
                                              </button>
                                            </div>
                                          </div>

                                          {isBondSectionOpen ? (
                                            <div className="mt-2 rounded-md border border-[#222222] bg-[#0F0F0F] overflow-hidden" onClick={(e) => e.stopPropagation()}>
                                              <div className="p-2.5">
                                                <div className="text-[11px] font-medium text-white">Refund requirements</div>
                                                <div className="mt-1 text-[9px] text-[#606060]">
                                                  Refunding a bond requires <span className="text-white">deactivating</span> the market.
                                                </div>

                                                <div className="mt-2 space-y-1">
                                                  {[
                                                    {
                                                      label: 'You are the creator',
                                                      ok:
                                                        Boolean(bondState?.bond?.creator) &&
                                                        String(bondState?.bond?.creator || '').toLowerCase() === String(walletAddress || '').toLowerCase(),
                                                      value: bondState?.bond?.creator ? 'Verified' : bondState?.loaded ? 'No bond' : '—',
                                                    },
                                                    {
                                                      label: '0 trades',
                                                      ok: bondState?.activity?.totalTrades === 0n,
                                                      value:
                                                        bondState?.activity?.totalTrades !== undefined && bondState?.activity?.totalTrades !== null
                                                          ? String(bondState.activity.totalTrades)
                                                          : '—',
                                                    },
                                                    {
                                                      label: '0 open orders',
                                                      ok:
                                                        bondState?.activity?.buyOrders !== null &&
                                                        bondState?.activity?.sellOrders !== null &&
                                                        bondState?.activity?.buyOrders !== undefined &&
                                                        bondState?.activity?.sellOrders !== undefined &&
                                                        (bondState.activity.buyOrders + bondState.activity.sellOrders) === 0n,
                                                      value:
                                                        bondState?.activity?.buyOrders !== undefined &&
                                                        bondState?.activity?.sellOrders !== undefined &&
                                                        bondState?.activity?.buyOrders !== null &&
                                                        bondState?.activity?.sellOrders !== null
                                                          ? `${String(bondState.activity.buyOrders)} / ${String(bondState.activity.sellOrders)}`
                                                          : '—',
                                                    },
                                                    {
                                                      label: '0 locked margin',
                                                      ok: bondState?.activity?.totalMarginLocked6 === 0n,
                                                      value:
                                                        bondState?.activity?.totalMarginLocked6 !== undefined &&
                                                        bondState?.activity?.totalMarginLocked6 !== null
                                                          ? formatUsd6(bondState.activity.totalMarginLocked6)
                                                          : '—',
                                                    },
                                                  ].map((req) => (
                                                    <div key={req.label} className="flex items-center justify-between">
                                                      <div className="flex items-center gap-2 min-w-0 flex-1">
                                                        <div
                                                          className={[
                                                            'w-1.5 h-1.5 rounded-full flex-shrink-0',
                                                            req.ok ? 'bg-green-400' : 'bg-[#404040]',
                                                          ].join(' ')}
                                                        />
                                                        <span className="text-[10px] text-[#808080] truncate">{req.label}</span>
                                                      </div>
                                                      <span className="text-[10px] text-white font-mono">{req.value}</span>
                                                    </div>
                                                  ))}
                                                </div>

                                                {bondState?.ineligibleReason ? (
                                                  <div className="mt-2 text-[10px] text-[#606060]">
                                                    <span className="text-[#808080]">Status:</span> {bondState.ineligibleReason}
                                                  </div>
                                                ) : null}

                                                {bondState?.error ? (
                                                  <div className="mt-2 text-[10px] text-red-400">
                                                    {bondState.error}
                                                  </div>
                                                ) : null}

                                                <div className="mt-3 flex items-center justify-end gap-2">
                                                  <button
                                                    type="button"
                                                    onClick={() => void loadBondEligibility(m)}
                                                    disabled={bondState?.loading}
                                                    className={`px-3 py-2 rounded-md text-[11px] border transition-all duration-200 ${
                                                      bondState?.loading
                                                        ? 'border-[#222222] text-[#808080]'
                                                        : 'border-[#222222] text-[#808080] hover:border-[#333333] hover:bg-[#1A1A1A] hover:text-white'
                                                    }`}
                                                  >
                                                    {bondState?.loading ? 'Checking…' : 'Re-check'}
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => setRefundConfirmMarket(m)}
                                                    disabled={!bondState?.eligible || bondState?.loading}
                                                    className={`px-3 py-2 rounded-md text-[11px] border transition-all duration-200 ${
                                                      bondState?.eligible && !bondState?.loading
                                                        ? 'border-yellow-500/20 text-yellow-400 hover:border-yellow-500/30 hover:bg-yellow-500/5'
                                                        : 'border-[#222222] text-[#606060]'
                                                    }`}
                                                  >
                                                    Deactivate & refund
                                                  </button>
                                                </div>

                                                {bondState?.lastTxHash ? (
                                                  <div className="mt-2 text-[9px] text-[#606060] font-mono truncate">
                                                    Tx: {bondState.lastTxHash}
                                                  </div>
                                                ) : null}
                                              </div>
                                            </div>
                                          ) : null}
                                        </div>
                                      ) : null}
                                    </div>

                                    {/* Hover details */}
                                    <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-24 overflow-hidden transition-all duration-200">
                                      <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
                                        <div className="text-[9px] pt-1.5">
                                          <span className="text-[#606060]">
                                            {deploy ? `Deployment: ${deploy} · ` : ''}
                                            Status: {status || '—'}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })()}
                  </>
                )}
              </div>
            </div>
          </>
        ) : null}

        {activeTab === 'preferences' ? (
          <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 mb-6">
            <div className="p-6">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Preferences</h4>
                <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">Coming soon</div>
              </div>
              <p className="text-[11px] text-[#606060]">
                Theme, privacy, and advanced preferences will live here.
              </p>
            </div>
          </div>
        ) : null}
            </div>

        {/* Error Message */}
        {errorMessage && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-md">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
              <span className="text-[11px] text-red-500">{errorMessage}</span>
            </div>
          </div>
        )}

        {/* Save Actions */}
        <div className="flex justify-end">
          <button 
            onClick={handleSave} 
            disabled={isLoading || !walletData.isConnected || !!usernameError}
            data-walkthrough="settings-save"
            className={`px-6 py-3 rounded-md font-medium text-sm transition-all duration-200 flex items-center gap-2 ${
              saveStatus === 'saving' 
                ? 'bg-yellow-500 text-black cursor-not-allowed' 
                : saveStatus === 'success'
                ? 'bg-green-500 text-black'
                : saveStatus === 'error'
                ? 'bg-red-500 text-white'
                : walletData.isConnected
                ? 'bg-[#0F0F0F] hover:bg-[#1A1A1A] border border-[#222222] hover:border-[#333333] text-white'
                : 'bg-[#404040] text-[#666666] cursor-not-allowed'
            }`}
          >
            {saveStatus === 'saving' && (
              <>
                <div className="w-3 h-3 border border-black/30 border-t-black rounded-full animate-spin" />
                Saving...
              </>
            )}
            {saveStatus === 'success' && (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Saved!
              </>
            )}
            {saveStatus === 'error' && (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                  <line x1="15" y1="9" x2="9" y2="15" stroke="currentColor" strokeWidth="2"/>
                  <line x1="9" y1="9" x2="15" y2="15" stroke="currentColor" strokeWidth="2"/>
                </svg>
                Error
              </>
            )}
            {saveStatus === 'idle' && (
              <>
                {walletData.isConnected ? (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <polyline points="17,21 17,13 7,13 7,21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <polyline points="7,3 7,8 15,8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Save Profile
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" stroke="currentColor" strokeWidth="2"/>
                      <line x1="8" y1="21" x2="16" y2="21" stroke="currentColor" strokeWidth="2"/>
                      <line x1="12" y1="17" x2="12" y2="21" stroke="currentColor" strokeWidth="2"/>
                    </svg>
                    Connect Wallet
                  </>
                )}
              </>
            )}
          </button>
        </div>
          </div>
        </div>
      </div>
    </div>
  )
} 