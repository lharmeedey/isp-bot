'use client';

/**
 * Thin REST client for the operator console.
 *
 * Token handling:
 *  - The access token (short-lived, 15 min) is kept in memory + localStorage so
 *    a page refresh doesn't force a re-login.
 *  - The refresh token is also persisted so non-cookie (cross-origin dev) flows
 *    work; in production the backend additionally sets an httpOnly cookie.
 *  - On any 401 we transparently try one refresh, then replay the request.
 *
 * NOTE: persisting tokens in localStorage trades some XSS exposure for a simple
 * cross-origin dev setup. Access tokens are short-lived and refresh rotation
 * revokes the chain on reuse. For a hardened same-origin deploy, rely on the
 * httpOnly refresh cookie and keep only the access token in memory.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3000';

const ACCESS_KEY  = 'isp_access';
const REFRESH_KEY = 'isp_refresh';

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
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include', // send/receive the refresh cookie when same-site
  });
  return res;
}

async function tryRefresh() {
  const refreshToken = getRefreshToken();
  const res = await rawFetch('/api/auth/refresh', {
    method: 'POST',
    auth: false,
    body: refreshToken ? { refreshToken } : {},
  });
  if (!res.ok) return false;
  const data = await res.json();
  setTokens(data);
  return true;
}

/**
 * apiFetch — JSON request with one automatic refresh-and-retry on 401.
 * Throws an Error with .status and .data on non-2xx (after the retry).
 */
export async function apiFetch(path, opts = {}) {
  let res = await rawFetch(path, opts);

  if (res.status === 401 && opts.auth !== false) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      res = await rawFetch(path, opts);
    }
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
export const api = {
  register: (payload) => apiFetch('/api/auth/register', { method: 'POST', auth: false, body: payload }),
  login:    (payload) => apiFetch('/api/auth/login',    { method: 'POST', auth: false, body: payload }),
  logout:   () => apiFetch('/api/auth/logout', { method: 'POST', body: { refreshToken: getRefreshToken() } }),
  me:       () => apiFetch('/api/auth/me'),

  // Onboarding
  saveProvider:  (payload) => apiFetch('/api/onboarding/provider', { method: 'PUT',  body: payload }),
  testProvider:  () => apiFetch('/api/onboarding/test',  { method: 'POST' }),
  voucherGroups: () => apiFetch('/api/onboarding/voucher-groups'),
  savePlans:     (plans)  => apiFetch('/api/onboarding/plans',   { method: 'POST', body: { plans } }),
  syncOnboard:   () => apiFetch('/api/onboarding/sync', { method: 'POST' }),
  activate:      () => apiFetch('/api/onboarding/activate', { method: 'POST' }),

  // Dashboard
  sales:    () => apiFetch('/api/dashboard/sales'),
  revenue:  () => apiFetch('/api/dashboard/revenue'),
  users:    () => apiFetch('/api/dashboard/users'),
  stock:    () => apiFetch('/api/dashboard/stock'),
  online:   () => apiFetch('/api/dashboard/online'),
  syncNow:  () => apiFetch('/api/dashboard/sync', { method: 'POST' }),
  listPlans:() => apiFetch('/api/dashboard/plans'),
  createPlan:(payload) => apiFetch('/api/dashboard/plans', { method: 'POST', body: payload }),
  updatePlan:(planId, payload) => apiFetch(`/api/dashboard/plans/${planId}`, { method: 'PUT', body: payload }),
  deletePlan:(planId) => apiFetch(`/api/dashboard/plans/${planId}`, { method: 'DELETE' }),
};
