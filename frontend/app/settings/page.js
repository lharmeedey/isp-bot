'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/useAuth';
import { api, setTokens } from '@/lib/api';
import Alert from '@/components/Alert';
import { Button, Card, Field, Input, PasswordInput, ThemeToggle } from '@/components/ui';

// Operator self-service settings: business profile (name + contact email),
// login-email change (OTP-verified), and password change. Guarded by useAuth.
export default function SettingsPage() {
  const router = useRouter();
  const { loading, me, refresh } = useAuth();

  if (loading) return <Centered>Loading…</Centered>;

  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/80 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3.5">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-glow">◍</span>
            <div>
              <h1 className="text-base font-bold leading-tight text-slate-900 dark:text-slate-100">Settings</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">{me?.operator?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="ghost" onClick={() => router.push('/dashboard')}>Back to dashboard</Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        <BusinessCard me={me} onSaved={refresh} />
        <EmailCard me={me} onSaved={refresh} />
        <PasswordCard />
      </div>
    </main>
  );
}

// ── Business profile: display name + contact email (tenants table) ──
function BusinessCard({ me, onSaved }) {
  const [name, setName]                 = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [msg, setMsg]     = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy]   = useState(false);

  useEffect(() => {
    if (me?.tenant) {
      setName(me.tenant.name || '');
      setContactEmail(me.tenant.email || '');
    }
  }, [me]);

  async function save(e) {
    e.preventDefault();
    setMsg(''); setError(''); setBusy(true);
    try {
      await api.updateProfile({ name, contactEmail });
      setMsg('Business details saved.');
      await onSaved();
    } catch (err) {
      setError(err.message || 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-1 font-semibold text-slate-900 dark:text-slate-100">Business</h2>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">Your storefront display name and contact email.</p>
      <form onSubmit={save} className="space-y-4">
        {error && <Alert type="error">{error}</Alert>}
        {msg && <Alert type="info">{msg}</Alert>}
        <Field label="Business / display name" htmlFor="bizName">
          <Input id="bizName" value={name} onChange={(e) => setName(e.target.value)} placeholder="My Wi-Fi Store" />
        </Field>
        <Field label="Contact email" htmlFor="contactEmail">
          <Input id="contactEmail" type="email" value={contactEmail}
                 onChange={(e) => setContactEmail(e.target.value)} placeholder="hello@business.com" />
        </Field>
        <Button type="submit" loading={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>
      </form>
    </Card>
  );
}

// ── Login email: change requires current password → OTP to new address ──
function EmailCard({ me, onSaved }) {
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
      await api.requestEmailChange({ newEmail: newEmail.trim().toLowerCase(), currentPassword });
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
      await api.verifyEmailChange({ newEmail: newEmail.trim().toLowerCase(), code: code.trim() });
      setMsg('Login email updated.');
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
      <h2 className="mb-1 font-semibold text-slate-900 dark:text-slate-100">Login email</h2>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Current: <span className="font-medium text-slate-700 dark:text-slate-300">{me?.operator?.email}</span>
      </p>
      {step === 1 ? (
        <form onSubmit={request} className="space-y-4">
          {error && <Alert type="error">{error}</Alert>}
          {msg && <Alert type="info">{msg}</Alert>}
          <Field label="New email" htmlFor="newEmail">
            <Input id="newEmail" type="email" value={newEmail}
                   onChange={(e) => setNewEmail(e.target.value)} required autoComplete="email" />
          </Field>
          <Field label="Current password" htmlFor="emailPw">
            <PasswordInput id="emailPw" value={currentPassword}
                   onChange={(e) => setCurrentPassword(e.target.value)} required autoComplete="current-password" />
          </Field>
          <Button type="submit" loading={busy}>{busy ? 'Sending…' : 'Send verification code'}</Button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-4">
          {error && <Alert type="error">{error}</Alert>}
          {msg && <Alert type="info">{msg}</Alert>}
          <Field label="6-digit code" htmlFor="emailCode">
            <Input id="emailCode" inputMode="numeric" maxLength={6} value={code}
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

// ── Password: current + new ──
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
      const data = await api.changePassword({ currentPassword, newPassword });
      // The backend revokes other sessions and re-issues this one — persist it.
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
      <h2 className="mb-1 font-semibold text-slate-900 dark:text-slate-100">Password</h2>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">Changing your password signs out all other devices.</p>
      <form onSubmit={save} className="space-y-4">
        {error && <Alert type="error">{error}</Alert>}
        {msg && <Alert type="info">{msg}</Alert>}
        <Field label="Current password" htmlFor="curPw">
          <PasswordInput id="curPw" value={currentPassword}
                 onChange={(e) => setCurrentPassword(e.target.value)} required autoComplete="current-password" />
        </Field>
        <Field label="New password" htmlFor="newPw">
          <PasswordInput id="newPw" value={newPassword}
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
