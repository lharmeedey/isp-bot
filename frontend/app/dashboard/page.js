'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useAuth } from '@/lib/useAuth';
import { api } from '@/lib/api';
import Alert from '@/components/Alert';
import PlanManager from '@/components/dashboard/PlanManager';
import { Button, Card, Stat, Badge, Skeleton, staggerContainer, staggerItem } from '@/components/ui';

const naira = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');

export default function DashboardPage() {
  const router = useRouter();
  const { loading, me, logout } = useAuth();

  const [data, setData]   = useState({});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [syncMsg, setSyncMsg] = useState('');
  const [syncing, setSyncing] = useState(false);

  const provider = me?.tenant?.networkProvider || 'none';

  const loadAll = useCallback(async () => {
    setError('');
    try {
      const [sales, revenue, users, stock, online] = await Promise.all([
        api.sales(), api.revenue(), api.users(), api.stock(),
        provider !== 'none' ? api.online() : Promise.resolve(null),
      ]);
      setData({ sales, revenue, users, stock, online });
    } catch (err) {
      setError(err.message);
    } finally {
      setReady(true);
    }
  }, [provider]);

  useEffect(() => { if (me) loadAll(); }, [me, loadAll]);

  async function runSync() {
    setSyncMsg(''); setSyncing(true);
    try {
      const r = await api.syncNow();
      setSyncMsg(`Imported ${r.totalInserted} new, updated ${r.totalUpdated}.`);
      await loadAll();
    } catch (err) {
      setSyncMsg(`Sync failed: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  }

  if (loading) return <Centered>Loading…</Centered>;

  const notLive = me?.tenant && !me.tenant.active;

  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3.5">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-glow">◍</span>
            <div>
              <h1 className="text-base font-bold leading-tight text-slate-900">{me?.tenant?.name || 'Dashboard'}</h1>
              <p className="text-xs text-slate-500">{me?.operator?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={loadAll}>Refresh</Button>
            <Button variant="ghost" onClick={logout}>Sign out</Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        {notLive && (
          <Alert type="info">
            Your account isn&apos;t live yet.{' '}
            <button className="font-semibold underline" onClick={() => router.replace('/onboarding')}>
              Finish onboarding
            </button>.
          </Alert>
        )}
        <Alert type="error">{error}</Alert>

        {/* Stat cards */}
        {!ready ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0,1,2,3].map((i) => <div key={i} className="card"><Skeleton className="h-4 w-20" /><Skeleton className="mt-3 h-8 w-24" /></div>)}
          </div>
        ) : (
          <motion.div variants={staggerContainer} initial="hidden" animate="show"
                      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat variants={staggerItem} label="Today's sales" value={data.sales ? data.sales.transactions : '—'}
                  sub={data.sales ? naira(data.sales.revenue) : ''} />
            <Stat variants={staggerItem} label="Total revenue" value={data.revenue ? naira(data.revenue.revenue) : '—'}
                  sub={data.revenue ? `${data.revenue.purchases} purchases` : ''} />
            <Stat variants={staggerItem} label="Active users" value={data.users ? data.users.active : '—'}
                  sub={data.users ? `${data.users.total} total` : ''} />
            <Stat variants={staggerItem} label="Online now"
                  value={data.online ? sumOnline(data.online) : (provider === 'none' ? 'n/a' : '—')}
                  sub={provider === 'none' ? 'no controller' : 'live from controller'} />
          </motion.div>
        )}

        {/* Voucher stock */}
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Voucher stock</h2>
            {provider === 'omada' && (
              <Button onClick={runSync} loading={syncing}>
                {syncing ? 'Syncing…' : 'Sync now'}
              </Button>
            )}
          </div>
          {syncMsg && <div className="mb-3"><Alert type="info">{syncMsg}</Alert></div>}
          {data.stock?.plans?.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400">
                  <th className="py-2 font-medium">Plan</th><th className="font-medium">Unused</th>
                  <th className="font-medium">Used</th><th className="font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.stock.plans.map((p) => (
                  <tr key={p.plan} className="border-t border-slate-100">
                    <td className="py-2 font-medium text-slate-800">{p.plan}</td>
                    <td><Badge tone="success">{p.unused}</Badge></td>
                    <td className="text-slate-500">{p.used}</td>
                    <td className="font-medium">{p.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm text-slate-500">No vouchers in stock yet.</p>}
        </Card>

        {/* Online groups (Omada/MikroTik) */}
        {data.online?.groups?.length > 0 && (
          <Card>
            <h2 className="mb-3 font-semibold text-slate-900">Live network status</h2>
            <ul className="space-y-1 text-sm">
              {data.online.groups.map((g) => (
                <li key={g.name} className="flex justify-between border-t border-slate-100 py-1.5">
                  <span className="text-slate-700">{g.name}</span>
                  <span className="text-slate-500">{g.online} used · {g.unused} unused</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* Plan management */}
        <PlanManager provider={provider} />

        {/* Users */}
        <Card>
          <h2 className="mb-3 font-semibold text-slate-900">Users</h2>
          {data.users?.users?.length ? (
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-slate-400">
                    <th className="py-2 font-medium">Name</th><th className="font-medium">Email</th>
                    <th className="font-medium">Plan</th><th className="font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.users.map((u) => (
                    <tr key={u.telegramId} className="border-t border-slate-100">
                      <td className="py-2 text-slate-800">{u.name || '—'}</td>
                      <td className="text-slate-500">{u.email || '—'}</td>
                      <td>{u.plan || '—'}</td>
                      <td>
                        {u.status === 'active'
                          ? <Badge tone="success">active</Badge>
                          : <Badge tone="muted">{u.status}</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-sm text-slate-500">No users yet.</p>}
        </Card>
      </div>
    </main>
  );
}

function sumOnline(online) {
  if (!online?.groups?.length) return 0;
  return online.groups.reduce((acc, g) => acc + (Number(g.online) || 0), 0);
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
