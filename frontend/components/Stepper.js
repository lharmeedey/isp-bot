'use client';

import { motion } from 'framer-motion';

// Horizontal step indicator for the onboarding wizard.
const STEPS = [
  { key: 'provider', label: 'Connect' },
  { key: 'plans',    label: 'Plans' },
  { key: 'sync',     label: 'Sync' },
  { key: 'done',     label: 'Go live' },
];

export default function Stepper({ current }) {
  const currentIdx = STEPS.findIndex((s) => s.key === current);
  const pct = STEPS.length > 1 ? (Math.max(0, currentIdx) / (STEPS.length - 1)) * 100 : 0;

  return (
    <div className="mb-8">
      {/* progress rail */}
      <div className="relative mb-4 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full bg-brand-gradient"
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        />
      </div>
      <ol className="flex items-center justify-between">
        {STEPS.map((s, i) => {
          const done   = i < currentIdx;
          const active = i === currentIdx;
          return (
            <li key={s.key} className="flex flex-col items-center gap-1.5">
              <motion.span
                initial={false}
                animate={{ scale: active ? 1.1 : 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                className={
                  'flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold shadow-sm ' +
                  (done   ? 'bg-brand-gradient text-white'
                   : active ? 'bg-white text-brand-700 ring-2 ring-brand-500 dark:bg-slate-900 dark:text-brand-300'
                   : 'bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400')
                }
              >
                {done ? '✓' : i + 1}
              </motion.span>
              <span className={'text-xs ' + (active ? 'font-semibold text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400')}>
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
