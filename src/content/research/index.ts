import type { ResearchPost } from './types';
import sampleIssue from './sample-issue';

/**
 * Content source for the `/research` smart-money layer.
 *
 * Today this returns hand-built placeholder content (a single labeled sample).
 * When the Polymarket ingestion + generation engine land, swap `POSTS` for a
 * Supabase-backed fetch (e.g. a `pm_posts` table). The routes, renderers, and
 * JSON-LD never change — only this provider does.
 */
export const RESEARCH_CONFIG = {
  /**
   * Master switch for indexing the `/research` section. Keep `false` until real,
   * data-grounded posts are flowing — this enforces the plan's thin-content
   * guard (don't let placeholder pages get indexed).
   */
  indexable: false,
};

const POSTS: ResearchPost[] = [sampleIssue];

const SORTED = [...POSTS].sort(
  (a, b) =>
    new Date(b.datePublished).getTime() - new Date(a.datePublished).getTime()
);

export function getAllResearchPosts(): ResearchPost[] {
  return SORTED;
}

export function getResearchPost(slug: string): ResearchPost | undefined {
  return POSTS.find((p) => p.slug === slug);
}

export function getResearchSlugs(): string[] {
  return POSTS.map((p) => p.slug);
}

/** A post is indexable only when the section is enabled AND it is not a sample. */
export function isResearchPostIndexable(post: ResearchPost): boolean {
  return RESEARCH_CONFIG.indexable && !post.isSample;
}

/** Slugs that are safe to expose in the sitemap (indexable, non-sample). */
export function getIndexableResearchSlugs(): string[] {
  return getAllResearchPosts()
    .filter(isResearchPostIndexable)
    .map((p) => p.slug);
}
