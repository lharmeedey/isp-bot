'use client';

import { useTheme } from '@/lib/theme';

/**
 * ThemeToggle — a compact sun/moon button that flips between dark and light.
 * Neutral styling so it sits comfortably in both operator and storefront chrome.
 */
export default function ThemeToggle({ className = '' }) {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
      className={
        'inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white/80 ' +
        'text-slate-600 transition hover:text-brand-600 hover:border-brand-300 ' +
        'dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300 dark:hover:text-brand-300 ' +
        'dark:hover:border-brand-600 ' + className
      }
    >
      {dark ? (
        // Sun
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
             strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      ) : (
        // Moon
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
             strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}
