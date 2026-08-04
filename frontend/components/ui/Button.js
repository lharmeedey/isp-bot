'use client';

import { motion } from 'framer-motion';

/**
 * Button — motion-enhanced button that reuses the .btn-* CSS primitives.
 * variant: 'primary' | 'ghost' | 'accent'
 * Works as a submit button in forms (pass type="submit").
 */
export default function Button({
  children,
  variant = 'primary',
  className = '',
  loading = false,
  disabled = false,
  ...props
}) {
  const base =
    variant === 'ghost'  ? 'btn-ghost' :
    variant === 'accent' ? 'btn-accent' :
                           'btn-primary';

  return (
    <motion.button
      whileHover={{ scale: disabled || loading ? 1 : 1.02 }}
      whileTap={{ scale: disabled || loading ? 1 : 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className={`${base} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
      )}
      {children}
    </motion.button>
  );
}
