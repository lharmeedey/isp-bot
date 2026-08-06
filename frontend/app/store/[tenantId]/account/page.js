'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { useCustomer } from '@/lib/useCustomer';
import StoreShell from '@/components/store/StoreShell';
import { Button, Card, Badge, staggerContainer, staggerItem } from '@/components/ui';

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
    <StoreShell
      tenantId={tenantId}
      signedIn
      customer={customer}
      onSignOut={logout}
      contentClassName="mx-auto max-w-3xl space-y-8 px-4 py-8"
    >
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          Hi{customer?.name ? `, ${customer.name}` : ''} 👋
        </h1>
        {customer?.email && (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{customer.email}</p>
        )}
      </div>

      {/* Vouchers */}
      <section>
        <h2 className="mb-3 text-lg font-bold text-slate-900 dark:text-slate-100">Your vouchers</h2>
        {vouchers.length ? (
          <motion.div variants={staggerContainer} initial="hidden" animate="show"
                      className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {vouchers.map((v) => (
              <Card key={v.code} variants={staggerItem} className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{v.plan}</span>
                  {v.status === 'used'
                    ? <Badge tone="muted">used</Badge>
                    : <Badge tone="success">active</Badge>}
                </div>
                <button onClick={() => copy(v.code)}
                        className="w-full rounded-lg border border-dashed border-brand-300 bg-brand-50 px-3 py-2 text-left font-mono text-lg font-bold tracking-wide text-brand-800 transition hover:bg-brand-100 dark:border-brand-700 dark:bg-brand-950/50 dark:text-brand-200 dark:hover:bg-brand-900/50">
                  {v.code}
                  <span className="ml-2 font-sans text-xs font-normal text-brand-500 dark:text-brand-400">
                    {copied === v.code ? 'copied!' : 'copy'}
                  </span>
                </button>
                <p className="text-xs text-slate-400 dark:text-slate-500">Issued {fmtDate(v.createdAt)}</p>
              </Card>
            ))}
          </motion.div>
        ) : (
          <Card className="text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">No vouchers yet.</p>
            <Link href={`/store/${tenantId}`}><Button className="mt-3">Browse plans</Button></Link>
          </Card>
        )}
      </section>

      {/* Purchase history — collapsed + muted, secondary to vouchers */}
      <details className="group rounded-2xl border border-slate-200/60 bg-white/50 px-5 py-3 dark:border-slate-800 dark:bg-slate-900/40">
        <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-slate-500 dark:text-slate-400">
          <span>Purchase history{purchases.length ? ` (${purchases.length})` : ''}</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round" className="transition group-open:rotate-180">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </summary>
        <div className="mt-3">
          {purchases.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 dark:text-slate-500">
                  <th className="py-2 font-medium">Date</th><th className="font-medium">Plan</th>
                  <th className="font-medium">Amount</th><th className="font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((p) => (
                  <tr key={p.reference} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-2 text-slate-600 dark:text-slate-300">{fmtDate(p.date)}</td>
                    <td className="font-medium text-slate-800 dark:text-slate-200">{p.plan}</td>
                    <td>{naira(p.amount)}</td>
                    <td><Badge tone={p.status === 'success' ? 'success' : 'muted'}>{p.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm text-slate-500 dark:text-slate-400">No purchases yet.</p>}
        </div>
      </details>
    </StoreShell>
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
