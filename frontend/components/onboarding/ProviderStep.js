'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import Alert from '@/components/Alert';

// Step 1: choose provider, enter controller + Paystack config, save, test.
export default function ProviderStep({ onAdvance }) {
  const [provider, setProvider] = useState('omada');
  const [form, setForm] = useState({
    omadaControllerType: 'software',
    paystackSecret: '', paystackPublic: '',
  });
  const [error, setError]     = useState('');
  const [saved, setSaved]     = useState(false);
  const [test, setTest]       = useState(null); // { success, message }
  const [busy, setBusy]       = useState('');   // '', 'save', 'test'

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function buildPayload() {
    const p = {
      networkProvider: provider,
      paystackSecret: form.paystackSecret || undefined,
      paystackPublic: form.paystackPublic || undefined,
    };
    if (provider === 'omada') {
      Object.assign(p, {
        omadaUrl: form.omadaUrl,
        omadaControllerId: form.omadaControllerId,
        omadaSiteId: form.omadaSiteId,
        omadaControllerType: form.omadaControllerType,
        omadaClientId: form.omadaClientId,
        omadaClientSecret: form.omadaClientSecret,
        omadaAdminUsername: form.omadaAdminUsername,
        omadaAdminPassword: form.omadaAdminPassword,
      });
    } else if (provider === 'mikrotik') {
      Object.assign(p, {
        mikrotikUrl: form.mikrotikUrl,
        mikrotikUsername: form.mikrotikUsername,
        mikrotikPassword: form.mikrotikPassword,
      });
    }
    return p;
  }

  async function save() {
    setError(''); setTest(null); setBusy('save');
    try {
      await api.saveProvider(buildPayload());
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function runTest() {
    setError(''); setBusy('test');
    try {
      const res = await api.testProvider();
      setTest(res);
    } catch (err) {
      setTest({ success: false, message: err.message });
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Connect your controller</h2>
        <p className="text-sm text-slate-500">
          Enter your controller and payment details. We encrypt every secret before storing it.
        </p>
      </div>

      <Alert type="error">{error}</Alert>

      <div>
        <label className="label">Network provider</label>
        <div className="flex gap-2">
          {['omada', 'mikrotik', 'none'].map((p) => (
            <button key={p} type="button"
              onClick={() => { setProvider(p); setSaved(false); setTest(null); }}
              className={'btn ' + (provider === p ? 'btn-primary' : 'btn-ghost')}>
              {p === 'omada' ? 'TP-Link Omada' : p === 'mikrotik' ? 'MikroTik' : 'None'}
            </button>
          ))}
        </div>
      </div>

      <ProviderFields provider={provider} form={form} set={set} setForm={setForm} />

      <PaystackFields form={form} set={set} />

      {test && (
        <Alert type={test.success ? 'success' : 'error'}>
          {test.success ? '✓ ' : '✗ '}{test.message}
        </Alert>
      )}

      <div className="flex items-center gap-2">
        <button className="btn-primary" onClick={save} disabled={busy === 'save'}>
          {busy === 'save' ? 'Saving…' : saved ? 'Saved — save again' : 'Save configuration'}
        </button>
        <button className="btn-ghost" onClick={runTest} disabled={!saved || busy === 'test'}>
          {busy === 'test' ? 'Testing…' : 'Test connection'}
        </button>
        <div className="flex-1" />
        <button className="btn-primary" disabled={!saved} onClick={onAdvance}>
          Next: plans →
        </button>
      </div>
      {!saved && <p className="text-xs text-slate-400">Save before testing or moving on.</p>}
    </div>
  );
}

function Field({ label, children, hint }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function ProviderFields({ provider, form, set, setForm }) {
  if (provider === 'none') {
    return <p className="text-sm text-slate-500">No controller — you can still take payments and manage plans manually.</p>;
  }
  if (provider === 'mikrotik') {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Router URL"><input className="input" value={form.mikrotikUrl || ''} onChange={set('mikrotikUrl')} placeholder="https://1.2.3.4" /></Field>
        <div className="hidden sm:block" />
        <Field label="Username"><input className="input" value={form.mikrotikUsername || ''} onChange={set('mikrotikUsername')} /></Field>
        <Field label="Password"><input className="input" type="password" value={form.mikrotikPassword || ''} onChange={set('mikrotikPassword')} /></Field>
      </div>
    );
  }
  // omada
  return (
    <div className="space-y-4">
      <Field label="Controller type">
        <div className="flex gap-2">
          {['software', 'cloud'].map((t) => (
            <button key={t} type="button"
              onClick={() => setForm((f) => ({ ...f, omadaControllerType: t }))}
              className={'btn ' + (form.omadaControllerType === t ? 'btn-primary' : 'btn-ghost')}>
              {t === 'software' ? 'Software / OC200 / OC300' : 'Omada Cloud'}
            </button>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Controller URL" hint="e.g. https://your-controller:8043">
          <input className="input" value={form.omadaUrl || ''} onChange={set('omadaUrl')} />
        </Field>
        <Field label="Controller ID"><input className="input" value={form.omadaControllerId || ''} onChange={set('omadaControllerId')} /></Field>
        <Field label="Site ID"><input className="input" value={form.omadaSiteId || ''} onChange={set('omadaSiteId')} /></Field>
        <div className="hidden sm:block" />
        <Field label="Client ID (API)"><input className="input" value={form.omadaClientId || ''} onChange={set('omadaClientId')} /></Field>
        <Field label="Client secret (API)"><input className="input" type="password" value={form.omadaClientSecret || ''} onChange={set('omadaClientSecret')} /></Field>
        <Field label="Admin username"><input className="input" value={form.omadaAdminUsername || ''} onChange={set('omadaAdminUsername')} /></Field>
        <Field label="Admin password"><input className="input" type="password" value={form.omadaAdminPassword || ''} onChange={set('omadaAdminPassword')} /></Field>
      </div>
    </div>
  );
}

function PaystackFields({ form, set }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Paystack secret key" hint="sk_live_… — encrypted at rest">
        <input className="input" type="password" value={form.paystackSecret || ''} onChange={set('paystackSecret')} />
      </Field>
      <Field label="Paystack public key" hint="pk_live_…">
        <input className="input" value={form.paystackPublic || ''} onChange={set('paystackPublic')} />
      </Field>
    </div>
  );
}
