export interface CountdownTickerProps {
  /** Target date to count down to */
  targetDate: Date | string;
  /** Optional title to display */
  title?: string;
  /** Optional subtitle to display */
  subtitle?: string;
  /** Callback when countdown reaches zero */
  onComplete?: () => void;
  /** Custom CSS class name */
  className?: string;
  /** Whether to show the banner layout or just the ticker */
  showBanner?: boolean;
}

export interface TimeRemaining {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export interface CountdownItemProps {
  value: number;
  label: string;
  className?: string;
} 