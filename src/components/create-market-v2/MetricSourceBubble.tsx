'use client';

import React from 'react';
import { MetricSource, type SearchResult } from '@/types/metricDiscovery';
import { DataSourceTooltip, DataSourceTooltipContent } from '@/components/ui/Tooltip';

export interface MetricSourceOption {
  id: string;
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  url: string;
  confidence: number;
  authority: string;
  badge?: string;
  iconBg: string;
  tooltip: DataSourceTooltipContent;
}

interface MetricSourceBubbleProps {
  primarySource: MetricSource | null;
  secondarySources: MetricSource[];
  metricName?: string;
  /** Optional SerpApi results; used to populate icon + tooltip snippet. */
  searchResults?: SearchResult[];
  onSelectSource?: (source: MetricSourceOption) => void;
  /** Fetch status for Step 3 source discovery. */
  fetchState?: 'idle' | 'loading' | 'success' | 'error';
  onRetry?: () => void;
  isVisible: boolean;
  /** If provided, marks a previously validated URL with a small badge. */
  validatedSourceUrl?: string | null;
}

function normalizeUrl(url: string) {
  try {
    const u = new URL(url);
    u.hash = '';
    // Keep query for API endpoints; just normalize trailing slash.
    return u.toString().replace(/\/$/, '');
  } catch {
    return (url || '').trim().replace(/\/$/, '');
  }
}

function normalizeHttpUrl(raw: string) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(candidate);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function getHostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isApiLikeUrl(url: string) {
  const u = (url || '').toLowerCase();
  return u.includes('/api/') || u.includes('api.') || u.includes('api?') || u.includes('api=');
}

function reliabilityFromConfidence(confidence: number) {
  const pct = Math.round((Number.isFinite(confidence) ? confidence : 0) * 100);
  if (pct >= 95) return `Very High (${pct}%)`;
  if (pct >= 85) return `High (${pct}%)`;
  if (pct >= 70) return `Medium (${pct}%)`;
  return `Low (${pct}%)`;
}

function heuristicConfidenceFromDomain(domainOrHost: string) {
  const d = (domainOrHost || '').toLowerCase();
  if (!d) return 0.6;

  // Prefer official / institutional sources.
  if (d.endsWith('.gov') || d.includes('.gov.')) return 0.92;
  if (d.endsWith('.edu') || d.includes('.edu.')) return 0.85;
  if (d.endsWith('.int') || d.includes('.int.')) return 0.88;

  // Well-known public data aggregators / institutions.
  if (
    d.includes('worldbank.org') ||
    d.includes('imf.org') ||
    d.includes('oecd.org') ||
    d.includes('un.org') ||
    d.includes('eia.gov') ||
    d.includes('noaa.gov') ||
    d.includes('fred.stlouisfed.org')
  ) {
    return 0.88;
  }

  // Common low-signal / paywall-ish sources.
  if (d.includes('scribd.com')) return 0.35;
  if (d.includes('medium.com') || d.includes('substack.com')) return 0.4;

  return 0.6;
}

const ICON_BACKGROUNDS = [
  'bg-gradient-to-br from-emerald-400 to-emerald-600',
  'bg-gradient-to-br from-blue-500 to-indigo-600',
  'bg-gradient-to-br from-yellow-400 to-orange-500',
  'bg-gradient-to-br from-purple-500 to-purple-700',
  'bg-gradient-to-br from-pink-500 to-rose-600',
  'bg-gradient-to-br from-cyan-400 to-sky-600',
  'bg-gradient-to-br from-lime-400 to-green-600',
  'bg-gradient-to-br from-gray-500 to-gray-700',
];

function hashToIndex(input: string, mod: number) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return mod ? hash % mod : 0;
}

function makeFaviconUrl(params: { favicon?: string; domain?: string }) {
  if (params.favicon) return params.favicon;
  const domain = (params.domain || '').trim();
  if (!domain) return undefined;
  // Fallback: Google favicon service.
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}

