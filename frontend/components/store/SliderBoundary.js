'use client';

import { Component } from 'react';

/**
 * SliderBoundary — an error boundary around HeroSlider. A render error in the
 * carousel should never blank the whole page (and stay blank until a full
 * reload). Instead we catch it, log it to the console, and render a minimal
 * fallback so the rest of the storefront keeps working.
 *
 * The captured message is also shown inline (dev aid) so the actual failure is
 * visible instead of a silent vanish.
 */
export default class SliderBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Surface the real cause — this is what we've been missing.
    console.error('HeroSlider crashed:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <section className="rounded-3xl bg-brand-gradient px-6 py-10 text-center text-slate-900 shadow-float">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-900/80">Instant data</p>
          <h1 className="mt-2 text-3xl font-extrabold leading-tight sm:text-4xl">
            Buy a plan, get your voucher in seconds.
          </h1>
          <p className="mt-3 text-slate-900/85">Pick a plan below to get started.</p>
          {process.env.NODE_ENV !== 'production' && (
            <p className="mt-4 rounded-lg bg-black/20 px-3 py-2 font-mono text-xs text-slate-900/90">
              slider error: {String(this.state.error?.message || this.state.error)}
            </p>
          )}
        </section>
      );
    }
    return this.props.children;
  }
}
