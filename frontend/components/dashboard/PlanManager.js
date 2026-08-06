'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import Alert from '@/components/Alert';

// Lists tenant plans and supports create + soft-delete (active=false).
// For Omada tenants it also loads the controller's voucher groups so a plan can
// be mapped to a group via a dropdown (instead of pasting a raw profile ID) —
// both when creating a plan and when fixing the mapping on an existing one.
export default function PlanManager({ provider = 'none' }) {
  const isOmada = provider === 'omada';

  const [plans, setPlans]   = useState([]);
  const [groups, setGroups] = useState([]);
  const [error, setError]   = useState('');
  const [busy, setBusy]     = useState(false);
  const [loadingGroups, setLoadingGroups] = useState(isOmada);
  const [savingId, setSavingId] = useState(null);
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

  // Load Omada voucher groups once (used by both the create form and the
  // per-row group selector on existing plans).
  useEffect(() => {
    if (!isOmada) return;
    (async () => {
      try {
        const res = await api.voucherGroups();
        setGroups(res.groups || []);
      } catch (err) {
        setError(`Couldn't load voucher groups: ${err.message}`);
      } finally {
        setLoadingGroups(false);
      }
    })();
  }, [isOmada]);

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  // Human label for a group id, for showing an existing plan's current mapping.
  const groupName = (id) => {
    if (!id) return null;
    const g = groups.find((x) => x.id === id);
    return g ? g.name : id; // fall back to the raw id if not in the loaded list
  };

  async function create() {
    setError('');
    if (!draft.label || draft.price === '' || draft.gb === '' || !draft.validity) {
      setError('Fill label, price, GB and validity.');
      return;
    }
    if (isOmada && !draft.omadaProfileId) {
      setError('Map the plan to a voucher group.');
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

  async function remap(planId, omadaProfileId) {
    setError('');
    setSavingId(planId);
    try {
      await api.updatePlan(planId, { omadaProfileId: omadaProfileId || null });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingId(null);
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
      <h2 className="mb-3 font-semibold text-slate-900 dark:text-slate-100">Plans</h2>
      <Alert type="error">{error}</Alert>

      {isOmada && loadingGroups && (
        <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">Loading voucher groups…</p>
      )}
      {isOmada && !loadingGroups && !groups.length && (
        <div className="mb-3">
          <Alert type="info">
            No voucher groups found on the controller. Create one in Omada first, then Refresh.
          </Alert>
        </div>
      )}

      {plans.length ? (
        <table className="mb-4 w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 dark:text-slate-400">
              <th className="py-2">Label</th><th>Price</th><th>GB</th><th>Validity</th>
              {isOmada && <th>Voucher group</th>}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.planId} className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-2 font-medium text-slate-800 dark:text-slate-200">{p.label}</td>
                <td>₦{Number(p.price).toLocaleString('en-NG')}</td>
                <td>{p.gb}</td>
                <td>{p.validity}d</td>
                {isOmada && (
                  <td>
                    <select
                      className="input py-1 text-xs"
                      value={p.omadaProfileId || ''}
                      disabled={savingId === p.planId || loadingGroups}
                      onChange={(e) => remap(p.planId, e.target.value)}
                    >
                      <option value="">
                        {p.omadaProfileId ? `⚠ unknown (${p.omadaProfileId})` : '⚠ Not mapped'}
                      </option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name} ({g.unusedCount} unused)
                        </option>
                      ))}
                    </select>
                  </td>
                )}
                <td className="text-right">
                  <button className="text-sm text-red-500 hover:underline" onClick={() => remove(p.planId)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">No plans yet.</p>}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-12 sm:items-end">
        <div className="sm:col-span-3">
          <label className="label">Label</label>
          <input className="input" value={draft.label} onChange={set('label')} placeholder="5 GB" />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Price (₦)</label>
          <input className="input" type="number" min="0" value={draft.price} onChange={set('price')} />
        </div>
        <div className="sm:col-span-1">
          <label className="label">GB</label>
          <input className="input" type="number" min="0" step="0.1" value={draft.gb} onChange={set('gb')} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Validity (d)</label>
          <input className="input" type="number" min="1" value={draft.validity} onChange={set('validity')} />
        </div>
        <div className="sm:col-span-3">
          <label className="label">Voucher group</label>
          {isOmada ? (
            <select className="input" value={draft.omadaProfileId} onChange={set('omadaProfileId')} disabled={loadingGroups}>
              <option value="">Select…</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.unusedCount} unused)
                </option>
              ))}
            </select>
          ) : (
            <input className="input" value={draft.omadaProfileId} onChange={set('omadaProfileId')} placeholder="n/a" disabled />
          )}
        </div>
        <div className="sm:col-span-1">
          <button className="btn-primary w-full" onClick={create} disabled={busy}>
            {busy ? '…' : 'Add'}
          </button>
        </div>
      </div>
      {isOmada && (
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
          Each plan hands out vouchers from its mapped Omada group. Change a group above to remap instantly.
        </p>
      )}
    </section>
  );
}
