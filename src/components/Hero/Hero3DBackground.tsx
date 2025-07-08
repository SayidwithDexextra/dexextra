'use client';

import React, { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import styles from './Hero.module.css';

// Placeholder for your 3D scene - replace this with your actual 3D content
const Scene: React.FC = () => {
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="hotpink" />
    </mesh>
  );
};

const Hero3DBackground: React.FC = () => {
  return (
    <div className={styles.hero3DBackground}>
      <Canvas
        camera={{ position: [0, 0, 5], fov: 75 }}
        style={{ 
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          zIndex: 1
        }}
      >
        <Suspense fallback={null}>
          <ambientLight intensity={0.5} />
          <pointLight position={[10, 10, 10]} />
          {/* Replace this Scene component with your actual 3D content */}
          <Scene />
        </Suspense>
      </Canvas>
    </div>
  );
};

export default Hero3DBackground; 