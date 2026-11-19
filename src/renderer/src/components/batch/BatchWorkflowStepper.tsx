import React from 'react';

export type BatchWorkflowStepNumber = 1 | 2 | 3 | 4;

const WORKFLOW_STEPS: Array<{ num: BatchWorkflowStepNumber; label: string; shortDesc: string }> = [
  { num: 1, label: 'Batch Setup', shortDesc: 'PDFs, pages, cost breakdown & cap' },
  { num: 2, label: 'Processing', shortDesc: 'Extract, crop, metadata & catalog match' },
  { num: 3, label: 'Review', shortDesc: 'Metadata, offers, matches & exceptions' },
  { num: 4, label: 'Publication', shortDesc: 'Preflight, approval & guarded DB writes' }
];

interface BatchWorkflowStepperProps {
  currentStep: BatchWorkflowStepNumber;
  onStepClick?: (step: BatchWorkflowStepNumber) => void;
}

export const BatchWorkflowStepper: React.FC<BatchWorkflowStepperProps> = ({
  currentStep,
  onStepClick
}) => {
  return (
    <nav
      aria-label="Batch workflow steps"
      className="bg-slate-950/70 border border-slate-800 rounded-xl p-2.5 grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]"
    >
      {WORKFLOW_STEPS.map((s) => {
        const isCurrent = s.num === currentStep;
        const isDone = s.num < currentStep;
        const canClick = Boolean(onStepClick && s.num !== currentStep);

        return (
          <button
            key={s.num}
            type="button"
            disabled={!canClick}
            onClick={() => canClick && onStepClick?.(s.num)}
            className={`text-left px-2.5 py-2 rounded-lg border transition-all flex items-start gap-2 ${
              isCurrent
                ? 'bg-indigo-950/80 border-indigo-500 text-white shadow'
                : isDone
                  ? 'bg-emerald-950/30 border-emerald-800/70 text-emerald-200 hover:bg-emerald-950/50'
                  : 'bg-slate-900/60 border-slate-800/80 text-slate-400'
            } ${canClick ? 'cursor-pointer' : 'cursor-default'}`}
          >
            <span
              className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] ${
                isCurrent
                  ? 'bg-indigo-600 text-white'
                  : isDone
                    ? 'bg-emerald-700 text-white'
                    : 'bg-slate-800 text-slate-400'
              }`}
            >
              {isDone ? '✓' : s.num}
            </span>
            <div className="min-w-0">
              <div className="font-semibold truncate">
                {s.num}. {s.label}
              </div>
              <div className="text-[10px] opacity-75 truncate">{s.shortDesc}</div>
            </div>
          </button>
        );
      })}
    </nav>
  );
};
