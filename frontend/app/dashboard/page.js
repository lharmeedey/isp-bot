'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useAuth } from '@/lib/useAuth';
import { api } from '@/lib/api';
import Alert from '@/components/Alert';
import PlanManager from '@/components/dashboard/PlanManager';
import RevenueChart from '@/components/dashboard/RevenueChart';
import { Button, Card, Stat, Badge, Skeleton, Toast, ThemeToggle, Logo, staggerContainer, staggerItem } from '@/components/ui';

const naira = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');
const LOW_STOCK = 5; // toast when a plan drops below this many unused vouchers

export default function DashboardPage() {
  const router = useRouter();
  const { loading, me, logout } = useAuth();

  const [data, setData]   = useState({});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [syncMsg, setSyncMsg] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState(null); // { message, tone }
  const toastKey = useRef('');              // dedupe: only re-toast when the condition changes

  const provider = me?.tenant?.networkProvider || 'none';

  const loadAll = useCallback(async () => {
    setError('');
    try {
      const [sales, revenue, users, stock, online, analytics] = await Promise.all([
        api.sales(), api.revenue(), api.users(), api.stock(),
        provider !== 'none' ? api.online() : Promise.resolve(null),
        api.analytics().catch(() => null),
      ]);
      setData({ sales, revenue, users, stock, online, analytics });
    } catch (err) {
      setError(err.message);
    } finally {
      setReady(true);
    }
  }, [provider]);

  useEffect(() => { if (me) loadAll(); }, [me, loadAll]);

  // Background notifications: poll stock + sync-status every 60s (skipping when
  // the tab is hidden). Surface the single highest-priority condition as a toast,
  // deduped so it fires once and re-arms only when the condition changes.
  useEffect(() => {
    if (!me) return;

    async function check() {
      if (document.hidden) return;
      const [stockRes, syncRes] = await Promise.allSettled([api.stock(), api.syncStatus()]);

      let next = null; // { key, message, tone }

      if (syncRes.status === 'fulfilled' && syncRes.value?.ok === false) {
        const err = syncRes.value.error ? `: ${syncRes.value.error}` : '';
        next = { key: `sync:${syncRes.value.lastSyncAt || ''}`, tone: 'error',
                 message: `Last controller sync failed${err}` };
      } else if (stockRes.status === 'fulfilled') {
        const low = (stockRes.value?.plans || []).filter((p) => Number(p.unused) < LOW_STOCK);
        if (low.length) {
          const names = low.map((p) => `${p.plan} (${p.unused})`).join(', ');
          next = { key: `low:${low.map((p) => `${p.plan}=${p.unused}`).join(',')}`, tone: 'error',
                   message: `Low voucher stock: ${names}` };
        }
      }

      if (next) {
        if (next.key !== toastKey.current) {
          toastKey.current = next.key;
          setToast({ message: next.message, tone: next.tone });
        }
      } else {
        toastKey.current = ''; // recovered — silently re-arm
      }
    }

    check();
    const id = setInterval(check, 60000);
    return () => clearInterval(id);
  }, [me]);

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
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/80 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3.5">
          <div className="flex items-center gap-3">
            <Logo />
            <div>
              <h1 className="text-base font-bold leading-tight text-slate-900 dark:text-slate-100">{me?.tenant?.name || 'Dashboard'}</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">{me?.operator?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="ghost" onClick={loadAll}>Refresh</Button>
            <Button variant="ghost" onClick={() => router.push('/settings')}>Settings</Button>
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

        {/* Your store link */}
        {me?.tenant?.tenantId && (
          <Card>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h2 className="mb-1 font-semibold text-slate-900 dark:text-slate-100">Your store</h2>
                <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
                  Share this link with your customers to let them browse plans and buy vouchers.
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {typeof window !== 'undefined' ? `${window.location.origin}/store/${me.tenant.slug || me.tenant.tenantId}` : ''}
                  </code>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      const url = `${window.location.origin}/store/${me.tenant.slug || me.tenant.tenantId}`;
                      navigator.clipboard?.writeText(url).then(() => {
                        setToast({ message: 'Store URL copied to clipboard', tone: 'success' });
                      });
                    }}
                  >
                    Copy
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Revenue analytics */}
        {ready && data.analytics && (
          <Card>
            <RevenueChart data={data.analytics} />
          </Card>
        )}

        {/* Voucher stock */}
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900 dark:text-slate-100">Voucher stock</h2>
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
                <tr className="text-left text-slate-400 dark:text-slate-500">
                  <th className="py-2 font-medium">Plan</th><th className="font-medium">Unused</th>
                  <th className="font-medium">Used</th><th className="font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.stock.plans.map((p) => (
                  <tr key={p.plan} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-2 font-medium text-slate-800 dark:text-slate-200">{p.plan}</td>
                    <td><Badge tone="success">{p.unused}</Badge></td>
                    <td className="text-slate-500 dark:text-slate-400">{p.used}</td>
                    <td className="font-medium">{p.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm text-slate-500 dark:text-slate-400">No vouchers in stock yet.</p>}
        </Card>

        {/* Online groups (Omada/MikroTik) */}
        {data.online?.groups?.length > 0 && (
          <Card>
            <h2 className="mb-3 font-semibold text-slate-900 dark:text-slate-100">Live network status</h2>
            <ul className="space-y-1 text-sm">
              {data.online.groups.map((g) => (
                <li key={g.name} className="flex justify-between border-t border-slate-100 py-1.5 dark:border-slate-800">
                  <span className="text-slate-700 dark:text-slate-300">{g.name}</span>
                  <span className="text-slate-500 dark:text-slate-400">{g.online} used · {g.unused} unused</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* Plan management */}
        <PlanManager provider={provider} />

        {/* Users */}
        <Card>
          <h2 className="mb-3 font-semibold text-slate-900 dark:text-slate-100">Users</h2>
          {data.users?.users?.length ? (
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white dark:bg-slate-900">
                  <tr className="text-left text-slate-400 dark:text-slate-500">
                    <th className="py-2 font-medium">Name</th><th className="font-medium">Email</th>
                    <th className="font-medium">Plan</th><th className="font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.users.map((u) => (
                    <tr key={u.telegramId} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="py-2 text-slate-800 dark:text-slate-200">{u.name || '—'}</td>
                      <td className="text-slate-500 dark:text-slate-400">{u.email || '—'}</td>
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
          ) : <p className="text-sm text-slate-500 dark:text-slate-400">No users yet.</p>}
        </Card>
      </div>

      <Toast message={toast?.message} tone={toast?.tone || 'info'} onClose={() => setToast(null)} />
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
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600 dark:border-brand-900 dark:border-t-brand-400" />
        <p className="text-sm text-slate-400 dark:text-slate-500">{children}</p>
      </div>
    </main>
  );
}
