'use client';

import { motion } from 'framer-motion';
import { Button, Card, staggerContainer, staggerItem } from '@/components/ui';

const naira = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');

/**
 * PlanGrid — the storefront's browsable plan cards. `onBuy(plan)` is called when
 * a customer picks a plan; `busyLabel` is the plan currently being processed
 * (shows a spinner on that card). The middle plan is highlighted as "Popular".
 */
export default function PlanGrid({ plans, onBuy, busyLabel }) {
  if (!plans?.length) {
    return <p className="text-center text-sm text-slate-500 dark:text-slate-400">No plans available right now — check back soon.</p>;
  }

  const popularIdx = plans.length >= 3 ? Math.floor(plans.length / 2) : -1;

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
    >
      {plans.map((p, i) => {
        const popular = i === popularIdx;
        return (
          <Card
            key={p.id ?? p.label}
            variants={staggerItem}
            hover
            className={`relative flex flex-col ${popular ? 'ring-2 ring-brand-500' : ''}`}
          >
            {popular && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent-500 px-3 py-0.5 text-xs font-bold text-white shadow-glow">
                Popular
              </span>
            )}
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{p.label}</h3>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-3xl font-extrabold text-gradient">{naira(p.price)}</span>
            </div>
            <ul className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-300">
              <li className="flex items-center gap-2">
                <Check /> <span><strong className="text-slate-900 dark:text-slate-100">{p.gb}</strong> GB data</span>
              </li>
              <li className="flex items-center gap-2">
                <Check /> Valid for {p.validity} {String(p.validity) === '1' ? 'day' : 'days'}
              </li>
              <li className="flex items-center gap-2">
                <Check /> Instant voucher delivery
              </li>
            </ul>
            <div className="flex-1" />
            <Button
              className="mt-5 w-full"
              variant={popular ? 'primary' : 'ghost'}
              loading={busyLabel === p.label}
              onClick={() => onBuy(p)}
            >
              {busyLabel === p.label ? 'Starting…' : 'Get this plan'}
            </Button>
          </Card>
        );
      })}
    </motion.div>
  );
}

function Check() {
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[10px] font-bold text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
      ✓
    </span>
  );
}
