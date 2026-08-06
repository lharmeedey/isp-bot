'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { api, setTokens } from '@/lib/api';
import Alert from '@/components/Alert';
import { Button, Field, Input, PasswordInput } from '@/components/ui';

export default function RegisterPage() {
  const router = useRouter();
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail]               = useState('');
  const [password, setPassword]         = useState('');
  const [error, setError]               = useState('');
  const [busy, setBusy]                 = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      const data = await api.register({ businessName, email, password });
      setTokens(data);
      // Fresh tenants start at onboarding_step 'provider'.
      router.replace('/onboarding');
    } catch (err) {
      setError(err.message || 'Registration failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden bg-brand-gradient lg:block">
        <div className="absolute inset-0 bg-mesh opacity-70" />
        <div className="absolute -right-10 bottom-1/4 h-72 w-72 rounded-full bg-white/10 blur-3xl animate-float" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <span className="text-lg font-bold tracking-tight">◍ ISP Console</span>
          <div>
            <h2 className="text-3xl font-bold leading-tight">Start selling Wi-Fi in minutes.</h2>
            <p className="mt-3 max-w-sm text-white/80">
              Connect your controller, map your plans, and go live with automated voucher delivery.
            </p>
          </div>
          <ul className="space-y-1 text-sm text-white/75">
            <li>✓ TP-Link Omada &amp; MikroTik</li>
            <li>✓ Paystack payments</li>
            <li>✓ Live dashboard &amp; stock</li>
          </ul>
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
          <h1 className="mb-1 text-2xl font-bold text-slate-900 dark:text-slate-100">Create your account</h1>
          <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">Set up your operator console.</p>

          <form onSubmit={onSubmit} className="card space-y-4">
            <Alert type="error">{error}</Alert>
            <Field label="Business name" htmlFor="business">
              <Input id="business" type="text" value={businessName}
                     onChange={(e) => setBusinessName(e.target.value)} placeholder="Acme WiFi" />
            </Field>
            <Field label="Email" htmlFor="email">
              <Input id="email" type="email" value={email}
                     onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </Field>
            <Field label="Password" htmlFor="password" hint="At least 8 characters.">
              <PasswordInput id="password" value={password}
                     onChange={(e) => setPassword(e.target.value)} required
                     autoComplete="new-password" minLength={8} />
            </Field>
            <Button type="submit" className="w-full" loading={busy}>
              {busy ? 'Creating…' : 'Create account'}
            </Button>
          </form>

          <p className="mt-4 text-center text-sm text-slate-500 dark:text-slate-400">
            Already have an account?{' '}
            <Link href="/login" className="font-semibold text-brand-600 hover:underline dark:text-brand-400">Sign in</Link>
          </p>
        </motion.div>
      </section>
    </main>
  );
}
