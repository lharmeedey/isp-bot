'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { useCustomer } from '@/lib/useCustomer';
import { customerApi } from '@/lib/customerApi';
import Alert from '@/components/Alert';
import { Button, Card, Badge, GradientHeader, staggerContainer, staggerItem } from '@/components/ui';

const naira = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');
const fmtDate = (d) => {
  try { return new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return '—'; }
};

export default function StoreAccount() {
  const { tenantId } = useParams();
  const { loading, me, logout } = useCustomer(tenantId);
  const [copied, setCopied] = useState('');

  function copy(code) {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(code);
      setTimeout(() => setCopied(''), 1500);
    });
  }

  if (loading) return <Centered>Loading your account…</Centered>;
  if (!me) return null; // useCustomer redirected

  const { customer, purchases = [], vouchers = [] } = me;

  return (
    <main className="min-h-screen">
      <GradientHeader compact
        title={`Hi${customer?.name ? `, ${customer.name}` : ''} 👋`}
        subtitle={customer?.email}
      >
        <div className="flex flex-wrap gap-2">
          <Link href={`/store/${tenantId}`}
                className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-brand-700 shadow-sm transition hover:-translate-y-0.5">
            Buy a plan
          </Link>
          <button onClick={logout}
                  className="rounded-xl bg-white/15 px-4 py-2 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/25">
            Sign out
          </button>
        </div>
      </GradientHeader>

      <div className="mx-auto max-w-3xl space-y-8 px-4 py-10">
        {/* Vouchers */}
        <section>
          <h2 className="mb-3 text-lg font-bold text-slate-900">Your vouchers</h2>
          {vouchers.length ? (
            <motion.div variants={staggerContainer} initial="hidden" animate="show"
                        className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {vouchers.map((v) => (
                <Card key={v.code} variants={staggerItem} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-900">{v.plan}</span>
                    {v.status === 'used'
                      ? <Badge tone="muted">used</Badge>
                      : <Badge tone="success">active</Badge>}
                  </div>
                  <button onClick={() => copy(v.code)}
                          className="w-full rounded-lg border border-dashed border-brand-300 bg-brand-50 px-3 py-2 text-left font-mono text-lg font-bold tracking-wide text-brand-800 transition hover:bg-brand-100">
                    {v.code}
                    <span className="ml-2 font-sans text-xs font-normal text-brand-500">
                      {copied === v.code ? 'copied!' : 'copy'}
                    </span>
                  </button>
                  <p className="text-xs text-slate-400">Issued {fmtDate(v.createdAt)}</p>
                </Card>
              ))}
            </motion.div>
          ) : (
            <Card className="text-center">
              <p className="text-sm text-slate-500">No vouchers yet.</p>
              <Link href={`/store/${tenantId}`}><Button className="mt-3">Browse plans</Button></Link>
            </Card>
          )}
        </section>

        {/* Purchase history */}
        <section>
          <h2 className="mb-3 text-lg font-bold text-slate-900">Purchase history</h2>
          <Card>
            {purchases.length ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-400">
                    <th className="py-2 font-medium">Date</th><th className="font-medium">Plan</th>
                    <th className="font-medium">Amount</th><th className="font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {purchases.map((p) => (
                    <tr key={p.reference} className="border-t border-slate-100">
                      <td className="py-2 text-slate-600">{fmtDate(p.date)}</td>
                      <td className="font-medium text-slate-800">{p.plan}</td>
                      <td>{naira(p.amount)}</td>
                      <td><Badge tone={p.status === 'success' ? 'success' : 'muted'}>{p.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="text-sm text-slate-500">No purchases yet.</p>}
          </Card>
        </section>
      </div>
    </main>
  );
}

function Centered({ children }) {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
        <p className="text-sm text-slate-400">{children}</p>
      </div>
    </main>
  );
}
