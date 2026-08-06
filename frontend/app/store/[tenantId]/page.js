'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { customerApi, getAccessToken, clearTokens } from '@/lib/customerApi';
import { useCustomer } from '@/lib/useCustomer';
import PlanGrid from '@/components/store/PlanGrid';
import StoreShell from '@/components/store/StoreShell';
import HeroSlider from '@/components/store/HeroSlider';
import SliderBoundary from '@/components/store/SliderBoundary';
import Alert from '@/components/Alert';
import { Skeleton, Toast } from '@/components/ui';

// Public storefront landing: shows a tenant's plans. Browsing needs no login;
// buying does — an unauthenticated "Get this plan" bounces to login and returns.
export default function StoreLanding() {
  const { tenantId } = useParams();
  const router = useRouter();

  // Non-redirecting auth: gives us `me`/`logout` when signed in, silent otherwise.
  const { me, logout } = useCustomer(tenantId, { redirect: false });
  const signedIn = !!me;

  const [info, setInfo]   = useState(null);
  const [plans, setPlans] = useState(null);
  const [error, setError] = useState('');
  const [busyLabel, setBusyLabel] = useState('');
  const [toast, setToast] = useState('');

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

  // Data balance = sum of GB across UNUSED vouchers (web customers have no
  // stored GB counter, so it's derived from the plan catalogue).
  const balanceGb = useMemo(() => {
    if (!signedIn || !plans || !me?.vouchers) return null;
    const gbByPlan = Object.fromEntries(plans.map((p) => [p.label, Number(p.gb) || 0]));
    const total = me.vouchers
      .filter((v) => v.status === 'unused')
      .reduce((sum, v) => sum + (gbByPlan[v.plan] || 0), 0);
    return Math.round(total * 100) / 100;
  }, [signedIn, plans, me]);

  async function onBuy(plan) {
    // Send unauthenticated buyers (or those with a dead session) to login,
    // remembering the plan so checkout resumes automatically afterwards.
    function goLogin() {
      try { window.sessionStorage.setItem('buy_intent', plan.label); } catch {}
      clearTokens();
      router.push(`/store/${tenantId}/login?next=buy`);
    }

    if (!getAccessToken()) { goLogin(); return; }

    setBusyLabel(plan.label);
    setError('');
    try {
      const { authorizationUrl } = await customerApi.checkout(plan.label);
      window.location.href = authorizationUrl; // hand off to Paystack
    } catch (err) {
      if (err.status === 401) { goLogin(); return; }
      setError(err.message || 'Could not start checkout.');
      setBusyLabel('');
    }
  }

  return (
    <StoreShell
      tenantId={tenantId}
      businessName={info?.name}
      signedIn={signedIn}
      customer={me?.customer}
      onSignOut={logout}
      balanceGb={balanceGb}
    >
      <SliderBoundary>
        <HeroSlider plans={plans || []} balanceGb={balanceGb} signedIn={signedIn} onBuy={onBuy} />
      </SliderBoundary>

      <div className="mt-10">
        {error && <div className="mb-6"><Alert type="error">{error}</Alert></div>}

        {info && info.active === false && (
          <div className="mb-6"><Alert type="info">This store isn&apos;t taking orders yet. Please check back soon.</Alert></div>
        )}

        <h2 className="mb-4 text-lg font-bold text-slate-900 dark:text-slate-100">Choose a plan</h2>

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
    </StoreShell>
  );
}
