'use client';

import React, { useLayoutEffect, useRef, useState } from 'react';
import styles from './SocialPreviewCard.module.css';

export interface SocialPreviewCardData {
  title: string;
  symbol?: string;
  category?: string;
  description?: string;
  iconUrl?: string;
  markPrice?: number;
  startPrice?: number;
  /** Explicit PnL %. When provided, overrides the price-derived calculation. */
  pnlPercent?: number;
  /** Price-action points for the chart variant (shape only; scale-agnostic). */
  series?: number[];
}

export type SocialPreviewVariant = 'image' | 'chart';

/** Canvas shape of the preview frame. Square mirrors the image actually shared
 *  natively (1080×1080) and lets the card render large on every viewport. */
export type SocialPreviewShape = 'landscape' | 'square' | 'portrait';

interface SocialPreviewCardProps {
  data: SocialPreviewCardData;
  /** Bump to replay the assembly animation (e.g. each time the modal opens). */
  animationKey?: number;
  /** 'image' shows the market artwork; 'chart' recreates the price action. */
  variant?: SocialPreviewVariant;
  /** Frame aspect + how much the card is scaled to fill it. */
  shape?: SocialPreviewShape;
}

// Canvas dimensions per shape, plus how much to enlarge the fixed 520×594 card
// so it fills the frame. These mirror the server OG route's FORMATS map.
const SHAPES: Record<SocialPreviewShape, { w: number; h: number; cardScale: number }> = {
  landscape: { w: 1200, h: 630, cardScale: 1 },
  square: { w: 1080, h: 1080, cardScale: 1.6 },
  portrait: { w: 1080, h: 1350, cardScale: 1.62 },
};

// Chart coordinate space (matches the inner panel size for 1:1 aspect).
const CHART_W = 496;
const CHART_H = 296;
const CHART_PAD_X = 30;
const CHART_PAD_Y = 42;
const CHART_GRID_LINES = 5;

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) || 1;
}

function seededRandom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// When we have no real candles, synthesize a smooth, deterministic price path
// that drifts from the entry/original cost to the current mark price.
function synthesizeSeries(start: number, end: number, seedStr: string, n = 56): number[] {
  const s = start > 0 ? start : end > 0 ? end : 1;
  const e = end > 0 ? end : s;
  const rand = seededRandom(hashString(seedStr));
  const vol = Math.max(Math.abs(e - s), Math.max(s, e) * 0.05) * 0.45;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const base = s + (e - s) * t;
    const wave = Math.sin(t * Math.PI * 3 + (rand() - 0.5)) * vol * 0.35;
    const noise = (rand() - 0.5) * vol * (1 - t * 0.5);
    out.push(Math.max(0, base + wave + noise));
  }
  out[0] = s;
  out[n - 1] = e;
  return out;
}

function buildChartGeometry(series: number[]) {
  const pts = series.length >= 2 ? series : [series[0] ?? 0, series[0] ?? 0];
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = max - min || 1;
  const innerW = CHART_W - CHART_PAD_X * 2;
  const innerH = CHART_H - CHART_PAD_Y * 2;
  const coords = pts.map((v, i) => {
    const x = CHART_PAD_X + (i / (pts.length - 1)) * innerW;
    const y = CHART_PAD_Y + innerH - ((v - min) / range) * innerH;
    return { x, y };
  });
  const line = coords
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(' ');
  const baseY = (CHART_H - CHART_PAD_Y).toFixed(2);
  const area = `${line} L${coords[coords.length - 1].x.toFixed(2)} ${baseY} L${coords[0].x.toFixed(2)} ${baseY} Z`;
  const gridYs = Array.from({ length: CHART_GRID_LINES }, (_, i) =>
    CHART_PAD_Y + (i / (CHART_GRID_LINES - 1)) * innerH
  );
  return { line, area, last: coords[coords.length - 1], gridYs };
}

const DEXETERA_LOGO_URL = '/Dexicon/LOGO-Dexetera-04.svg';

