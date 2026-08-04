'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { customerApi, getAccessToken, clearTokens } from './customerApi';

/**
 * useCustomer — loads the signed-in customer via /api/store/me. Scoped to a
 * tenant's storefront: on logout / auth failure it redirects to that store's
 * login page (not the operator login).
 *
 * When `redirect` is false, it simply reports auth state without navigating
 * (used by the public landing page to show a "My account" link when signed in).
 */
export function useCustomer(tenantId, { redirect = true } = {}) {
  const router = useRouter();
  const [me, setMe]           = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!getAccessToken()) {
      setLoading(false);
      if (redirect) router.replace(`/store/${tenantId}/login`);
      return;
    }
    try {
      const data = await customerApi.me();
      setMe(data);
    } catch (err) {
      clearTokens();
      if (redirect) router.replace(`/store/${tenantId}/login`);
    } finally {
      setLoading(false);
    }
  }, [router, redirect, tenantId]);

  useEffect(() => { load(); }, [load]);

  const logout = useCallback(async () => {
    try { await customerApi.logout(); } catch { /* ignore */ }
    clearTokens();
    router.replace(`/store/${tenantId}`);
  }, [router, tenantId]);

  return { loading, me, refresh: load, logout };
}
