/**
 * Auto-discovery of CSS selectors for fast metric extraction.
 *
 * Uses Jina Reader (X-Return-Format: html) to fetch the rendered HTML,
 * then cheerio to parse and probe the DOM server-side. No Puppeteer needed.
 */

import * as cheerio from 'cheerio';
import { fetchHtmlWithJina } from './jinaReader';

// ─── Types ─────────────────────────────────────────────────────────

export interface DiscoveredSelector {
  type: 'css';
  selector?: string;
  xpath?: string;
  script?: string;
  confidence: number;
  sample_value: string;
}

export interface AiSourceLocatorData {
  url: string;
  discovered_at: string;
  selectors: DiscoveredSelector[];
  text_pattern: string | null;
  primary_evidence_type: string;
  last_successful_at: string | null;
  success_count: number;
  failure_count: number;
  version: number;
}

// ─── Selector builder ──────────────────────────────────────────────

type CheerioSelection = ReturnType<cheerio.CheerioAPI>;

function buildCssSelector($: cheerio.CheerioAPI, el: CheerioSelection): string {
  const parts: string[] = [];
  let cur = el;

  for (let depth = 0; depth < 8; depth++) {
    const node = cur.get(0);
    if (!node || node.type !== 'tag') break;

    const tagName = node.tagName.toLowerCase();
    if (tagName === 'body' || tagName === 'html') break;

    const id = cur.attr('id');
    if (id) {
      parts.unshift(`#${CSS.escape(id)}`);
      break;
    }

    const testAttr = cur.attr('data-test') || cur.attr('data-testid');
    if (testAttr) {
      parts.unshift(`${tagName}[data-test="${testAttr}"]`);
      break;
    }

    let part = tagName;

    const classAttr = cur.attr('class') || '';
    const stableClasses = classAttr
      .split(/\s+/)
      .filter(c => c && c.length < 40 && !/^[a-z]{1,3}[A-Z0-9]/.test(c) && !/^css-/.test(c))
      .slice(0, 2);
    if (stableClasses.length) {
      part += '.' + stableClasses.map(c => CSS.escape(c)).join('.');
    }

    const parent = cur.parent();
    if (parent.length) {
      const siblings = parent.children(tagName);
      if (siblings.length > 1) {
        const idx = siblings.index(cur) + 1;
        part += `:nth-child(${idx})`;
      }
    }

    parts.unshift(part);
    cur = cur.parent() as CheerioSelection;
  }

  return parts.join(' > ');
}

// ─── CSS.escape polyfill (Node doesn't have it natively) ───────────

if (typeof CSS === 'undefined' || !CSS.escape) {
  (globalThis as any).CSS = {
    escape(value: string): string {
      return value.replace(/([^\w-])/g, '\\$1');
    },
  };
}

// ─── Core discovery ────────────────────────────────────────────────

interface RawCandidate {
  css: string;
  text: string;
  specificity: number;
  context: string;
}

function findCandidates(
  $: cheerio.CheerioAPI,
  numericStr: string,
): RawCandidate[] {
  const found: RawCandidate[] = [];

  $('body *').each((_, elem) => {
    const el = $(elem);

    // Only look at leaf-ish elements (no deep nesting of children with text)
    const directText = el.contents()
      .filter((_, n) => n.type === 'text')
      .text()
      .trim();
    if (!directText) return;

    const cleaned = directText.replace(/[$€£¥,\s]/g, '');
    if (!cleaned.includes(numericStr)) return;

    const css = buildCssSelector($, el);
    if (!css) return;

    let specificity = 0;
    if (css.includes('#')) specificity += 3;
    if (css.includes('[data-test')) specificity += 2;
    if (css.includes('.')) specificity += 1;

    const priceClasses = ['price', 'Price', 'value', 'Value', 'quote', 'Quote', 'last', 'Last'];
    const classAttr = el.attr('class') || '';
    if (priceClasses.some(pc => classAttr.includes(pc))) specificity += 2;
    if (el.closest('[class*="price"], [class*="Price"], [class*="value"], [class*="Value"]').length) specificity += 1;

    const parentText = (el.parent().text() || '').trim().slice(0, 120);

    found.push({ css, text: directText.slice(0, 80), specificity, context: parentText });
  });

  found.sort((a, b) => b.specificity - a.specificity);
  return found.slice(0, 6);
}

// ─── Public API ────────────────────────────────────────────────────

/**
 * Discover CSS selectors that resolve to `confirmedValue`.
 * Fetches rendered HTML via Jina, parses with cheerio.
 */
