import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
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
  if (!user) return <Navigate to="/auth" replace state={{ from: loc.pathname }} />;
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
            <Route path="/" element={<Landing />} />
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
