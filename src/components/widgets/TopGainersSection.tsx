'use client';

import React from 'react';
import SectionHeader from './SectionHeader';
import TokenListItem from './TokenListItem';
import { mockTopGainerTokens } from './utils/mockData';
import styles from './styles/Widget.module.css';

const TopGainersSection: React.FC = () => {
  return (
    <div className={styles.card}>
      <SectionHeader 
        icon="🚀" 
        title="Top Gainers" 
        viewMoreLink="/top-gainers"
      />
      <div className="flex flex-col gap-3">
        {mockTopGainerTokens.map((token, index) => (
          <TokenListItem key={index} {...token} />
        ))}
      </div>
    </div>
  );
};

export default TopGainersSection; 