function makeIconNode(params: { faviconUrl?: string; label: string }) {
  const letter = (params.label || '?').trim().slice(0, 1).toUpperCase();
  return (
    <div className="relative h-7 w-7">
      {/* Always render a clean fallback so the tile looks uniform even if favicon fails. */}
      <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/15 text-white/90">
        <span className="text-[14px] font-semibold">{letter}</span>
      </div>
      {params.faviconUrl ? (
        <img
          src={params.faviconUrl}
          alt=""
          className="absolute inset-0 h-7 w-7 rounded-lg bg-white p-1 object-contain shadow-sm"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={(e) => {
            // If favicon fails, fall back to the letter underneath.
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : null}
    </div>
  );
}

function buildTooltip(params: {
  authority: string;
  confidence: number;
  url: string;
  searchResult?: SearchResult;
}): DataSourceTooltipContent {
  const domain = params.searchResult?.domain || getHostname(params.url);
  const name = params.authority || params.searchResult?.source || domain || 'Data source';
  const description =
    params.searchResult?.snippet ||
    (domain ? `Data source from ${domain}.` : 'Public data source discovered via web search.');

  const isApi = isApiLikeUrl(params.url);

  return {
    name,
    description,
    reliability: reliabilityFromConfidence(params.confidence),
    updateFrequency: isApi ? 'API (typically near real-time)' : 'Unknown (web)',
    dataType: isApi ? 'API' : 'Web',
  };
}

export function MetricSourceBubble({
  primarySource,
  secondarySources,
  metricName,
  searchResults,
  onSelectSource,
  fetchState = 'idle',
  onRetry,
  isVisible,
  validatedSourceUrl = null,
}: MetricSourceBubbleProps) {
  // "Focused" is the extra step: user clicks a bubble to inspect it,
  // then explicitly hits Select to validate/continue.
  const [focusedSource, setFocusedSource] = React.useState<MetricSourceOption | null>(null);
  const [hasAnimated, setHasAnimated] = React.useState(false);
  const [customMode, setCustomMode] = React.useState(false);
  const [customUrl, setCustomUrl] = React.useState('');
  const [customError, setCustomError] = React.useState<string | null>(null);
  const customInputRef = React.useRef<HTMLInputElement>(null);

  const sourceOptions = React.useMemo<MetricSourceOption[]>(() => {
    const ordered: Array<{ source: MetricSource; isPrimary: boolean }> = [];
    if (primarySource?.url) ordered.push({ source: primarySource, isPrimary: true });
    for (const s of secondarySources || []) {
      if (s?.url) ordered.push({ source: s, isPrimary: false });
    }

    const map = new Map<string, SearchResult>();
    for (const r of searchResults || []) {
      if (!r?.url) continue;
      map.set(normalizeUrl(r.url), r);
    }

    // If the AI did not select any sources, fall back to raw SERP results.
    // This lets the user pick a candidate source even when the model is conservative.
    if (!ordered.length) {
      const candidates = (searchResults || [])
        .filter((r) => Boolean(r?.url))
        .slice(0, 10);

      return candidates.map((r, idx) => {
        const domain = r.domain || getHostname(r.url);
        const label = r.source?.trim() || domain || 'Candidate';
        const sublabel = domain && domain !== label ? domain : undefined;
        const faviconUrl = makeFaviconUrl({ favicon: r.favicon, domain });
        const iconBg = ICON_BACKGROUNDS[hashToIndex(domain || label, ICON_BACKGROUNDS.length)];
        const confidence = heuristicConfidenceFromDomain(domain);

        return {
          id: `candidate-${idx}-${domain || label}`.toLowerCase(),
          icon: makeIconNode({ faviconUrl, label }),
          label,
          sublabel,
          url: r.url,
          confidence,
          authority: r.source?.trim() || label,
          badge: 'Candidate',
          iconBg,
          tooltip: buildTooltip({
            authority: r.source?.trim() || label,
            confidence,
            url: r.url,
            searchResult: r,
          }),
        };
      });
    }

    return ordered.map(({ source, isPrimary }, idx) => {
      const sr = map.get(normalizeUrl(source.url));
      const domain = sr?.domain || getHostname(source.url);
      const label = sr?.source?.trim() || source.authority?.trim() || domain || 'Source';
      const sublabel = domain && domain !== label ? domain : undefined;
      const faviconUrl = makeFaviconUrl({ favicon: sr?.favicon, domain });
      const iconBg = ICON_BACKGROUNDS[hashToIndex(domain || label, ICON_BACKGROUNDS.length)];

      return {
        id: `${isPrimary ? 'primary' : 'secondary'}-${idx}-${domain || label}`.toLowerCase(),
        icon: makeIconNode({ faviconUrl, label }),
        label,
        sublabel,
        url: source.url,
        confidence: source.confidence ?? 0,
        authority: source.authority ?? label,
        badge: isPrimary ? 'Primary' : undefined,
        iconBg,
        tooltip: buildTooltip({
          authority: source.authority ?? label,
          confidence: source.confidence ?? 0,
          url: source.url,
          searchResult: sr,
        }),
      };
    });
  }, [primarySource, secondarySources, searchResults]);

  const validatedKey = React.useMemo(
    () => (validatedSourceUrl ? normalizeUrl(validatedSourceUrl) : null),
    [validatedSourceUrl]
  );

  // Trigger animations after mount
  React.useEffect(() => {
    if (isVisible && !hasAnimated) {
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => setHasAnimated(true), 50);
      return () => clearTimeout(timer);
    }
  }, [isVisible, hasAnimated]);

  // Reset animation state when visibility changes
  React.useEffect(() => {
    if (!isVisible) {
      setHasAnimated(false);
      setFocusedSource(null);
    }
  }, [isVisible]);

  React.useEffect(() => {
    if (!customMode) return;
    // Let the collapse animation start, then focus.
    const t = window.setTimeout(() => customInputRef.current?.focus(), 220);
    return () => window.clearTimeout(t);
  }, [customMode]);

  const focusedId = focusedSource?.id ?? null;
  const isFocused = Boolean(focusedSource);
  const isValidatedUrl = React.useCallback(
    (url: string) => Boolean(validatedKey) && normalizeUrl(url) === validatedKey,
    [validatedKey]
  );

  // If options change (re-search), clear an invalid focus (but keep custom URL focus).
  React.useEffect(() => {
    if (!focusedSource) return;
    if (focusedSource.id === 'custom-url') return;
    const updated = sourceOptions.find((s) => s.id === focusedSource.id) ?? null;
    setFocusedSource(updated);
  }, [focusedSource?.id, sourceOptions]); // intentionally only track the id

  const handleFocus = React.useCallback((source: MetricSourceOption) => {
    setFocusedSource(source);
    setCustomMode(false);
    setCustomError(null);
  }, []);

  const handleConfirmSelect = React.useCallback(() => {
    if (!focusedSource) return;
    onSelectSource?.(focusedSource);
  }, [focusedSource, onSelectSource]);

  const submitCustomUrl = React.useCallback(() => {
    const normalized = normalizeHttpUrl(customUrl);
    if (!normalized) {
      setCustomError('Enter a valid URL (e.g., https://example.com/data).');
      return;
    }

    const host = getHostname(normalized);
    const tooltip: DataSourceTooltipContent = {
      name: 'Custom URL',
      description: host ? `User-provided data source from ${host}.` : 'User-provided data source URL.',
      reliability: 'User-provided',
      updateFrequency: isApiLikeUrl(normalized) ? 'API (unknown)' : 'Unknown',
      dataType: isApiLikeUrl(normalized) ? 'API' : 'Web',
    };

    setFocusedSource({
      id: 'custom-url',
      icon: makeIconNode({ label: 'C' }),
      label: 'Custom URL',
      sublabel: host || undefined,
      url: normalized,
      confidence: 0,
      authority: 'Custom',
      iconBg: 'bg-gradient-to-br from-gray-500 to-gray-700',
      tooltip,
    });

    setCustomError(null);
    setCustomMode(false);
  }, [customUrl]);

  if (!isVisible) return null;

  // Stagger delay for each tile (in ms)
  const getStaggerDelay = (index: number) => index * 80;

  return (
    <div className="mt-8 w-[calc(100%+320px)] max-w-[calc(100vw-120px)] -ml-[280px]">

      {/* Focused source details (extra step) */}
      <div
        className={[
          'overflow-hidden transition-all duration-300 ease-out',
          // Shift only the focused UI upward (not the whole component).
          isFocused ? 'mt-0 max-h-[520px] opacity-100 translate-y-0' : 'max-h-0 opacity-0 -translate-y-2 pointer-events-none',
        ].join(' ')}
      >
        {focusedSource ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setFocusedSource(null)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/85 hover:bg-white/7 transition-colors"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                  <path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
                </svg>
                Back
              </button>

              <div className="text-[12px] text-white/45">
                Review this source before continuing
              </div>
            </div>

            {/* Selected bubble */}
            <div className="flex items-start">
              <DataSourceTooltip data={focusedSource.tooltip} position="bottom" delay={250}>
                <div
                  className="group flex items-center gap-3 rounded-xl bg-white/10 ring-1 ring-white/20 px-3 py-2"
                  aria-label={`Selected source ${focusedSource.label}`}
                >
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-lg ${focusedSource.iconBg}`}>
                    {focusedSource.icon}
                  </div>

                  <div className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <div className="flex min-w-0 items-baseline gap-1">
                        <div className="shrink-0 text-sm font-medium text-white">{focusedSource.label}</div>
                        {focusedSource.sublabel ? (
                          <div className="min-w-0 truncate text-sm font-medium text-white/60">
                            {focusedSource.sublabel}
                          </div>
                        ) : null}
                      </div>
                      {focusedSource.badge ? (
                        <span className="ml-auto shrink-0 rounded-full bg-blue-500 px-2 py-0.5 text-[10px] font-medium text-white pointer-events-none">
                          {focusedSource.badge}
                        </span>
                      ) : null}
                      {isValidatedUrl(focusedSource.url) ? (
                        <span className="shrink-0 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-medium text-emerald-200 pointer-events-none">
                          Validated
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-white/40 mt-0.5">
                      {focusedSource.tooltip.reliability}
                    </div>
                  </div>
                </div>
              </DataSourceTooltip>
            </div>

            {/* Description + actions */}
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
              <div className="text-sm text-white/80 line-clamp-3">
                {focusedSource.tooltip.description}
              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-white/55">
                <span className="rounded-full bg-white/5 px-2 py-1">
                  {focusedSource.tooltip.dataType}
                </span>
                <span className="rounded-full bg-white/5 px-2 py-1">
                  {focusedSource.tooltip.updateFrequency}
                </span>
                {focusedSource.url ? (
                  <span className="rounded-full bg-white/5 px-2 py-1">
                    {getHostname(focusedSource.url) || 'Source URL'}
                  </span>
                ) : null}
              </div>

              <div className="mt-3 flex items-center gap-2">
                <a
                  href={focusedSource.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-medium text-white/90 hover:bg-white/7 transition-colors"
                >
                  View
                </a>
                <button
                  type="button"
                  onClick={handleConfirmSelect}
                  className="inline-flex h-9 items-center justify-center rounded-xl bg-white px-4 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={fetchState === 'loading'}
                >
                  Select
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Source Options Grid - matching Generate panel style */}
      {/* Animated mode switcher: bubbles <-> custom URL input (in the same row area) */}
      <div className="space-y-3">
        {/* Bubbles row */}
        <div
          className={[
            'overflow-hidden transition-all duration-300 ease-out',
            customMode || isFocused
              ? 'max-h-0 opacity-0 -translate-y-2 pointer-events-none'
              : 'max-h-[900px] opacity-100 translate-y-0',
          ].join(' ')}
        >
          <div className="flex flex-wrap items-start gap-4">
            {sourceOptions.map((source, index) => (
              <DataSourceTooltip
                key={source.id}
                data={source.tooltip}
                position="bottom"
                delay={400}
              >
                <button
                  onClick={() => handleFocus(source)}
                  className={[
                    'group relative flex items-center gap-3 rounded-xl px-4 py-3 transition-all duration-200',
                    focusedId === source.id ? 'bg-white/10 ring-1 ring-white/20' : 'hover:bg-white/5',
                  ].join(' ')}
                  style={{
                    opacity: hasAnimated ? 1 : 0,
                    transform: hasAnimated ? 'translateY(0)' : 'translateY(24px)',
                    transition: `opacity 0.5s ease-out ${getStaggerDelay(index) + 100}ms, transform 0.5s ease-out ${getStaggerDelay(index) + 100}ms`,
                  }}
                >
                  {/* Icon */}
                  <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-lg ${source.iconBg}`}>
                    {source.icon}
                  </div>
                  
                  {/* Label */}
                  <div className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <div className="flex min-w-0 items-baseline gap-1">
                        <div className="shrink-0 text-sm font-medium text-white">{source.label}</div>
                        {source.sublabel ? (
                          <div className="min-w-0 truncate text-sm font-medium text-white/60">
                            {source.sublabel}
                          </div>
                        ) : null}
                      </div>
                      {source.badge ? (
                        <span className="ml-auto shrink-0 rounded-full bg-blue-500 px-2 py-0.5 text-[10px] font-medium text-white pointer-events-none">
                          {source.badge}
                        </span>
                      ) : null}
                      {isValidatedUrl(source.url) ? (
                        <span className="shrink-0 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-medium text-emerald-200 pointer-events-none">
                          Validated
                        </span>
                      ) : null}
                    </div>
                    {focusedId === source.id && (
                      <div className="text-xs text-white/40 mt-0.5">
                        {Math.round(source.confidence * 100)}% confidence
                      </div>
                    )}
                  </div>
                </button>
              </DataSourceTooltip>
            ))}

            {/* Always-available custom URL tile */}
            <DataSourceTooltip
              data={{
                name: 'Custom URL',
                description: 'Paste your own public URL for the metric’s underlying data.',
                reliability: 'User-provided',
                updateFrequency: 'Unknown',
                dataType: 'API/Web',
              }}
              position="bottom"
              delay={400}
            >
              <button
                type="button"
                onClick={() => {
                  setCustomMode(true);
                  setFocusedSource(null);
                  setCustomError(null);
                }}
                className={`group relative flex items-center gap-3 rounded-xl px-4 py-3 transition-all duration-200 ${
                  focusedId === 'custom-url' ? 'bg-white/10 ring-1 ring-white/20' : 'hover:bg-white/5'
                }`}
                style={{
                  opacity: hasAnimated ? 1 : 0,
                  transform: hasAnimated ? 'translateY(0)' : 'translateY(24px)',
                  transition: `opacity 0.5s ease-out ${getStaggerDelay(sourceOptions.length) + 100}ms, transform 0.5s ease-out ${getStaggerDelay(sourceOptions.length) + 100}ms`,
                }}
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-lg bg-gradient-to-br from-gray-500 to-gray-700">
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden="true">
                    <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
                  </svg>
                </div>
                <div className="text-left">
                  <div className="text-sm font-medium text-white">
                    Custom URL <span className="ml-1 text-white/60">Endpoint</span>
                  </div>
                </div>
              </button>
            </DataSourceTooltip>
          </div>
        </div>

        {/* Custom URL input row (animates in where bubbles were) */}
        <div
          className={[
            'overflow-hidden transition-all duration-300 ease-out',
            customMode ? 'max-h-[120px] opacity-100 translate-y-0' : 'max-h-0 opacity-0 -translate-y-2 pointer-events-none',
          ].join(' ')}
        >
          <div className="w-full max-w-[520px]">
            {/* Match the "name" bubble style */}
            <div className="rounded-2xl border border-white/10 bg-[#1E1E1E] px-4 py-3 shadow-lg">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setCustomMode(false);
                    setCustomError(null);
                  }}
                  className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/80 hover:bg-white/7 transition-colors"
                  aria-label="Go back"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
                    <path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
                  </svg>
                </button>

                <input
                  ref={customInputRef}
                  value={customUrl}
                  onChange={(e) => {
                    setCustomUrl(e.target.value);
                    setCustomError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      submitCustomUrl();
                    } else if (e.key === 'Escape') {
                      setCustomMode(false);
                      setCustomError(null);
                    }
                  }}
                  placeholder="Custom metric URL (https://...)"
                  className="w-full bg-transparent text-sm text-white placeholder:text-white/35 border-none !outline-none focus:!outline-none focus-visible:!outline-none focus:ring-0 focus-visible:ring-0 focus-visible:outline-none shadow-none appearance-none"
                  style={{ outline: 'none', boxShadow: 'none' }}
                />

                <button
                  type="button"
                  onClick={submitCustomUrl}
                  className="shrink-0 inline-flex h-9 items-center justify-center rounded-xl bg-white px-4 text-sm font-medium text-black hover:bg-white/90"
                >
                  Use
                </button>
              </div>

              {customError ? <div className="mt-2 text-[12px] text-red-400">{customError}</div> : null}
              {!customError ? (
                <div className="mt-2 text-[11px] text-white/45">Press Enter to continue</div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Status card: only shown while loading or on error - when fetch succeeds with no sources, the custom URL tile is the only option */}
      {!sourceOptions.length && !customMode && (fetchState === 'loading' || fetchState === 'idle' || fetchState === 'error') ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-white/70">
          {fetchState === 'loading' || fetchState === 'idle' ? (
            <div className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border border-white/20 border-t-white/70" aria-hidden="true" />
              <span>Searching the web for reliable data sources…</span>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-white/85 font-medium">Couldn’t fetch data sources</div>
                <div className="mt-1 text-white/55 text-[13px]">
                  Please retry. If this keeps happening, check server logs and `SERPAPI_KEY`.
                </div>
              </div>
              {onRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="shrink-0 rounded-xl bg-white px-3 py-2 text-xs font-medium text-black hover:bg-white/90"
                >
                  Retry
                </button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
