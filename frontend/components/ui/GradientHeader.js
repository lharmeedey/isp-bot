'use client';

import { motion } from 'framer-motion';

/**
 * GradientHeader — a branded hero band with a soft mesh background. Used at the
 * top of the storefront landing and (compactly) other screens. `compact`
 * reduces vertical padding for auth/inner pages.
 */
export default function GradientHeader({ title, subtitle, children, compact = false }) {
  return (
    <div className="relative overflow-hidden bg-brand-gradient text-slate-900">
      <div className="pointer-events-none absolute inset-0 bg-mesh opacity-60" />
      <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-black/10 blur-2xl" />
      <div className={`relative mx-auto max-w-5xl px-4 ${compact ? 'py-8' : 'py-14'}`}>
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className={`font-bold tracking-tight ${compact ? 'text-2xl' : 'text-3xl sm:text-4xl'}`}
        >
          {title}
        </motion.h1>
        {subtitle && (
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.08 }}
            className="mt-2 max-w-xl text-sm text-slate-900/85 sm:text-base"
          >
            {subtitle}
          </motion.p>
        )}
        {children && <div className="relative mt-5">{children}</div>}
      </div>
    </div>
  );
}
