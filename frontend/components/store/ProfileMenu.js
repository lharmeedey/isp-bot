'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { useTheme } from '@/lib/theme';

/**
 * ProfileMenu — an avatar button in the storefront header that opens a dropdown
 * with account settings, a light/dark theme toggle, and sign out. Sits on the
 * brand gradient, so the trigger is a translucent white circle; the popover
 * itself is a normal surface that adapts to the theme.
 */
export default function ProfileMenu({ tenantId, name, email, onSignOut, tone = 'gradient' }) {
  const { theme, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const initials = (name || email || '?').trim().charAt(0).toUpperCase();

  const triggerClass = tone === 'surface'
    ? 'flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white transition hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 dark:bg-brand-500 dark:hover:bg-brand-400'
    : 'flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-sm font-bold text-white backdrop-blur transition hover:bg-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70';

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className={triggerClass}
      >
        {initials}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="absolute right-0 z-40 mt-2 w-60 overflow-hidden rounded-2xl border border-slate-200/70 bg-white/95 text-slate-700 shadow-float backdrop-blur-md dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-200"
          >
            <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
              <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                {name || 'Your account'}
              </p>
              {email && <p className="truncate text-xs text-slate-500 dark:text-slate-400">{email}</p>}
            </div>

            <Link
              href={`/store/${tenantId}/account/settings`}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-4 py-2.5 text-sm transition hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <GearIcon /> Account settings
            </Link>

            <button
              type="button"
              role="menuitem"
              onClick={toggle}
              className="flex w-full items-center justify-between gap-2.5 px-4 py-2.5 text-sm transition hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <span className="flex items-center gap-2.5">
                {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
                {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              </span>
              <span className="text-xs text-slate-400 dark:text-slate-500">{theme === 'dark' ? 'On' : 'Off'}</span>
            </button>

            <div className="border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                role="menuitem"
                onClick={() => { setOpen(false); onSignOut?.(); }}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                <SignOutIcon /> Sign out
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}
