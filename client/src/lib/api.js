/**
 * API client.
 *
 * • Base URL comes from VITE_API_BASE_URL (baked in at build time on Vercel).
 *   When it is empty we use relative paths, which the Vite dev proxy forwards
 *   to the Express server — so no CORS in development.
 * • The JWT lives in localStorage and is sent as a Bearer header. That is what
 *   makes sessions work cross-device: sign in on each device, see every device
 *   under Settings → Sessions, revoke any of them remotely.
 * • NO SECRET KEYS ARE EVER PRESENT IN THIS FOLDER. Only the public API base
 *   URL and the user's own session token.
 */

const RAW_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
export const API_BASE = RAW_BASE || '';

const TOKEN_KEY = 'tm_token';
// Some environments block localStorage outright (private windows, embedded
// frames). A memory mirror keeps the guest session alive for the tab even then.
let memoryToken = null;

export const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? memoryToken;
  } catch {
    return memoryToken;
  }
};
export const setToken = (t) => {
  memoryToken = t || null;
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode — memory mirror still holds the session */
  }
};
export const clearToken = () => setToken(null);

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

let onUnauthorized = null;
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn;
};

async function request(path, { method = 'GET', body, signal, raw = false } = {}) {
  const token = getToken();
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(
      RAW_BASE
        ? `Could not reach the API at ${RAW_BASE}. Check that the backend is running and CLIENT_URL matches its CORS allow-list.`
        : 'Could not reach the API. Is the backend running?',
      0
    );
  }

  if (res.status === 401 && !path.startsWith('/api/auth/login')) {
    clearToken();
    onUnauthorized?.();
  }

  if (raw) return res;

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 300) };
    }
  }

  if (!res.ok) {
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data?.details);
  }
  return data;
}

export const api = {
  get: (p, o) => request(p, { ...o, method: 'GET' }),
  post: (p, body, o) => request(p, { ...o, method: 'POST', body }),
  patch: (p, body, o) => request(p, { ...o, method: 'PATCH', body }),
  del: (p, o) => request(p, { ...o, method: 'DELETE' }),
};

// ── endpoint groups ─────────────────────────────────────────────────────────

export const Auth = {
  signup: (b) => api.post('/api/auth/signup', b),
  login: (b) => api.post('/api/auth/login', b),
  demo: () => api.post('/api/auth/demo', {}),
  me: () => api.get('/api/auth/me'),
  logout: (allDevices = false) => api.post('/api/auth/logout', { allDevices }),
  sessions: () => api.get('/api/auth/sessions'),
  revokeSession: (id) => api.del(`/api/auth/sessions/${id}`),
  changePassword: (b) => api.post('/api/auth/password', b),
};

export const Profile = {
  get: () => api.get('/api/profile'),
  update: (b) => api.patch('/api/profile', b),
  marketAccess: () => api.get('/api/profile/market-access'),
};

export const Market = {
  markets: () => api.get('/api/market/markets'),
  instruments: (market = 'all') => api.get(`/api/market/instruments?market=${market}`),
  quote: (symbol) => api.get(`/api/market/quote/${encodeURIComponent(symbol)}`),
  candles: (symbol, interval = '15m', limit = 120) =>
    api.get(`/api/market/candles/${encodeURIComponent(symbol)}?interval=${interval}&limit=${limit}`),
  tickers: (market = 'all') => api.get(`/api/market/tickers?market=${market}`),
  history: (symbol, points = 90) => api.get(`/api/market/history/${encodeURIComponent(symbol)}?points=${points}`),
  news: (market = 'all', refresh = false) =>
    api.get(`/api/market/news?market=${market}${refresh ? '&refresh=1' : ''}`),
  liveStatus: () => api.get('/api/market/live-status'),
};

export const Wallet = {
  get: () => api.get('/api/wallet'),
  deposit: (amount) => api.post('/api/wallet/deposit', { amount }),
  withdraw: (amount) => api.post('/api/wallet/withdraw', { amount }),
  reset: () => api.post('/api/wallet/reset', {}),
  transactions: () => api.get('/api/wallet/transactions'),
};

export const Trade = {
  order: (b) => api.post('/api/trade/order', b),
  close: (id, reason = 'manual') => api.post(`/api/trade/close/${id}`, { reason }),
  positions: (status = 'open') => api.get(`/api/trade/positions?status=${status}`),
  orders: () => api.get('/api/trade/orders'),
  portfolio: () => api.get('/api/portfolio'),
};

export const Content = {
  notes: () => api.get('/api/notes'),
  createNote: (b) => api.post('/api/notes', b),
  updateNote: (id, b) => api.patch(`/api/notes/${id}`, b),
  deleteNote: (id) => api.del(`/api/notes/${id}`),
  summarizeNote: (id) => api.post(`/api/notes/${id}/summarize`, {}),

  watchlist: () => api.get('/api/watchlist'),
  addWatch: (b) => api.post('/api/watchlist', b),
  updateWatch: (id, b) => api.patch(`/api/watchlist/${id}`, b),
  removeWatch: (id) => api.del(`/api/watchlist/${id}`),

  journal: () => api.get('/api/journal'),
  createJournal: (b) => api.post('/api/journal', b),
  updateJournal: (id, b) => api.patch(`/api/journal/${id}`, b),
  deleteJournal: (id) => api.del(`/api/journal/${id}`),
  journalFeedback: (id) => api.post(`/api/journal/${id}/feedback`, {}),
};

export const Learn = {
  roadmap: () => api.get('/api/learn/roadmap'),
  module: (id) => api.get(`/api/learn/module/${id}`),
  read: (id, lessonId) => api.post(`/api/learn/module/${id}/read`, { lessonId }),
  quiz: (id, answers) => api.post(`/api/learn/module/${id}/quiz`, { answers }),
  reset: (id) => api.post(`/api/learn/module/${id}/reset`, {}),
};

export const Bot = {
  state: () => api.get('/api/bot/state'),
  setups: () => api.get('/api/bot/setups'),
  config: (b) => api.post('/api/bot/config', b),
  arm: (armed) => api.post('/api/bot/arm', { armed }),
  killSwitch: (on) => api.post('/api/bot/kill-switch', { on }),
  signals: (limit = 12) => api.get(`/api/bot/signals?limit=${limit}`),
  learning: () => api.get('/api/bot/learning'),
  memory: (limit = 50) => api.get(`/api/bot/memory?limit=${limit}`),
  resetMemory: () => api.post('/api/bot/memory/reset', {}),
  backtest: (b) => api.post('/api/bot/backtest', b),
  run: () => api.post('/api/bot/run', {}),
  analyse: (symbol, interval = '15m') => api.get(`/api/bot/analyse/${encodeURIComponent(symbol)}?interval=${interval}`),
};

export const AI = {
  modes: () => api.get('/api/ai/modes'),
  status: () => api.get('/api/ai/status'),
  generate: (b) => api.post('/api/ai/generate', b),
  briefing: (market = 'stocks') => api.get(`/api/ai/briefing?market=${market}`),
};

export default api;