function formatPrice(price: number): string {
  if (price >= 1000) {
    return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (price >= 1) {
    return `$${price.toFixed(2)}`;
  }
  if (price > 0) {
    return `$${price.toPrecision(4)}`;
  }
  return '$0.00';
}

function formatPnlPercent(percent: number): string {
  const sign = percent >= 0 ? '+' : '';
  return `${sign}${percent.toFixed(2)}%`;
}

function truncateText(text: string, maxLength: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

export default function SocialPreviewCard({
  data,
  animationKey = 0,
  variant = 'image',
  shape = 'square',
}: SocialPreviewCardProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const shapeCfg = SHAPES[shape];

  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / shapeCfg.w);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [shapeCfg.w]);

  const title = truncateText(data.title || data.symbol || 'Market', 28);
  const category = data.category ? truncateText(data.category.toUpperCase(), 18) : '';
  const description = truncateText(
    data.description ||
      `Trade ${title} on Dexetera — decentralized metric futures with no permission needed.`,
    120
  );
  const currentPrice = Number.isFinite(data.markPrice) ? Number(data.markPrice) : 0;
  const startPrice = Number.isFinite(data.startPrice) ? Number(data.startPrice) : 0;
  const hasPnlOverride = data.pnlPercent != null && Number.isFinite(data.pnlPercent);
  const pnlPercent = hasPnlOverride
    ? Number(data.pnlPercent)
    : startPrice > 0
      ? ((currentPrice - startPrice) / startPrice) * 100
      : 0;
  const showPnl = startPrice > 0 || hasPnlOverride;
  const pnlColor = pnlPercent >= 0 ? '#4ADE80' : '#F87171';

  const chartColor = pnlPercent >= 0 ? '#16C784' : '#EA3943';
  const chartSeries =
    variant === 'chart'
      ? data.series && data.series.length >= 2
        ? data.series
        : synthesizeSeries(startPrice, currentPrice, data.symbol || title)
      : [];
  const chart = variant === 'chart' ? buildChartGeometry(chartSeries) : null;
  const gradientId = `spc-area-${(data.symbol || title).replace(/[^a-zA-Z0-9]/g, '') || 'm'}`;

  return (
    <div
      className={styles.frame}
      ref={frameRef}
      style={{ aspectRatio: `${shapeCfg.w} / ${shapeCfg.h}` }}
    >
      <div
        key={animationKey}
        className={styles.stage}
        style={{
          width: shapeCfg.w,
          height: shapeCfg.h,
          transform: `scale(${scale || 0.0001})`,
        }}
      >
        <div className={styles.scaler} style={{ transform: `scale(${shapeCfg.cardScale})` }}>
        <div
          className={`${styles.card} ${styles.assemble} ${styles.assembleScale}`}
          style={{ animationDelay: '0ms' }}
        >
          {variant === 'chart' && chart ? (
            <div
              className={`${styles.chartPanel} ${styles.assemble} ${styles.assembleDown}`}
              style={{ animationDelay: '140ms' }}
            >
              <svg
                className={styles.chartSvg}
                viewBox={`0 0 ${CHART_W} ${CHART_H}`}
                preserveAspectRatio="xMidYMid meet"
              >
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartColor} stopOpacity="0.16" />
                    <stop offset="100%" stopColor={chartColor} stopOpacity="0" />
                  </linearGradient>
                </defs>
                {chart.gridYs.map((y, i) => (
                  <line
                    key={i}
                    x1={CHART_PAD_X - 12}
                    x2={CHART_W - CHART_PAD_X + 12}
                    y1={y}
                    y2={y}
                    stroke="#E2E2E0"
                    strokeWidth={1.5}
                    strokeDasharray="2 7"
                    strokeLinecap="round"
                  />
                ))}
                <path d={chart.area} fill={`url(#${gradientId})`} className={styles.chartArea} />
                <path
                  d={chart.line}
                  fill="none"
                  stroke={chartColor}
                  strokeWidth={5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  pathLength={1}
                  className={styles.chartLine}
                />
                <g className={styles.chartDot}>
                  <circle cx={chart.last.x} cy={chart.last.y} r={9} fill="#FFFFFF" />
                  <circle cx={chart.last.x} cy={chart.last.y} r={6.5} fill={chartColor} />
                </g>
              </svg>
            </div>
          ) : (
            <div
              className={`${styles.imagePanel} ${styles.assemble} ${styles.assembleDown}`}
              style={{ animationDelay: '140ms' }}
            >
              {data.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={data.iconUrl} alt={title} />
              ) : (
                <span className={styles.imageFallback}>{(data.symbol || title)[0]}</span>
              )}
            </div>
          )}

          <div className={styles.body}>
            <div className={styles.topBlock}>
              <div className={styles.titleRow}>
                <span
                  className={`${styles.title} ${styles.assemble} ${styles.assembleLeft}`}
                  style={{ animationDelay: '340ms' }}
                >
                  {title}
                </span>
                {category && (
                  <div
                    className={`${styles.category} ${styles.assemble} ${styles.assembleScale}`}
                    style={{ animationDelay: '460ms' }}
                  >
                    <span className={styles.categoryText}>{category}</span>
                  </div>
                )}
              </div>

              <span
                className={`${styles.description} ${styles.assemble} ${styles.assembleUp}`}
                style={{ animationDelay: '560ms' }}
              >
                {description}
              </span>

              <div className={styles.stats}>
                <div
                  className={`${styles.stat} ${styles.assemble} ${styles.assembleUp}`}
                  style={{ animationDelay: '700ms' }}
                >
                  <span className={styles.statLabel}>Mark Price</span>
                  <span className={styles.statValue}>{formatPrice(currentPrice)}</span>
                </div>

                {startPrice > 0 && (
                  <div
                    className={`${styles.stat} ${styles.assemble} ${styles.assembleUp}`}
                    style={{ animationDelay: '800ms' }}
                  >
                    <span className={styles.statLabel}>Original Cost</span>
                    <span className={`${styles.statValue} ${styles.statValueMuted}`}>
                      {formatPrice(startPrice)}
                    </span>
                  </div>
                )}

                {showPnl && (
                  <div
                    className={`${styles.stat} ${styles.assemble} ${styles.assembleUp}`}
                    style={{ animationDelay: '900ms' }}
                  >
                    <span className={styles.statLabel}>PnL</span>
                    <span className={styles.statValue} style={{ color: pnlColor }}>
                      {formatPnlPercent(pnlPercent)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div
              className={`${styles.brand} ${styles.assemble} ${styles.assembleUp}`}
              style={{ animationDelay: '1040ms' }}
            >
              <div className={styles.brandInner}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={DEXETERA_LOGO_URL} alt="Dexetera" />
                <span className={styles.brandText}>DEXETERA</span>
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
