'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useInView } from 'framer-motion';

/**
 * Stat — a dashboard metric card with an animated count-up on the numeric part.
 * `value` may be a number (animated) or a preformatted string like "₦12,500"
 * (the leading symbol/commas are preserved, digits animate).
 */
export default function Stat({ label, value, sub, variants }) {
  return (
    <motion.div variants={variants} className="card overflow-hidden">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">
        <AnimatedValue value={value} />
      </p>
      {sub ? <p className="mt-0.5 text-xs text-slate-500">{sub}</p> : null}
    </motion.div>
  );
}

function AnimatedValue({ value }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  const [display, setDisplay] = useState(typeof value === 'number' ? '0' : value);

  // Extract a number to animate; keep any prefix (₦) / suffix around it.
  const str = String(value ?? '');
  const match = str.match(/[\d,.]+/);
  const target = match ? Number(match[0].replace(/,/g, '')) : null;

  useEffect(() => {
    if (!inView || target === null || Number.isNaN(target)) {
      setDisplay(str);
      return;
    }
    const duration = 700;
    const start = performance.now();
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = Math.round(target * eased);
      const formatted = current.toLocaleString('en-NG');
      setDisplay(str.replace(match[0], formatted));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, target]); // eslint-disable-line react-hooks/exhaustive-deps

  return <span ref={ref}>{display}</span>;
}
