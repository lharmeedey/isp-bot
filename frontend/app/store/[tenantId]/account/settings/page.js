'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCustomer } from '@/lib/useCustomer';
import { customerApi, setTokens } from '@/lib/customerApi';
import Alert from '@/components/Alert';
import { Button, Card, Field, Input, PasswordInput, GradientHeader, ThemeToggle } from '@/components/ui';

// Customer self-service settings: display name, email (OTP-verified), password.
// Split out of the main account page so that page stays focused on vouchers +
// history. Guarded by useCustomer, which redirects unauthenticated visitors.
export default function StoreAccountSettings() {
  const { tenantId } = useParams();
  const { loading, me, refresh } = useCustomer(tenantId);

  if (loading) return <Centered>Loading…</Centered>;
  if (!me) return null; // useCustomer redirected

  const { customer } = me;

  return (
    <main className="min-h-screen">
      <GradientHeader compact title="Account settings" subtitle="Manage your name, email and password.">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/store/${tenantId}/account`}
                className="rounded-xl bg-white/15 px-4 py-2 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/25">
            ← Back to account
          </Link>
          <ThemeToggle className="border-white/30 bg-white/15 text-white hover:border-white/50 hover:text-white dark:border-white/30 dark:bg-white/15 dark:text-white" />
        </div>
      </GradientHeader>

      <div className="mx-auto max-w-2xl space-y-4 px-4 py-10">
        <ProfileCard customer={customer} onSaved={refresh} />
        <EmailCard customer={customer} onSaved={refresh} />
        <PasswordCard />
      </div>
    </main>
  );
}

// ── Display name (customers.name) ──
function ProfileCard({ customer, onSaved }) {
  const [name, setName]   = useState('');
  const [msg, setMsg]     = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy]   = useState(false);

  useEffect(() => { setName(customer?.name || ''); }, [customer]);

  async function save(e) {
    e.preventDefault();
    setMsg(''); setError(''); setBusy(true);
    try {
      await customerApi.updateProfile({ name });
      setMsg('Name saved.');
      await onSaved();
    } catch (err) {
      setError(err.message || 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h3 className="mb-3 font-semibold text-slate-900 dark:text-slate-100">Your name</h3>
      <form onSubmit={save} className="space-y-4">
        {error && <Alert type="error">{error}</Alert>}
        {msg && <Alert type="info">{msg}</Alert>}
        <Field label="Display name" htmlFor="custName">
          <Input id="custName" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
        </Field>
        <Button type="submit" loading={busy}>{busy ? 'Saving…' : 'Save'}</Button>
      </form>
    </Card>
  );
}

// ── Email change: current password → OTP to new address ──
function EmailCard({ customer, onSaved }) {
  const [step, setStep] = useState(1);
  const [newEmail, setNewEmail]               = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [code, setCode]   = useState('');
  const [msg, setMsg]     = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy]   = useState(false);

  async function request(e) {
    e.preventDefault();
    setMsg(''); setError(''); setBusy(true);
    try {
      await customerApi.requestEmailChange({ newEmail: newEmail.trim().toLowerCase(), currentPassword });
      setMsg(`Enter the 6-digit code we sent to ${newEmail.trim().toLowerCase()}.`);
      setStep(2);
    } catch (err) {
      setError(err.message || 'Could not start email change');
    } finally {
      setBusy(false);
    }
  }

  async function verify(e) {
    e.preventDefault();
    setMsg(''); setError(''); setBusy(true);
    try {
      await customerApi.verifyEmailChange({ newEmail: newEmail.trim().toLowerCase(), code: code.trim() });
      setMsg('Email updated.');
      setStep(1);
      setCode(''); setCurrentPassword(''); setNewEmail('');
      await onSaved();
    } catch (err) {
      setError(err.message || 'Could not verify code');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h3 className="mb-1 font-semibold text-slate-900 dark:text-slate-100">Email</h3>
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
        Current: <span className="font-medium text-slate-700 dark:text-slate-300">{customer?.email}</span>
      </p>
      {step === 1 ? (
        <form onSubmit={request} className="space-y-4">
          {error && <Alert type="error">{error}</Alert>}
          {msg && <Alert type="info">{msg}</Alert>}
          <Field label="New email" htmlFor="custNewEmail">
            <Input id="custNewEmail" type="email" value={newEmail}
                   onChange={(e) => setNewEmail(e.target.value)} required autoComplete="email" />
          </Field>
          <Field label="Current password" htmlFor="custEmailPw">
            <PasswordInput id="custEmailPw" value={currentPassword}
                   onChange={(e) => setCurrentPassword(e.target.value)} required autoComplete="current-password" />
          </Field>
          <Button type="submit" loading={busy}>{busy ? 'Sending…' : 'Send verification code'}</Button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-4">
          {error && <Alert type="error">{error}</Alert>}
          {msg && <Alert type="info">{msg}</Alert>}
          <Field label="6-digit code" htmlFor="custEmailCode">
            <Input id="custEmailCode" inputMode="numeric" maxLength={6} value={code}
                   onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                   required autoComplete="one-time-code" placeholder="123456" />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" loading={busy}>{busy ? 'Verifying…' : 'Confirm new email'}</Button>
            <Button type="button" variant="ghost" onClick={() => { setStep(1); setError(''); setMsg(''); }}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

// ── Password change ──
function PasswordCard() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword]         = useState('');
  const [msg, setMsg]     = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy]   = useState(false);

  async function save(e) {
    e.preventDefault();
    setMsg(''); setError(''); setBusy(true);
    try {
      const data = await customerApi.changePassword({ currentPassword, newPassword });
      if (data?.accessToken) setTokens(data);
      setMsg('Password changed. Other sessions were signed out.');
      setCurrentPassword(''); setNewPassword('');
    } catch (err) {
      setError(err.message || 'Could not change password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h3 className="mb-3 font-semibold text-slate-900 dark:text-slate-100">Password</h3>
      <form onSubmit={save} className="space-y-4">
        {error && <Alert type="error">{error}</Alert>}
        {msg && <Alert type="info">{msg}</Alert>}
        <Field label="Current password" htmlFor="custCurPw">
          <PasswordInput id="custCurPw" value={currentPassword}
                 onChange={(e) => setCurrentPassword(e.target.value)} required autoComplete="current-password" />
        </Field>
        <Field label="New password" htmlFor="custNewPw">
          <PasswordInput id="custNewPw" value={newPassword}
                 onChange={(e) => setNewPassword(e.target.value)} required
                 autoComplete="new-password" minLength={8} placeholder="At least 8 characters" />
        </Field>
        <Button type="submit" loading={busy}>{busy ? 'Saving…' : 'Change password'}</Button>
      </form>
    </Card>
  );
}

function Centered({ children }) {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600 dark:border-brand-900 dark:border-t-brand-400" />
        <p className="text-sm text-slate-400 dark:text-slate-500">{children}</p>
      </div>
    </main>
  );
}
