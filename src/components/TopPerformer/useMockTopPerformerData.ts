"use client";

import { useMemo } from 'react';
import { TopPerformerData } from './types';

/**
 * Mock data hook for TopPerformer component
 * Provides sample data for testing and development
 */
export const useMockTopPerformerData = (): TopPerformerData[] => {
  const mockData: TopPerformerData[] = useMemo(() => [
    {
      id: '1',
      name: 'Alex neuski',
      role: 'Designer',
      description: 'UI/UX specialist with 5+ years experience',
      avatarUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&h=150&fit=crop&crop=face',
      profileUrl: 'https://example.com/alex'
    },
    {
      id: '2',
      name: 's0undpad',
      role: 'Other',
      description: 'Audio engineer & music producer',
      avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop&crop=face',
      profileUrl: 'https://example.com/soundpad'
    },
    {
      id: '3',
      name: 'Jawad Shreim',
      role: 'Founder',
      description: 'Tech entrepreneur & startup mentor',
      avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&h=150&fit=crop&crop=face',
      profileUrl: 'https://example.com/jawad'
    },
    {
      id: '4',
      name: 'Myles Snider',
      role: 'Writer',
      description: 'Technical content creator',
      avatarUrl: 'https://images.unsplash.com/photo-1519244703995-f4e0f30006d5?w=150&h=150&fit=crop&crop=face',
      profileUrl: 'https://example.com/myles'
    },
    {
      id: '5',
      name: 'APHORIST',
      role: 'minimalism × techno',
      description: 'Electronic music producer',
      avatarUrl: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150&h=150&fit=crop&crop=face',
      profileUrl: 'https://example.com/aphorist'
    },
    {
      id: '6',
      name: 'Lauren LeDonne',
      role: 'a personal website',
      description: 'Full-stack web developer',
      avatarUrl: 'https://images.unsplash.com/photo-1494790108755-2616b612b977?w=150&h=150&fit=crop&crop=face',
      profileUrl: 'https://example.com/lauren'
    },
    {
      id: '7',
      name: 'hacxx',
      role: 'hacxx',
      description: 'Cybersecurity researcher',
      avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&h=150&fit=crop&crop=face',
      profileUrl: 'https://example.com/hacxx'
    },
    {
      id: '8',
      name: 'QAComet | Nucelo blog',
      role: 'qacomet',
      description: 'Quality assurance engineer',
      avatarUrl: 'https://images.unsplash.com/photo-1566492031773-4f4e44671d66?w=150&h=150&fit=crop&crop=face',
      profileUrl: 'https://example.com/qacomet'
    },
    {
      id: '9',
      name: 'Leo',
      role: 'Product and Website Designer',
      description: 'Design systems & user experience',
      avatarUrl: 'https://images.unsplash.com/photo-1507591064344-4c6ce005b128?w=150&h=150&fit=crop&crop=face',
      profileUrl: 'https://example.com/leo'
    },
    {
      id: '10',
      name: 'Sarah Chen',
      role: 'Data Scientist',
      description: 'ML & AI researcher',
      avatarUrl: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150&h=150&fit=crop&crop=face',
      profileUrl: 'https://example.com/sarah'
    },
    {
      id: '11',
      name: 'Marcus Johnson',
      role: 'DevOps Engineer',
      description: 'Cloud infrastructure specialist',
      avatarUrl: 'https://images.unsplash.com/photo-1463453091185-61582044d556?w=150&h=150&fit=crop&crop=face',
      profileUrl: 'https://example.com/marcus'
    },
    {
      id: '12',
      name: 'Emma Rodriguez',
      role: 'Brand Designer',
      description: 'Visual identity & branding',
      avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&h=150&fit=crop&crop=face',
      profileUrl: 'https://example.com/emma'
    }
  ], []);

  return mockData;
};

export default useMockTopPerformerData; 