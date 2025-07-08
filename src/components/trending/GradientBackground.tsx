'use client';

import React from 'react';

interface GradientBackgroundProps {
  type: 'card1' | 'card2' | 'card3' | 'card4';
  className?: string;
}

const gradientMap = {
  card1: 'linear-gradient(135deg, #8B5CF6 0%, #F59E0B 50%, #3B82F6 100%)',
  card2: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 50%, #10B981 100%)',
  card3: 'linear-gradient(135deg, #8B5CF6 0%, #EC4899 50%, #F59E0B 100%)',
  card4: 'linear-gradient(135deg, #F59E0B 0%, #EC4899 50%, #3B82F6 100%)'
};

export const GradientBackground: React.FC<GradientBackgroundProps> = ({
  type,
  className = ''
}) => {
  const gradient = gradientMap[type];

  return (
    <>
      <div className={`gradient-background ${className}`} />
      <style jsx>{`
        .gradient-background {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: ${gradient};
          border-radius: inherit;
          z-index: 0;
        }
      `}</style>
    </>
  );
}; 