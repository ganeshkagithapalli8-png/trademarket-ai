import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate, Link } from 'react-router-dom';
import { Auth as AuthApi } from './lib/api.js';
import { AuthProvider, useAuth, guestGuard } from './context/AuthContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { FundsProvider } from './context/FundsContext.jsx';
import Layout from './components/Layout.jsx';
import { Spinner, Logo } from './components/ui.jsx';
import Landing from './pages/Landing.jsx';
import AuthPage from './pages/Auth.jsx';

// Route-level code splitting keeps the first paint fast on mobile networks.
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Markets = lazy(() => import('./pages/Markets.jsx'));
const TradeView = lazy(() => import('./pages/TradeView.jsx'));
const Portfolio = lazy(() => import('./pages/Portfolio.jsx'));
const Wallet = lazy(() => import('./pages/Wallet.jsx'));
const Learn = lazy(() => import('./pages/Learn.jsx'));
const ModuleView = lazy(() => import('./pages/ModuleView.jsx'));
const BotLab = lazy(() => import('./pages/BotLab.jsx'));
const News = lazy(() => import('./pages/News.jsx'));
const Notes = lazy(() => import('./pages/Notes.jsx'));
const Journal = lazy(() => import('./pages/Journal.jsx'));
const Coach = lazy(() => import('./pages/Coach.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const NotFound = lazy(() => import('./pages/NotFound.jsx'));

function PageLoader() {
  return (
    <div className="grid min-h-[50vh] place-items-center">
      <div className="flex flex-col items-center gap-3">
        <Spinner className="h-7 w-7 text-brand-500" />
        <p className="text-[12.5px] font-semibold text-slate-400">Loading…</p>
      </div>
    </div>
  );
}

/**
 * Zero-click entry: opening the app drops you straight into the markets with a
 * guest paper session — no email, no account form in the way. Email accounts
 * remain opt-in at /auth (and the marketing tour lives at /welcome).
 */
// Concurrent gate mounts must not create parallel guest sessions (409 storms).
let pendingDemo = null;
const demoOnce = () => {
  pendingDemo = pendingDemo || AuthApi.demo().finally(() => { pendingDemo = null; });
  return pendingDemo;
};

function EnterMarkets() {
  const { user, loading, adopt } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [err, setErr] = useState('');
  const started = useRef(false);
  const dest = loc.state?.from || '/app/markets';

  useEffect(() => {
    if (loading || user || started.current) return;
    if (guestGuard.broken) {
      setErr('Your guest session was not accepted. Press Try again, or sign in with an email account.');
      return;
    }
    started.current = true;
    guestGuard.lastAt = Date.now();
    guestGuard.broken = false;
    const attempt = (left) =>
      demoOnce()
        .then((r) => adopt(r.token, r.user))
        .then(() => nav(dest, { replace: true }))
        .catch((e) => {
          const msg = e.message || 'Could not reach the market server.';
          const limited = /too many guest/i.test(msg);
          if (!limited && left > 0) return new Promise((r2) => setTimeout(r2, 900)).then(() => attempt(left - 1));
          started.current = false;
          setErr(msg);
        });
    attempt(2);
  }, [loading, user, adopt, nav, dest]);

  useEffect(() => {
    if (!loading && user) {
      guestGuard.broken = false; // a live session resets the loop-breaker
      nav(dest, { replace: true });
    }
  }, [loading, user, nav, dest]);

  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 px-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <Logo className="h-12 w-12 animate-pulse-soft" />
        {err ? (
          <>
            <p className="text-[14px] font-bold text-slate-800">The market server did not answer</p>
            <p className="text-[12.5px] leading-snug text-slate-500">{err}</p>
            <button
              onClick={() => { setErr(''); started.current = false; guestGuard.broken = false; }}
              className="rounded-xl bg-brand-600 px-4 py-2 text-[13px] font-bold text-white transition hover:bg-brand-700"
            >
              Try again
            </button>
          </>
        ) : (
          <>
            <p className="text-[15px] font-extrabold tracking-tight text-slate-900">Opening your markets…</p>
            <p className="text-[12.5px] leading-snug text-slate-500">
              Guest paper session — simulated rupees, no email needed.
            </p>
            <Spinner className="h-6 w-6 text-brand-500" />
          </>
        )}
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-1 text-[12px] font-semibold text-slate-500">
          <Link to="/auth" className="text-brand-600 hover:underline">Use an email account instead</Link>
          <Link to="/welcome" className="hover:underline">What is this app?</Link>
        </div>
      </div>
    </div>
  );
}

function Protected({ children }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="flex flex-col items-center gap-4">
          <Logo className="h-12 w-12 animate-pulse-soft" />
          <Spinner className="h-6 w-6 text-brand-500" />
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/" replace state={{ from: loc.pathname }} />;
  return <Layout>{children}</Layout>;
}

function PublicOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="grid min-h-screen place-items-center"><Spinner className="h-6 w-6 text-brand-500" /></div>;
  if (user) return <Navigate to="/app" replace />;
  return children;
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <FundsProvider>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<EnterMarkets />} />
            <Route path="/welcome" element={<Landing />} />
            <Route path="/auth" element={<PublicOnly><AuthPage /></PublicOnly>} />

            <Route path="/app" element={<Protected><Dashboard /></Protected>} />
            <Route path="/app/markets" element={<Protected><Markets /></Protected>} />
            <Route path="/app/trade/:symbol" element={<Protected><TradeView /></Protected>} />
            <Route path="/app/portfolio" element={<Protected><Portfolio /></Protected>} />
            <Route path="/app/wallet" element={<Protected><Wallet /></Protected>} />
            <Route path="/app/learn" element={<Protected><Learn /></Protected>} />
            <Route path="/app/learn/:id" element={<Protected><ModuleView /></Protected>} />
            <Route path="/app/bot" element={<Protected><BotLab /></Protected>} />
            <Route path="/app/news" element={<Protected><News /></Protected>} />
            <Route path="/app/notes" element={<Protected><Notes /></Protected>} />
            <Route path="/app/journal" element={<Protected><Journal /></Protected>} />
            <Route path="/app/coach" element={<Protected><Coach /></Protected>} />
            <Route path="/app/settings" element={<Protected><Settings /></Protected>} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
        </FundsProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
