'use client';

import React from 'react';

interface NFTGraphicProps {
  type: 'sphere' | 'crystal' | 'fluid' | 'geometric';
  className?: string;
}

export const NFTGraphic: React.FC<NFTGraphicProps> = ({ type, className = '' }) => {
  switch (type) {
    case 'sphere':
      return <SphereGraphic className={className} />;
    case 'crystal':
      return <CrystalGraphic className={className} />;
    case 'fluid':
      return <FluidGraphic className={className} />;
    case 'geometric':
      return <GeometricGraphic className={className} />;
    default:
      return <SphereGraphic className={className} />;
  }
};

const SphereGraphic: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`nft-sphere ${className}`}>
    <div className="sphere" />
    <style jsx>{`
      .nft-sphere {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .sphere {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: linear-gradient(135deg, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0.1) 100%);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255,255,255,0.2);
      }
    `}</style>
  </div>
);

const CrystalGraphic: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`nft-crystal ${className}`}>
    <div className="crystal" />
    <style jsx>{`
      .nft-crystal {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .crystal {
        width: 45px;
        height: 50px;
        background: linear-gradient(135deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0.05) 100%);
        clip-path: polygon(50% 0%, 0% 100%, 100% 100%);
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255,255,255,0.15);
      }
    `}</style>
  </div>
);

const FluidGraphic: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`nft-fluid ${className}`}>
    <div className="fluid" />
    <style jsx>{`
      .nft-fluid {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .fluid {
        width: 50px;
        height: 30px;
        background: linear-gradient(135deg, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0.1) 100%);
        border-radius: 50px;
        backdrop-filter: blur(12px);
        border: 1px solid rgba(255,255,255,0.2);
        transform: rotate(-15deg);
      }
    `}</style>
  </div>
);

const GeometricGraphic: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`nft-geometric ${className}`}>
    <div className="geometric" />
    <style jsx>{`
      .nft-geometric {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .geometric {
        width: 40px;
        height: 40px;
        background: linear-gradient(135deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0.1) 100%);
        clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255,255,255,0.15);
      }
    `}</style>
  </div>
); 