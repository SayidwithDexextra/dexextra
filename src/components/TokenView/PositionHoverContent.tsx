'use client';

import React, { useMemo } from 'react';
import { formatCurrency, formatPercent } from '@/lib/formatters';

interface Position {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  size: number;
  entryPrice: number;
  markPrice: number;
  pnl: number;
  pnlPercent: number;
  liquidationPrice: number;
  margin: number;
  leverage: number;
}

interface PositionHoverContentProps {
  position: Position;
  allPositions: Position[];
}

interface HealthInfo {
  score: number;
  label: string;
  color: string;
}

function calculateHealthScore(position: Position): HealthInfo {
  const { side, markPrice, liquidationPrice } = position;
  if (!liquidationPrice || liquidationPrice <= 0 || !markPrice || markPrice <= 0) {
    return { score: 100, label: 'Safe', color: '#22c55e' };
  }
  let dist: number;
  if (side === 'LONG') dist = ((markPrice - liquidationPrice) / liquidationPrice) * 100;
  else dist = ((liquidationPrice - markPrice) / markPrice) * 100;
  const score = Math.max(0, Math.min(100, dist * 2));
  if (dist <= 0) return { score: 0, label: 'Critical', color: '#ef4444' };
  if (dist < 5) return { score: Math.round(score), label: 'Danger', color: '#f87171' };
  if (dist < 15) return { score: Math.round(score), label: 'Caution', color: '#fbbf24' };
  if (dist < 30) return { score: Math.round(score), label: 'Moderate', color: '#a3e635' };
  if (dist < 50) return { score: Math.round(score), label: 'Healthy', color: '#4ade80' };
  return { score: 100, label: 'Safe', color: '#22c55e' };
}

interface PieSlice { id: string; percentage: number; color: string; isHighlighted: boolean; }

const SLICE_COLORS = ['rgba(139,92,246,0.9)','rgba(59,130,246,0.85)','rgba(236,72,153,0.85)','rgba(249,115,22,0.85)','rgba(234,179,8,0.85)','rgba(34,197,94,0.85)','rgba(6,182,212,0.85)','rgba(99,102,241,0.85)'];

function MiniPieChart({ slices, size = 40 }: { slices: PieSlice[]; size?: number }) {
  const r = size / 2, cx = r, cy = r, ir = r * 0.5;
  const paths = useMemo(() => {
    if (!slices.length) return [];
    let angle = -Math.PI / 2;
    return slices.map((s) => {
      const sa = angle, ea = angle + (s.percentage / 100) * 2 * Math.PI;
      angle = ea;
      const or = s.isHighlighted ? r : r - 2, inr = s.isHighlighted ? ir + 1 : ir;
      const d = `M ${cx + or * Math.cos(sa)} ${cy + or * Math.sin(sa)} A ${or} ${or} 0 ${ea - sa > Math.PI ? 1 : 0} 1 ${cx + or * Math.cos(ea)} ${cy + or * Math.sin(ea)} L ${cx + inr * Math.cos(ea)} ${cy + inr * Math.sin(ea)} A ${inr} ${inr} 0 ${ea - sa > Math.PI ? 1 : 0} 0 ${cx + inr * Math.cos(sa)} ${cy + inr * Math.sin(sa)} Z`;
      return { d, color: s.color, hl: s.isHighlighted };
    });
  }, [slices, r, cx, cy, ir]);
  const hl = slices.find(s => s.isHighlighted);
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r - 1} fill="none" stroke="#2A2A2A" strokeWidth={r - ir - 1} />
        {paths.map((p, i) => <path key={i} d={p.d} fill={p.color} opacity={p.hl ? 1 : 0.4} stroke={p.hl ? 'rgba(255,255,255,0.4)' : 'transparent'} strokeWidth={p.hl ? 1 : 0} style={{ filter: p.hl ? 'drop-shadow(0 0 3px rgba(139,92,246,0.6))' : undefined }} />)}
      </svg>
      {hl && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><span className="text-[9px] font-bold text-white font-mono">{Math.round(hl.percentage)}%</span></div>}
    </div>
  );
}

export function PositionHoverContent({ position, allPositions }: PositionHoverContentProps) {
  const positionValue = position.size * position.markPrice;
  const health = calculateHealthScore(position);
  const pieSlices = useMemo<PieSlice[]>(() => {
    const total = allPositions.reduce((s, p) => s + p.size * p.markPrice, 0);
    if (total <= 0) return [];
    return allPositions.map((p, i) => ({ id: p.id, percentage: ((p.size * p.markPrice) / total) * 100, color: SLICE_COLORS[i % SLICE_COLORS.length], isHighlighted: p.id === position.id })).filter(s => s.percentage > 0.5).sort((a, b) => b.percentage - a.percentage);
  }, [allPositions, position.id]);

  return (
    <div className="w-[380px]">
      <div className="flex items-center h-[44px]">
        {/* Pie Chart */}
        <div className="flex items-center justify-center w-[50px] h-full">
          <MiniPieChart slices={pieSlices} size={40} />
        </div>

        {/* Value */}
        <div className="flex flex-col justify-center h-full border-l border-[#1A1A1A] pl-3 pr-3">
          <div className="text-[8px] text-[#606060] uppercase tracking-wider">Value</div>
          <div className="text-[12px] font-semibold text-white font-mono">{formatCurrency(positionValue, { compact: true })}</div>
        </div>

        {/* Margin */}
        <div className="flex flex-col justify-center h-full border-l border-[#1A1A1A] pl-3 pr-3">
          <div className="text-[8px] text-[#606060] uppercase tracking-wider">Margin</div>
          <div className="text-[12px] font-semibold text-white font-mono">{formatCurrency(position.margin, { compact: true })}</div>
        </div>

        {/* P&L */}
        <div className="flex flex-col justify-center h-full border-l border-[#1A1A1A] pl-3 pr-3">
          <div className="text-[8px] text-[#606060] uppercase tracking-wider">P&L</div>
          <div className={`text-[12px] font-semibold font-mono ${position.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{position.pnl >= 0 ? '+' : ''}{formatPercent(position.pnlPercent, { decimals: 1 })}%</div>
        </div>

        {/* Vertical Health Bar */}
        <div className="flex items-center h-full border-l border-[#1A1A1A] pl-3 gap-1.5">
          <div className="relative w-2.5 h-[36px] rounded-sm overflow-hidden" style={{ background: 'linear-gradient(to top, #ef4444 0%, #fbbf24 50%, #22c55e 100%)' }}>
            <div className="absolute top-0 left-0 right-0 bg-[#0F0F0F]/85" style={{ height: `${100 - health.score}%` }} />
          </div>
          <div className="flex flex-col justify-center">
            <span className="text-[10px] font-semibold font-mono" style={{ color: health.color }}>{health.score}%</span>
            <span className="text-[7px] text-[#606060] uppercase">Health</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PositionHoverContent;
