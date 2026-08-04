'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';

/**
 * Toast — a small animated notification pinned bottom-right. Controlled: render
 * with a `message`; call `onClose` to clear. Auto-dismisses after `duration`ms.
 * tone: 'success' | 'error' | 'info'
 */
export default function Toast({ message, tone = 'info', onClose, duration = 3500 }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => onClose?.(), duration);
    return () => clearTimeout(t);
  }, [message, duration, onClose]);

  const tones = {
    success: 'border-brand-200 bg-brand-50 text-brand-800',
    error:   'border-red-200 bg-red-50 text-red-700',
    info:    'border-slate-200 bg-white text-slate-700',
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 sm:justify-end sm:pr-6">
      <AnimatePresence>
        {message && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 400, damping: 28 }}
            className={`pointer-events-auto max-w-sm rounded-xl border px-4 py-3 text-sm font-medium shadow-card backdrop-blur ${tones[tone]}`}
            role="status"
          >
            {message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
