'use client';

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { api, setTokens } from '@/lib/api';
import Alert from '@/components/Alert';
import { Button, Field, Input, PasswordInput, Logo } from '@/components/ui';

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="min-h-screen" />}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const justReset = useSearchParams().get('reset') === '1';
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [busy, setBusy]         = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await api.login({ email, password });
      setTokens(data);
      router.replace('/dashboard');
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden bg-brand-gradient lg:block">
        <div className="absolute inset-0 bg-mesh opacity-70" />
        <div className="absolute -left-10 top-1/3 h-72 w-72 rounded-full bg-black/10 blur-3xl animate-float" />
        <div className="relative flex h-full flex-col justify-between p-12 text-slate-900">
          <Logo variant="lockup" size={56} />
          <div>
            <h2 className="text-3xl font-bold leading-tight">Run your Wi-Fi business on autopilot.</h2>
            <p className="mt-3 max-w-sm text-slate-900/80">
              Vouchers, plans, payments and live network status — all in one place.
            </p>
          </div>
          <p className="text-xs text-slate-900/70">Encrypted secrets · Multi-tenant · Paystack-ready</p>
        </div>
      </aside>

      {/* Form panel */}
      <section className="flex items-center justify-center px-4 py-12">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-sm"
        >
          <h1 className="mb-1 text-2xl font-bold text-slate-900 dark:text-slate-100">Welcome back</h1>
          <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">Sign in to manage your ISP.</p>

          <form onSubmit={onSubmit} className="card space-y-4">
            <Alert type="error">{error}</Alert>
            {justReset && <Alert type="info">Password reset — sign in with your new password.</Alert>}
            <Field label="Email" htmlFor="email">
              <Input id="email" type="email" value={email}
                     onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </Field>
            <Field label="Password" htmlFor="password">
              <PasswordInput id="password" value={password}
                     onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
            </Field>
            <div className="text-right -mt-1">
              <Link href="/forgot" className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400">
                Forgot password?
              </Link>
            </div>
            <Button type="submit" className="w-full" loading={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <p className="mt-4 text-center text-sm text-slate-500 dark:text-slate-400">
            No account?{' '}
            <Link href="/register" className="font-semibold text-brand-600 hover:underline dark:text-brand-400">Create one</Link>
          </p>
        </motion.div>
      </section>
    </main>
  );
}
