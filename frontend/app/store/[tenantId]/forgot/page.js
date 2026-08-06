'use client';

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { customerApi } from '@/lib/customerApi';
import Alert from '@/components/Alert';
import StoreShell from '@/components/store/StoreShell';
import { Button, Field, Input, PasswordInput } from '@/components/ui';

export default function StoreForgot() {
  return (
    <Suspense fallback={<main className="min-h-screen" />}>
      <StoreForgotInner />
    </Suspense>
  );
}

function StoreForgotInner() {
  const { tenantId } = useParams();
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
      await customerApi.forgotPassword(tenantId, email.trim().toLowerCase());
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
      await customerApi.resetPassword(tenantId, {
        email: email.trim().toLowerCase(),
        code: code.trim(),
        newPassword,
      });
      router.replace(`/store/${tenantId}/login?reset=1`);
    } catch (err) {
      setError(err.message || 'Could not reset password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <StoreShell tenantId={tenantId} signedIn={false}
                contentClassName="mx-auto flex max-w-md flex-col px-4 py-10">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Reset password</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {step === 1 ? 'Enter your email to get a code.' : 'Enter the code we emailed and a new password.'}
        </p>
      </div>
      {step === 1 ? (
          <motion.form
            onSubmit={requestCode}
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
            <Button type="submit" className="w-full" loading={busy}>
              {busy ? 'Sending…' : 'Send code'}
            </Button>
          </motion.form>
        ) : (
          <motion.form
            onSubmit={submitReset}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="card space-y-4"
          >
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
          </motion.form>
        )}

        <p className="mt-4 text-center text-sm text-slate-500 dark:text-slate-400">
          Remembered it?{' '}
          <Link href={`/store/${tenantId}/login`} className="font-semibold text-brand-600 hover:underline dark:text-brand-400">
            Back to sign in
          </Link>
        </p>
        <Link href={`/store/${tenantId}`} className="mt-2 text-center text-sm text-slate-400 hover:text-brand-600 dark:text-slate-500 dark:hover:text-brand-400">
          ← Back to store
        </Link>
    </StoreShell>
  );
}
