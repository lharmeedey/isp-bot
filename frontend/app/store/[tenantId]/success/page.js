'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { customerApi } from '@/lib/customerApi';
import Alert from '@/components/Alert';
import { Button, Card, GradientHeader } from '@/components/ui';

// Paystack callback lands here (?reference=…). We verify server-side, which
// provisions the voucher idempotently, then reveal the code.
export default function StoreSuccess() {
  return (
    <Suspense fallback={<main className="min-h-screen" />}>
      <StoreSuccessInner />
    </Suspense>
  );
}

function StoreSuccessInner() {
  const { tenantId } = useParams();
  const params = useSearchParams();
  const reference = params.get('reference');

  const [state, setState] = useState('verifying'); // verifying | done | error
  const [result, setResult] = useState(null);
  const [error, setError]   = useState('');
  const [copied, setCopied] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;      // guard React 18 strict double-invoke
    ran.current = true;
    if (!reference) {
      setState('error');
      setError('Missing payment reference.');
      return;
    }
    (async () => {
      try {
        const res = await customerApi.verify(reference);
        setResult(res);
        setState('done');
      } catch (err) {
        setError(err.message || 'We could not confirm your payment.');
        setState('error');
      }
    })();
  }, [reference]);

  function copyCode() {
    if (!result?.code) return;
    navigator.clipboard?.writeText(result.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <main className="min-h-screen">
      <GradientHeader compact
        title={state === 'done' ? 'Payment confirmed 🎉' : state === 'error' ? 'Payment issue' : 'Confirming payment…'}
        subtitle={state === 'done' ? 'Your voucher is ready to use.' : ''}
      />
      <div className="mx-auto max-w-md px-4 py-10">
        {state === 'verifying' && (
          <Card className="flex flex-col items-center gap-4 py-10">
            <span className="h-10 w-10 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
            <p className="text-sm text-slate-500">Verifying your payment with Paystack…</p>
          </Card>
        )}

        {state === 'error' && (
          <Card className="space-y-4">
            <Alert type="error">{error}</Alert>
            <p className="text-sm text-slate-500">
              If you were charged, your voucher is safe — reopen this page or check your account. Payments are
              only ever provisioned once.
            </p>
            <div className="flex gap-2">
              <Link href={`/store/${tenantId}/account`} className="flex-1"><Button variant="ghost" className="w-full">My account</Button></Link>
              <Link href={`/store/${tenantId}`} className="flex-1"><Button className="w-full">Back to store</Button></Link>
            </div>
          </Card>
        )}

        {state === 'done' && result && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 220, damping: 20 }}
          >
            <Card className="space-y-5 text-center">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 260, damping: 14, delay: 0.1 }}
                className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-gradient text-3xl text-white shadow-glow"
              >
                ✓
              </motion.div>

              <div>
                <p className="text-sm text-slate-500">Your voucher code</p>
                <button onClick={copyCode}
                        className="group mt-1 inline-flex items-center gap-2 rounded-xl border border-dashed border-brand-300 bg-brand-50 px-5 py-3 font-mono text-2xl font-bold tracking-wider text-brand-800 transition hover:bg-brand-100">
                  {result.code}
                  <span className="text-xs font-sans font-normal text-brand-500 group-hover:text-brand-700">
                    {copied ? 'copied!' : 'tap to copy'}
                  </span>
                </button>
              </div>

              <div className="space-y-1 text-sm text-slate-600">
                <p><span className="text-slate-400">Plan:</span> <strong className="text-slate-900">{result.plan}</strong></p>
                {result.expiry && <p><span className="text-slate-400">Valid until:</span> {result.expiry}</p>}
              </div>

              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                Connect to the Wi-Fi network and enter this code on the login page. Keep it safe.
              </p>

              <div className="flex gap-2">
                <Link href={`/store/${tenantId}/account`} className="flex-1"><Button variant="ghost" className="w-full">My vouchers</Button></Link>
                <Link href={`/store/${tenantId}`} className="flex-1"><Button className="w-full">Buy again</Button></Link>
              </div>
            </Card>
          </motion.div>
        )}
      </div>
    </main>
  );
}
