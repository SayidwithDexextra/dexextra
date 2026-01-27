'use client';

import React from 'react';
import { MetricDefinition } from '@/types/metricDiscovery';

interface MetricDefinitionCardProps {
  definition: MetricDefinition;
  confidence?: number;
  processingTime?: number;
}

export function MetricDefinitionCard({ 
  definition, 
  confidence, 
  processingTime 
}: MetricDefinitionCardProps) {
  return (
    <div className="rounded-2xl border border-green-500/30 bg-green-500/5 p-4 sm:p-6">
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-lg font-medium text-green-400">✓ Metric Discovered</h3>
        {processingTime && (
          <span className="text-xs text-white/50">{processingTime}ms</span>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <div className="text-sm text-white/60 mb-1">Metric Name</div>
          <div className="text-base font-medium text-white">{definition.metric_name}</div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-white/60 mb-1">Unit</div>
            <div className="text-white">{definition.unit}</div>
          </div>
          <div>
            <div className="text-white/60 mb-1">Scope</div>
            <div className="text-white">{definition.scope}</div>
          </div>
          <div>
            <div className="text-white/60 mb-1">Time Basis</div>
            <div className="text-white">{definition.time_basis}</div>
          </div>
          {confidence !== undefined && (
            <div>
              <div className="text-white/60 mb-1">Confidence</div>
              <div className="text-white">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-green-500 transition-all duration-500"
                      style={{ width: `${confidence * 100}%` }}
                    />
                  </div>
                  <span className="text-xs">{Math.round(confidence * 100)}%</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="text-sm text-white/60 mb-1">Measurement Method</div>
          <div className="text-sm text-white/80 leading-relaxed">
            {definition.measurement_method}
          </div>
        </div>
      </div>
    </div>
  );
}
