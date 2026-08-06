'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import Alert from '@/components/Alert';

// Step 3+4: pull vouchers from the controller, then activate and reveal the
// Paystack webhook URL to paste into the Paystack dashboard.
export default function SyncStep({ networkProvider }) {
  const [syncResult, setSyncResult] = useState(null);
  const [activateResult, setActivate] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy]   = useState('');
  const [copied, setCopied] = useState('');

  const isOmada = networkProvider === 'omada';

  async function runSync() {
    setError(''); setBusy('sync');
    try {
      setSyncResult(await api.syncOnboard());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function goLive() {
    setError(''); setBusy('activate');
    try {
      setActivate(await api.activate());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  function copyUrl(value, key) {
    if (!value) return;
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(''), 2000);
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Sync &amp; go live</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {isOmada
            ? 'Pull your vouchers into stock, then activate your account.'
            : 'Activate your account to start taking payments.'}
        </p>
      </div>

      <Alert type="error">{error}</Alert>

      {isOmada && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-slate-800 dark:text-slate-200">1. Initial voucher sync</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">Import unused vouchers from your controller.</p>
            </div>
            <button className="btn-primary" onClick={runSync} disabled={busy === 'sync'}>
              {busy === 'sync' ? 'Syncing…' : 'Run sync'}
            </button>
          </div>
          {syncResult && (
            <Alert type="success">
              Imported {syncResult.totalInserted} new, updated {syncResult.totalUpdated} vouchers.
            </Alert>
          )}
        </div>
      )}

      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-slate-800 dark:text-slate-200">{isOmada ? '2. ' : ''}Activate account</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">Flip your storefront live.</p>
          </div>
          <button className="btn-primary" onClick={goLive} disabled={busy === 'activate' || !!activateResult}>
            {busy === 'activate' ? 'Activating…' : activateResult ? 'Activated ✓' : 'Go live'}
          </button>
        </div>

        {activateResult && (
          <div className="space-y-4">
            <Alert type="success">Your account is live.</Alert>

            {activateResult.storeUrl && (
              <div>
                <label className="label">Your store link</label>
                <p className="mb-1 text-xs text-slate-500 dark:text-slate-400">
                  Share this with your customers so they can browse plans and buy vouchers.
                </p>
                <div className="flex gap-2">
                  <input className="input font-mono text-xs" readOnly value={activateResult.storeUrl} />
                  <button className="btn-ghost" onClick={() => copyUrl(activateResult.storeUrl, 'store')}>
                    {copied === 'store' ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}

            <div>
              <label className="label">Paystack webhook URL</label>
              <p className="mb-1 text-xs text-slate-500 dark:text-slate-400">
                Paste this into Paystack → Settings → API Keys &amp; Webhooks so payments notify your account.
              </p>
              <div className="flex gap-2">
                <input className="input font-mono text-xs" readOnly value={activateResult.paystackWebhookUrl} />
                <button className="btn-ghost" onClick={() => copyUrl(activateResult.paystackWebhookUrl, 'paystack')}>
                  {copied === 'paystack' ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
