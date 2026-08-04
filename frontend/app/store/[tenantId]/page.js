'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { customerApi, getAccessToken } from '@/lib/customerApi';
import PlanGrid from '@/components/store/PlanGrid';
import Alert from '@/components/Alert';
import { GradientHeader, Skeleton, Toast } from '@/components/ui';

// Public storefront landing: shows a tenant's plans. Browsing needs no login;
// buying does — an unauthenticated "Get this plan" bounces to login and returns.
export default function StoreLanding() {
  const { tenantId } = useParams();
  const router = useRouter();

  const [info, setInfo]   = useState(null);
  const [plans, setPlans] = useState(null);
  const [error, setError] = useState('');
  const [busyLabel, setBusyLabel] = useState('');
  const [toast, setToast] = useState('');
  const signedIn = typeof window !== 'undefined' && !!getAccessToken();

  useEffect(() => {
    (async () => {
      try {
        const [i, p] = await Promise.all([
          customerApi.info(tenantId),
          customerApi.plans(tenantId),
        ]);
        setInfo(i);
        setPlans(p.plans || []);
      } catch (err) {
        setError(err.message || 'This store is unavailable.');
      }
    })();
  }, [tenantId]);

  async function onBuy(plan) {
    if (!getAccessToken()) {
      // Remember intent and send to login.
      try { window.sessionStorage.setItem('buy_intent', plan.label); } catch {}
      router.push(`/store/${tenantId}/login?next=buy`);
      return;
    }
    setBusyLabel(plan.label);
    setError('');
    try {
      const { authorizationUrl } = await customerApi.checkout(plan.label);
      window.location.href = authorizationUrl; // hand off to Paystack
    } catch (err) {
      setError(err.message || 'Could not start checkout.');
      setBusyLabel('');
    }
  }

  return (
    <main className="min-h-screen">
      <GradientHeader
        title={info ? info.name : 'Wi-Fi Store'}
        subtitle="Fast, affordable data plans. Pay securely and get your voucher instantly."
      >
        <div className="flex flex-wrap gap-2">
          {signedIn ? (
            <Link href={`/store/${tenantId}/account`}
                  className="rounded-xl bg-white/15 px-4 py-2 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/25">
              My account →
            </Link>
          ) : (
            <>
              <Link href={`/store/${tenantId}/login`}
                    className="rounded-xl bg-white/15 px-4 py-2 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/25">
                Sign in
              </Link>
              <Link href={`/store/${tenantId}/register`}
                    className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-brand-700 shadow-sm transition hover:-translate-y-0.5">
                Create account
              </Link>
            </>
          )}
        </div>
      </GradientHeader>

      <div className="mx-auto max-w-5xl px-4 py-10">
        {error && <div className="mb-6"><Alert type="error">{error}</Alert></div>}

        {info && info.active === false && (
          <div className="mb-6"><Alert type="info">This store isn&apos;t taking orders yet. Please check back soon.</Alert></div>
        )}

        {plans === null ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[0,1,2].map((i) => (
              <div key={i} className="card space-y-3">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-9 w-32" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </div>
        ) : (
          <PlanGrid plans={plans} onBuy={onBuy} busyLabel={busyLabel} />
        )}
      </div>

      <Toast message={toast} tone="info" onClose={() => setToast('')} />
    </main>
  );
}
