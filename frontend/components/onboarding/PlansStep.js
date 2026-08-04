'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import Alert from '@/components/Alert';

// Step 2: load Omada voucher groups, let the operator define plans and map each
// to a group (omadaProfileId). Non-Omada tenants just define plans.
export default function PlansStep({ networkProvider, onAdvance }) {
  const [groups, setGroups] = useState([]);
  const [rows, setRows]     = useState([blankRow()]);
  const [error, setError]   = useState('');
  const [busy, setBusy]     = useState(false);
  const [loadingGroups, setLoadingGroups] = useState(networkProvider === 'omada');

  const isOmada = networkProvider === 'omada';

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

  function blankRowInit() { return blankRow(); }
  const addRow = () => setRows((r) => [...r, blankRowInit()]);
  const removeRow = (i) => setRows((r) => r.filter((_, idx) => idx !== i));
  const setCell = (i, k) => (e) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [k]: e.target.value } : row)));

  async function save() {
    setError('');
    const plans = rows
      .filter((r) => r.label && r.price !== '' && r.gb !== '' && r.validity)
      .map((r) => ({
        label: r.label.trim(),
        price: Number(r.price),
        gb: Number(r.gb),
        validity: String(r.validity),
        omadaProfileId: r.omadaProfileId || null,
      }));

    if (!plans.length) {
      setError('Add at least one complete plan (label, price, GB, validity).');
      return;
    }
    if (isOmada && plans.some((p) => !p.omadaProfileId)) {
      setError('Map every plan to a voucher group.');
      return;
    }

    setBusy(true);
    try {
      await api.savePlans(plans);
      onAdvance();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Define your plans</h2>
        <p className="text-sm text-slate-500">
          {isOmada
            ? 'Map each plan to an Omada voucher group. Customers buy a plan; we hand out a voucher from its group.'
            : 'Create the plans customers can buy.'}
        </p>
      </div>

      <Alert type="error">{error}</Alert>

      {isOmada && loadingGroups && <p className="text-sm text-slate-500">Loading voucher groups…</p>}
      {isOmada && !loadingGroups && !groups.length && (
        <Alert type="info">No voucher groups found on the controller. Create some in Omada first, then reload.</Alert>
      )}

      <div className="space-y-3">
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-12 sm:items-end">
            <div className="sm:col-span-3">
              <label className="label">Label</label>
              <input className="input" value={row.label} onChange={setCell(i, 'label')} placeholder="5 GB" />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Price (₦)</label>
              <input className="input" type="number" min="0" value={row.price} onChange={setCell(i, 'price')} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Data (GB)</label>
              <input className="input" type="number" min="0" step="0.1" value={row.gb} onChange={setCell(i, 'gb')} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Validity (days)</label>
              <input className="input" type="number" min="1" value={row.validity} onChange={setCell(i, 'validity')} placeholder="30" />
            </div>
            <div className="sm:col-span-2">
              {isOmada ? (
                <>
                  <label className="label">Voucher group</label>
                  <select className="input" value={row.omadaProfileId} onChange={setCell(i, 'omadaProfileId')}>
                    <option value="">Select…</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.unusedCount} unused)
                      </option>
                    ))}
                  </select>
                </>
              ) : <div />}
            </div>
            <div className="sm:col-span-1">
              <button type="button" className="btn-ghost w-full" onClick={() => removeRow(i)} disabled={rows.length === 1}>✕</button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button type="button" className="btn-ghost" onClick={addRow}>+ Add plan</button>
        <div className="flex-1" />
        <button className="btn-primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save plans → sync'}
        </button>
      </div>
    </div>
  );
}

function blankRow() {
  return { label: '', price: '', gb: '', validity: '30', omadaProfileId: '' };
}
