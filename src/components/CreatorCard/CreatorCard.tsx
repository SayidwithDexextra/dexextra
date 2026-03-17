'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import styles from './CreatorCard.module.css';
import { DEFAULT_PROFILE_IMAGE } from '@/types/userProfile';

interface CreatorCardProps {
  creatorWallet?: string;
  currentUserWallet?: string;
  className?: string;
}

interface CreatorProfile {
  id: string;
  wallet_address: string;
  username?: string;
  display_name?: string;
  profile_image_url?: string;
}

export default function CreatorCard({
  creatorWallet,
  currentUserWallet,
  className,
}: CreatorCardProps) {
  const [creatorProfile, setCreatorProfile] = useState<CreatorProfile | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch creator profile
  useEffect(() => {
    if (!creatorWallet) return;

    const fetchCreator = async () => {
      try {
        const response = await fetch(`/api/profile?wallet=${creatorWallet.toLowerCase()}`);
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.data) {
            setCreatorProfile(data.data);
          }
        }
      } catch (err) {
        console.error('Error fetching creator profile:', err);
      }
    };

    fetchCreator();
  }, [creatorWallet]);

  // Check if current user is following this creator
  useEffect(() => {
    if (!currentUserWallet || !creatorProfile?.id) return;

    const checkFollowing = async () => {
      try {
        const response = await fetch(
          `/api/watchlist?wallet=${currentUserWallet.toLowerCase()}`
        );
        if (response.ok) {
          const data = await response.json();
          const watchedUserIds = data.watched_user_ids || [];
          setIsFollowing(watchedUserIds.includes(creatorProfile.id));
        }
      } catch (err) {
        console.error('Error checking follow status:', err);
      }
    };

    checkFollowing();
  }, [currentUserWallet, creatorProfile?.id]);

  const handleFollow = useCallback(async () => {
    if (!currentUserWallet || !creatorProfile?.id) return;

    setIsLoading(true);
    try {
      if (isFollowing) {
        const response = await fetch('/api/watchlist', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wallet_address: currentUserWallet,
            watched_user_id: creatorProfile.id,
          }),
        });
        if (response.ok) {
          setIsFollowing(false);
        }
      } else {
        const response = await fetch('/api/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wallet_address: currentUserWallet,
            watched_user_id: creatorProfile.id,
          }),
        });
        if (response.ok) {
          setIsFollowing(true);
        }
      }
    } catch (err) {
      console.error('Error toggling follow:', err);
    } finally {
      setIsLoading(false);
    }
  }, [currentUserWallet, creatorProfile?.id, isFollowing]);

  const formatWallet = (wallet: string) => {
    return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
  };

  if (!creatorWallet) {
    return null;
  }

  const displayName = creatorProfile?.display_name || creatorProfile?.username || formatWallet(creatorWallet);
  const isOwnProfile = currentUserWallet?.toLowerCase() === creatorWallet?.toLowerCase();

  return (
    <div className={`${styles.container} ${className || ''}`}>
      <div className={styles.header}>
        <span className={styles.title}>Creator</span>
      </div>
      
      <div className={styles.content}>
        <Link href={`/user/${creatorWallet}`} className={styles.creatorInfo}>
          <div className={styles.avatar}>
            <img 
              src={creatorProfile?.profile_image_url || DEFAULT_PROFILE_IMAGE} 
              alt="" 
              className={styles.avatarImg} 
            />
          </div>
          
          <div className={styles.details}>
            <div className={styles.nameRow}>
              <span className={styles.name}>{displayName}</span>
              <span className={styles.badge}>Creator</span>
            </div>
          </div>
        </Link>

        {!isOwnProfile && currentUserWallet && (
          <button
            className={`${styles.followBtn} ${isFollowing ? styles.followBtnActive : ''}`}
            onClick={handleFollow}
            disabled={isLoading}
          >
            {isLoading ? '...' : isFollowing ? 'Following' : 'Follow'}
          </button>
        )}
      </div>
    </div>
  );
}
