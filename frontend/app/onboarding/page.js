'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '@/lib/useAuth';
import Stepper from '@/components/Stepper';
import ProviderStep from '@/components/onboarding/ProviderStep';
import PlansStep from '@/components/onboarding/PlansStep';
import SyncStep from '@/components/onboarding/SyncStep';
import { GradientHeader } from '@/components/ui';

// Wizard orchestrator. The backend's tenants.onboarding_step is the source of
// truth; local `step` mirrors it and advances optimistically as each step saves.
export default function OnboardingPage() {
  const router = useRouter();
  const { loading, me, refresh } = useAuth();
  const [step, setStep] = useState(null);

  useEffect(() => {
    if (me?.tenant) {
      // If already live, don't trap the operator in the wizard.
      if (me.tenant.onboardingStep === 'done' || me.tenant.active) {
        router.replace('/dashboard');
      } else {
        setStep(me.tenant.onboardingStep || 'provider');
      }
    }
  }, [me, router]);

  if (loading || !step) {
    return <Centered>Loading…</Centered>;
  }

  const provider = me?.tenant?.networkProvider || 'omada';

  async function advanceTo(next) {
    await refresh();      // re-read onboarding_step from the backend
    setStep(next);
  }

  return (
    <main className="min-h-screen">
      <GradientHeader
        compact
        title={`Set up ${me?.tenant?.name || 'your service'}`}
        subtitle="A few steps and you're selling."
      />

      <div className="mx-auto max-w-3xl px-4 py-10">
        <Stepper current={step} />

        <div className="card">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            >
              {step === 'provider' && <ProviderStep onAdvance={() => advanceTo('plans')} />}
              {step === 'plans'    && <PlansStep networkProvider={provider} onAdvance={() => advanceTo('sync')} />}
              {step === 'sync'     && <SyncStep networkProvider={provider} />}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="mt-4 text-right">
          <button className="text-sm text-slate-400 transition hover:text-brand-600"
                  onClick={() => router.replace('/dashboard')}>
            Skip to dashboard →
          </button>
        </div>
      </div>
    </main>
  );
}

function Centered({ children }) {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
        <p className="text-sm text-slate-400">{children}</p>
      </div>
    </main>
  );
}
