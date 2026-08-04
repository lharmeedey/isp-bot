'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api, getAccessToken, clearTokens } from './api';

/**
 * useAuth — loads the current operator/tenant via /me. If not authenticated,
 * redirects to /login. Returns { loading, me, refresh, logout }.
 */
export function useAuth({ redirect = true } = {}) {
  const router = useRouter();
  const [me, setMe]           = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!getAccessToken()) {
      setLoading(false);
      if (redirect) router.replace('/login');
      return;
    }
    try {
      const data = await api.me();
      setMe(data);
    } catch (err) {
      clearTokens();
      if (redirect) router.replace('/login');
    } finally {
      setLoading(false);
    }
  }, [router, redirect]);

  useEffect(() => { load(); }, [load]);

  const logout = useCallback(async () => {
    try { await api.logout(); } catch { /* ignore */ }
    clearTokens();
    router.replace('/login');
  }, [router]);

  return { loading, me, refresh: load, logout };
}
