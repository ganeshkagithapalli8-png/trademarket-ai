import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Auth, setToken, clearToken, getToken, setUnauthorizedHandler } from '../lib/api.js';

const AuthContext = createContext(null);
// Loop-breaker: if a brand-new guest session is rejected within seconds, stop
// auto-retry and let the human decide (no infinite refresh loops, ever).
export const guestGuard = { lastAt: 0, broken: false };
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [wallet, setWallet] = useState({ simBalance: 0 });
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return null;
    }
    try {
      const data = await Auth.me();
      setUser(data.user);
      setWallet(data.wallet || { simBalance: 0 });
      setLoading(false);
      return data.user;
    } catch {
      clearToken();
      setUser(null);
      setLoading(false);
      return null;
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // A 401 anywhere in the app drops the session and returns to sign-in.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      // No expiry screens anywhere: a dead session silently re-enters the app.
      if (Date.now() - guestGuard.lastAt < 20000) guestGuard.broken = true;
      navigate('/', { replace: true });
    });
  }, [navigate]);

  const signup = useCallback(async (payload) => {
    const data = await Auth.signup(payload);
    setToken(data.token);
    setUser(data.user);
    setWallet({ simBalance: 0 });
    return data;
  }, []);

  const login = useCallback(async (payload) => {
    const data = await Auth.login(payload);
    setToken(data.token);
    setUser(data.user);
    const me = await Auth.me().catch(() => null);
    if (me) setWallet(me.wallet || { simBalance: 0 });
    return data;
  }, []);

  const adopt = useCallback(async (token, user) => {
    setToken(token);
    setUser(user);
    guestGuard.lastAt = Date.now();
    const me = await Auth.me().catch((e) => ({ __err: e?.status || 0 }));
    if (me && me.__err === 401) {
      // A brand-new session rejected on its very first check (seen through some
      // proxies): trust the issuance response once and continue. If the session
      // keeps failing, the loop-breaker shows a static retry screen instead of
      // cycling forever.
      setToken(token);
      setUser(user);
      return user;
    }
    if (me && !me.__err) {
      if (me.user) setUser(me.user);
      setWallet(me.wallet || { simBalance: 0 });
    }
    return user;
  }, []);

  const logout = useCallback(
    async (allDevices = false) => {
      try {
        await Auth.logout(allDevices);
      } catch {
        /* local sign-out must work even if the API is unreachable */
      }
      clearToken();
      setUser(null);
      setWallet({ simBalance: 0 });
      navigate('/auth', { replace: true });
    },
    [navigate]
  );

  const patchUser = useCallback((partial) => {
    setUser((u) => (u ? { ...u, ...partial } : u));
  }, []);

  const refreshWallet = useCallback(async () => {
    try {
      const me = await Auth.me();
      setWallet(me.wallet || { simBalance: 0 });
      return me.wallet;
    } catch {
      return null;
    }
  }, []);

  const value = useMemo(
    () => ({ user, wallet, loading, signup, login, logout, load, patchUser, refreshWallet, setWallet, adopt }),
    [user, wallet, loading, signup, login, logout, load, patchUser, refreshWallet, adopt]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
