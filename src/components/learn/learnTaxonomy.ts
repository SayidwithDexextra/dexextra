import { BookOpen, Compass, GraduationCap, Layers } from 'lucide-react';

export interface CategoryStyle {
  icon: typeof BookOpen;
  /** A hex accent used for tints, icon color, and hover glows. */
  accent: string;
  blurb: string;
}

const STYLES: Record<string, CategoryStyle> = {
  Fundamentals: {
    icon: BookOpen,
    accent: '#00D4FF',
    blurb: 'The core concepts — what these markets are and how they work.',
  },
  Guides: {
    icon: Compass,
    accent: '#A78BFA',
    blurb: 'Step-by-step walkthroughs to go from curious to trading.',
  },
  Strategy: {
    icon: GraduationCap,
    accent: '#34D399',
    blurb: 'Sharper thinking for reading markets and sizing positions.',
  },
};

const DEFAULT: CategoryStyle = {
  icon: Layers,
  accent: '#3B82F6',
  blurb: '',
};

export function getCategoryStyle(category: string): CategoryStyle {
  return STYLES[category] ?? DEFAULT;
}

/** Stable anchor id for a category section (used by hero topic pills). */
export function categoryAnchor(category: string): string {
  return category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** Append an 8-digit-hex alpha to a 6-digit hex (e.g. "#00D4FF" + 20 → "#00D4FF20"). */
export function withAlpha(hex: string, alpha: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) return `${hex}${alpha}`;
  return hex;
}
