'use client';

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { customerApi, setTokens } from '@/lib/customerApi';
import Alert from '@/components/Alert';
import { Button, Field, Input, GradientHeader } from '@/components/ui';

export default function StoreRegister() {
  return (
    <Suspense fallback={<main className="min-h-screen" />}>
      <StoreRegisterInner />
    </Suspense>
  );
}

function StoreRegisterInner() {
  const { tenantId } = useParams();
  const router = useRouter();
  const params = useSearchParams();
  const next   = params.get('next');

  const [name, setName]         = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [busy, setBusy]         = useState(false);

  async function resumeIntentOrHome() {
    let intent = null;
    try { intent = window.sessionStorage.getItem('buy_intent'); } catch {}
    if (next === 'buy' && intent) {
      try {
        window.sessionStorage.removeItem('buy_intent');
        const { authorizationUrl } = await customerApi.checkout(intent);
        window.location.href = authorizationUrl;
        return;
      } catch { /* fall through */ }
    }
    router.replace(`/store/${tenantId}`);
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      const data = await customerApi.register(tenantId, { name, email, password });
      setTokens(data);
      await resumeIntentOrHome();
    } catch (err) {
      setError(err.message || 'Registration failed');
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen">
      <GradientHeader compact title="Create your account" subtitle="One account to buy plans and track your vouchers." />
      <div className="mx-auto flex max-w-md flex-col px-4 py-10">
        <motion.form
          onSubmit={onSubmit}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="card space-y-4"
        >
          <Alert type="error">{error}</Alert>
          <Field label="Name (optional)" htmlFor="name">
            <Input id="name" type="text" value={name}
                   onChange={(e) => setName(e.target.value)} placeholder="Ada" />
          </Field>
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" value={email}
                   onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </Field>
          <Field label="Password" htmlFor="password" hint="At least 8 characters.">
            <Input id="password" type="password" value={password}
                   onChange={(e) => setPassword(e.target.value)} required
                   autoComplete="new-password" minLength={8} />
          </Field>
          <Button type="submit" className="w-full" loading={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </Button>
        </motion.form>

        <p className="mt-4 text-center text-sm text-slate-500">
          Already have an account?{' '}
          <Link href={`/store/${tenantId}/login${next ? `?next=${next}` : ''}`}
                className="font-semibold text-brand-600 hover:underline">
            Sign in
          </Link>
        </p>
        <Link href={`/store/${tenantId}`} className="mt-2 text-center text-sm text-slate-400 hover:text-brand-600">
          ← Back to store
        </Link>
      </div>
    </main>
  );
}
