'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import Alert from '@/components/Alert';

// Lists tenant plans and supports create + soft-delete (active=false).
export default function PlanManager() {
  const [plans, setPlans] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy]   = useState(false);
  const [draft, setDraft] = useState({ label: '', price: '', gb: '', validity: '30', omadaProfileId: '' });

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await api.listPlans();
      setPlans(res.plans || []);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  async function create() {
    setError('');
    if (!draft.label || draft.price === '' || draft.gb === '' || !draft.validity) {
      setError('Fill label, price, GB and validity.');
      return;
    }
    setBusy(true);
    try {
      await api.createPlan({
        label: draft.label.trim(),
        price: Number(draft.price),
        gb: Number(draft.gb),
        validity: String(draft.validity),
        omadaProfileId: draft.omadaProfileId || null,
      });
      setDraft({ label: '', price: '', gb: '', validity: '30', omadaProfileId: '' });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(planId) {
    setError('');
    try {
      await api.deletePlan(planId);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="card">
      <h2 className="mb-3 font-semibold text-slate-900">Plans</h2>
      <Alert type="error">{error}</Alert>

      {plans.length ? (
        <table className="mb-4 w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-2">Label</th><th>Price</th><th>GB</th><th>Validity</th><th></th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.planId} className="border-t border-slate-100">
                <td className="py-2 font-medium text-slate-800">{p.label}</td>
                <td>₦{Number(p.price).toLocaleString('en-NG')}</td>
                <td>{p.gb}</td>
                <td>{p.validity}d</td>
                <td className="text-right">
                  <button className="text-sm text-red-500 hover:underline" onClick={() => remove(p.planId)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="mb-4 text-sm text-slate-500">No plans yet.</p>}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-12 sm:items-end">
        <div className="sm:col-span-3">
          <label className="label">Label</label>
          <input className="input" value={draft.label} onChange={set('label')} placeholder="5 GB" />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Price (₦)</label>
          <input className="input" type="number" min="0" value={draft.price} onChange={set('price')} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">GB</label>
          <input className="input" type="number" min="0" step="0.1" value={draft.gb} onChange={set('gb')} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Validity (d)</label>
          <input className="input" type="number" min="1" value={draft.validity} onChange={set('validity')} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Group ID</label>
          <input className="input" value={draft.omadaProfileId} onChange={set('omadaProfileId')} placeholder="optional" />
        </div>
        <div className="sm:col-span-1">
          <button className="btn-primary w-full" onClick={create} disabled={busy}>
            {busy ? '…' : 'Add'}
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Group ID maps the plan to an Omada voucher group. Leave blank for non-Omada plans.
      </p>
    </section>
  );
}
