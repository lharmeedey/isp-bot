'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getAccessToken } from '@/lib/api';

// Entry point: send authenticated operators to the dashboard, others to login.
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace(getAccessToken() ? '/dashboard' : '/login');
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
        <p className="text-sm text-slate-400">Loading…</p>
      </div>
    </main>
  );
}
