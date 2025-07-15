"use client";

import React from 'react';
import Image from 'next/image';
import { TopPerformerCardProps } from './types';
import styles from './TopPerformer.module.css';

const TopPerformerCard: React.FC<TopPerformerCardProps> = ({ 
  performer, 
  onClick 
}) => {
  const handleClick = () => {
    if (onClick) {
      onClick(performer);
    } else if (performer.profileUrl) {
      window.open(performer.profileUrl, '_blank');
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleClick();
    }
  };

  return (
    <div 
      className={styles.card}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-label={`View profile of ${performer.name}, ${performer.role}`}
    >
      <div className={styles.avatarContainer}>
        <Image
          src={performer.avatarUrl || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzIiIGhlaWdodD0iNzIiIHZpZXdCb3g9IjAgMCA3MiA3MiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjcyIiBoZWlnaHQ9IjcyIiByeD0iMzYiIGZpbGw9IiMzMzMzMzMiLz4KPHN2ZyB4PSIyNCIgeT0iMTgiIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSIjNjY2NjY2Ij4KPHA+YXRoIGQ9Ik0xMiAxMmMyLjIxIDAgNC0xLjc5IDQtNHMtMS43OS00LTQtNC00IDEuNzktNCA0IDEuNzkgNCA0IDR6bTAgMmMtMi42NyAwLTggMS4zNC04IDR2MmgxNnYtMmMwLTIuNjYtNS4zMy00LTgtNHoiLz4KPC9zdmc+Cjwvc3ZnPgo='}
          alt={`${performer.name} avatar`}
          width={72}
          height={72}
          className={styles.avatar}
          unoptimized={performer.avatarUrl?.startsWith('data:')}
        />
      </div>
      
      <div className={styles.contentContainer}>
        <h3 className={styles.name}>{performer.name}</h3>
        <p className={styles.role}>{performer.role}</p>
        {performer.description && (
          <p className={styles.description}>{performer.description}</p>
        )}
      </div>
      
      {performer.profileUrl && (
        <svg 
          className={styles.linkIcon}
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2"
        >
          <path d="M7 17L17 7M17 7H7M17 7V17" />
        </svg>
      )}
    </div>
  );
};

export default TopPerformerCard; 