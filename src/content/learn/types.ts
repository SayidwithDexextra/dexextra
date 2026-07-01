import type { ComponentType } from 'react';

export interface LearnFaq {
  question: string;
  answer: string;
}

export interface LearnArticle {
  /** URL slug — `/learn/[slug]`. */
  slug: string;
  /** Page `<title>` / H1. */
  title: string;
  /** Meta description (≈150–160 chars). */
  description: string;
  /** Short summary shown on the `/learn` index card. */
  excerpt: string;
  /** ISO date string. */
  datePublished: string;
  /** ISO date string (defaults to datePublished). */
  dateModified?: string;
  /** Editorial category label. */
  category: string;
  /** Target search keywords. */
  keywords: string[];
  /** Approximate reading time in minutes. */
  readingMinutes: number;
  /** Optional Q&A — rendered visibly and as FAQPage JSON-LD. */
  faqs?: LearnFaq[];
  /** Server component that renders the article body. */
  Body: ComponentType;
}
