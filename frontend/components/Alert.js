'use client';

import { AnimatePresence, motion } from 'framer-motion';

// Inline alert used across forms. type: 'error' | 'success' | 'info'
export default function Alert({ type = 'info', children }) {
  const styles = {
    error:   'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300',
    success: 'border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-900/50 dark:bg-brand-950/40 dark:text-brand-300',
    info:    'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300',
  }[type];

  return (
    <AnimatePresence initial={false}>
      {children ? (
        <motion.div
          initial={{ opacity: 0, height: 0, marginBottom: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0, marginBottom: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className={`overflow-hidden rounded-xl border px-3.5 py-2.5 text-sm ${styles}`}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
