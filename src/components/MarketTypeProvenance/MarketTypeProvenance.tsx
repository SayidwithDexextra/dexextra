'use client';

import React from 'react';

export interface MarketTypeProvenanceProps {
  marketType?: 'single' | 'ratio' | 'indexed' | string | null;
  baseValue?: number;
  legs?: {
    numerator?: { label?: string; sources?: string[]; valueAtCreation?: number };
    denominator?: { label?: string; sources?: string[]; valueAtCreation?: number };
  } | null;
  baseline?: { A0?: number; B0?: number; V0?: number; asOf?: string } | null;
  manifestUrl?: string | null;
  manifestCid?: string | null;
  className?: string;
}

const IPFS_GATEWAY = 'https://gateway.pinata.cloud/ipfs/';

function ipfsToHttp(uriOrCid?: string | null): string | null {
  if (!uriOrCid) return null;
  let cid = uriOrCid.trim();
  if (cid.startsWith('ipfs://')) cid = cid.slice('ipfs://'.length);
  const idx = cid.indexOf('/ipfs/');
  if (idx !== -1) cid = cid.slice(idx + '/ipfs/'.length);
  return `${IPFS_GATEWAY}${cid}`;
}

/**
 * "How this price is derived" panel for ratio / indexed markets. Renders the
 * formula, the two legs and their sources, the indexed baseline, and a link to
 * the immutable IPFS manifest that anchors the market on-chain.
 */
export default function MarketTypeProvenance({
  marketType,
  baseValue = 100,
  legs,
  baseline,
  manifestUrl,
  manifestCid,
  className,
}: MarketTypeProvenanceProps) {
  if (marketType !== 'ratio' && marketType !== 'indexed') return null;

  const isIndexed = marketType === 'indexed';
  const formula = isIndexed ? `${baseValue} × (A / B) / V₀` : 'A / B';
  const manifestHref = ipfsToHttp(manifestUrl || manifestCid);
  const numerator = legs?.numerator;
  const denominator = legs?.denominator;

  return (
    <div className={`rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5 ${className || ''}`}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-white/90">How this price is derived</h3>
        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/[0.08] px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300">
          {isIndexed ? 'Indexed (base 100)' : 'Ratio'}
        </span>
      </div>

      <div className="mb-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-[13px] text-white/80">
        value = {formula}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <LegCard tag="A (numerator)" leg={numerator} />
        <LegCard tag="B (denominator)" leg={denominator} />
      </div>

      {isIndexed && baseline && (
        <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-white/40">Baseline (locked at creation)</div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-white/70">
            {typeof baseline.V0 === 'number' && <span>V₀ = {baseline.V0}</span>}
            {typeof baseline.A0 === 'number' && <span>A₀ = {baseline.A0}</span>}
            {typeof baseline.B0 === 'number' && <span>B₀ = {baseline.B0}</span>}
          </div>
          <div className="mt-1 text-[11px] text-emerald-300/70">100 = value at launch. Above 100 = A gaining on B.</div>
        </div>
      )}

      {manifestHref && (
        <div className="mt-3 flex items-center gap-2 text-[11px] text-white/50">
          <span>Immutable spec:</span>
          <a
            href={manifestHref}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-sky-400/80 hover:text-sky-300"
          >
            {manifestCid || manifestUrl}
          </a>
        </div>
      )}
    </div>
  );
}

function LegCard({ tag, leg }: { tag: string; leg?: { label?: string; sources?: string[]; valueAtCreation?: number } }) {
  const src = leg?.sources?.[0];
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-white/40">{tag}</div>
      <div className="truncate text-[13px] text-white/85">{leg?.label || '—'}</div>
      {typeof leg?.valueAtCreation === 'number' && (
        <div className="text-[11px] text-white/50">at creation: {leg.valueAtCreation}</div>
      )}
      {src && (
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-0.5 block truncate text-[11px] text-sky-400/70 hover:text-sky-300"
        >
          {src}
        </a>
      )}
    </div>
  );
}
