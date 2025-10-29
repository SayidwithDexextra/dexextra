'use client';

import React, { useMemo, useState } from 'react';

export type StepStatus = 'pending' | 'active' | 'done' | 'error';
export type ProgressStep = {
  id: string;
  title: string;
  description?: string;
  status: StepStatus;
};

interface DeploymentProgressPanelProps {
  steps: ProgressStep[];
  visible?: boolean;
  title?: string;
}

export const DeploymentProgressPanel: React.FC<DeploymentProgressPanelProps> = ({
  steps,
  visible = true,
  title = 'Deployment Progress',
}) => {
  const [expanded, setExpanded] = useState(true);
  const completedCount = useMemo(() => steps.filter(s => s.status === 'done').length, [steps]);
  const isAnyActive = useMemo(() => steps.some(s => s.status === 'active'), [steps]);
  const progressPercent = useMemo(() => {
    return Math.min(100, Math.round(((completedCount + (isAnyActive ? 0.35 : 0)) / Math.max(steps.length, 1)) * 100));
  }, [completedCount, isAnyActive, steps.length]);

  if (!visible) return null;

  return (
    <div className="group bg-[#0F0F0F] hover:bg-[#101010] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 mb-4">
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${completedCount === steps.length ? 'bg-green-400' : isAnyActive ? 'bg-blue-400 animate-pulse' : 'bg-[#404040]'}`} />
          <span className="text-[11px] font-medium text-[#808080]">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-24 h-1 bg-[#2A2A2A] rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-400 transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          {isAnyActive && (
            <svg className="w-3 h-3 text-blue-400 animate-spin" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" opacity="0.25" />
              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" fill="none" />
            </svg>
          )}
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="text-[11px] text-[#808080] hover:text-white"
          >
            {expanded ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>
      <div className={`${expanded ? 'opacity-100 max-h-40' : 'opacity-0 max-h-0 group-hover:opacity-100 group-hover:max-h-40'} overflow-hidden transition-all duration-200`}>
        <div className="px-4 pb-3 border-t border-[#1A1A1A]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-3">
            {steps.map(step => (
              <div key={step.id} className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <div
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      step.status === 'done' ? 'bg-green-400' :
                      step.status === 'active' ? 'bg-blue-400 animate-pulse' :
                      step.status === 'error' ? 'bg-red-400' : 'bg-[#404040]'
                    }`}
                  />
                  <span className="text-[11px] text-white truncate">{step.title}</span>
                </div>
                <span className={`text-[9px] ${
                  step.status === 'done' ? 'text-green-400' :
                  step.status === 'active' ? 'text-blue-400' :
                  step.status === 'error' ? 'text-red-400' : 'text-[#606060]'
                }`}>
                  {step.status === 'done' ? 'Done' : step.status === 'active' ? 'In Progress' : step.status === 'error' ? 'Error' : 'Pending'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};


