'use client';

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { customerApi, setTokens } from '@/lib/customerApi';
import Alert from '@/components/Alert';
import { Button, Field, Input, GradientHeader } from '@/components/ui';

export default function StoreLogin() {
  return (
    <Suspense fallback={<main className="min-h-screen" />}>
      <StoreLoginInner />
    </Suspense>
  );
}

function StoreLoginInner() {
  const { tenantId } = useParams();
  const router = useRouter();
  const params = useSearchParams();
  const next   = params.get('next');

  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [busy, setBusy]         = useState(false);

  async function resumeIntentOrHome() {
    // If the customer came here mid-purchase, resume checkout automatically.
    let intent = null;
    try { intent = window.sessionStorage.getItem('buy_intent'); } catch {}
    if (next === 'buy' && intent) {
      try {
        window.sessionStorage.removeItem('buy_intent');
        const { authorizationUrl } = await customerApi.checkout(intent);
        window.location.href = authorizationUrl;
        return;
      } catch {
        // fall through to the store on failure
      }
    }
    router.replace(`/store/${tenantId}`);
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await customerApi.login(tenantId, { email, password });
      setTokens(data);
      await resumeIntentOrHome();
    } catch (err) {
      setError(err.message || 'Login failed');
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen">
      <GradientHeader compact title="Welcome back" subtitle="Sign in to buy plans and view your vouchers." />
      <div className="mx-auto flex max-w-md flex-col px-4 py-10">
        <motion.form
          onSubmit={onSubmit}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="card space-y-4"
        >
          <Alert type="error">{error}</Alert>
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" value={email}
                   onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </Field>
          <Field label="Password" htmlFor="password">
            <Input id="password" type="password" value={password}
                   onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </Field>
          <Button type="submit" className="w-full" loading={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </motion.form>

        <p className="mt-4 text-center text-sm text-slate-500">
          New here?{' '}
          <Link href={`/store/${tenantId}/register${next ? `?next=${next}` : ''}`}
                className="font-semibold text-brand-600 hover:underline">
            Create an account
          </Link>
        </p>
        <Link href={`/store/${tenantId}`} className="mt-2 text-center text-sm text-slate-400 hover:text-brand-600">
          ← Back to store
        </Link>
      </div>
    </main>
  );
}
