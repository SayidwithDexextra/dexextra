'use client';

import React from 'react';
import styles from './styles/Widget.module.css';

interface SectionHeaderProps {
  icon: string;
  title: string;
  viewMoreLink: string;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({ icon, title, viewMoreLink }) => {
  return (
    <div className="flex justify-between items-center pb-2 mb-2 border-b border-gray-800">
      <div className="flex items-center gap-1.5">
        <span className="text-sm">{icon}</span>
        <h2 className={styles.sectionHeaderSmall}>{title}</h2>
      </div>
      <a 
        href={viewMoreLink}
        className={styles.viewMoreLinkSmall}
      >
        View more
        <span className="text-xs">›</span>
      </a>
    </div>
  );
};

export default SectionHeader; 