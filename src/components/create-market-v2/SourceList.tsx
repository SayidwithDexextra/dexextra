'use client';

import React from 'react';
import { MetricSource } from '@/types/metricDiscovery';

interface SourceListProps {
  primarySource: MetricSource;
  secondarySources?: MetricSource[];
}

export function SourceList({ primarySource, secondarySources = [] }: SourceListProps) {
  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm text-white/60 mb-2 flex items-center gap-2">
          <span>Primary Data Source</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-blue-500/20 text-blue-400">
            Recommended
          </span>
        </div>
        <SourceCard source={primarySource} isPrimary />
      </div>

      {secondarySources.length > 0 && (
        <div>
          <div className="text-sm text-white/60 mb-2">
            Alternative Sources ({secondarySources.length})
          </div>
          <div className="space-y-2">
            {secondarySources.map((source, idx) => (
              <SourceCard key={idx} source={source} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SourceCard({ source, isPrimary = false }: { source: MetricSource; isPrimary?: boolean }) {
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`block p-3 rounded-lg transition-all ${
        isPrimary 
          ? 'bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30' 
          : 'bg-white/5 hover:bg-white/10 border border-white/10'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-medium mb-1 ${
            isPrimary ? 'text-blue-400' : 'text-white'
          }`}>
            {source.authority}
          </div>
          <div className="text-xs text-white/50 truncate">{source.url}</div>
        </div>
        <div className="flex-shrink-0">
          <div className="text-xs text-white/60">
            {Math.round(source.confidence * 100)}%
          </div>
          <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden mt-1">
            <div 
              className={`h-full transition-all duration-500 ${
                isPrimary ? 'bg-blue-500' : 'bg-white/50'
              }`}
              style={{ width: `${source.confidence * 100}%` }}
            />
          </div>
        </div>
      </div>
    </a>
  );
}
