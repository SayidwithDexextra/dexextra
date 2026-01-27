'use client';

import React from 'react';
import Image from 'next/image';
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
  const isIconUrl = typeof icon === 'string' && (icon.startsWith('http://') || icon.startsWith('https://') || icon.startsWith('/'));
  return (
    <div className="flex justify-between items-center py-1.5 rounded transition-colors duration-200 hover:bg-black/20">
      <div className="flex items-center gap-1.5">
        {isIconUrl ? (
          <div style={{ width: 16, height: 16, position: 'relative' }}>
            <Image
              src={icon}
              alt=""
              fill
              sizes="16px"
              style={{ objectFit: 'cover', borderRadius: 999 }}
            />
          </div>
        ) : (
          <div className="w-4 h-4 flex items-center justify-center text-xs" style={{ opacity: 0.85 }}>
            {icon}
          </div>
        )}
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