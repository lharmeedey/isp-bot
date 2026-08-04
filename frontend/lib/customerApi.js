'use client';

/**
 * Storefront REST client for end-customers (buyers). A sibling of lib/api.js
 * with a SEPARATE token namespace (isp_cust_*) so one browser can be signed in
 * as both an operator and a customer without the two clobbering each other.
 *
 * Tenant scoping: public reads (plans/info) take the tenantId from the URL and
 * pass it explicitly. All authed calls rely on the customer JWT, whose tenantId
 * the backend trusts over anything the client sends.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3000';

const ACCESS_KEY  = 'isp_cust_access';
const REFRESH_KEY = 'isp_cust_refresh';

export function getAccessToken() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACCESS_KEY);
}
export function getRefreshToken() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(REFRESH_KEY);
}
export function setTokens({ accessToken, refreshToken }) {
  if (typeof window === 'undefined') return;
  if (accessToken)  window.localStorage.setItem(ACCESS_KEY, accessToken);
  if (refreshToken) window.localStorage.setItem(REFRESH_KEY, refreshToken);
}
export function clearTokens() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
}

async function rawFetch(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
  });
}

async function tryRefresh() {
  const refreshToken = getRefreshToken();
  const res = await rawFetch('/api/store/auth/refresh', {
    method: 'POST',
    auth: false,
    body: refreshToken ? { refreshToken } : {},
  });
  if (!res.ok) return false;
  const data = await res.json();
  setTokens(data);
  return true;
}

async function apiFetch(path, opts = {}) {
  let res = await rawFetch(path, opts);

  if (res.status === 401 && opts.auth !== false) {
    const refreshed = await tryRefresh();
    if (refreshed) res = await rawFetch(path, opts);
  }

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

// ── Endpoint helpers ─────────────────────────────────────────
export const customerApi = {
  // Public (tenant from URL)
  info:  (tenantId) => apiFetch(`/api/store/${tenantId}/info`, { auth: false }),
  plans: (tenantId) => apiFetch(`/api/store/${tenantId}/plans`, { auth: false }),
  register: (tenantId, payload) =>
    apiFetch(`/api/store/${tenantId}/auth/register`, { method: 'POST', auth: false, body: payload }),
  login: (tenantId, payload) =>
    apiFetch(`/api/store/${tenantId}/auth/login`, { method: 'POST', auth: false, body: payload }),

  // Authed (tenant from token)
  logout: () => apiFetch('/api/store/auth/logout', { method: 'POST', body: { refreshToken: getRefreshToken() } }),
  me:     () => apiFetch('/api/store/me'),

  // Checkout
  checkout: (plan)      => apiFetch('/api/checkout', { method: 'POST', body: { plan } }),
  verify:   (reference) => apiFetch(`/api/checkout/verify?reference=${encodeURIComponent(reference)}`),
};
