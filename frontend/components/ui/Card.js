'use client';

import { motion } from 'framer-motion';

/**
 * Card — a motion-aware surface built on the .card primitive.
 * Set `hover` for a subtle lift on hover (use for interactive/plan cards).
 * Pass motion variants via `variants` to participate in a staggered container.
 */
export default function Card({
  children,
  className = '',
  hover = false,
  variants,
  ...props
}) {
  return (
    <motion.div
      variants={variants}
      whileHover={hover ? { y: -4, boxShadow: '0 20px 50px -20px rgba(13,148,136,0.35)' } : undefined}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
      className={`card ${className}`}
      {...props}
    >
      {children}
    </motion.div>
  );
}
