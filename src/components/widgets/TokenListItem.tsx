'use client';

import React from 'react';
import styles from './styles/Widget.module.css';

interface TokenListItemProps {
  icon: string;
  name: string;
  price: string;
  change: number;
  isPositive: boolean;
  symbol?: string;
}

const TokenListItem: React.FC<TokenListItemProps> = ({ icon, name, price, change, isPositive }) => {
  return (
    <div className="flex justify-between items-center py-1.5 hover:bg-white hover:bg-opacity-[0.02] rounded transition-colors duration-200">
      <div className="flex items-center gap-1.5">
        <div className="w-4 h-4 rounded-full flex items-center justify-center text-xs">
          {icon}
        </div>
        <span className={styles.tokenNameTiny}>{name}</span>
      </div>
      
      <div className="flex items-center gap-1.5">
        <span className={styles.priceTiny}>{price}</span>
        <div className={`flex items-center gap-0.5 px-1 py-0.5 rounded text-xs font-medium ${
          isPositive ? styles.positive : styles.negative
        }`}>
          <span className="text-xs">{isPositive ? '▲' : '▼'}</span>
          <span>{change}%</span>
        </div>
      </div>
    </div>
  );
};

export default TokenListItem; 