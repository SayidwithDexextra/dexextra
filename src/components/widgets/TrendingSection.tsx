'use client';

import React from 'react';
import SectionHeader from './SectionHeader';
import TokenListItem from './TokenListItem';
import { mockTrendingTokens } from './utils/mockData';
import styles from './styles/Widget.module.css';

const TrendingSection: React.FC = () => {
  return (
    <div className={styles.card}>
      <SectionHeader 
        icon="🔥" 
        title="Trending" 
        viewMoreLink="/trending"
      />
      <div className="flex flex-col gap-3">
        {mockTrendingTokens.map((token, index) => (
          <TokenListItem key={index} {...token} />
        ))}
      </div>
    </div>
  );
};

export default TrendingSection; 