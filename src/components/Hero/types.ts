export interface HeroStats {
  mintPrice: string;
  totalItems: number;
  mintStartsIn: string;
}

export interface HeroData {
  title: string;
  author: string;
  isVerified?: boolean;
  stats: HeroStats;
  backgroundImage?: string;
}

export interface CountdownTime {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export interface HeroProps {
  data: HeroData;
  className?: string;
  onMintClick?: () => void;
}

export interface HeroCardProps {
  data: HeroData;
  className?: string;
}

export interface VerificationBadgeProps {
  isVerified: boolean;
  className?: string;
}

export interface StatItemProps {
  label: string;
  value: string | number;
  className?: string;
}

export interface CountdownProps {
  targetDate: string;
  className?: string;
} 