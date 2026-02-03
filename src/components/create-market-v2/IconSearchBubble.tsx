'use client';

import React from 'react';
import Image from 'next/image';

export interface IconOption {
  id: string;
  title: string;
  url: string;
  thumbnail: string;
  source: string;
  domain: string;
}

interface IconSearchBubbleProps {
  /** Search query (usually metric name) */
  query: string;
  /** Callback when an icon is selected (url or File) */
  onSelectIcon: (iconUrl: string) => void;
  /** Callback when a file is uploaded */
  onUploadIcon: (file: File) => void;
  /** Currently selected icon URL */
  selectedIconUrl: string | null;
  /** Whether the bubble is visible */
  isVisible: boolean;
}

type FetchState = 'idle' | 'loading' | 'success' | 'error';

export function IconSearchBubble({
  query,
  onSelectIcon,
  onUploadIcon,
  selectedIconUrl,
  isVisible,
}: IconSearchBubbleProps) {
  const [fetchState, setFetchState] = React.useState<FetchState>('idle');
  const [iconOptions, setIconOptions] = React.useState<IconOption[]>([]);
  const [hasAnimated, setHasAnimated] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [customMode, setCustomMode] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Fetch icons when query changes and is visible
  React.useEffect(() => {
    if (!isVisible || !query.trim()) {
      return;
    }

    const fetchIcons = async () => {
      setFetchState('loading');
      setErrorMessage(null);

      try {
        const response = await fetch('/api/icon-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, maxResults: 8 }),
        });

        if (!response.ok) {
          throw new Error('Failed to fetch icons');
        }

        const data = await response.json();
        const results: IconOption[] = (data.results || []).map(
          (r: any, idx: number) => ({
            id: `icon-${idx}-${r.domain || 'unknown'}`,
            title: r.title || '',
            url: r.url || '',
            thumbnail: r.thumbnail || r.url || '',
            source: r.source || '',
            domain: r.domain || '',
          })
        );

        setIconOptions(results);
        setFetchState('success');
      } catch (error) {
        console.error('[IconSearchBubble] Error:', error);
        setErrorMessage(
          error instanceof Error ? error.message : 'Failed to search icons'
        );
        setFetchState('error');
      }
    };

    fetchIcons();
  }, [isVisible, query]);

  // Trigger animations after mount
  React.useEffect(() => {
    if (isVisible && !hasAnimated) {
      const timer = setTimeout(() => setHasAnimated(true), 50);
      return () => clearTimeout(timer);
    }
  }, [isVisible, hasAnimated]);

  // Reset animation state when visibility changes
  React.useEffect(() => {
    if (!isVisible) {
      setHasAnimated(false);
      setCustomMode(false);
    }
  }, [isVisible]);

  // Focus file input when entering custom mode
  React.useEffect(() => {
    if (!customMode) return;
    const t = window.setTimeout(() => fileInputRef.current?.click(), 220);
    return () => window.clearTimeout(t);
  }, [customMode]);

  const handleRetry = () => {
    setFetchState('idle');
    setIconOptions([]);
    setTimeout(() => {
      setFetchState('loading');
      fetch('/api/icon-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, maxResults: 8 }),
      })
        .then((res) => res.json())
        .then((data) => {
          const results: IconOption[] = (data.results || []).map(
            (r: any, idx: number) => ({
              id: `icon-${idx}-${r.domain || 'unknown'}`,
              title: r.title || '',
              url: r.url || '',
              thumbnail: r.thumbnail || r.url || '',
              source: r.source || '',
              domain: r.domain || '',
            })
          );
          setIconOptions(results);
          setFetchState('success');
        })
        .catch(() => {
          setErrorMessage('Failed to search icons');
          setFetchState('error');
        });
    }, 100);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUploadIcon(file);
      setCustomMode(false);
    }
  };

  if (!isVisible) return null;

  // Stagger delay for each tile (in ms)
  const getStaggerDelay = (index: number) => index * 60;

  // Check if selected icon is from search results
  const isCustomSelected =
    selectedIconUrl &&
    !iconOptions.some((opt) => opt.url === selectedIconUrl || opt.thumbnail === selectedIconUrl);

  return (
    <div className="mt-8 w-[calc(100%+320px)] max-w-[calc(100vw-120px)] -ml-[280px]">
      {/* Section Header */}
      <div
        className="mb-4 text-left"
        style={{
          opacity: hasAnimated ? 1 : 0,
          transform: hasAnimated ? 'translateY(0)' : 'translateY(20px)',
          transition: 'opacity 0.4s ease-out, transform 0.4s ease-out',
        }}
      >
        <h2 className="text-base font-medium text-white/90">Select Icon</h2>
        <p className="mt-1 text-sm text-white/50">
          Choose an icon for your market
        </p>
      </div>

      {/* Animated mode switcher: bubbles <-> custom upload (in the same row area) */}
      <div className="space-y-3">
        {/* Bubbles row */}
        <div
          className={[
            'overflow-hidden transition-all duration-300 ease-out',
            customMode
              ? 'max-h-0 opacity-0 -translate-y-2 pointer-events-none'
              : 'max-h-[180px] opacity-100 translate-y-0',
          ].join(' ')}
        >
          <div className="grid grid-cols-5 gap-3" style={{ maxWidth: '100%' }}>
            {/* Icon options from search (max 8 + 1 custom = 9 total, 2 rows) */}
            {iconOptions.slice(0, 8).map((icon, index) => (
              <button
                key={icon.id}
                type="button"
                onClick={() => onSelectIcon(icon.url)}
                className={`group relative flex items-center justify-center rounded-xl p-2 transition-all duration-200 ${
                  selectedIconUrl === icon.url || selectedIconUrl === icon.thumbnail
                    ? 'bg-white/10 ring-1 ring-white/20'
                    : 'hover:bg-white/5'
                }`}
                style={{
                  opacity: hasAnimated ? 1 : 0,
                  transform: hasAnimated ? 'translateY(0)' : 'translateY(24px)',
                  transition: `opacity 0.5s ease-out ${getStaggerDelay(index) + 100}ms, transform 0.5s ease-out ${getStaggerDelay(index) + 100}ms`,
                }}
                title={icon.title || icon.domain}
              >
                {/* Icon thumbnail */}
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-black/40 border border-white/8 overflow-hidden">
                  <Image
                    src={icon.thumbnail}
                    alt={icon.title || 'Icon option'}
                    width={48}
                    height={48}
                    className="h-full w-full object-contain p-1"
                    unoptimized
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>

                {/* Selection indicator */}
                {(selectedIconUrl === icon.url || selectedIconUrl === icon.thumbnail) && (
                  <div className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-black">
                    <svg
                      viewBox="0 0 24 24"
                      className="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                )}
              </button>
            ))}

            {/* Always-available custom upload tile */}
            <button
              type="button"
              onClick={() => setCustomMode(true)}
              className={`group relative flex items-center justify-center rounded-xl p-2 transition-all duration-200 ${
                isCustomSelected ? 'bg-white/10 ring-1 ring-white/20' : 'hover:bg-white/5'
              }`}
              style={{
                opacity: hasAnimated ? 1 : 0,
                transform: hasAnimated ? 'translateY(0)' : 'translateY(24px)',
                transition: `opacity 0.5s ease-out ${getStaggerDelay(Math.min(iconOptions.length, 8)) + 100}ms, transform 0.5s ease-out ${getStaggerDelay(Math.min(iconOptions.length, 8)) + 100}ms`,
              }}
              title="Upload custom icon"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white shadow-lg bg-gradient-to-br from-gray-500 to-gray-700 border border-white/8">
                {/* Upload icon */}
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
                  <path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z" />
                </svg>
              </div>

              {/* Selection indicator for custom */}
              {isCustomSelected && (
                <div className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-black">
                  <svg
                    viewBox="0 0 24 24"
                    className="h-3 w-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              )}
            </button>
          </div>
        </div>

        {/* Custom upload row (animates in where bubbles were) */}
        <div
          className={[
            'overflow-hidden transition-all duration-300 ease-out',
            customMode
              ? 'max-h-[140px] opacity-100 translate-y-0'
              : 'max-h-0 opacity-0 -translate-y-2 pointer-events-none',
          ].join(' ')}
        >
          <div className="w-full max-w-[520px]">
            <div className="rounded-2xl border border-white/10 bg-[#0A0A0A] px-4 py-3 shadow-lg">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setCustomMode(false)}
                  className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/80 hover:bg-white/7 transition-colors"
                  aria-label="Go back"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
                    <path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
                  </svg>
                </button>

                <div className="flex-1">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/8 bg-black/30 px-3 py-2 text-sm text-white/85 hover:bg-black/50 transition-colors">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleFileChange}
                    />
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                      <path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z" />
                    </svg>
                    <span>Upload icon</span>
                    <span className="text-[11px] text-white/45">(png/jpg/svg)</span>
                  </label>
                </div>
              </div>

              <div className="mt-2 text-[11px] text-white/45">
                Keep it square for best results. Click the button or drop a file.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Status card: only shown while loading or on error */}
      {!iconOptions.length && !customMode && (fetchState === 'loading' || fetchState === 'idle' || fetchState === 'error') ? (
        <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-4 text-sm text-white/70">
          {fetchState === 'loading' || fetchState === 'idle' ? (
            <div className="flex items-center gap-2">
              <span
                className="h-4 w-4 animate-spin rounded-full border border-white/20 border-t-white/70"
                aria-hidden="true"
              />
              <span>Searching for icons…</span>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-white/85 font-medium">Couldn&apos;t fetch icons</div>
                <div className="mt-1 text-white/55 text-[13px]">
                  {errorMessage || 'Please try again.'}
                </div>
              </div>
              <button
                type="button"
                onClick={handleRetry}
                className="shrink-0 rounded-xl bg-white px-3 py-2 text-xs font-medium text-black hover:bg-white/90"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
