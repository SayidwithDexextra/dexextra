import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import UserPage from '@/components/User/UserPage'
import { UserProfileService } from '@/lib/userProfileService'
import type { PublicUserProfile } from '@/types/userProfile'

function isWalletAddress(v: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(v)
}

export default async function UserWalletPage(props: { params: { wallet: string } }) {
  const { wallet: walletRaw } = props.params
  let wallet = String(walletRaw || '').trim()
  try {
    wallet = decodeURIComponent(wallet).trim()
  } catch {
    // ignore bad URI encoding; will fail validation below
  }

  if (!isWalletAddress(wallet)) {
    notFound()
  }

  let profile: PublicUserProfile | null = null
  try {
    profile = await UserProfileService.getPublicProfile(wallet)
  } catch {
    // If Supabase/env is misconfigured or query fails, render a friendly empty-state
    profile = null
  }

  return (
    <Suspense fallback={null}>
      <UserPage walletAddress={wallet} initialProfile={profile} />
    </Suspense>
  )
}

