/**
 * Metric AI Worker Library Exports
 * 
 * This module exports all utilities from the metric-ai-worker.
 * For archiving, this is the SINGLE SOURCE OF TRUTH.
 */

// ==========================================
// ARCHIVING (Single Source of Truth)
// ==========================================
// Use archiveMulti for all archiving needs.
// It handles Internet Archive + Archive.today in parallel.
export {
  archiveMulti,
  type MultiArchiveResult,
  type MultiArchiveOptions,
  type ProviderResult,
  type ArchiveProvider,
} from './archiveMulti';

// Individual providers (use archiveMulti instead for most cases)
export { archivePage, type ArchiveResult } from './archivePage';
export { archiveToday, type ArchiveTodayResult } from './archiveToday';
