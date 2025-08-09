'use client';

import React from 'react';
import Image from 'next/image';

interface LoadingScreenProps {
  /** Main loading message */
  message?: string;
  /** Optional secondary message */
  subtitle?: string;
}

const LoadingScreen: React.FC<LoadingScreenProps> = ({
  message = "Loading...",
  subtitle
}) => {
  return (
    <div className="fixed inset-0 z-[9999] bg-white flex flex-col items-center justify-center">
      {/* Dexetra Logo with pulse animation */}
      <div className="animate-pulse">
        <Image
          src="/Dexicon/LOGO-Dexetera-07.svg"
          alt="Dexetra Logo"
          width={120}
          height={120}
          className="mb-8"
          priority
        />
      </div>
      
      {/* Loading text */}
      {message && (
        <div className="text-center">
          <h2 className="text-xl font-medium text-gray-900 mb-2">
            {message}
          </h2>
          {subtitle && (
            <p className="text-sm text-gray-600">
              {subtitle}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default LoadingScreen; 