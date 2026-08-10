'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

/**
 * HeroSlider — a self-contained carousel on the storefront home. Replaces the
 * static GradientHeader hero with a rotating brand panel: a promo/CTA slide, a
 * data-balance slide (signed in), and featured-plan slides. Auto-advances every
 * 5s, pausing on hover / when the tab is hidden / when the user prefers reduced
 * motion. Fully keyboard- and dot-navigable.
 *
 * No carousel dependency — framer-motion (already a dep) drives the transitions.
 */
const naira = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');

export default function HeroSlider({ plans = [], balanceGb = null, signedIn = false, onBuy }) {
  const reduce = useReducedMotion();
  const slides = buildSlides({ plans, balanceGb, signedIn, onBuy });

  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(1);
  const [paused, setPaused] = useState(false);

  const count = slides.length;
  const go = useCallback((next) => {
    setDir(next > index ? 1 : -1);
    setIndex(((next % count) + count) % count);
  }, [index, count]);
  const next = useCallback(() => { setDir(1); setIndex((i) => (i + 1) % count); }, [count]);
  const prev = useCallback(() => { setDir(-1); setIndex((i) => (i - 1 + count) % count); }, [count]);

  // Auto-advance, paused on hover / hidden tab / reduced-motion / single slide.
  useEffect(() => {
    if (reduce || paused || count <= 1) return;
    const id = setInterval(() => {
      if (!document.hidden) { setDir(1); setIndex((i) => (i + 1) % count); }
    }, 5000);
    return () => clearInterval(id);
  }, [reduce, paused, count]);

  // If the slide count shrinks (e.g. signed-in slides collapse to just the promo
  // while `me`/`plans` reload), keep the stored index in range.
  useEffect(() => {
    if (index >= count) setIndex(0);
  }, [count, index]);

  // Always resolve to a valid slide — an out-of-range index would otherwise throw
  // in slide.render() and unmount the whole carousel.
  const safeIndex = ((index % count) + count) % count;
  const slide = slides[safeIndex];

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Store highlights"
      className="relative overflow-hidden rounded-3xl bg-brand-gradient text-slate-900 shadow-float"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') next();
        if (e.key === 'ArrowLeft') prev();
      }}
      tabIndex={0}
    >
      <div className="pointer-events-none absolute inset-0 bg-mesh opacity-40" />

      <div className="relative flex min-h-[240px] items-center justify-center px-6 py-10 sm:px-10 sm:py-14">
        {/* A plain keyed motion.div — NOT AnimatePresence. Changing `key` remounts
            the node, so framer-motion re-runs initial→animate every slide. There's
            no exit phase, so a slide can never get stuck mid-transition and blank
            the panel (the AnimatePresence "wait" desync we hit on nav-back). */}
        <motion.div
          key={safeIndex}
          initial={{ opacity: 0, x: reduce ? 0 : dir * 40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          aria-roledescription="slide"
          aria-label={`${safeIndex + 1} of ${count}`}
        >
          {slide.render()}
        </motion.div>
      </div>

      {count > 1 && (
        <>
          <button type="button" onClick={prev} aria-label="Previous slide"
                  className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/10 text-slate-900 backdrop-blur transition hover:bg-black/20">
            ‹
          </button>
          <button type="button" onClick={next} aria-label="Next slide"
                  className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/10 text-slate-900 backdrop-blur transition hover:bg-black/20">
            ›
          </button>
          <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-2">
            {slides.map((_, i) => (
              <button key={i} type="button" onClick={() => go(i)}
                      aria-label={`Go to slide ${i + 1}`} aria-current={i === safeIndex}
                      className={`h-2 rounded-full transition-all ${i === safeIndex ? 'w-6 bg-slate-900' : 'w-2 bg-slate-900/40 hover:bg-slate-900/60'}`} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// Build the ordered slide list from current props.
function buildSlides({ plans, balanceGb, signedIn, onBuy }) {
  const naira = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');
  const slides = [];

  // 1. Always: promo / value proposition.
  slides.push({
    key: 'promo',
    render: () => (
      <div className="mx-auto max-w-xl text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-900/80">Instant data</p>
        <h1 className="mt-2 text-3xl font-extrabold leading-tight sm:text-4xl">
          Buy a plan, get your voucher in seconds.
        </h1>
        <p className="mt-3 text-slate-900/85">Secure payment, instant delivery. Pick a plan below to get started.</p>
      </div>
    ),
  });

  // 2. Signed-in: data balance (or an out-of-data nudge).
  if (signedIn && balanceGb != null) {
    slides.push({
      key: 'balance',
      render: () => (
        <div className="mx-auto max-w-xl text-center">
          {balanceGb > 0 ? (
            <>
              <p className="text-sm font-semibold uppercase tracking-wide text-slate-900/80">Your data balance</p>
              <p className="mt-2 text-5xl font-extrabold sm:text-6xl">{balanceGb} <span className="text-2xl font-bold">GB</span></p>
              <p className="mt-3 text-slate-900/85">Across your active vouchers. Top up any time.</p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold uppercase tracking-wide text-slate-900/80">Your data balance</p>
              <p className="mt-2 text-3xl font-extrabold sm:text-4xl">You&apos;re out of data</p>
              <p className="mt-3 text-slate-900/85">Grab a plan below to get back online.</p>
            </>
          )}
        </div>
      ),
    });
  }

  // 3. Featured plans: cheapest + a "popular" middle pick.
  const featured = pickFeatured(plans);
  for (const plan of featured) {
    slides.push({
      key: `plan-${plan.label}`,
      render: () => (
        <div className="mx-auto max-w-xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-900/80">Featured plan</p>
          <h2 className="mt-2 text-3xl font-extrabold sm:text-4xl">{plan.label}</h2>
          <p className="mt-1 text-lg text-slate-900/90">{naira(plan.price)} · {plan.validity}</p>
          {onBuy && (
            <button type="button" onClick={() => onBuy(plan)}
                    className="mt-5 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5">
              Get this plan →
            </button>
          )}
        </div>
      ),
    });
  }

  return slides;
}

// Cheapest plan + the middle "popular" one, de-duplicated, max 2.
function pickFeatured(plans) {
  if (!plans?.length) return [];
  const sorted = [...plans].sort((a, b) => Number(a.price) - Number(b.price));
  const picks = [sorted[0]];
  const mid = plans[Math.floor(plans.length / 2)];
  if (mid && mid.label !== picks[0].label) picks.push(mid);
  return picks;
}
