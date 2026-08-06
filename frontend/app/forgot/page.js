'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import Alert from '@/components/Alert';
import { Button, Field, Input, PasswordInput } from '@/components/ui';

// Two-step reset: (1) enter email → we email a 6-digit code, (2) enter the code
// + a new password. Step 1 always "succeeds" (the backend never reveals whether
// an email exists), so we advance to step 2 regardless.
export default function ForgotPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [email, setEmail]             = useState('');
  const [code, setCode]               = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError]   = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy]     = useState(false);

  async function requestCode(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.forgotPassword(email.trim().toLowerCase());
      setNotice(`If an account exists for ${email.trim().toLowerCase()}, a 6-digit code is on its way.`);
      setStep(2);
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function submitReset(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.resetPassword({
        email: email.trim().toLowerCase(),
        code: code.trim(),
        newPassword,
      });
      router.replace('/login?reset=1');
    } catch (err) {
      setError(err.message || 'Could not reset password');
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
            <h2 className="text-3xl font-bold leading-tight">Reset your password.</h2>
            <p className="mt-3 max-w-sm text-white/80">
              We&apos;ll email you a one-time code to set a new password securely.
            </p>
          </div>
          <p className="text-xs text-white/60">Codes expire in 10 minutes.</p>
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
          <h1 className="mb-1 text-2xl font-bold text-slate-900 dark:text-slate-100">Forgot password</h1>
          <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
            {step === 1 ? 'Enter your account email to get a code.' : 'Enter the code we emailed and a new password.'}
          </p>

          {step === 1 ? (
            <form onSubmit={requestCode} className="card space-y-4">
              <Alert type="error">{error}</Alert>
              <Field label="Email" htmlFor="email">
                <Input id="email" type="email" value={email}
                       onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
              </Field>
              <Button type="submit" className="w-full" loading={busy}>
                {busy ? 'Sending…' : 'Send code'}
              </Button>
            </form>
          ) : (
            <form onSubmit={submitReset} className="card space-y-4">
              <Alert type="error">{error}</Alert>
              {notice && <Alert type="info">{notice}</Alert>}
              <Field label="6-digit code" htmlFor="code">
                <Input id="code" inputMode="numeric" maxLength={6} value={code}
                       onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                       required autoComplete="one-time-code" placeholder="123456" />
              </Field>
              <Field label="New password" htmlFor="newPassword">
                <PasswordInput id="newPassword" value={newPassword}
                       onChange={(e) => setNewPassword(e.target.value)} required
                       autoComplete="new-password" minLength={8} placeholder="At least 8 characters" />
              </Field>
              <Button type="submit" className="w-full" loading={busy}>
                {busy ? 'Resetting…' : 'Reset password'}
              </Button>
              <button type="button" onClick={() => { setStep(1); setError(''); setNotice(''); }}
                      className="w-full text-center text-xs text-slate-500 hover:underline dark:text-slate-400">
                Use a different email
              </button>
            </form>
          )}

          <p className="mt-4 text-center text-sm text-slate-500 dark:text-slate-400">
            Remembered it?{' '}
            <Link href="/login" className="font-semibold text-brand-600 hover:underline dark:text-brand-400">Back to sign in</Link>
          </p>
        </motion.div>
      </section>
    </main>
  );
}