export async function discoverLocators(
  url: string,
  confirmedValue: string,
  primaryEvidenceType: string = 'vision',
): Promise<AiSourceLocatorData | null> {
  const started = Date.now();

  try {
    const numericStr = String(confirmedValue).replace(/[^0-9.\-]/g, '');
    if (!numericStr || !Number.isFinite(Number(numericStr))) {
      console.log('[AutoLocator] Skipped — confirmed value not numeric');
      return null;
    }

    console.log(`[AutoLocator] Fetching rendered HTML via Jina for ${url}`);
    const htmlResult = await fetchHtmlWithJina(url, { timeoutMs: 30_000 });
    if (!htmlResult.success || !htmlResult.html) {
      console.log(`[AutoLocator] Failed to fetch HTML: ${htmlResult.error}`);
      return null;
    }

    const $ = cheerio.load(htmlResult.html);
    const candidates = findCandidates($, numericStr);

    if (candidates.length === 0) {
      console.log(`[AutoLocator] No DOM matches for "${numericStr}" on ${url} (${Date.now() - started}ms)`);
      return null;
    }

    // Verify each candidate re-resolves to the value
    const verified: DiscoveredSelector[] = [];
    for (const c of candidates) {
      try {
        const resolvedText = $(c.css).first().text().trim();
        const resolvedClean = resolvedText.replace(/[$€£¥,\s]/g, '');
        if (!resolvedClean.includes(numericStr)) continue;

        const conf = Math.min(0.95, 0.5 + c.specificity * 0.1);
        verified.push({ type: 'css', selector: c.css, confidence: conf, sample_value: numericStr });
      } catch {
        continue;
      }
    }

    if (verified.length === 0) {
      console.log(`[AutoLocator] Candidates found but none re-verified on ${url}`);
      return null;
    }

    verified.sort((a, b) => b.confidence - a.confidence);
    const topSelectors = verified.slice(0, 9);

    // Build a text pattern from the surrounding context of the best match
    let textPattern: string | null = null;
    const bestCtx = candidates[0]?.context || '';
    if (bestCtx && numericStr) {
      const idx = bestCtx.replace(/[$€£¥,\s]/g, '').indexOf(numericStr);
      if (idx >= 0) {
        const escaped = numericStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        textPattern = `[\\$€£¥]?\\s*${escaped.replace(/\d/g, '\\d')}`;
      }
    }

    const now = new Date().toISOString();
    const result: AiSourceLocatorData = {
      url,
      discovered_at: now,
      selectors: topSelectors,
      text_pattern: textPattern,
      primary_evidence_type: primaryEvidenceType,
      last_successful_at: now,
      success_count: 1,
      failure_count: 0,
      version: 2,
    };

    console.log(`[AutoLocator] Discovered ${topSelectors.length} selectors for ${url} in ${Date.now() - started}ms (via Jina + cheerio)`);
    return result;

  } catch (err) {
    console.error('[AutoLocator] Discovery failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Use stored CSS selectors to extract a value without the full vision pipeline.
 * Fetches rendered HTML via Jina, evaluates selectors with cheerio.
 */
export async function fastExtract(
  url: string,
  selectors: DiscoveredSelector[],
): Promise<{ value: string; method: string; selector: string; extractTimeMs: number } | null> {
  const started = Date.now();

  try {
    console.log(`[FastExtract] Fetching rendered HTML via Jina for ${url}`);
    const htmlResult = await fetchHtmlWithJina(url, { timeoutMs: 25_000 });
    if (!htmlResult.success || !htmlResult.html) {
      console.log(`[FastExtract] Failed to fetch HTML: ${htmlResult.error}`);
      return null;
    }

    const $ = cheerio.load(htmlResult.html);
    const sorted = [...selectors].sort((a, b) => b.confidence - a.confidence);

    for (const sel of sorted) {
      try {
        if (sel.type !== 'css' || !sel.selector) continue;

        const el = $(sel.selector).first();
        if (!el.length) continue;

        const rawText = el.text().trim();
        if (!rawText) continue;

        const cleaned = rawText.replace(/[$€£¥,\s]/g, '');
        const numMatch = cleaned.match(/-?[\d]+\.?\d*/);
        if (!numMatch) continue;

        const num = Number(numMatch[0]);
        if (!Number.isFinite(num) || num <= 0) continue;

        console.log(`[FastExtract] ✓ Extracted "${numMatch[0]}" via ${sel.selector} in ${Date.now() - started}ms`);
        return {
          value: numMatch[0],
          method: sel.type,
          selector: sel.selector,
          extractTimeMs: Date.now() - started,
        };
      } catch {
        continue;
      }
    }

    console.log(`[FastExtract] No selectors matched on ${url}`);
    return null;
  } catch (err) {
    console.error('[FastExtract] Failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
