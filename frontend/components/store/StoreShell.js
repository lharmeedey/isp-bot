'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { customerApi } from '@/lib/customerApi';
import ProfileMenu from '@/components/store/ProfileMenu';
import { ThemeToggle } from '@/components/ui';

/**
 * StoreShell — the single persistent frame for every storefront page. A slim
 * sticky top nav (business name + actions) over one consistent centered content
 * column. Replaces the per-page GradientHeader so navigating the store keeps a
 * stable layout instead of a different design on each page.
 *
 * Signed-in pages pass `signedIn`, `customer`, `onSignOut` → ProfileMenu (which
 * carries logout + settings on EVERY page). Signed-out pages show Sign in /
 * Create account instead.
 *
 * `businessName` is optional; when omitted the shell fetches it from
 * customerApi.info(tenantId) so account/auth pages still show the store name.
 */
export default function StoreShell({
  tenantId,
  businessName,
  signedIn = false,
  customer,
  onSignOut,
  balanceGb = null,
  contentClassName = 'mx-auto max-w-5xl px-4 py-8',
  children,
}) {
  const [name, setName] = useState(businessName || '');

  useEffect(() => {
    if (businessName) { setName(businessName); return; }
    let live = true;
    customerApi.info(tenantId)
      .then((i) => { if (live && i?.name) setName(i.name); })
      .catch(() => {});
    return () => { live = false; };
  }, [tenantId, businessName]);

  // Browser tab title follows the store — a customer's bookmarks/history show the
  // business, not a generic app name. Falls back to the app title if not loaded.
  useEffect(() => {
    document.title = name ? `${name} — Store` : 'Wi-Fi Store';
  }, [name]);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/80 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3.5">
          <Link href={`/store/${tenantId}`} className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-glow">◍</span>
            <span className="truncate text-base font-bold text-slate-900 dark:text-slate-100">
              {name || 'Wi-Fi Store'}
            </span>
          </Link>

          <div className="flex items-center gap-2">
            {signedIn && balanceGb != null && (
              <span className="hidden items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 sm:inline-flex dark:bg-brand-950/50 dark:text-brand-300">
                <BoltIcon /> {balanceGb} GB
              </span>
            )}

            {signedIn ? (
              <>
                <Link href={`/store/${tenantId}`}
                      className="hidden rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 transition hover:text-brand-700 sm:block dark:text-slate-300 dark:hover:text-brand-400">
                  Buy data
                </Link>
                <ThemeToggle />
                <ProfileMenu
                  tenantId={tenantId}
                  name={customer?.name}
                  email={customer?.email}
                  onSignOut={onSignOut}
                  tone="surface"
                />
              </>
            ) : (
              <>
                <ThemeToggle />
                <Link href={`/store/${tenantId}/login`}
                      className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 transition hover:text-brand-700 dark:text-slate-300 dark:hover:text-brand-400">
                  Sign in
                </Link>
                <Link href={`/store/${tenantId}/register`}
                      className="btn-primary">
                  Create account
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <div className={contentClassName}>{children}</div>
    </div>
  );
}

function BoltIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
      <path d="M13 2L4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z" />
    </svg>
  );
}
