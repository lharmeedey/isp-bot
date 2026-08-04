'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { api, setTokens } from '@/lib/api';
import Alert from '@/components/Alert';
import { Button, Field, Input } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
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
        <div className="absolute -left-10 top-1/3 h-72 w-72 rounded-full bg-white/10 blur-3xl animate-float" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <span className="text-lg font-bold tracking-tight">◍ ISP Console</span>
          <div>
            <h2 className="text-3xl font-bold leading-tight">Run your Wi-Fi business on autopilot.</h2>
            <p className="mt-3 max-w-sm text-white/80">
              Vouchers, plans, payments and live network status — all in one place.
            </p>
          </div>
          <p className="text-xs text-white/60">Encrypted secrets · Multi-tenant · Paystack-ready</p>
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
          <h1 className="mb-1 text-2xl font-bold text-slate-900">Welcome back</h1>
          <p className="mb-6 text-sm text-slate-500">Sign in to manage your ISP.</p>

          <form onSubmit={onSubmit} className="card space-y-4">
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
          </form>

          <p className="mt-4 text-center text-sm text-slate-500">
            No account?{' '}
            <Link href="/register" className="font-semibold text-brand-600 hover:underline">Create one</Link>
          </p>
        </motion.div>
      </section>
    </main>
  );
}
